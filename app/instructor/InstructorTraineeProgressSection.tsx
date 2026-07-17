"use client";

import { useMemo, useState } from "react";
import {
  listStudentRidingProgressFeedbackForInstructorView,
  createStudentRidingProgressFeedbackAsInstructor,
  updateStudentRidingProgressFeedbackAsInstructor,
} from "@/lib/actions/student-riding-progress-feedback-instructor";
import {
  listStudentLungeProgressFeedbackForInstructorView,
  createStudentLungeProgressFeedbackAsInstructor,
  updateStudentLungeProgressFeedbackAsInstructor,
} from "@/lib/actions/student-lunge-progress-feedback-instructor";
import {
  listStudentPresentationProgressFeedbackForInstructorView,
  createStudentPresentationProgressFeedbackAsInstructor,
  updateStudentPresentationProgressFeedbackAsInstructor,
} from "@/lib/actions/student-presentation-progress-feedback-instructor";
import { getStudentRidingHistoryForInstructorTraineeProgress } from "@/lib/actions/riding-slots";
import {
  getStudentTeachingPracticeFeedbackForInstructorTraineeProgress,
  getUnfilledTeachingPracticeParticipationsForInstructor,
} from "@/lib/actions/teaching-practice-feedback-history";
import { upsertTeachingPracticeFeedbackAsInstructor } from "@/lib/actions/teaching-practice";
import {
  listStudentGeneralNotesForInstructor,
  createStudentGeneralNoteAsInstructor,
  updateStudentGeneralNoteAsInstructor,
} from "@/lib/actions/student-general-notes-instructor";
import {
  TraineeProgressDetail,
  type TraineeProgressCapabilities,
  type TraineeProgressDataSource,
} from "@/lib/components/TraineeProgressDetail";
import { getHorseDisplayInfo } from "@/lib/horse-info";

// Instructor/coach-facing "מעקב חניכים" screen. Trainee browsing (search +
// group/subgroup sections below) is unchanged from the original Stage I2
// screen; once a trainee is selected, this now renders the exact same
// TraineeProgressDetail component the manager's /admin/trainee-progress
// page renders for that trainee - same section layout/content/records/
// timelines/averages, per the product requirement that an authorized
// instructor sees the full picture, never a reduced instructor-only
// summary. Which edit controls are actually enabled is driven entirely by
// `capabilities` below (derived from this instructor's own
// canEditRidingNotes/canEditTeachingPracticeFeedback flags, re-verified
// fresh from the DB inside every dataSource action regardless of what this
// screen renders) - this file never imports requireAdmin or any *AsAdmin
// action.
//
// The VIEW data source below uses the *ForInstructorView reads (every row
// for the trainee, admin- and instructor-authored alike, gated by page
// access) rather than the pre-existing own-rows-only
// listStudent*ProgressFeedbackForInstructor actions - see this stage's
// implementation report for why viewing needed a new, wider read while
// editing keeps the existing own-row restriction.
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
  canEditRidingNotes,
  canEditTeachingPracticeFeedback,
}: {
  instructorId: string;
  students: TraineeProgressStudentOption[];
  studentHorseInfo: TraineeProgressHorseInfoOption[];
  canEditRidingNotes: boolean;
  canEditTeachingPracticeFeedback: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

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

  // Same capabilities/dataSource shape TraineeProgressClient.tsx builds for
  // admin, wired to the instructor-scoped actions instead. `students` here
  // is already active-only (see app/instructor/page.tsx), so isActive is
  // always true for every trainee this screen can ever select.
  const capabilities: TraineeProgressCapabilities = useMemo(
    () => ({
      isAdmin: false,
      canEditRidingFeedback: canEditRidingNotes,
      canEditTeachingPracticeFeedback,
      canDeleteGeneralNotes: false,
    }),
    [canEditRidingNotes, canEditTeachingPracticeFeedback]
  );

  const dataSource: TraineeProgressDataSource = useMemo(
    () => ({
      listGeneralNotes: (studentId) => listStudentGeneralNotesForInstructor(instructorId, studentId),
      createGeneralNote: (studentId, content) =>
        createStudentGeneralNoteAsInstructor(instructorId, studentId, content),
      updateGeneralNote: (noteId, content) =>
        updateStudentGeneralNoteAsInstructor(instructorId, noteId, content),
      // No deleteGeneralNote - general-note deletion stays manager-only for
      // this stage (see this stage's implementation report).

      listRidingProgress: (studentId) =>
        listStudentRidingProgressFeedbackForInstructorView(instructorId, studentId),
      createRidingProgress: (studentId, input) =>
        createStudentRidingProgressFeedbackAsInstructor(instructorId, studentId, input),
      updateRidingProgress: (id, input) => updateStudentRidingProgressFeedbackAsInstructor(instructorId, id, input),
      // No deleteRidingProgress - progress-feedback deletion stays
      // manager-only for this stage (see this stage's implementation report).

      getRidingHistory: async (studentId) => {
        const result = await getStudentRidingHistoryForInstructorTraineeProgress(instructorId, studentId);
        return result?.rows ?? null;
      },

      getTeachingPracticeHistory: (studentId) =>
        getStudentTeachingPracticeFeedbackForInstructorTraineeProgress(instructorId, studentId),
      upsertTeachingPracticeFeedback: (participantId, input) =>
        upsertTeachingPracticeFeedbackAsInstructor(instructorId, participantId, input),
      listUnfilledTeachingPracticeParticipations: (studentId) =>
        getUnfilledTeachingPracticeParticipationsForInstructor(instructorId, studentId),

      listLungeProgress: (studentId) => listStudentLungeProgressFeedbackForInstructorView(instructorId, studentId),
      createLungeProgress: (studentId, input) =>
        createStudentLungeProgressFeedbackAsInstructor(instructorId, studentId, input),
      updateLungeProgress: (id, input) => updateStudentLungeProgressFeedbackAsInstructor(instructorId, id, input),
      // No deleteLungeProgress - progress-feedback deletion stays
      // manager-only for this stage (see this stage's implementation report).

      listPresentationProgress: (studentId) =>
        listStudentPresentationProgressFeedbackForInstructorView(instructorId, studentId),
      createPresentationProgress: (studentId, input) =>
        createStudentPresentationProgressFeedbackAsInstructor(instructorId, studentId, input),
      updatePresentationProgress: (id, input) =>
        updateStudentPresentationProgressFeedbackAsInstructor(instructorId, id, input),
      // No deletePresentationProgress - progress-feedback deletion stays
      // manager-only for this stage (see this stage's implementation report).
    }),
    [instructorId]
  );

  function handleSelectStudent(studentId: string) {
    setSelectedStudentId(studentId);
    setSearch("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-card-foreground">מעקב חניכים</h2>
        <p className="text-sm text-muted-foreground">מעקב ומשובים מלא לחניך/ה - זהה לתצוגה שרואה המנהלת.</p>
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
        <TraineeProgressDetail
          key={selectedStudent.id}
          student={{ ...selectedStudent, isActive: true }}
          capabilities={capabilities}
          actorInstructorId={instructorId}
          dataSource={dataSource}
        />
      )}
    </div>
  );
}
