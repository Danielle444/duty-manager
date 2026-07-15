"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  listStudentRidingProgressFeedbackForInstructor,
  createStudentRidingProgressFeedbackAsInstructor,
  updateStudentRidingProgressFeedbackAsInstructor,
  deleteStudentRidingProgressFeedbackAsInstructor,
} from "@/lib/actions/student-riding-progress-feedback-instructor";
import {
  listStudentLungeProgressFeedbackForInstructor,
  createStudentLungeProgressFeedbackAsInstructor,
  updateStudentLungeProgressFeedbackAsInstructor,
  deleteStudentLungeProgressFeedbackAsInstructor,
} from "@/lib/actions/student-lunge-progress-feedback-instructor";
import { RidingProgressFeedbackList } from "@/lib/components/RidingProgressFeedbackSection";
import { LungeProgressFeedbackList } from "@/lib/components/LungeProgressFeedbackSection";
import type { StudentRidingProgressFeedbackRow } from "@/lib/actions/student-riding-progress-feedback";
import type { StudentLungeProgressFeedbackRow } from "@/lib/actions/student-lunge-progress-feedback";
import { getHorseDisplayInfo } from "@/lib/horse-info";

// Stage I2 - instructor/coach-facing "מעקב חניכים" screen for the two
// newer trainee-progress journals (רכיבה, לונג׳ בלי רוכב). Deliberately
// does NOT include הדרכת מתקדמים (already has its own instructor flow -
// see app/instructor/InstructorRidingSlotsSection.tsx, the "רכיבות" main
// tab) or התנסויות מתחילים (already has its own instructor flow - see
// app/instructor/InstructorTeachingPracticeSection.tsx, the "התנסויות
// מתחילים" עוד item) or פרזנטציה (next stage). This screen only reads/
// writes StudentRidingProgressFeedback/StudentLungeProgressFeedback via the
// Stage I1 instructor actions, which re-check Instructor.canEditRidingNotes
// fresh from the DB on every call - the same permission already gates
// whether this screen is even shown (see InstructorClient.tsx), reused
// deliberately rather than a new permission (see the Stage I1 instructor
// action files' own comments for the full rationale).
//
// UI reuse: the רכיבה/לונג׳ form+list components are shared with the admin
// page via lib/components/RidingProgressFeedbackSection.tsx and
// lib/components/LungeProgressFeedbackSection.tsx (Stage I2 extraction) -
// this screen passes thin wrappers around the *AsInstructor actions
// (currying instructorId through) as each component's `actions` prop, so
// the exact same form/list UI/validation-echo is never duplicated between
// admin and instructor.
//
// Students: reuses the `students` prop already loaded once in
// app/instructor/page.tsx (active students only, id/fullName/groupName/
// subgroupNumber) and threaded through InstructorClient.tsx to every other
// instructor section - no new "list students" action needed for this stage.
// `studentHorseInfo` is a separate, second read added alongside that same
// Promise.all in app/instructor/page.tsx (id/hasPrivateHorse/
// privateHorseName/assignedHorseName only) so the shared StudentOption
// shape consumed by every other instructor tab stays untouched - this
// section merges the two by id purely for its own group/horse browsing UI.

const NO_GROUP_LABEL = "ללא קבוצה";
const NO_SUBGROUP_LABEL = "ללא תת-קבוצה";

interface TraineeProgressStudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

interface TraineeProgressHorseInfoOption {
  id: string;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

interface MergedTraineeRow {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

interface SubgroupBucket {
  subgroupNumber: number | null;
  trainees: MergedTraineeRow[];
}

interface GroupSection {
  groupName: string | null;
  subgroups: SubgroupBucket[];
}

// Deterministic ordering: no project-wide group-order constant exists yet
// (checked - every other group/subgroup UI in the app either hardcodes א/ב
// options or relies on plain string sort, same as here), so groups sort
// alphabetically with no-group last, subgroups ascend numerically with
// no-subgroup last, and trainees sort alphabetically by name within each
// subgroup.
function buildGroupSections(rows: MergedTraineeRow[]): GroupSection[] {
  const sectionByGroup = new Map<string, GroupSection>();

  for (const row of rows) {
    const groupKey = row.groupName ?? "__none__";
    let section = sectionByGroup.get(groupKey);
    if (!section) {
      section = { groupName: row.groupName, subgroups: [] };
      sectionByGroup.set(groupKey, section);
    }

    const subKey = row.subgroupNumber ?? -1;
    let bucket = section.subgroups.find((b) => (b.subgroupNumber ?? -1) === subKey);
    if (!bucket) {
      bucket = { subgroupNumber: row.subgroupNumber, trainees: [] };
      section.subgroups.push(bucket);
    }
    bucket.trainees.push(row);
  }

  const sections = Array.from(sectionByGroup.values());
  sections.sort((a, b) => {
    if (a.groupName === null) return b.groupName === null ? 0 : 1;
    if (b.groupName === null) return -1;
    return a.groupName.localeCompare(b.groupName, "he");
  });

  for (const section of sections) {
    section.subgroups.sort((a, b) => {
      if (a.subgroupNumber == null) return b.subgroupNumber == null ? 0 : 1;
      if (b.subgroupNumber == null) return -1;
      return a.subgroupNumber - b.subgroupNumber;
    });
    for (const bucket of section.subgroups) {
      bucket.trainees.sort((a, b) => a.fullName.localeCompare(b.fullName, "he"));
    }
  }

  return sections;
}

// Priority: private horse name (when hasPrivateHorse and a name was
// entered) -> assigned course horse name -> explicit "not set" placeholder.
// Reuses the same shared badgeType priority as every other horse display in
// the app (lib/horse-info.ts) so this only diverges in the "none" label
// text, per this screen's own product spec.
function horseSecondaryText(row: MergedTraineeRow): string {
  const info = getHorseDisplayInfo(row);
  return info.badgeType === "none" ? "לא הוגדר סוס" : info.horseNameDisplay;
}

export function InstructorTraineeProgressSection({
  instructorId,
  students,
  studentHorseInfo,
}: {
  instructorId: string;
  students: TraineeProgressStudentOption[];
  studentHorseInfo: TraineeProgressHorseInfoOption[];
}) {
  const [search, setSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [ridingRows, setRidingRows] = useState<StudentRidingProgressFeedbackRow[] | null>(null);
  const [lungeRows, setLungeRows] = useState<StudentLungeProgressFeedbackRow[] | null>(null);

  const mergedTrainees = useMemo<MergedTraineeRow[]>(() => {
    const horseById = new Map(studentHorseInfo.map((h) => [h.id, h]));
    return students.map((s) => {
      const horse = horseById.get(s.id);
      return {
        id: s.id,
        fullName: s.fullName,
        groupName: s.groupName,
        subgroupNumber: s.subgroupNumber,
        hasPrivateHorse: horse?.hasPrivateHorse ?? false,
        privateHorseName: horse?.privateHorseName ?? null,
        assignedHorseName: horse?.assignedHorseName ?? null,
      };
    });
  }, [students, studentHorseInfo]);

  const filteredTrainees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mergedTrainees;
    return mergedTrainees.filter((t) => t.fullName.toLowerCase().includes(q));
  }, [search, mergedTrainees]);

  const sections = useMemo(() => buildGroupSections(filteredTrainees), [filteredTrainees]);

  const selectedStudent = useMemo(
    () => mergedTrainees.find((t) => t.id === selectedStudentId) ?? null,
    [mergedTrainees, selectedStudentId]
  );

  // Own rows only (list...ForInstructor already filters to
  // createdByInstructorId === this instructor - see that action's own
  // comment) - never another instructor's or an admin's rows, by design.
  useEffect(() => {
    if (!selectedStudentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRidingRows(null);
      return;
    }
    let cancelled = false;
    setRidingRows(null);
    startTransition(async () => {
      const result = await listStudentRidingProgressFeedbackForInstructor(instructorId, selectedStudentId);
      if (!cancelled) setRidingRows(result ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [instructorId, selectedStudentId]);

  useEffect(() => {
    if (!selectedStudentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLungeRows(null);
      return;
    }
    let cancelled = false;
    setLungeRows(null);
    startTransition(async () => {
      const result = await listStudentLungeProgressFeedbackForInstructor(instructorId, selectedStudentId);
      if (!cancelled) setLungeRows(result ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [instructorId, selectedStudentId]);

  function refreshRiding() {
    if (!selectedStudentId) return;
    startTransition(async () => {
      const result = await listStudentRidingProgressFeedbackForInstructor(instructorId, selectedStudentId);
      setRidingRows(result ?? []);
    });
  }

  function refreshLunge() {
    if (!selectedStudentId) return;
    startTransition(async () => {
      const result = await listStudentLungeProgressFeedbackForInstructor(instructorId, selectedStudentId);
      setLungeRows(result ?? []);
    });
  }

  function handleSelectStudent(studentId: string) {
    setSelectedStudentId(studentId);
    setSearch("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-card-foreground">מעקב חניכים</h2>
        <p className="text-sm text-muted-foreground">
          משובים אישיים על רכיבה ולונג׳ ללא רוכב. הדרכת מתקדמים והתנסויות מתחילים מנוהלות במסכים הייעודיים
          שלהן.
        </p>
      </div>

      {selectedStudent ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-card-foreground">
            חניך/ה נבחר/ת: <span className="font-semibold">{selectedStudent.fullName}</span>
          </p>
          <button
            type="button"
            onClick={() => setSelectedStudentId(null)}
            className="text-xs font-medium text-secondary-foreground underline hover:opacity-80"
          >
            החלפת חניך/ה
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <label className="flex flex-col gap-1 text-sm">
              חיפוש חניך/ה לפי שם
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="הקלידו שם..."
                  className="w-full rounded-xl border border-border py-3 pl-9 pr-3 text-base"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="ניקוי חיפוש"
                    className="absolute inset-y-0 left-2 flex items-center px-1 text-muted-foreground hover:text-card-foreground"
                  >
                    ✕
                  </button>
                )}
              </div>
            </label>
          </div>

          {mergedTrainees.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
              לא נמצאו חניכים
            </p>
          ) : sections.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
              לא נמצאו חניכים התואמים לחיפוש
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {sections.map((section) => (
                <div
                  key={section.groupName ?? "__none__"}
                  className="rounded-2xl border-2 border-border bg-muted p-3"
                >
                  <h3 className="mb-2 px-1 text-base font-bold text-card-foreground">
                    {section.groupName ? `קבוצה ${section.groupName}` : NO_GROUP_LABEL}
                  </h3>
                  <div className="flex flex-col gap-2">
                    {section.subgroups.map((sub) => (
                      <div
                        key={sub.subgroupNumber ?? "__none__"}
                        className="rounded-xl border border-border bg-card p-2"
                      >
                        <p className="mb-1.5 px-1 text-xs font-semibold text-muted-foreground">
                          {sub.subgroupNumber != null ? `תת-קבוצה ${sub.subgroupNumber}` : NO_SUBGROUP_LABEL}
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {sub.trainees.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              onClick={() => handleSelectStudent(row.id)}
                              className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-3 text-right transition-colors hover:bg-muted"
                            >
                              <span className="text-base font-bold text-card-foreground">{row.fullName}</span>
                              <span className="text-sm text-muted-foreground">{horseSecondaryText(row)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedStudent && (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-bold text-card-foreground">רכיבה</h3>
            {ridingRows === null ? (
              <p className="text-sm text-muted-foreground">טוען...</p>
            ) : (
              <RidingProgressFeedbackList
                studentId={selectedStudent.id}
                rows={ridingRows}
                onChanged={refreshRiding}
                actions={{
                  create: (studentId, input) =>
                    createStudentRidingProgressFeedbackAsInstructor(instructorId, studentId, input),
                  update: (id, input) =>
                    updateStudentRidingProgressFeedbackAsInstructor(instructorId, id, input),
                  delete: (id) => deleteStudentRidingProgressFeedbackAsInstructor(instructorId, id),
                }}
              />
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-bold text-card-foreground">לונג׳</h3>
            <p className="mb-3 text-xs text-muted-foreground">משובי לונג׳ ללא רוכב, להזנה ידנית.</p>
            {lungeRows === null ? (
              <p className="text-sm text-muted-foreground">טוען...</p>
            ) : (
              <LungeProgressFeedbackList
                studentId={selectedStudent.id}
                rows={lungeRows}
                onChanged={refreshLunge}
                actions={{
                  create: (studentId, input) =>
                    createStudentLungeProgressFeedbackAsInstructor(instructorId, studentId, input),
                  update: (id, input) =>
                    updateStudentLungeProgressFeedbackAsInstructor(instructorId, id, input),
                  delete: (id) => deleteStudentLungeProgressFeedbackAsInstructor(instructorId, id),
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
