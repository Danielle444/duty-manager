"use client";

import { useEffect, useState } from "react";
import { Button } from "@/lib/components/Button";
import { formatHebrewDate, formatHebrewDateTime, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import {
  getRidingHorsePublicationsForInstructor,
  type RidingHorsePublicationFeedItem,
} from "@/lib/actions/riding-slot-horse-publications";

type LoadStatus = "loading" | "loaded" | "error";

// Read-only - no checkboxes, no editable fields, no publish/update controls,
// no stale warning, no edit-from-message link, no archive/read state. Those
// all remain exclusive to RidingHorseListEditor/RidingHorsePublicationModal
// (the authoring side) or later stages. This section only ever renders the
// snapshot data getRidingHorsePublicationsForInstructor returns - never live
// RidingSlotHorseListItem rows, and never a trainee-audience publication
// (the server action itself only ever returns INSTRUCTORS-audience rows).
function PublicationCard({ item }: { item: RidingHorsePublicationFeedItem }) {
  const date = parseDateKey(item.date);
  const showActivityTitle = item.activityTitle && item.activityTitle !== item.title;
  const showFirstPublished = item.firstPublishedAt !== item.updatedAt;

  return (
    <div className="rounded-2xl border-2 border-border bg-card p-4">
      <div className="mb-1 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="min-w-0 break-words text-base font-bold text-card-foreground">{item.title}</p>
        <p className="shrink-0 text-xs text-muted-foreground">
          {formatHebrewWeekday(date)} · {formatHebrewDate(date)} · {item.startTime}-{item.endTime}
        </p>
      </div>
      {showActivityTitle && <p className="mb-2 break-words text-xs text-muted-foreground">{item.activityTitle}</p>}
      {item.generalNote && (
        <p className="mb-3 whitespace-pre-wrap break-words rounded-lg bg-secondary p-2 text-sm text-secondary-foreground">
          {item.generalNote}
        </p>
      )}

      {item.groups.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          אין סוסים לאיכוף בסשן זה
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {item.groups.map((group) => (
            <div
              key={group.groupName ?? "__none__"}
              className={`rounded-xl border-2 border-border p-3 ${getScheduleGroupColorClass(group.groupName)}`}
            >
              <p className="mb-2 text-sm font-bold text-card-foreground">
                {group.groupName ? `קבוצה ${group.groupName}` : "ללא קבוצה"}
              </p>
              <div className="flex flex-col gap-2">
                {group.subgroups.map((sub) => (
                  <div
                    key={sub.subgroupNumber ?? "__none__"}
                    className="rounded-lg border border-border bg-card p-2"
                  >
                    <p className="mb-1 text-base font-semibold text-card-foreground">
                      {sub.subgroupNumber != null ? `תת-קבוצה ${sub.subgroupNumber}` : "ללא תת-קבוצה"}
                    </p>
                    <p className="mb-2 break-words text-sm font-medium text-muted-foreground">
                      מדריכ/ה אחראי/ת: {sub.responsibleInstructorNames ?? "לא הוגדר"}
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {sub.items.map((row, index) => (
                        <li key={index} className="rounded-lg border border-border bg-card p-2">
                          <p className="break-words text-base font-bold text-card-foreground">{row.horseName}</p>
                          <p className="break-words text-xs text-muted-foreground">
                            {row.studentName ?? "ללא חניכ/ה משויכ/ת"}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        עודכן ע&quot;י {item.updatedByName} · {formatHebrewDateTime(new Date(item.updatedAt))}
      </p>
      {showFirstPublished && (
        <p className="text-[11px] text-muted-foreground">
          פורסם לראשונה: {formatHebrewDateTime(new Date(item.firstPublishedAt))}
        </p>
      )}
    </div>
  );
}

// Separate, independent section from InstructorMessagesSection - its own
// fetch, its own loading/error state, no shared data model with
// MessageTask/MessageTaskRecipient. A failure here never blocks the
// existing messages/tasks list from loading, since the two components
// share nothing beyond both being rendered under the same "messages" tab.
//
// Authorization is entirely server-side inside
// getRidingHorsePublicationsForInstructor (isActive AND (canEditRidingNotes
// OR canEditHorseFeeding)) - this component only passes instructorId
// through and renders whatever comes back (an empty array for an
// instructor who doesn't qualify), never re-implementing that check here.
export function InstructorRidingHorsePublicationsSection({ instructorId }: { instructorId: string }) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [items, setItems] = useState<RidingHorsePublicationFeedItem[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("loading");
    getRidingHorsePublicationsForInstructor(instructorId)
      .then((result) => {
        if (cancelled) return;
        setItems(result);
        setStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [instructorId, reloadToken]);

  function handleRetry() {
    setReloadToken((n) => n + 1);
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-3 text-lg font-bold text-card-foreground">עדכוני סוסים לאיכוף</h2>

      {status === "loading" && <p className="text-base text-muted-foreground">טוען...</p>}

      {status === "error" && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-danger">שגיאה בטעינת עדכוני הסוסים לאיכוף.</p>
          <Button variant="secondary" className="!px-3 !py-1.5 !text-sm" onClick={handleRetry}>
            ניסיון חוזר
          </Button>
        </div>
      )}

      {status === "loaded" && items.length === 0 && (
        <p className="text-base text-muted-foreground">אין כרגע עדכוני סוסים לאיכוף</p>
      )}

      {status === "loaded" && items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <PublicationCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
