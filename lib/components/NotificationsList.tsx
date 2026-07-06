"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { formatHebrewDateTime } from "@/lib/dates";
import type { NotificationRow } from "@/lib/actions/notifications";
import type { ActionResult } from "@/lib/actions/students";

// A compact, read-only preview of one message/task, already normalized by
// the caller from getStudentMessages (trainee, real per-recipient
// read/completed state). fetchMessagePreview/onOpenMessages are optional -
// instructors don't have a messaging use-case today (they coordinate over a
// separate WhatsApp group) so the instructor "עדכונים" screen omits them and
// shows only system notifications.
export interface MessagePreviewItem {
  id: string;
  typeLabel: string;
  title: string;
  body: string;
  createdAt: string;
  isUnread: boolean | null;
}

// Shared by the instructor and student "עדכונים" screens - only the fetch/
// mark-read functions differ per role (getNotificationsForStudent vs
// getNotificationsForInstructor, etc.), everything else is identical.
// Deliberately uses an explicit "סימון כנקרא" button rather than
// auto-marking-as-read on open: every other read/unread flow already in
// this app (the message/task inbox) uses an explicit button, never a
// side-effect fired just from viewing a list, so this stays consistent with
// that convention instead of introducing a new, more surprising pattern.
//
// Messages/tasks are shown as a separate, clearly-labeled section rather
// than duplicating their own read/mark-as-read/complete controls here -
// that logic stays exactly where it already lives (the "הודעות ומשימות"
// screen). This section is a preview only; opening it (or tapping "פתיחה
// בהודעות ומשימות") navigates to that existing screen, which is the actual
// place to read/act on a message or task.
export function NotificationsList({
  fetchNotifications,
  onMarkRead,
  fetchMessagePreview,
  onOpenMessages,
}: {
  fetchNotifications: () => Promise<NotificationRow[]>;
  onMarkRead: (notificationId: string) => Promise<ActionResult>;
  fetchMessagePreview?: () => Promise<MessagePreviewItem[]>;
  onOpenMessages?: () => void;
}) {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messagePreview, setMessagePreview] = useState<MessagePreviewItem[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function load() {
    setLoadError(null);
    fetchNotifications()
      .then(setRows)
      .catch(() => {
        setRows([]);
        setLoadError("שגיאה בטעינת העדכונים. נסו לרענן.");
      });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!fetchMessagePreview) return;
    fetchMessagePreview()
      .then((items) => setMessagePreview(items.slice(0, 5)))
      .catch(() => setMessagePreview([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMarkRead(notificationId: string) {
    startTransition(async () => {
      const result = await onMarkRead(notificationId);
      if (!result.success) return;
      setRows((prev) =>
        prev
          ? prev.map((n) => (n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n))
          : prev
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-card-foreground">עדכונים</h1>
        <p className="mt-1 text-sm text-muted-foreground">התראות אוטומטיות על נוכחות וחומרי קורס חדשים.</p>
      </div>

      {loadError && <p className="rounded-lg bg-danger-muted p-3 text-sm text-danger">{loadError}</p>}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">טוען...</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          אין עדכונים כרגע
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((n) => {
            const isUnread = !n.readAt;
            return (
              <div
                key={n.id}
                className={`rounded-xl border p-4 ${
                  isUnread ? "border-primary/40 bg-primary/5" : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-card-foreground">
                    {isUnread && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    )}
                    <span className="truncate">{n.title}</span>
                  </p>
                  {isUnread && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleMarkRead(n.id)}
                      className="shrink-0 text-xs text-muted-foreground underline decoration-dotted disabled:opacity-50"
                    >
                      סימון כנקרא
                    </button>
                  )}
                </div>
                {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {formatHebrewDateTime(new Date(n.createdAt))}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {fetchMessagePreview && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-card-foreground">הודעות ומשימות אחרונות</h2>
          {messagePreview === null ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : messagePreview.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              אין הודעות או משימות כרגע
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {messagePreview.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-xl border p-3 ${
                    m.isUnread ? "border-primary/40 bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {m.isUnread && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    )}
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {m.typeLabel}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-card-foreground">
                      {m.title}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.body}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatHebrewDateTime(new Date(m.createdAt))}
                  </p>
                </div>
              ))}
            </div>
          )}
          {onOpenMessages && (
            <Button variant="secondary" onClick={onOpenMessages} className="self-start !text-sm">
              פתיחה בהודעות ומשימות
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
