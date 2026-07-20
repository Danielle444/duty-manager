"use client";

import { useMemo, type ReactNode } from "react";
import { Button } from "@/lib/components/Button";
import {
  projectScheduleBoard,
  type ScheduleBoardPlanInput,
  type ScheduleBoardCandidateInput,
  type ScheduleBoardStationVM,
} from "@/lib/riding-complex-schedule-board/project";
import { showsBoardEditControl } from "@/lib/riding-complex-schedule-board/edit-navigation";

// RIDING-COMPLEX-SCHEDULE-BOARD - schedule-style overview of a whole complex
// riding plan. This component renders ONLY; it owns no draft state, holds no
// save logic, and issues no query or server action of its own. It reshapes the
// already-loaded plan tree via the pure projectScheduleBoard core (see that
// file) and lays the result out as time-block sections with coach-station
// lanes, so the entire plan is visible at once.
//
// Stage 2B inline editing (additive, permission-gated): when the parent passes
// canEdit plus the edit callbacks, each block header, station card, and pair
// row gains a labeled edit control. Clicking a control does NOT mutate anything
// here - it calls back so the PARENT (the sole draft + save owner) either opens
// an inline editor whose UI it injects via renderBlockTimeEditor /
// renderStationMetaEditor (placed here, inside the header/card), or opens its
// own pair sub-dialog. While any edit is active the parent sets editLocked,
// which hides every other edit control so only one target is ever open and an
// in-progress draft is never silently discarded. A read-only viewer (canEdit
// false, or no callbacks) sees no edit control at all. The block/station/pair
// source ids used by the callbacks come from the projection's internal
// blockId/stationId/pairId fields and are used ONLY in click handlers - never
// rendered into text, attributes, accessible labels, or React keys.
//
// Layout: time blocks stack vertically in chronological order (the primary
// structure). Within a block, stations flow as responsive cards - a single
// stacked column on mobile (no wide-table overflow), widening to lanes on
// larger screens where space permits. Hebrew RTL and the existing design
// tokens are inherited from the surrounding app; nothing here forces LTR or a
// fixed wide width. Missing optional values fall back to a clear Hebrew label,
// and empty blocks/stations render an explicit "nothing here" line rather than
// collapsing silently.

function StationLane({
  station,
  metaEditing,
  renderMetaEditor,
  onEditMeta,
  onEditPair,
  onAddPair,
  editLocked,
  canEdit,
}: {
  station: ScheduleBoardStationVM;
  // True when THIS station's metadata (instructor + arena) is being edited
  // inline - the parent-injected editor replaces the static header/arena.
  metaEditing: boolean;
  renderMetaEditor?: () => ReactNode;
  // Provided only when the station's metadata may be edited (editable actor,
  // nothing else open, station has a routable id).
  onEditMeta?: () => void;
  // Provided per pair only when that pair may be edited; called with the pair's
  // source id (never rendered) so the parent opens its pair sub-dialog.
  onEditPair?: (pairId: string) => void;
  // Provided only when a pair may be added to this station; opens the parent's
  // pair dialog in CREATE mode.
  onAddPair?: () => void;
  editLocked: boolean;
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-border bg-card p-3">
      {metaEditing ? (
        renderMetaEditor?.()
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <h4 className="text-base font-bold text-card-foreground">
              {station.instructorName ?? "לא הוגדר מאמן"}
            </h4>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {station.pairs.length} זוגות
              </span>
              {onEditMeta && (
                <Button
                  variant="secondary"
                  className="!px-2 !py-1 !text-xs"
                  onClick={onEditMeta}
                  aria-label={`עריכת מאמן ומגרש של ${station.instructorName ?? "תחנה ללא מאמן"}`}
                >
                  עריכה
                </Button>
              )}
            </div>
          </div>
          <p className="text-sm text-card-foreground">מגרש: {station.arena ?? "לא הוגדר מגרש"}</p>
        </>
      )}
      {station.pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין זוגות בתחנה זו</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {station.pairs.map((pair) => {
            const canEditPair =
              showsBoardEditControl(canEdit, pair.pairId) && !editLocked && Boolean(onEditPair);
            return (
              <div key={pair.key} className="flex items-start justify-between gap-2 rounded-lg bg-muted/50 p-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-card-foreground">
                    {pair.traineeNames.length > 0 ? pair.traineeNames.join(" + ") : "לא נבחרו חניכים"}
                  </p>
                  <p className="text-muted-foreground">סוס: {pair.horseName ?? "לא הוגדר סוס"}</p>
                  {pair.note && <p className="text-muted-foreground">הערה: {pair.note}</p>}
                </div>
                {canEditPair && pair.pairId && (
                  <Button
                    variant="ghost"
                    className="!px-2 !py-1 !text-xs"
                    onClick={() => onEditPair?.(pair.pairId as string)}
                    aria-label={`עריכת זוג: ${pair.traineeNames.length > 0 ? pair.traineeNames.join(" ו-") : "ללא חניכים"}`}
                  >
                    עריכת זוג
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {onAddPair && (
        <div className="flex justify-end">
          <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onAddPair}>
            + הוספת זוג
          </Button>
        </div>
      )}
    </div>
  );
}

export function ComplexPlanScheduleBoard({
  plan,
  candidates,
  canEdit = false,
  editLocked = false,
  inlineBlockTimeId = null,
  renderBlockTimeEditor,
  inlineStationMetaId = null,
  renderStationMetaEditor,
  onEditBlockTime,
  onEditStationMeta,
  onEditPair,
  onAddPair,
}: {
  plan: ScheduleBoardPlanInput;
  candidates: readonly ScheduleBoardCandidateInput[];
  // Inline editing is fully additive and opt-in: without canEdit + the
  // callbacks the board renders exactly as before (read-only). No control here
  // ever mutates.
  canEdit?: boolean;
  // Any inline editor / pair dialog is open in the parent - hide every other
  // edit control so exactly one target is active at a time.
  editLocked?: boolean;
  // The block whose time range is being edited inline, plus the parent-injected
  // editor UI to place inside that block's header.
  inlineBlockTimeId?: string | null;
  renderBlockTimeEditor?: () => ReactNode;
  // The station whose metadata is being edited inline, plus its editor UI.
  inlineStationMetaId?: string | null;
  renderStationMetaEditor?: () => ReactNode;
  // Edit intents - the parent opens the corresponding inline editor / dialog.
  onEditBlockTime?: (blockId: string) => void;
  onEditStationMeta?: (blockId: string, stationId: string) => void;
  onEditPair?: (blockId: string, stationId: string, pairId: string) => void;
  onAddPair?: (blockId: string, stationId: string) => void;
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
      {board.blocks.map((block) => {
        const blockTimeEditing = Boolean(inlineBlockTimeId) && block.blockId === inlineBlockTimeId;
        const canEditBlockTime =
          showsBoardEditControl(canEdit, block.blockId) && !editLocked && Boolean(onEditBlockTime);
        return (
          <section key={block.key} className="flex flex-col gap-2">
            <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background px-1 py-1">
              {blockTimeEditing ? (
                renderBlockTimeEditor?.()
              ) : (
                <>
                  <h3 className="text-base font-bold text-card-foreground">
                    {block.startTime}–{block.endTime}
                  </h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {block.stations.length} תחנות
                  </span>
                  {canEditBlockTime && block.blockId && (
                    <Button
                      variant="secondary"
                      className="!px-2 !py-1 !text-xs"
                      onClick={() => onEditBlockTime?.(block.blockId as string)}
                      aria-label={`עריכת שעות של טווח ${block.startTime}–${block.endTime}`}
                    >
                      עריכת שעות
                    </Button>
                  )}
                </>
              )}
            </div>
            {block.stations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                אין תחנות בטווח זה
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {block.stations.map((station) => {
                  const metaEditing =
                    Boolean(inlineStationMetaId) && station.stationId === inlineStationMetaId;
                  const canEditMeta =
                    showsBoardEditControl(canEdit, station.stationId) &&
                    !editLocked &&
                    Boolean(onEditStationMeta) &&
                    Boolean(block.blockId);
                  const canAddPair =
                    showsBoardEditControl(canEdit, station.stationId) &&
                    !editLocked &&
                    Boolean(onAddPair) &&
                    Boolean(block.blockId);
                  return (
                    <StationLane
                      key={station.key}
                      station={station}
                      canEdit={canEdit}
                      editLocked={editLocked}
                      metaEditing={metaEditing}
                      renderMetaEditor={metaEditing ? renderStationMetaEditor : undefined}
                      onEditMeta={
                        canEditMeta
                          ? () => onEditStationMeta?.(block.blockId as string, station.stationId as string)
                          : undefined
                      }
                      onEditPair={
                        block.blockId && station.stationId
                          ? (pairId) => onEditPair?.(block.blockId as string, station.stationId as string, pairId)
                          : undefined
                      }
                      onAddPair={
                        canAddPair
                          ? () => onAddPair?.(block.blockId as string, station.stationId as string)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
