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
import { formatHebrewDate, formatHebrewWeekday, parseDateKey, todayDateKey } from "@/lib/dates";
import { Modal } from "@/lib/components/Modal";
import { buildTelLink, buildWhatsAppLink } from "@/lib/phone-contact-links";
// Shared, DB-free, JSX-free detection rule only - reused so this trainee
// surface never disagrees with the admin/instructor one about what counts
// as "same parent." Nothing else is imported from
// lib/components/TeachingPracticeManager.tsx (see that file's own header
// for why this surface deliberately shares no other code with it) - the
// badge itself is a tiny local component below, not imported, for the same
// reason ROLE_LABELS/PRACTICE_TYPE_LABELS are duplicated locally instead.
import {
  buildParentKey,
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
// same as the rest of this card). stopPropagation keeps a badge tap from
// also triggering any future click behavior on the enclosing card/row.
function SameParentBadge({ otherNames, onClick }: { otherNames: string[]; onClick: () => void }) {
  if (otherNames.length === 0) return null;
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="mr-1 cursor-pointer rounded-full bg-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-warning hover:opacity-80"
      title={`אותו הורה/איש קשר כמו: ${otherNames.join(", ")}`}
    >
      אותו הורה
    </span>
  );
}

function LessonCard({
  lesson,
  sameParentOtherNamesByChildId,
  onOpenSameParentPopup,
}: {
  lesson: TeachingPracticeTraineeLessonRow;
  sameParentOtherNamesByChildId: Map<string, string[]>;
  onOpenSameParentPopup: (childId: string) => void;
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

      {/* responsibleInstructorName is intentionally not rendered here (Stage
          S2 product decision, display-only) - the field itself is still
          returned by the server action untouched, so this can be
          re-enabled later with no data change. */}
      {lesson.location && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          <span>מיקום: {lesson.location}</span>
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
            {lesson.children.map((c) => {
              // Display-time derivation only - c.parentPhone (stored free
              // text) is never modified. null simply means "don't render
              // this action," never a broken tel:/wa.me link.
              const telLink = c.parentPhone ? buildTelLink(c.parentPhone) : null;
              const waLink = c.parentPhone ? buildWhatsAppLink(c.parentPhone) : null;
              return (
                <li key={c.childId} className="rounded-lg bg-muted p-2 text-sm text-card-foreground">
                  <p className="font-semibold">
                    {c.firstName}
                    {c.lastName ? ` ${c.lastName}` : ""}
                    {c.age != null || c.gender ? " · " : ""}
                    {c.age != null ? `גיל ${c.age}` : ""}
                    {c.age != null && c.gender ? " · " : ""}
                    {c.gender ?? ""}
                    <SameParentBadge
                      otherNames={sameParentOtherNamesByChildId.get(c.childId) ?? []}
                      onClick={() => onOpenSameParentPopup(c.childId)}
                    />
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
                  {(telLink || waLink) && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {telLink && (
                        <a
                          href={telLink}
                          className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground hover:opacity-80"
                        >
                          התקשר
                        </a>
                      )}
                      {waLink && (
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full bg-success-muted px-2 py-0.5 text-xs font-medium text-success hover:opacity-80"
                        >
                          WhatsApp
                        </a>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
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

  // "ההתנסויות שלי" date tabs - Stage S2. Based only on myLessons (never
  // allLessons) - one tab per distinct date that actually has a lesson for
  // this trainee, plus "הכל". mineDateTab is null until the trainee
  // actually clicks a tab - the default (nearest upcoming date, or "all")
  // is derived purely at render time below (effectiveMineDateTab), never
  // written back via an effect/setState, so it can never fight with a
  // manual tab choice or trigger an extra render.
  const [mineDateTab, setMineDateTab] = useState<string | "all" | null>(null);

  const mineDateKeys = useMemo(() => {
    if (!myLessons) return [];
    return Array.from(new Set(myLessons.map((l) => l.date))).sort();
  }, [myLessons]);

  // Nearest date >= today among this trainee's own lesson dates, or "all"
  // if there isn't one - every date tab is guaranteed non-empty (derived
  // directly from myLessons' own dates), so this can never land on an
  // empty tab.
  const defaultMineDateTab = useMemo(() => {
    const todayKey = todayDateKey();
    return mineDateKeys.find((d) => d >= todayKey) ?? "all";
  }, [mineDateKeys]);

  const effectiveMineDateTab = mineDateTab ?? defaultMineDateTab;

  const displayedMineLessons = useMemo(() => {
    if (!myLessons) return [];
    if (effectiveMineDateTab === "all") return myLessons;
    return myLessons.filter((l) => l.date === effectiveMineDateTab);
  }, [myLessons, effectiveMineDateTab]);

  // "כל ההתנסויות" (tab === "all") is untouched by the date-tab feature
  // above - it keeps showing its full continuous list exactly as before
  // (Stage S3, not this stage, is where that view changes).
  const displayedLessons = tab === "mine" ? displayedMineLessons : (lessons ?? []);

  // "אותו הורה" badge - deliberately scoped to only the children already
  // visible in the CURRENTLY LOADED lesson list (mine or all, whichever tab
  // is active), never the full child registry - trainees never fetch (and
  // this component never requests) the admin/instructor child list. A child
  // appearing in more than one lesson is deduped by childId first, so its
  // own repeat appearances are never mistaken for a second same-parent
  // child in the tooltip.
  //
  // Deliberately built from `lessons` (the whole "mine"/"all" list), NOT
  // `displayedLessons`/`displayedMineLessons` - the Stage S2 date-tabs only
  // control which cards are shown at once, they must never narrow same-
  // parent detection down to just the selected date. A match spanning two
  // different dates still needs to be flagged correctly no matter which
  // date tab happens to be open.
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

  // "אותו הורה" row-details popup - deliberately built from ALL PUBLISHED
  // lessons (allLessons), never just the currently-active tab's list, per
  // the product decision that once published, a trainee may see every
  // matching published row, not only their own. allLessons is fetched here
  // on first badge click if it hasn't been loaded yet (rather than eagerly
  // on mount) - reuses the exact same
  // listPublishedTeachingPracticeLessonsForTrainee action the "כל
  // ההתנסויות" tab already calls; no new server action, no expanded data
  // exposure. samePopupChildId !== null && allLessons === null is the
  // loading state (no separate boolean needed).
  const [samePopupChildId, setSamePopupChildId] = useState<string | null>(null);

  function handleOpenSameParentPopup(childId: string) {
    setSamePopupChildId(childId);
    if (allLessons === null) {
      startTransition(async () => {
        const result = await listPublishedTeachingPracticeLessonsForTrainee(studentId);
        setAllLessons(result);
      });
    }
  }

  function handleCloseSameParentPopup() {
    setSamePopupChildId(null);
  }

  const samePopupRows = useMemo(() => {
    if (!samePopupChildId || !allLessons) return null;
    let targetKey: string | null = null;
    for (const lesson of allLessons) {
      const match = lesson.children.find((c) => c.childId === samePopupChildId);
      if (match) {
        targetKey = buildParentKey(match.parentName, match.parentPhone);
        break;
      }
    }
    if (!targetKey) return [];

    const rows: {
      key: string;
      childFullName: string;
      parentName: string | null;
      parentPhone: string | null;
      date: string;
      startTime: string;
      practiceType: TeachingPracticeTypeValue;
      participantNames: string[];
      horseName: string | null;
      equipmentNotes: string | null;
    }[] = [];
    for (const lesson of allLessons) {
      for (const c of lesson.children) {
        if (buildParentKey(c.parentName, c.parentPhone) !== targetKey) continue;
        rows.push({
          key: `${lesson.id}-${c.childId}`,
          childFullName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
          parentName: c.parentName,
          parentPhone: c.parentPhone,
          date: lesson.date,
          startTime: lesson.startTime,
          practiceType: lesson.practiceType,
          participantNames: lesson.participants.map((p) => p.traineeName),
          horseName: c.horseName,
          equipmentNotes: c.equipmentNotes,
        });
      }
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }, [samePopupChildId, allLessons]);

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

      {tab === "mine" && myLessons !== null && myLessons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {mineDateKeys.map((date) => (
            <button
              key={date}
              type="button"
              onClick={() => setMineDateTab(date)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                effectiveMineDateTab === date
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {formatHebrewWeekday(parseDateKey(date))} · {formatHebrewDate(parseDateKey(date))}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMineDateTab("all")}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              effectiveMineDateTab === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            הכל
          </button>
        </div>
      )}

      {lessons === null ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : lessons.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {displayedLessons.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              sameParentOtherNamesByChildId={sameParentOtherNamesByChildId}
              onOpenSameParentPopup={handleOpenSameParentPopup}
            />
          ))}
        </div>
      )}

      <Modal
        open={samePopupChildId !== null}
        onClose={handleCloseSameParentPopup}
        title="אותו הורה / איש קשר"
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            כדאי לתאם מי יוצר קשר כדי לא לפנות לאותו הורה כמה פעמים.
          </p>
          {samePopupRows === null ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : samePopupRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">לא נמצאו שיעורים משויכים.</p>
          ) : (
            <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
              {samePopupRows.map((row) => (
                <div key={row.key} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <p className="font-semibold text-card-foreground">{row.childFullName}</p>
                  <p className="mt-1 text-muted-foreground">
                    {row.parentName ?? "—"}
                    {row.parentPhone ? ` · ${row.parentPhone}` : ""}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {formatHebrewDate(parseDateKey(row.date))} · {row.startTime} ·{" "}
                    {PRACTICE_TYPE_LABELS[row.practiceType]}
                  </p>
                  {row.participantNames.length > 0 && (
                    <p className="mt-1 text-muted-foreground">חניכים: {row.participantNames.join(", ")}</p>
                  )}
                  {(row.horseName || row.equipmentNotes) && (
                    <p className="mt-1 text-muted-foreground">
                      {row.horseName ? `סוס: ${row.horseName}` : ""}
                      {row.horseName && row.equipmentNotes ? " · " : ""}
                      {row.equipmentNotes ? `ציוד: ${row.equipmentNotes}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
