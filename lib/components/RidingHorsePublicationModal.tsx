"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { formatHebrewDateTime } from "@/lib/dates";
import {
  getInstructorHorsePublicationStatusForAdmin,
  getInstructorHorsePublicationStatusForInstructor,
  publishRidingHorseListToInstructorsAsAdmin,
  publishRidingHorseListToInstructorsAsInstructor,
  type RidingHorsePublicationStatusLabel,
  type RidingSlotHorsePublicationStatus,
} from "@/lib/actions/riding-slot-horse-publications";

// Preview-only shapes - built by the caller (RidingHorseListEditor) from
// data it already has loaded (the last SAVED horse-list items + candidate
// responsible-instructor names), never from local/unsaved selection state.
// This is strictly a preview of what publishing would send - the horse/
// trainee rows themselves are never editable here.
export interface RidingHorsePublicationPreviewRow {
  horseName: string;
  studentName: string | null;
}

export interface RidingHorsePublicationPreviewSubgroup {
  subgroupNumber: number | null;
  responsibleInstructorNames: string | null;
  rows: RidingHorsePublicationPreviewRow[];
}

export interface RidingHorsePublicationPreviewGroup {
  groupName: string | null;
  subgroups: RidingHorsePublicationPreviewSubgroup[];
}

const STATUS_LABELS: Record<RidingHorsePublicationStatusLabel, string> = {
  UNPUBLISHED: "טרם פורסם למדריכים",
  CURRENT: "פורסם למדריכים",
  STALE: "הרשימה השתנתה מאז הפרסום האחרון",
};

const STALE_EXPLANATION =
  "הפרסום הקיים עדיין מציג את הרשימה שפורסמה קודם. עדכון הפרסום יחליף אותו ברשימה הנוכחית.";

// Exported so the entry-point button in RidingHorseListEditor uses the exact
// same wording as this modal's own submit button - one source of truth for
// these three labels.
export const RIDING_HORSE_PUBLICATION_ACTION_LABELS: Record<RidingHorsePublicationStatusLabel, string> = {
  UNPUBLISHED: "פרסום למדריכים",
  CURRENT: "עריכת הפרסום למדריכים",
  STALE: "עדכון הפרסום למדריכים",
};

type LoadStatus = "loading" | "loaded" | "error";

// Nested inside RidingHorseListEditor's own modal (which may itself be
// nested inside RidingSlotModal) - an independent Modal instance with its
// own onClose, so closing it (X, backdrop, or the "ביטול" button here)
// never touches the horse-list editor's own open state, and opening it
// never resets the editor's local selection state, since neither one is
// read or written here.
export function RidingHorsePublicationModal({
  open,
  onClose,
  ridingSlotId,
  actor,
  isListDirty,
  hasHorseList,
  previewGroups,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  ridingSlotId: string;
  actor: { type: "admin" } | { type: "instructor"; instructorId: string };
  // True when the horse-list editor has local selection changes that have
  // not been saved yet - publishing must always reflect the last SAVED
  // list, never in-progress client-only edits.
  isListDirty: boolean;
  // False only when no RidingSlotHorseList has ever been saved for this
  // slot yet - publishing is impossible until a first save happens.
  hasHorseList: boolean;
  previewGroups: RidingHorsePublicationPreviewGroup[];
  // Called once after a successful publish/update so the parent editor can
  // update its own CURRENT/STALE display without a full reload.
  onPublished: () => void;
}) {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [pubStatus, setPubStatus] = useState<RidingSlotHorsePublicationStatus | null>(null);
  const [title, setTitle] = useState("");
  const [generalNote, setGeneralNote] = useState("");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [isPublishing, startPublishTransition] = useTransition();
  const isPublishingRef = useRef(false);

  const instructorKey = actor.type === "instructor" ? actor.instructorId : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadStatus("loading");
    setPubStatus(null);
    setPublishError(null);
    setPublishSuccess(false);
    setTitle("");
    setGeneralNote("");

    const load =
      actor.type === "admin"
        ? getInstructorHorsePublicationStatusForAdmin(ridingSlotId)
        : getInstructorHorsePublicationStatusForInstructor(instructorKey as string, ridingSlotId);

    load
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setLoadStatus("error");
          return;
        }
        setPubStatus(result);
        // Prefill from the existing publication only - never duplicate the
        // server's default-title generation on the client, so an empty
        // field here always means "let the server decide."
        setTitle(result.publication?.title ?? "");
        setGeneralNote(result.publication?.generalNote ?? "");
        setLoadStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [open, ridingSlotId, actor.type, instructorKey]);

  function handlePublish() {
    if (isListDirty || !hasHorseList || isPublishingRef.current) return;
    setPublishError(null);
    setPublishSuccess(false);

    isPublishingRef.current = true;
    startPublishTransition(async () => {
      const trimmedTitle = title.trim();
      const trimmedNote = generalNote.trim() || null;
      const result =
        actor.type === "admin"
          ? await publishRidingHorseListToInstructorsAsAdmin({
              ridingSlotId,
              title: trimmedTitle,
              generalNote: trimmedNote,
            })
          : await publishRidingHorseListToInstructorsAsInstructor(actor.instructorId, {
              ridingSlotId,
              title: trimmedTitle,
              generalNote: trimmedNote,
            });
      isPublishingRef.current = false;

      // On failure, title/generalNote are deliberately left untouched (never
      // reset here) so the user doesn't lose in-progress input and can retry.
      if (!result.success || !result.status) {
        setPublishError(result.error ?? "אירעה שגיאה בפרסום");
        return;
      }

      setPubStatus(result.status);
      // Reflect back what the server actually saved (e.g. a generated
      // default title when the field was left blank) rather than leaving
      // the form showing what was submitted.
      setTitle(result.status.publication?.title ?? "");
      setGeneralNote(result.status.publication?.generalNote ?? "");
      setPublishSuccess(true);
      onPublished();
    });
  }

  const actionLabel = pubStatus
    ? RIDING_HORSE_PUBLICATION_ACTION_LABELS[pubStatus.status]
    : RIDING_HORSE_PUBLICATION_ACTION_LABELS.UNPUBLISHED;
  const canPublish = hasHorseList && !isListDirty && !isPublishing;

  return (
    <Modal open={open} title="פרסום רשימת סוסים למדריכים" size="wide" onClose={onClose}>
      <div className="flex max-h-[80vh] flex-col gap-3">
        {loadStatus === "loading" && <p className="text-sm text-muted-foreground">טוען...</p>}
        {loadStatus === "error" && (
          <p className="text-sm text-danger">שגיאה בטעינת סטטוס הפרסום. נסו לרענן.</p>
        )}

        {loadStatus === "loaded" && pubStatus && (
          <>
            <div className="shrink-0 rounded-lg bg-secondary p-2 text-xs text-secondary-foreground">
              <p className="font-semibold">{STATUS_LABELS[pubStatus.status]}</p>
              {pubStatus.status === "STALE" && <p className="mt-1">{STALE_EXPLANATION}</p>}
              <p className="mt-1">גרסת רשימת הסוסים הנוכחית: {pubStatus.horseListVersion}</p>
              {pubStatus.publication && (
                <>
                  <p>גרסת הרשימה שפורסמה: {pubStatus.publication.sourceVersion}</p>
                  <p>
                    פורסם לראשונה: {formatHebrewDateTime(new Date(pubStatus.publication.firstPublishedAt))}
                    {" · "}עודכן לאחרונה: {formatHebrewDateTime(new Date(pubStatus.publication.updatedAt))}
                    {" · "}
                    {pubStatus.publication.updatedByName}
                  </p>
                </>
              )}
            </div>

            {isListDirty && (
              <p className="shrink-0 rounded-lg bg-warning-muted p-2 text-sm font-medium text-warning">
                יש שינויים ברשימת הסוסים שטרם נשמרו. יש לשמור את הרשימה לפני הפרסום.
              </p>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1">
              <label className="flex flex-col gap-1 text-sm">
                כותרת הפרסום
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="ריק = תיווצר כותרת אוטומטית לפי פרטי הרכיבה"
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                הערה כללית (אופציונלי)
                <textarea
                  value={generalNote}
                  onChange={(e) => setGeneralNote(e.target.value)}
                  rows={3}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>

              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-card-foreground">
                  תצוגה מקדימה של הרשימה שתפורסם
                </p>
                {previewGroups.length === 0 ? (
                  <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
                    אין סוסים לאיכוף בסשן זה
                  </p>
                ) : (
                  previewGroups.map((group) => (
                    <div
                      key={group.groupName ?? "__none__"}
                      className="rounded-lg border border-border bg-card p-2"
                    >
                      <p className="mb-1 text-sm font-bold text-card-foreground">
                        {group.groupName ? `קבוצה ${group.groupName}` : "ללא קבוצה"}
                      </p>
                      <div className="flex flex-col gap-2">
                        {group.subgroups.map((sub) => (
                          <div key={sub.subgroupNumber ?? "__none__"}>
                            <p className="text-xs font-semibold text-card-foreground">
                              {sub.subgroupNumber != null ? `תת-קבוצה ${sub.subgroupNumber}` : "ללא תת-קבוצה"}
                              {" · "}
                              <span className="font-normal text-muted-foreground">
                                מדריכ/ה אחראי/ת: {sub.responsibleInstructorNames ?? "לא הוגדר"}
                              </span>
                            </p>
                            <ul className="mt-1 flex flex-col gap-0.5 text-sm text-card-foreground">
                              {sub.rows.map((row, index) => (
                                <li key={index}>
                                  {row.horseName}
                                  {row.studentName ? ` — ${row.studentName}` : " — ללא חניכ/ה משויכ/ת"}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {publishError && <p className="shrink-0 text-sm text-danger">{publishError}</p>}
            {publishSuccess && !publishError && (
              <p className="shrink-0 text-sm text-success">✓ הפרסום נשמר בהצלחה</p>
            )}

            <div className="flex shrink-0 justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                ביטול
              </Button>
              <Button type="button" disabled={!canPublish} onClick={handlePublish}>
                {isPublishing ? "מפרסם..." : actionLabel}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
