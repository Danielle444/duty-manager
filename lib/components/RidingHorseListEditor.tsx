"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { SuggestInput } from "@/lib/components/SuggestInput";
import { formatHebrewDateTime } from "@/lib/dates";
import { groupByGroupAndSubgroup } from "@/lib/attendance-ui";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import { getKnownRidingHorseNames } from "@/lib/actions/riding-slots";
import {
  getRidingSlotHorseListForAdmin,
  getRidingSlotHorseListForInstructor,
  saveRidingSlotHorseListAsAdmin,
  saveRidingSlotHorseListAsInstructor,
  type RidingHorseCandidate,
  type RidingSlotHorseListForEditing,
  type RidingSlotHorseListItemRow,
} from "@/lib/actions/riding-slot-horses";
import {
  RidingHorsePublicationModal,
  RIDING_HORSE_PUBLICATION_ACTION_LABELS,
  type RidingHorsePublicationPreviewGroup,
} from "@/lib/components/RidingHorsePublicationModal";
import type { RidingHorsePublicationStatusLabel } from "@/lib/actions/riding-slot-horse-publications";

export type RidingHorseListEditorActor = { type: "admin" } | { type: "instructor"; instructorId: string };

interface SelectionEntry {
  selected: boolean;
  horseName: string;
}

type LoadStatus = "loading" | "loaded" | "not-found" | "error";

function buildSelectionFromData(data: RidingSlotHorseListForEditing): Record<string, SelectionEntry> {
  const savedByStudentId = new Map(
    data.items.filter((item) => item.studentId).map((item) => [item.studentId as string, item])
  );
  const selection: Record<string, SelectionEntry> = {};
  for (const candidate of data.candidates) {
    const saved = savedByStudentId.get(candidate.studentId);
    selection[candidate.studentId] = saved
      ? { selected: true, horseName: saved.horseName }
      : { selected: false, horseName: candidate.horseName ?? "" };
  }
  return selection;
}

// Whether the current in-memory selection differs from the last SAVED
// state (re-derived from `data` via buildSelectionFromData) - used only to
// block publishing unsaved client-only changes, never to gate the horse-list
// save itself.
function hasUnsavedListChanges(
  current: Record<string, SelectionEntry>,
  data: RidingSlotHorseListForEditing
): boolean {
  const saved = buildSelectionFromData(data);
  return data.candidates.some((candidate) => {
    const a = current[candidate.studentId] ?? { selected: false, horseName: "" };
    const b = saved[candidate.studentId] ?? { selected: false, horseName: "" };
    if (a.selected !== b.selected) return true;
    if (a.selected && a.horseName.trim() !== b.horseName.trim()) return true;
    return false;
  });
}

// Preview-only projection of what publishing would send - built strictly
// from the last SAVED horse-list items (data.items), never from local
// unsaved selection state. responsibleInstructorNames is looked up per
// group/subgroup from the candidate sections already computed for the main
// editor list, so it isn't resolved a second time.
function buildPublicationPreviewGroups(
  items: RidingSlotHorseListItemRow[],
  candidateSections: ReturnType<typeof groupByGroupAndSubgroup<RidingHorseCandidate>>
): RidingHorsePublicationPreviewGroup[] {
  const instructorNamesByKey = new Map<string, string | null>();
  for (const section of candidateSections) {
    for (const sub of section.subgroups) {
      instructorNamesByKey.set(
        `${section.groupName ?? ""}::${sub.subgroupNumber ?? ""}`,
        sub.items[0]?.responsibleInstructorNames ?? null
      );
    }
  }

  return groupByGroupAndSubgroup(items).map((section) => ({
    groupName: section.groupName,
    subgroups: section.subgroups.map((sub) => ({
      subgroupNumber: sub.subgroupNumber,
      responsibleInstructorNames:
        instructorNamesByKey.get(`${section.groupName ?? ""}::${sub.subgroupNumber ?? ""}`) ?? null,
      rows: sub.items.map((item) => ({ horseName: item.horseName, studentName: item.studentName })),
    })),
  }));
}

// Shared between the admin RidingSlotModal and InstructorRidingSlotsSection -
// entirely self-contained (fetches on open, saves via its own actor-specific
// server action) so neither caller needs to manage this feature's state.
// Explicit save only, by design - there is no autosave anywhere in this
// component.
export function RidingHorseListEditor({
  open,
  onClose,
  ridingSlotId,
  contextLabel,
  actor,
}: {
  open: boolean;
  onClose: () => void;
  ridingSlotId: string;
  contextLabel?: string;
  actor: RidingHorseListEditorActor;
}) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [data, setData] = useState<RidingSlotHorseListForEditing | null>(null);
  const [selection, setSelection] = useState<Record<string, SelectionEntry>>({});
  const [knownHorseNames, setKnownHorseNames] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();
  // Synchronous guard (isSaving from useTransition only updates on the next
  // render) so a fast double-click can never fire a second overlapping save.
  const isSavingRef = useRef(false);

  // Independent of the horse-list load/save state above - opening/closing
  // this never touches `selection`, so in-progress unsaved edits are never
  // reset by it.
  const [showPublicationModal, setShowPublicationModal] = useState(false);

  const instructorKey = actor.type === "instructor" ? actor.instructorId : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Reset every time the modal opens (or targets a different slot) so a
    // slow request never leaves a previous slot's data visible under the new
    // one - same convention as RidingSlotModal's own load effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("loading");
    setData(null);
    setSelection({});
    setSaveError(null);
    setSaveSuccess(false);

    const load =
      actor.type === "admin"
        ? getRidingSlotHorseListForAdmin(ridingSlotId)
        : getRidingSlotHorseListForInstructor(instructorKey as string, ridingSlotId);

    load
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setStatus("not-found");
          return;
        }
        setData(result);
        setSelection(buildSelectionFromData(result));
        setStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });

    getKnownRidingHorseNames().then((names) => {
      if (!cancelled) setKnownHorseNames(names);
    });

    return () => {
      cancelled = true;
    };
  }, [open, ridingSlotId, actor.type, instructorKey]);

  function toggleCandidate(candidate: RidingHorseCandidate) {
    setSaveSuccess(false);
    setSelection((current) => {
      const existing = current[candidate.studentId];
      return {
        ...current,
        [candidate.studentId]: {
          selected: !(existing?.selected ?? false),
          horseName: existing?.horseName ?? candidate.horseName ?? "",
        },
      };
    });
  }

  function setHorseNameFor(studentId: string, value: string) {
    setSaveSuccess(false);
    setSelection((current) => ({
      ...current,
      [studentId]: { selected: current[studentId]?.selected ?? false, horseName: value },
    }));
  }

  function handleSave() {
    if (!data || isSavingRef.current) return;
    setSaveError(null);

    const items: { groupName?: string; subgroupNumber?: number; studentId?: string; horseName: string }[] = [];
    for (const candidate of data.candidates) {
      const sel = selection[candidate.studentId];
      if (!sel?.selected) continue;
      const horseName = sel.horseName.trim();
      if (!horseName) {
        setSaveError(`יש להזין שם סוס עבור ${candidate.studentName}`);
        return;
      }
      items.push({
        studentId: candidate.studentId,
        groupName: candidate.groupName ?? undefined,
        subgroupNumber: candidate.subgroupNumber ?? undefined,
        horseName,
      });
    }

    isSavingRef.current = true;
    startSaveTransition(async () => {
      const result =
        actor.type === "admin"
          ? await saveRidingSlotHorseListAsAdmin({ ridingSlotId, items })
          : await saveRidingSlotHorseListAsInstructor(actor.instructorId, { ridingSlotId, items });
      isSavingRef.current = false;

      // On failure, local selections are deliberately left untouched (never
      // reset here) so the user doesn't lose in-progress work and can retry.
      if (!result.success || !result.status) {
        setSaveError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }

      const savedStatus = result.status;
      setData((prev) => (prev ? { ...prev, ...savedStatus } : prev));
      const newSelection: Record<string, SelectionEntry> = {};
      for (const candidate of data.candidates) {
        const saved = savedStatus.items.find((item) => item.studentId === candidate.studentId);
        newSelection[candidate.studentId] = saved
          ? { selected: true, horseName: saved.horseName }
          : { selected: false, horseName: candidate.horseName ?? "" };
      }
      setSelection(newSelection);
      setSaveSuccess(true);
    });
  }

  const sections = groupByGroupAndSubgroup(data?.candidates ?? []);
  const candidateStudentIds = new Set((data?.candidates ?? []).map((c) => c.studentId));
  // Saved rows that no longer match any live candidate (student removed from
  // this slot's roster, moved group/subgroup, or the Student relation went
  // null) - shown read-only rather than silently dropped from view. Not
  // resubmitted on the next save unless the matching trainee returns to the
  // roster, which is what actually removes them (full-replace semantics).
  const orphanItems = (data?.items ?? []).filter(
    (item) => !item.studentId || !candidateStudentIds.has(item.studentId)
  );

  // Drives the entry-point button's label - derived from the same H3
  // booleans already loaded on `data` (hasPublications/hasStalePublication),
  // not a second fetch. Kept in sync after a successful publish via
  // handlePublished below, without a full reload.
  const publicationButtonStatus: RidingHorsePublicationStatusLabel = !data?.hasPublications
    ? "UNPUBLISHED"
    : data.hasStalePublication
      ? "STALE"
      : "CURRENT";
  const isListDirty = data ? hasUnsavedListChanges(selection, data) : false;
  const previewGroups = data ? buildPublicationPreviewGroups(data.items, sections) : [];

  function handlePublished() {
    // A successful publish/update always results in CURRENT status (its
    // sourceVersion was just set to the live list's version) - update this
    // editor's own status display immediately, without a full reload.
    setData((prev) => (prev ? { ...prev, hasPublications: true, hasStalePublication: false } : prev));
  }

  return (
    <Modal
      open={open}
      title={contextLabel ? `הגדרת סוסים לאיכוף - ${contextLabel}` : "הגדרת סוסים לאיכוף"}
      size="wide"
      onClose={onClose}
    >
      <div className="flex max-h-[80vh] flex-col gap-3">
        {status === "loading" && <p className="text-sm text-muted-foreground">טוען...</p>}
        {status === "not-found" && (
          <p className="text-sm text-danger">רכיבה זו לא נמצאה. ייתכן שנמחקה - סגרו ורעננו את העמוד.</p>
        )}
        {status === "error" && <p className="text-sm text-danger">שגיאה בטעינת רשימת הסוסים. נסו לרענן.</p>}

        {status === "loaded" && data && (
          <>
            <div className="shrink-0 rounded-lg bg-secondary p-2 text-xs text-secondary-foreground">
              {data.listId ? (
                <>
                  <p>
                    גרסה {data.version}
                    {data.updatedByName ? ` · עודכן ע"י ${data.updatedByName}` : ""}
                    {data.updatedAt ? ` · ${formatHebrewDateTime(new Date(data.updatedAt))}` : ""}
                  </p>
                  {data.hasStalePublication && (
                    <p className="mt-1 font-medium text-warning">הרשימה שונתה מאז הפרסום האחרון</p>
                  )}
                </>
              ) : (
                <p>רשימת הסוסים לרכיבה זו טרם נשמרה</p>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1">
              {sections.length === 0 ? (
                <p className="text-sm text-muted-foreground">אין חניכים רלוונטיים לרכיבה זו</p>
              ) : (
                sections.map((section) => (
                  <div
                    key={section.groupName ?? "__none__"}
                    className={`rounded-xl border-2 border-border p-3 ${getScheduleGroupColorClass(section.groupName)}`}
                  >
                    <p className="mb-2 text-sm font-bold text-card-foreground">
                      {section.groupName ? `קבוצה ${section.groupName}` : "ללא קבוצה"}
                    </p>
                    <div className="flex flex-col gap-2">
                      {section.subgroups.map((sub) => (
                        <div
                          key={sub.subgroupNumber ?? "__none__"}
                          className="rounded-lg border border-border bg-card p-2"
                        >
                          <p className="mb-1 text-base font-semibold text-card-foreground">
                            {sub.subgroupNumber != null ? `תת-קבוצה ${sub.subgroupNumber}` : "ללא תת-קבוצה"}
                          </p>
                          <p className="mb-2 text-sm font-medium text-muted-foreground">
                            מדריכ/ה אחראי/ת: {sub.items[0]?.responsibleInstructorNames ?? "לא הוגדר"}
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {sub.items.map((candidate) => {
                              const sel = selection[candidate.studentId] ?? {
                                selected: false,
                                horseName: candidate.horseName ?? "",
                              };
                              return (
                                <div
                                  key={candidate.studentId}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => toggleCandidate(candidate)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      toggleCandidate(candidate);
                                    }
                                  }}
                                  className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-right focus:outline-none focus:ring-2 focus:ring-primary sm:flex-row sm:items-center sm:justify-between ${
                                    sel.selected ? "border-primary bg-primary/5" : "border-border bg-card"
                                  }`}
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-3">
                                    <input
                                      type="checkbox"
                                      checked={sel.selected}
                                      onChange={() => toggleCandidate(candidate)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="h-5 w-5 shrink-0"
                                      aria-label={`בחירת סוס עבור ${candidate.studentName}`}
                                    />
                                    <div className="min-w-0 flex-1">
                                      {sel.selected ? (
                                        <div
                                          onClick={(e) => e.stopPropagation()}
                                          onKeyDown={(e) => e.stopPropagation()}
                                        >
                                          <SuggestInput
                                            value={sel.horseName}
                                            onChange={(value) => setHorseNameFor(candidate.studentId, value)}
                                            suggestions={knownHorseNames}
                                            placeholder={candidate.horseName ?? "שם הסוס"}
                                          />
                                        </div>
                                      ) : (
                                        <p className="truncate text-base font-bold text-card-foreground">
                                          {candidate.horseName ? candidate.horseNameDisplay : "לא הוגדר סוס"}
                                        </p>
                                      )}
                                      <p className="truncate text-xs text-muted-foreground">
                                        {candidate.studentName}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}

              {orphanItems.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning-muted/30 p-3 text-xs text-warning">
                  <p className="mb-1 font-semibold">
                    רשומות שמורות שאינן חלק מרשימת החניכ/ים הנוכחית של רכיבה זו:
                  </p>
                  <ul className="list-inside list-disc">
                    {orphanItems.map((item, index) => (
                      <li key={index}>
                        {item.horseName}
                        {item.studentName ? ` - ${item.studentName}` : " - ללא חניכ/ה משויכ/ת"}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1">רשומות אלו יוסרו בשמירה הבאה אלא אם החניכ/ה ישוב/תשוב לרשימת הרכיבה.</p>
                </div>
              )}
            </div>

            {saveError && <p className="shrink-0 text-sm text-danger">{saveError}</p>}
            {saveSuccess && !saveError && (
              <p className="shrink-0 text-sm text-success">✓ רשימת הסוסים נשמרה בהצלחה</p>
            )}

            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={!data.listId}
                onClick={() => setShowPublicationModal(true)}
              >
                {RIDING_HORSE_PUBLICATION_ACTION_LABELS[publicationButtonStatus]}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                ביטול
              </Button>
              <Button type="button" disabled={isSaving} onClick={handleSave}>
                {isSaving ? "שומר..." : "שמירת רשימת הסוסים"}
              </Button>
            </div>
          </>
        )}
      </div>

      {data && (
        <RidingHorsePublicationModal
          open={showPublicationModal}
          onClose={() => setShowPublicationModal(false)}
          ridingSlotId={ridingSlotId}
          actor={actor}
          isListDirty={isListDirty}
          hasHorseList={Boolean(data.listId)}
          previewGroups={previewGroups}
          onPublished={handlePublished}
        />
      )}
    </Modal>
  );
}
