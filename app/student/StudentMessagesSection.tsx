"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  getStudentMessages,
  markMessageRead,
  setTaskCompleted,
  type StudentMessageItem,
} from "@/lib/actions/messages";
import { formatHebrewDateTime } from "@/lib/dates";

const TYPE_LABELS: Record<StudentMessageItem["type"], string> = {
  MESSAGE: "הודעה",
  TASK: "משימה",
};

function isActive(item: StudentMessageItem): boolean {
  return item.type === "TASK" ? !item.completedAt : !item.readAt;
}

export function StudentMessagesSection({ studentId }: { studentId: string }) {
  const [items, setItems] = useState<StudentMessageItem[] | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getStudentMessages(studentId).then((result) => {
      if (!cancelled) setItems(result);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const { activeItems, historyItems } = useMemo(() => {
    if (!items) return { activeItems: [], historyItems: [] };
    return {
      activeItems: items.filter(isActive),
      historyItems: items.filter((item) => !isActive(item)),
    };
  }, [items]);

  function handleMarkRead(recipientId: string) {
    startTransition(async () => {
      const result = await markMessageRead(recipientId, studentId);
      if (!result.success) return;
      setItems((prev) =>
        prev
          ? prev.map((item) =>
              item.recipientId === recipientId
                ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
                : item
            )
          : prev
      );
    });
  }

  function handleSetCompleted(recipientId: string, completed: boolean) {
    startTransition(async () => {
      const result = await setTaskCompleted(recipientId, studentId, completed);
      if (!result.success) return;
      setItems((prev) =>
        prev
          ? prev.map((item) =>
              item.recipientId === recipientId
                ? { ...item, completedAt: completed ? new Date().toISOString() : null }
                : item
            )
          : prev
      );
    });
  }

  function renderCard(item: StudentMessageItem) {
    return (
      <div key={item.recipientId} className="rounded-xl border-2 border-border bg-card p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                item.type === "TASK"
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-success-muted text-success"
              }`}
            >
              {TYPE_LABELS[item.type]}
            </span>
            <p className="text-base font-bold text-card-foreground">{item.title}</p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              isActive(item) ? "bg-muted text-muted-foreground" : "bg-success-muted text-success"
            }`}
          >
            {item.type === "TASK"
              ? item.completedAt
                ? "הושלמה"
                : "פתוחה"
              : item.readAt
                ? "נקראה"
                : "לא נקראה"}
          </span>
        </div>
        <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {item.createdByName ?? "מנהלת"} · {formatHebrewDateTime(new Date(item.createdAt))}
          </p>
          {item.type === "MESSAGE" && !item.readAt && (
            <Button
              variant="secondary"
              className="!px-3 !py-1.5 !text-sm"
              disabled={isPending}
              onClick={() => handleMarkRead(item.recipientId)}
            >
              סימון כנקרא
            </Button>
          )}
          {item.type === "TASK" &&
            (item.completedAt ? (
              <Button
                variant="secondary"
                className="!px-3 !py-1.5 !text-sm"
                disabled={isPending}
                onClick={() => handleSetCompleted(item.recipientId, false)}
              >
                סימון כלא הושלמה
              </Button>
            ) : (
              <Button
                className="!px-3 !py-1.5 !text-sm"
                disabled={isPending}
                onClick={() => handleSetCompleted(item.recipientId, true)}
              >
                סימון כהושלמה
              </Button>
            ))}
        </div>
      </div>
    );
  }

  if (items === null) {
    return <p className="text-base text-muted-foreground">טוען...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {activeItems.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
            אין הודעות או משימות פתוחות
          </p>
        ) : (
          activeItems.map(renderCard)
        )}
      </div>

      {historyItems.length > 0 && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
            היסטוריה ({historyItems.length})
          </summary>
          <div className="mt-3 flex flex-col gap-3">{historyItems.map(renderCard)}</div>
        </details>
      )}
    </div>
  );
}
