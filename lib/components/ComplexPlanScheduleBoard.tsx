"use client";

import { useMemo } from "react";
import {
  projectScheduleBoard,
  type ScheduleBoardPlanInput,
  type ScheduleBoardCandidateInput,
  type ScheduleBoardStationVM,
} from "@/lib/riding-complex-schedule-board/project";

// RIDING-COMPLEX-SCHEDULE-BOARD - read-only, schedule-style overview of a
// whole complex riding plan. This component renders ONLY; it owns no draft
// state, adds no save/mutation control, and issues no query or server action.
// It reshapes the already-loaded plan tree via the pure projectScheduleBoard
// core (see that file) and lays the result out as time-block sections with
// coach-station lanes, so the entire plan is visible at once.
//
// Layout: time blocks stack vertically in chronological order (the primary
// structure). Within a block, stations flow as responsive cards - a single
// stacked column on mobile (no wide-table overflow), widening to lanes on
// larger screens where space permits. Hebrew RTL and the existing design
// tokens are inherited from the surrounding app; nothing here forces LTR or a
// fixed wide width. Missing optional values fall back to a clear Hebrew label,
// and empty blocks/stations render an explicit "nothing here" line rather than
// collapsing silently.

function StationLane({ station }: { station: ScheduleBoardStationVM }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <h4 className="text-base font-bold text-card-foreground">
          {station.instructorName ?? "לא הוגדר מאמן"}
        </h4>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {station.pairs.length} זוגות
        </span>
      </div>
      <p className="text-sm text-card-foreground">מגרש: {station.arena ?? "לא הוגדר מגרש"}</p>
      {station.pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין זוגות בתחנה זו</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {station.pairs.map((pair) => (
            <div key={pair.key} className="rounded-lg bg-muted/50 p-2 text-xs">
              <p className="font-medium text-card-foreground">
                {pair.traineeNames.length > 0 ? pair.traineeNames.join(" + ") : "לא נבחרו חניכים"}
              </p>
              <p className="text-muted-foreground">סוס: {pair.horseName ?? "לא הוגדר סוס"}</p>
              {pair.note && <p className="text-muted-foreground">הערה: {pair.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ComplexPlanScheduleBoard({
  plan,
  candidates,
}: {
  plan: ScheduleBoardPlanInput;
  candidates: readonly ScheduleBoardCandidateInput[];
}) {
  const board = useMemo(() => projectScheduleBoard(plan, candidates), [plan, candidates]);

  if (board.blocks.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">עדיין לא הוגדרו טווחי שעות לתכנון זה</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto ps-1">
      {board.blocks.map((block) => (
        <section key={block.key} className="flex flex-col gap-2">
          <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-background px-1 py-1">
            <h3 className="text-base font-bold text-card-foreground">
              {block.startTime}–{block.endTime}
            </h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {block.stations.length} תחנות
            </span>
          </div>
          {block.stations.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              אין תחנות בטווח זה
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {block.stations.map((station) => (
                <StationLane key={station.key} station={station} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
