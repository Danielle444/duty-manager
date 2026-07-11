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

interface TraineeProgressStudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

export function InstructorTraineeProgressSection({
  instructorId,
  students,
}: {
  instructorId: string;
  students: TraineeProgressStudentOption[];
}) {
  const [search, setSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [ridingRows, setRidingRows] = useState<StudentRidingProgressFeedbackRow[] | null>(null);
  const [lungeRows, setLungeRows] = useState<StudentLungeProgressFeedbackRow[] | null>(null);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.fullName.toLowerCase().includes(q));
  }, [search, students]);

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
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
    setIsSearchOpen(false);
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

      <div className="rounded-xl border border-border bg-card p-4">
        {selectedStudent && !isSearchOpen && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-card-foreground">
              חניך/ה נבחר/ת: <span className="font-semibold">{selectedStudent.fullName}</span>
            </p>
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="text-xs font-medium text-secondary-foreground underline hover:opacity-80"
            >
              החלפת חניך/ה
            </button>
          </div>
        )}

        {/* Same compact combobox convention as the admin trainee-progress
            page - results popup only while the input is focused, onMouseDown
            on each result to beat the input's own onBlur close so a tap
            still registers. Touch targets sized for the instructor app
            (py-3, text-base) rather than the admin page's tighter py-2/
            text-sm. */}
        <div className="relative">
          <label className="flex flex-col gap-1 text-sm">
            {selectedStudent ? "חיפוש/החלפת חניך/ה" : "חיפוש חניך/ה לפי שם"}
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              onBlur={() => {
                setTimeout(() => setIsSearchOpen(false), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsSearchOpen(false);
                  e.currentTarget.blur();
                }
              }}
              placeholder="הקלידו שם..."
              className="w-full rounded-xl border border-border px-3 py-3 text-base"
            />
          </label>

          {isSearchOpen && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
              {filteredStudents.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">לא נמצאו חניכים לפי החיפוש</p>
              ) : (
                filteredStudents.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectStudent(s.id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-3 text-right text-sm transition-colors ${
                      selectedStudentId === s.id
                        ? "bg-primary text-primary-foreground"
                        : "text-card-foreground hover:bg-muted"
                    }`}
                  >
                    <span>
                      {s.fullName}
                      {s.groupName ? ` · קבוצה ${s.groupName}` : ""}
                      {s.subgroupNumber != null ? ` · תת-קבוצה ${s.subgroupNumber}` : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

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
