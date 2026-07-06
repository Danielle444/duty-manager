"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { subscribeStudentToPush, unsubscribeStudentFromPush } from "@/lib/actions/push";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

type Support = "checking" | "unsupported" | "ios-not-installed" | "supported";

// Compact opt-in for real Web Push, shown only in the trainee profile screen.
// Deliberately never registers/subscribes automatically - the permission
// prompt only fires from handleSubscribe, i.e. only after a tap on "הפעלת
// התראות", never on mount/page load.
export function StudentPushSection({ studentId }: { studentId: string }) {
  const [support, setSupport] = useState<Support>("checking");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupport("unsupported");
      return;
    }
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (isIOS && !isStandalone) {
      setSupport("ios-not-installed");
      return;
    }
    setSupport("supported");

    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setSubscription(sub);
      })
      .catch(() => {
        // Registration failing just leaves the button in its "not
        // subscribed" state - tapping it will retry registration.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSubscribe() {
    setError(null);
    startTransition(async () => {
      try {
        const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidPublicKey) {
          setError("התראות אינן זמינות כרגע");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        });
        const json = sub.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
          setError("אירעה שגיאה בהפעלת ההתראות");
          return;
        }
        const result = await subscribeStudentToPush(
          studentId,
          { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
          navigator.userAgent
        );
        if (!result.success) {
          setError(result.error ?? "אירעה שגיאה בהפעלת ההתראות");
          return;
        }
        setSubscription(sub);
      } catch {
        setError("לא ניתן להפעיל התראות - יש לוודא שההרשאה אושרה בדפדפן");
      }
    });
  }

  function handleUnsubscribe() {
    setError(null);
    startTransition(async () => {
      if (!subscription) return;
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      setSubscription(null);
      await unsubscribeStudentFromPush(studentId, endpoint);
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="mb-1 text-base font-bold text-card-foreground">התראות לטלפון</p>

      {support === "checking" && <p className="text-sm text-muted-foreground">בודק זמינות...</p>}

      {support === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          הדפדפן הנוכחי אינו תומך בהתראות. יש לנסות דפדפן אחר או מכשיר אחר.
        </p>
      )}

      {support === "ios-not-installed" && (
        <p className="text-sm text-muted-foreground">
          באייפון יש להוסיף את האפליקציה למסך הבית כדי לקבל התראות.
        </p>
      )}

      {support === "supported" && (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            כדי לקבל עדכון כשנשלחת הודעה או משימה חדשה, יש לאשר התראות.
          </p>
          {error && <p className="mb-3 text-sm text-danger">{error}</p>}
          {subscription ? (
            <Button type="button" variant="secondary" disabled={isPending} onClick={handleUnsubscribe}>
              ביטול התראות
            </Button>
          ) : (
            <Button type="button" disabled={isPending} onClick={handleSubscribe}>
              הפעלת התראות
            </Button>
          )}
        </>
      )}
    </div>
  );
}
