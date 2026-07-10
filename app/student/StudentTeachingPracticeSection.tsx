"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  listMyTeachingPracticeLessonsForTrainee,
  listPublishedTeachingPracticeLessonsForTrainee,
  type TeachingPracticeTraineeLessonRow,
} from "@/lib/actions/teaching-practice-student";
import type {
  TeachingPracticeRoleValue,
  TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
// Shared, DB-free, JSX-free detection rule only - reused so this trainee
// surface never disagrees with the admin/instructor one about what counts
// as "same parent." Nothing else is imported from
// lib/components/TeachingPracticeManager.tsx (see that file's own header
// for why this surface deliberately shares no other code with it) - the
// badge itself is a tiny local component below, not imported, for the same
// reason ROLE_LABELS/PRACTICE_TYPE_LABELS are duplicated locally instead.
import {
  buildSameParentOtherNamesByChildId,
  type SameParentChildInput,
} from "@/lib/teaching-practice-same-parent";

// Read-only trainee surface - deliberately not sharing anything with
// lib/components/TeachingPracticeManager.tsx (the admin/instructor CRUD
// component), since that component's edit/publish affordances must never
// reach a trainee. Labels are duplicated locally rather than imported from
// there for the same reason.
const PRACTICE_TYPE_LABELS: Record<TeachingPracticeTypeValue, string> = {
  LUNGE: "לונג׳",
  BEGINNER_PRIVATE: "שיעור פרטי מתחילים",
  BEGINNER_GROUP: "שיעור קבוצתי מתחילים",
};

const ROLE_LABELS: Record<TeachingPracticeRoleValue, string> = {
  LEAD_INSTRUCTOR: "מדריך ראשון",
  SECOND_INSTRUCTOR: "מדריך שני",
  ASSISTANT_INSTRUCTOR: "עוזר מדריך",
  EVALUATOR: "ממשב",
};

type TraineeTab = "mine" | "all";

// Same "אותו הורה" wording/styling as the admin/instructor surface - never
// states siblinghood as fact, and never shows a phone number (names only,
// same as the rest of this card).
function SameParentBadge({ otherNames }: { otherNames: string[] }) {
  if (otherNames.length === 0) return null;
  return (
    <span
      className="mr-1 rounded-full bg-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-warning"
      title={`אותו הורה/איש קשר כמו: ${otherNames.join(", ")}`}
    >
      אותו הורה
    </span>
  );
}

function LessonCard({
  lesson,
  sameParentOtherNamesByChildId,
}: {
  lesson: TeachingPracticeTraineeLessonRow;
  sameParentOtherNamesByChildId: Map<string, string[]>;
}) {
  return (
    <div className="rounded-xl border-2 border-border p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-base font-semibold text-card-foreground">
          {formatHebrewWeekday(parseDateKey(lesson.date))} · {formatHebrewDate(parseDateKey(lesson.date))}
        </span>
        <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
          {lesson.startTime}-{lesson.endTime}
        </span>
      </div>

      <p className="text-lg font-bold text-card-foreground">
        {PRACTICE_TYPE_LABELS[lesson.practiceType]}
      </p>

      {(lesson.location || lesson.responsibleInstructorName) && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          {lesson.location && <span>מיקום: {lesson.location}</span>}
          {lesson.responsibleInstructorName && <span>מדריך/ה אחראי/ת: {lesson.responsibleInstructorName}</span>}
        </div>
      )}

      {lesson.participants.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1 text-sm font-semibold text-muted-foreground">צוות</p>
          <ul className="flex flex-col gap-1">
            {lesson.participants.map((p) => (
              <li
                key={p.traineeId}
                className={`text-sm ${
                  p.isSelf
                    ? "rounded-lg bg-secondary px-2 py-1 font-bold text-secondary-foreground"
                    : "text-card-foreground"
                }`}
              >
                {p.traineeName} - {ROLE_LABELS[p.role]}
                {p.isSelf && " (את/ה)"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lesson.children.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1 text-sm font-semibold text-muted-foreground">ילדים</p>
          <ul className="flex flex-col gap-2">
            {lesson.children.map((c) => (
              <li key={c.childId} className="rounded-lg bg-muted p-2 text-sm text-card-foreground">
                <p className="font-semibold">
                  {c.firstName}
                  {c.lastName ? ` ${c.lastName}` : ""}
                  {c.age != null || c.gender ? " · " : ""}
                  {c.age != null ? `גיל ${c.age}` : ""}
                  {c.age != null && c.gender ? " · " : ""}
                  {c.gender ?? ""}
                  <SameParentBadge otherNames={sameParentOtherNamesByChildId.get(c.childId) ?? []} />
                </p>
                {(c.horseName || c.equipmentNotes) && (
                  <p className="text-muted-foreground">
                    {c.horseName ? `סוס: ${c.horseName}` : ""}
                    {c.horseName && c.equipmentNotes ? " · " : ""}
                    {c.equipmentNotes ? `ציוד: ${c.equipmentNotes}` : ""}
                  </p>
                )}
                {(c.parentName || c.parentPhone) && (
                  <p className="text-muted-foreground">
                    {c.parentName ? `הורה: ${c.parentName}` : ""}
                    {c.parentName && c.parentPhone ? " · " : ""}
                    {c.parentPhone ? `טלפון: ${c.parentPhone}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function StudentTeachingPracticeSection({ studentId }: { studentId: string }) {
  const [tab, setTab] = useState<TraineeTab>("mine");
  const [myLessons, setMyLessons] = useState<TeachingPracticeTraineeLessonRow[] | null>(null);
  const [allLessons, setAllLessons] = useState<TeachingPracticeTraineeLessonRow[] | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await listMyTeachingPracticeLessonsForTrainee(studentId);
      setMyLessons(result);
    });
  }, [studentId]);

  useEffect(() => {
    if (tab !== "all" || allLessons !== null) return;
    startTransition(async () => {
      const result = await listPublishedTeachingPracticeLessonsForTrainee(studentId);
      setAllLessons(result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, studentId]);

  const lessons = tab === "mine" ? myLessons : allLessons;
  const emptyMessage =
    tab === "mine" ? "אין לך התנסויות מתחילים שפורסמו כרגע" : "אין התנסויות מתחילים שפורסמו כרגע";

  // "אותו הורה" badge - deliberately scoped to only the children already
  // visible in the CURRENTLY LOADED lesson list (mine or all, whichever tab
  // is active), never the full child registry - trainees never fetch (and
  // this component never requests) the admin/instructor child list. A child
  // appearing in more than one lesson is deduped by childId first, so its
  // own repeat appearances are never mistaken for a second same-parent
  // child in the tooltip.
  const sameParentOtherNamesByChildId = useMemo(() => {
    const uniqueChildren = new Map<string, SameParentChildInput>();
    for (const lesson of lessons ?? []) {
      for (const c of lesson.children) {
        if (!uniqueChildren.has(c.childId)) {
          uniqueChildren.set(c.childId, {
            id: c.childId,
            displayName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
            parentName: c.parentName,
            parentPhone: c.parentPhone,
          });
        }
      }
    }
    return buildSameParentOtherNamesByChildId([...uniqueChildren.values()]);
  }, [lessons]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-card-foreground">התנסויות מתחילים</h2>

      <div className="flex gap-2 rounded-xl border border-border bg-muted p-1">
        <button
          type="button"
          onClick={() => setTab("mine")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
            tab === "mine" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          ההתנסויות שלי
        </button>
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
            tab === "all" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          כל ההתנסויות
        </button>
      </div>

      {lessons === null ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : lessons.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {lessons.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              sameParentOtherNamesByChildId={sameParentOtherNamesByChildId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
