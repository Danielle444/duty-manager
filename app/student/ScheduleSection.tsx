"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getScheduleForStudent,
  type GroupFilter,
  type ScheduleItemView,
  type StudentScheduleResult,
} from "@/lib/actions/student-schedule";
import type { PublishedComplexRidingPlanForStudent } from "@/lib/actions/riding-slot-complex-publications";
import { todayDateKey } from "@/lib/dates";
import { getStudentScheduleTitle } from "@/lib/schedule-title";
import { ScheduleTimeGrid } from "@/lib/components/ScheduleTimeGrid";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import { coalesceAdjacentSameActivity } from "@/lib/schedule-grouping";

function isItemActiveNow(item: ScheduleItemView, now: Date): boolean {
  const todayKey = now.toISOString().slice(0, 10);
  if (item.dateKey !== todayKey) return false;
  const [sh, sm] = item.startTime.split(":").map(Number);
  const [eh, em] = item.endTime.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= sh * 60 + sm && nowMinutes < eh * 60 + em;
}

// RIDING-COMPLEX-PUBLICATION P7C
interface OwnComplexRidingAssignment {
  blockStartTime: string;
  blockEndTime: string;
  coachName: string | null;
  arena: string | null;
  partnerName: string | null;
  horseName: string | null;
}

// Every pair occurrence across every published block/station where the
// logged-in trainee appears as trainee1 or trainee2 - compared by stable ID
// only (never by name, per product rule), and never deduplicated: a trainee
// legitimately appearing in more than one block returns one entry per
// occurrence, in published block order.
function findOwnComplexRidingAssignments(
  plan: PublishedComplexRidingPlanForStudent,
  studentId: string
): OwnComplexRidingAssignment[] {
  const assignments: OwnComplexRidingAssignment[] = [];
  for (const block of plan.blocks) {
    for (const station of block.stations) {
      for (const pair of station.pairs) {
        const isTrainee1 = pair.trainee1Id === studentId;
        const isTrainee2 = pair.trainee2Id === studentId;
        if (!isTrainee1 && !isTrainee2) continue;
        assignments.push({
          blockStartTime: block.startTime,
          blockEndTime: block.endTime,
          coachName: station.coachName,
          arena: station.arena,
          partnerName: isTrainee1 ? pair.trainee2Name : pair.trainee1Name,
          horseName: pair.horseName,
        });
      }
    }
  }
  return assignments;
}

function formatOwnAssignmentLine(a: OwnComplexRidingAssignment): string {
  const parts = [
    `${a.blockStartTime}–${a.blockEndTime}`,
    `מאמן/ת: ${a.coachName ?? "לא הוגדר/ה"}`,
    `מגרש: ${a.arena ?? "לא הוגדר"}`,
  ];
  if (a.partnerName) parts.push(`עם ${a.partnerName}`);
  parts.push(`סוס: ${a.horseName ?? "לא הוגדר"}`);
  return parts.join(" · ");
}

// Highlights only the one name span, never the surrounding pair/station row -
// compared by stable trainee ID only (never by display name), so a
// null traineeId (snapshot survives a later Student deletion via
// onDelete: SetNull) is simply never highlighted rather than guessed at.
function ComplexPlanTraineeName({ name, isOwn }: { name: string; isOwn: boolean }) {
  if (!isOwn) return <span>{name}</span>;
  return (
    <span className="rounded-full bg-success-muted px-1.5 py-0.5 font-semibold text-success">{name}</span>
  );
}

// Full published block -> station -> pair hierarchy, stacked cards only
// (never a wide table) - only ever rendered once expanded. Never renders
// pair notes, warnings, publication status, or any actor/admin/instructor
// attribution - none of that exists in PublishedComplexRidingPlanForStudent
// at all.
function ExpandedComplexRidingPlan({
  plan,
  studentId,
}: {
  plan: PublishedComplexRidingPlanForStudent;
  studentId: string;
}) {
  if (plan.blocks.length === 0) {
    return <p className="text-xs text-muted-foreground">אין מידע להצגה</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {plan.blocks.map((block, blockIndex) => (
        <div key={blockIndex} className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold text-card-foreground">
            {block.startTime}–{block.endTime}
          </p>
          <div className="flex flex-col gap-1.5 ps-2">
            {block.stations.map((station, stationIndex) => (
              <div key={stationIndex} className="rounded-lg border border-border bg-card p-2">
                <p className="text-xs font-medium text-card-foreground">
                  מאמן/ת: {station.coachName ?? "לא הוגדר/ה מאמן/ת"} · מגרש: {station.arena ?? "לא הוגדר מגרש"}
                </p>
                {station.pairs.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">אין זוגות בתחנה זו</p>
                ) : (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {station.pairs.map((pair, pairIndex) => (
                      <p key={pairIndex} className="text-xs text-card-foreground">
                        <ComplexPlanTraineeName name={pair.trainee1Name} isOwn={pair.trainee1Id === studentId} />
                        {pair.trainee2Name && (
                          <>
                            {" + "}
                            <ComplexPlanTraineeName name={pair.trainee2Name} isOwn={pair.trainee2Id === studentId} />
                          </>
                        )}
                        {" — "}
                        {pair.horseName ?? "לא הוגדר סוס"}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Compact collapsed section: own-assignment summary (if found) or a neutral
// "not found" message (never an alarming error) + a block-count line, plus
// the expand/collapse toggle itself. isExpanded is local, per-card state -
// see ScheduleCard's own comment for why that's sufficient to keep it scoped
// correctly across item switches with zero extra bookkeeping.
function ComplexRidingPlanSection({
  plan,
  studentId,
  isExpanded,
  onToggle,
}: {
  plan: PublishedComplexRidingPlanForStudent;
  studentId: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const ownAssignments = findOwnComplexRidingAssignments(plan, studentId);

  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
      {!isExpanded && (
        <>
          {ownAssignments.length > 0 ? (
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <p className="font-medium text-card-foreground">השיבוץ שלי:</p>
              {ownAssignments.map((a, i) => (
                <p key={i}>{formatOwnAssignmentLine(a)}</p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">לא נמצא עבורך שיבוץ אישי בתכנון זה</p>
          )}
          <p className="text-xs text-muted-foreground">{plan.blocks.length} טווח/י שעות בתכנון</p>
        </>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="self-start text-xs font-medium text-primary underline decoration-dotted"
      >
        {isExpanded ? "סגירת שיבוץ הרכיבה" : "צפייה בשיבוץ הרכיבה המלא"}
      </button>
      {isExpanded && <ExpandedComplexRidingPlan plan={plan} studentId={studentId} />}
    </div>
  );
}

// Students must never see instructorName here, and titles always go through
// the student-facing shortening rule (e.g. "רכיבה - ישיבה יציבה" -> "רכיבה").
// A real component (not a plain helper function) specifically so its own
// isExpanded state (for the published-complex-plan section) can live here,
// scoped per card by React's own key-based reconciliation - every call site
// below supplies key={item.id} (or relies on ScheduleTimeGrid's own
// per-item keyed wrapper), so switching week/day/group naturally unmounts
// stale cards and mounts fresh ones at isExpanded=false, with no manual
// "reset expanded state" bookkeeping needed and no risk of one card's
// expanded plan leaking under another.
function ScheduleCard({
  item,
  active,
  compact = false,
  studentId,
}: {
  item: ScheduleItemView;
  active: boolean;
  compact?: boolean;
  studentId: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={`rounded-xl border-2 ${compact ? "p-2.5" : "p-4"} ${
        active ? "border-accent bg-secondary" : `border-border ${getScheduleGroupColorClass(item.groupName)}`
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
        <span className={`font-semibold text-card-foreground ${compact ? "text-sm" : "text-base"}`}>
          {item.startTime}-{item.endTime}
        </span>
        <span
          className={`rounded-full bg-muted text-muted-foreground ${
            compact ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
          }`}
        >
          {item.groupName ? `קבוצה ${item.groupName}` : "שתי הקבוצות"}
        </span>
      </div>
      <p className={`font-bold text-card-foreground ${compact ? "text-base" : "text-lg"}`}>
        {getStudentScheduleTitle(item.title)}
      </p>
      {item.location && (
        <p className={`mt-1 text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
          מיקום: {item.location}
        </p>
      )}
      {item.ridingInfo && (
        <div
          className={`mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-muted-foreground ${
            compact ? "text-xs" : "text-sm"
          }`}
        >
          {item.ridingInfo.instructorName && <span>מאמן/ת: {item.ridingInfo.instructorName}</span>}
          {item.ridingInfo.arena && <span>מגרש: {item.ridingInfo.arena}</span>}
          {item.ridingInfo.subgroupLabel && <span>{item.ridingInfo.subgroupLabel}</span>}
        </div>
      )}
      {active && (
        <span className="mt-2 inline-block rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">
          מתקיים עכשיו
        </span>
      )}
      {item.publishedComplexRidingPlan && (
        <ComplexRidingPlanSection
          plan={item.publishedComplexRidingPlan}
          studentId={studentId}
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded((v) => !v)}
        />
      )}
    </div>
  );
}

export function ScheduleSection({
  studentId,
  weeklyScheduleId,
  dayFilter,
}: {
  studentId: string;
  weeklyScheduleId: string | null;
  dayFilter: string | "all";
}) {
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("mine");
  const [result, setResult] = useState<StudentScheduleResult | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!weeklyScheduleId) return;
    let cancelled = false;
    getScheduleForStudent(studentId, weeklyScheduleId, dayFilter, groupFilter).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId, weeklyScheduleId, dayFilter, groupFilter]);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const groupedByDay = useMemo(() => {
    if (!result) return [];
    const map = new Map<string, ScheduleItemView[]>();
    for (const item of result.items) {
      if (!map.has(item.dateKey)) map.set(item.dateKey, []);
      map.get(item.dateKey)!.push(item);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [result]);

  const todayKey = todayDateKey();

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-card-foreground">הלו&quot;ז שלי</h2>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setGroupFilter("mine")}
            className={`rounded-full px-4 py-2 font-medium ${
              groupFilter === "mine"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            הקבוצה שלי
          </button>
          <button
            type="button"
            onClick={() => setGroupFilter("both")}
            className={`rounded-full px-4 py-2 font-medium ${
              groupFilter === "both"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            שתי הקבוצות
          </button>
        </div>
      </div>

      {!weeklyScheduleId ? (
        <p className="text-base text-card-foreground">עדיין לא הועלה לו&quot;ז לשבוע זה</p>
      ) : !result ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : !result.hasSchedule ? (
        <p className="text-base text-card-foreground">עדיין לא הועלה לו&quot;ז לשבוע זה</p>
      ) : groupedByDay.length === 0 ? (
        <p className="text-base text-muted-foreground">אין פריטים להצגה</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groupedByDay.map(([dk, items]) => (
            <div key={dk} className="flex flex-col gap-2">
              <div className="sticky top-0 z-10 rounded-lg bg-secondary px-3 py-2 text-base font-bold text-secondary-foreground">
                {items[0].dayLabel} · {items[0].dateLabel}
                {dk === todayKey && <span className="mr-2 text-sm font-normal">(היום)</span>}
              </div>
              {groupFilter === "both" ? (
                <ScheduleTimeGrid
                  items={items}
                  renderCard={(item) => (
                    <ScheduleCard item={item} active={isItemActiveNow(item, now)} compact studentId={studentId} />
                  )}
                />
              ) : (
                // Viewing only "הקבוצה שלי" - no cross-group layout needed,
                // just a simple stacked list, but a continuous activity can
                // still arrive as multiple contiguous same-title rows (the
                // source Excel timetable's fixed-slot rows), so it still
                // needs the same coalescing step ScheduleTimeGrid applies
                // internally, or it would render as separate cards here.
                // coalesceAdjacentSameActivity buckets by groupName
                // internally and concatenates each bucket's own chronological
                // run in group-encounter order, not merged across buckets -
                // so items from the student's own group and "שתי הקבוצות"
                // items need an explicit re-sort by time afterward.
                <div className="flex flex-col gap-3">
                  {[...coalesceAdjacentSameActivity(items)]
                    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime))
                    .map((item) => (
                      <ScheduleCard
                        key={item.id}
                        item={item}
                        active={isItemActiveNow(item, now)}
                        studentId={studentId}
                      />
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
