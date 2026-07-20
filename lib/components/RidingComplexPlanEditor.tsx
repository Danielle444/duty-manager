"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  applyComplexPlanMoveSwapAsAdmin,
  applyComplexPlanMoveSwapAsInstructor,
  type ComplexPlanMoveSwapActionResult,
} from "@/lib/actions/riding-slot-complex-move-swap";
import type { ComplexPlanMoveSwapCommand } from "@/lib/riding-complex-schedule-board/move-swap";
import {
  buildTraineePlacementIndex,
  type TraineePlacementIndex,
  type TraineeSlot,
} from "@/lib/riding-complex-schedule-board/placement-index";
import { decideTraineeSelection } from "@/lib/riding-complex-schedule-board/trainee-selection-decision";
import {
  buildProposalViewModel,
  decideProposalActionResult,
  type ProposalViewModel,
} from "@/lib/riding-complex-schedule-board/proposal-view-model";
import {
  buildMoveSwapProposalLabels,
  decideFullListTraineeClick,
  decisionToProposalInput,
  type FullListTraineeDecision,
} from "@/lib/riding-complex-schedule-board/trainee-move-swap-orchestration";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { SuggestInput } from "@/lib/components/SuggestInput";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { groupByGroupAndSubgroup } from "@/lib/attendance-ui";
import {
  getRidingSlotComplexPlanForAdmin,
  getRidingSlotComplexPlanForInstructor,
  saveRidingSlotComplexBlockAsAdmin,
  saveRidingSlotComplexBlockAsInstructor,
  saveRidingSlotComplexStationAsAdmin,
  saveRidingSlotComplexStationAsInstructor,
  deleteRidingSlotComplexStationAsAdmin,
  deleteRidingSlotComplexStationAsInstructor,
  reorderRidingSlotComplexStationsAsAdmin,
  reorderRidingSlotComplexStationsAsInstructor,
  deleteRidingSlotComplexBlockAsAdmin,
  deleteRidingSlotComplexBlockAsInstructor,
  duplicateRidingSlotComplexBlockAsAdmin,
  duplicateRidingSlotComplexBlockAsInstructor,
  reorderRidingSlotComplexBlocksAsAdmin,
  reorderRidingSlotComplexBlocksAsInstructor,
  deleteRidingSlotComplexPlanAsAdmin,
  type RidingSlotComplexPlanForEditing,
  type RidingSlotComplexPlanRow,
  type RidingSlotComplexBlockRow,
  type RidingSlotComplexStationRow,
  type RidingSlotComplexPairRow,
  type RidingSlotComplexTraineeCandidate,
  type RidingSlotComplexSaveWarnings,
  type RidingSlotComplexBlockSaveInput,
  type RidingSlotComplexStationSaveInput,
  type RidingSlotComplexPlanActionResult,
} from "@/lib/actions/riding-slot-complex";
import { ComplexPlanScheduleBoard } from "@/lib/components/ComplexPlanScheduleBoard";
import { boardEditTargetExists } from "@/lib/riding-complex-schedule-board/edit-navigation";
import {
  canOpenInlineTarget,
  canUnpublishComplexPlan,
  initialBoardView,
  isEditorActionBlocked,
  stationPairExists,
  canSaveBlockTimes,
  pairRowToFields,
  pairFieldsToInput,
  buildStationSavePayload,
  buildPairSaveSnapshotPairs,
  appendPairToStationSnapshot,
  removePairFromStationSnapshot,
  toggleTraineeSelection,
  initialTraineeSelection,
  applyTraineeSelectionToDraft,
  type StationSavePairInput,
  type PairSnapshotResult,
} from "@/lib/riding-complex-schedule-board/inline-edit";
import {
  getComplexRidingPlanPublicationStatusForAdmin,
  getComplexRidingPlanPublicationStatusForInstructor,
  publishComplexRidingPlanAsAdmin,
  publishComplexRidingPlanAsInstructor,
  unpublishComplexRidingPlanAsAdmin,
  unpublishComplexRidingPlanAsInstructor,
  type ComplexRidingPlanPublicationStatus,
  type ComplexRidingPlanPublicationStatusLabel,
} from "@/lib/actions/riding-slot-complex-publications";

type InstructorOption = { id: string; fullName: string };

// Narrow discriminated actor - lets this editor be reused unchanged by both
// the admin and instructor screens. Every P5b operation has an admin/
// instructor pair with a different parameter shape (the instructor variant
// takes instructorId first) - these eight small private routing helpers are
// the only place that difference is handled, so the rest of the component
// never branches on actor type except for permission/UI gating (canEdit,
// whole-plan deletion).
export type RidingComplexPlanEditorActor = { type: "admin" } | { type: "instructor"; instructorId: string };

function readComplexPlan(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string
): Promise<RidingSlotComplexPlanForEditing | null> {
  return actor.type === "admin"
    ? getRidingSlotComplexPlanForAdmin(ridingSlotId)
    : getRidingSlotComplexPlanForInstructor(actor.instructorId, ridingSlotId);
}

function saveComplexBlock(
  actor: RidingComplexPlanEditorActor,
  input: RidingSlotComplexBlockSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? saveRidingSlotComplexBlockAsAdmin(input)
    : saveRidingSlotComplexBlockAsInstructor(actor.instructorId, input);
}

// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.2) - route one atomic trainee Move/Swap
// to the committed transactional action, mirroring the established admin/
// instructor routing of every sibling complex-plan writer. The command is the
// exact Stage 3C.1 command, passed through unchanged. Authorization is the
// server action's sole responsibility (it never trusts a client canEdit flag).
function applyComplexMoveSwap(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  command: ComplexPlanMoveSwapCommand
): Promise<ComplexPlanMoveSwapActionResult> {
  return actor.type === "admin"
    ? applyComplexPlanMoveSwapAsAdmin(ridingSlotId, command)
    : applyComplexPlanMoveSwapAsInstructor(actor.instructorId, ridingSlotId, command);
}

function saveComplexStation(
  actor: RidingComplexPlanEditorActor,
  input: RidingSlotComplexStationSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? saveRidingSlotComplexStationAsAdmin(input)
    : saveRidingSlotComplexStationAsInstructor(actor.instructorId, input);
}

function deleteComplexStation(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  blockId: string,
  stationId: string,
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? deleteRidingSlotComplexStationAsAdmin(ridingSlotId, blockId, stationId, expectedVersion)
    : deleteRidingSlotComplexStationAsInstructor(actor.instructorId, ridingSlotId, blockId, stationId, expectedVersion);
}

function reorderComplexStations(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  blockId: string,
  orderedStationIds: string[],
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? reorderRidingSlotComplexStationsAsAdmin(ridingSlotId, blockId, orderedStationIds, expectedVersion)
    : reorderRidingSlotComplexStationsAsInstructor(
        actor.instructorId,
        ridingSlotId,
        blockId,
        orderedStationIds,
        expectedVersion
      );
}

function deleteComplexBlock(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  blockId: string,
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? deleteRidingSlotComplexBlockAsAdmin(ridingSlotId, blockId, expectedVersion)
    : deleteRidingSlotComplexBlockAsInstructor(actor.instructorId, ridingSlotId, blockId, expectedVersion);
}

function duplicateComplexBlock(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  blockId: string,
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? duplicateRidingSlotComplexBlockAsAdmin(ridingSlotId, blockId, expectedVersion)
    : duplicateRidingSlotComplexBlockAsInstructor(actor.instructorId, ridingSlotId, blockId, expectedVersion);
}

function reorderComplexBlocks(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  orderedBlockIds: string[],
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? reorderRidingSlotComplexBlocksAsAdmin(ridingSlotId, orderedBlockIds, expectedVersion)
    : reorderRidingSlotComplexBlocksAsInstructor(actor.instructorId, ridingSlotId, orderedBlockIds, expectedVersion);
}

// RIDING-COMPLEX-PUBLICATION P7B - status reading has no permission gate
// beyond being an active instructor (matches every other read helper above),
// so both branches are always attempted; the admin branch never actually
// resolves null, only the instructor one can (inactive/nonexistent
// instructor).
function readComplexPublicationStatus(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string
): Promise<ComplexRidingPlanPublicationStatus | null> {
  return actor.type === "admin"
    ? getComplexRidingPlanPublicationStatusForAdmin(ridingSlotId)
    : getComplexRidingPlanPublicationStatusForInstructor(actor.instructorId, ridingSlotId);
}

function publishComplexPlan(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string
): ReturnType<typeof publishComplexRidingPlanAsAdmin> {
  return actor.type === "admin"
    ? publishComplexRidingPlanAsAdmin(ridingSlotId)
    : publishComplexRidingPlanAsInstructor(actor.instructorId, ridingSlotId);
}

// RIDING-COMPLEX-PUBLICATION - unpublish routes by actor exactly like publish
// above (admin vs instructor variant, instructorId first for the instructor
// one). Both server actions re-check the caller's capability independently; the
// wrapper only picks which one to call for the actor that is already rendered
// this editor.
function unpublishComplexPlan(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string
): ReturnType<typeof unpublishComplexRidingPlanAsAdmin> {
  return actor.type === "admin"
    ? unpublishComplexRidingPlanAsAdmin(ridingSlotId)
    : unpublishComplexRidingPlanAsInstructor(actor.instructorId, ridingSlotId);
}

type LoadStatus = "loading" | "loaded" | "not-found" | "error";

// Navigation state for the three-level hierarchy (time blocks -> coach
// stations -> pairs). Only one sub-view is ever open at a time; switching
// blockId/stationId always remounts the relevant editor fresh (keyed below)
// rather than reusing stale draft state across two different targets.
type EditorView =
  | { type: "blockList" }
  | { type: "editBlock"; blockId: string | null }
  | { type: "stationList"; blockId: string }
  | { type: "editStation"; blockId: string; stationId: string | null };

function timeToMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function blocksOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart);
}

// Every block that overlaps at least one other block in the plan - computed
// fresh on every render (cheap, block counts are small), so the badge never
// goes stale after any block save/delete/reorder.
function computeOverlappingBlockIds(blocks: RidingSlotComplexBlockRow[]): Set<string> {
  const overlapping = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocksOverlap(blocks[i].startTime, blocks[i].endTime, blocks[j].startTime, blocks[j].endTime)) {
        overlapping.add(blocks[i].id);
        overlapping.add(blocks[j].id);
      }
    }
  }
  return overlapping;
}

// Readable Hebrew labels for the warnings a station save returns -
// informational only, never rendered as errors.
function buildStationWarningMessages(w: RidingSlotComplexSaveWarnings): string[] {
  const messages: string[] = [];
  if (w.noInstructor) messages.push("לא נבחר/ה מאמן/ת לתחנה זו");
  if (w.noArena) messages.push("לא הוגדר מגרש לתחנה זו");
  if (w.zeroPairs) messages.push("לא נוספו זוגות לתחנה זו");
  if (w.pairsMissingTrainee2 > 0) messages.push(`${w.pairsMissingTrainee2} זוג/ות ללא חניכ/ה שני/ה`);
  if (w.pairsMissingHorse > 0) messages.push(`${w.pairsMissingHorse} זוג/ות ללא סוס`);
  return messages;
}

// Same incompleteness signal, but computed live from a block's own current
// station data (not tied to a save event) - every block card in the list
// shows this, not just the most-recently-saved one.
function blockStationWarningBadges(block: RidingSlotComplexBlockRow): string[] {
  const badges: string[] = [];
  const noCoach = block.stations.filter((s) => !s.instructorId).length;
  const noArena = block.stations.filter((s) => !s.arena).length;
  const zeroPairs = block.stations.filter((s) => s.pairs.length === 0).length;
  if (noCoach > 0) badges.push(`${noCoach} תחנות ללא מאמן`);
  if (noArena > 0) badges.push(`${noArena} תחנות ללא מגרש`);
  if (zeroPairs > 0) badges.push(`${zeroPairs} תחנות ללא זוגות`);
  return badges;
}

// Live per-station incompleteness badges for the station list.
function stationWarningBadges(station: RidingSlotComplexStationRow): string[] {
  const badges: string[] = [];
  if (!station.instructorId) badges.push("ללא מאמן");
  if (!station.arena) badges.push("ללא מגרש");
  if (station.pairs.length === 0) badges.push("ללא זוגות");
  const missingTrainee2 = station.pairs.filter((p) => p.trainee1Id && !p.trainee2Id).length;
  if (missingTrainee2 > 0) badges.push(`${missingTrainee2} ללא חניכ/ה שני/ה`);
  const missingHorse = station.pairs.filter((p) => p.trainee1Id && !p.horseName).length;
  if (missingHorse > 0) badges.push(`${missingHorse} ללא סוס`);
  return badges;
}

// RIDING-COMPLEX-PUBLICATION P7B
const PUBLICATION_STATUS_LABELS: Record<ComplexRidingPlanPublicationStatusLabel, string> = {
  UNPUBLISHED: "לא פורסם לחניכים",
  CURRENT: "פורסם לחניכים · עדכני",
  STALE: "פורסם לחניכים · קיימים שינויים שלא פורסמו",
};

const PUBLICATION_STATUS_BADGE_CLASS: Record<ComplexRidingPlanPublicationStatusLabel, string> = {
  UNPUBLISHED: "bg-secondary text-secondary-foreground",
  CURRENT: "bg-success-muted text-success",
  STALE: "bg-warning-muted text-warning",
};

// Plan-wide warning summary for the publish confirmation modal - reuses the
// exact same underlying predicates as blockStationWarningBadges/
// stationWarningBadges above (no second, independently-drifting validation
// system), just aggregated across every block/station/pair in the plan
// instead of one block or station at a time. Informational only, never a
// publish blocker - the one real hard blocker (zero blocks) is handled
// separately by never opening this modal at all (see openPublishModal).
function buildPlanPublishWarnings(blocks: RidingSlotComplexBlockRow[]): string[] {
  const warnings: string[] = [];

  const blocksWithNoStations = blocks.filter((b) => b.stations.length === 0).length;
  if (blocksWithNoStations > 0) warnings.push(`${blocksWithNoStations} טווח/י שעות ללא תחנות`);

  const allStations = blocks.flatMap((b) => b.stations);
  const noCoach = allStations.filter((s) => !s.instructorId).length;
  if (noCoach > 0) warnings.push(`${noCoach} תחנות ללא מאמן/ת`);
  const noArena = allStations.filter((s) => !s.arena).length;
  if (noArena > 0) warnings.push(`${noArena} תחנות ללא מגרש`);
  const zeroPairs = allStations.filter((s) => s.pairs.length === 0).length;
  if (zeroPairs > 0) warnings.push(`${zeroPairs} תחנות ללא זוגות`);

  const allPairs = allStations.flatMap((s) => s.pairs);
  const missingTrainee2 = allPairs.filter((p) => p.trainee1Id && !p.trainee2Id).length;
  if (missingTrainee2 > 0) warnings.push(`${missingTrainee2} זוג/ות ללא בן/בת זוג שני/ה`);
  const missingHorse = allPairs.filter((p) => p.trainee1Id && !p.horseName).length;
  if (missingHorse > 0) warnings.push(`${missingHorse} זוג/ות ללא סוס`);

  return warnings;
}

// Compact publication-status card - only ever rendered in the root
// block-list view (never inside a block/station sub-view), per product
// decision. Status text/badge/action buttons are all driven by the
// server-returned status DTO only - status/hasBlocks are never guessed or
// recomputed client-side. canPublish already reflects the actor's real
// server-checked permission (canEdit) - this component never derives
// permission from anything else.
function PublicationStatusPanel({
  status,
  loading,
  error,
  canPublish,
  canUnpublish,
  hasBlocks,
  blockedByEdit,
  onOpenPublish,
  onOpenUnpublish,
}: {
  status: ComplexRidingPlanPublicationStatus | null;
  loading: boolean;
  error: string | null;
  canPublish: boolean;
  canUnpublish: boolean;
  hasBlocks: boolean;
  // True while an inline block/station/pair draft is active/saving (which also
  // covers the trainee selector being open) or a publication action is pending.
  // Publish/Unpublish are disabled and a short explanation is shown, so a draft
  // is never silently discarded to publish. Never carries any id.
  blockedByEdit: boolean;
  onOpenPublish: () => void;
  onOpenUnpublish: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {!status && loading && <span className="text-xs text-muted-foreground">טוען מצב פרסום...</span>}
          {status && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${PUBLICATION_STATUS_BADGE_CLASS[status.status]}`}
            >
              {PUBLICATION_STATUS_LABELS[status.status]}
            </span>
          )}
          {status && status.status !== "UNPUBLISHED" && status.updatedByName && (
            <span className="text-[11px] text-muted-foreground">
              עודכן ע&quot;י {status.updatedByName}
              {status.updatedAt ? ` · ${formatHebrewDateTime(new Date(status.updatedAt))}` : ""}
            </span>
          )}
        </div>
        {canPublish && status && status.status !== "CURRENT" && (
          <>
            {hasBlocks ? (
              <Button
                variant="secondary"
                className="!px-2 !py-1 !text-xs"
                onClick={onOpenPublish}
                disabled={blockedByEdit}
              >
                {status.status === "UNPUBLISHED" ? "פרסום לחניכים" : "עדכון הפרסום לחניכים"}
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground">לא ניתן לפרסם תכנון ללא טווחי שעות</span>
            )}
          </>
        )}
        {canPublish && status && status.status === "CURRENT" && (
          <Button variant="secondary" className="!px-2 !py-1 !text-xs" disabled>
            הפרסום עדכני
          </Button>
        )}
      </div>
      {canUnpublish && status && status.status !== "UNPUBLISHED" && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            className="!px-2 !py-1 !text-xs text-danger"
            onClick={onOpenUnpublish}
            disabled={blockedByEdit}
          >
            ביטול פרסום לחניכים
          </Button>
        </div>
      )}
      {blockedByEdit && (canPublish || canUnpublish) && (
        <p className="text-[11px] text-muted-foreground">יש לשמור או לבטל את העריכה לפני פרסום.</p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// Confirmation modal for both first publish and republish - copy differs
// only by isRepublish (product-approved bullet copy: UNPUBLISHED -> first-
// publish wording, STALE -> republish wording). Warnings are informational
// only (buildPlanPublishWarnings above) - this modal is never opened at all
// when the plan has zero blocks (see openPublishModal), so there is no
// separate "zero blocks" branch to render here.
function PublishConfirmModal({
  open,
  isRepublish,
  warnings,
  isPending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  isRepublish: boolean;
  warnings: string[];
  isPending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const explanationLines = isRepublish
    ? [
        "הפרסום הקודם יוחלף בשיבוץ הנוכחי",
        "החניכים יראו את הגרסה החדשה לאחר האישור",
        "השינויים נשמרים כטיוטה עד ללחיצה על עדכון הפרסום",
      ]
    : [
        "החניכים יוכלו לראות את השיבוץ האישי שפורסם עבורם",
        "הפרסום כולל שעות, מאמן/ת, מגרש, בן/בת זוג וסוס",
        "הערות פנימיות אינן מוצגות לחניכים",
        "שינויים עתידיים בטיוטה לא יוצגו עד לפרסום מחדש",
      ];

  return (
    <Modal
      open={open}
      title={isRepublish ? "עדכון הפרסום לחניכים" : "פרסום התכנון לחניכים"}
      onClose={() => {
        // Keep the modal open while a publish is in flight - never dismiss
        // mid-submit via backdrop click or the header X.
        if (isPending) return;
        onClose();
      }}
    >
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-sm text-card-foreground">
          {explanationLines.map((line) => (
            <li key={line} className="flex gap-1.5">
              <span className="text-muted-foreground">·</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {warnings.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
            <p className="font-semibold">שימו לב, התכנון עדיין לא מלא:</p>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
            ביטול
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? "מפרסם..." : isRepublish ? "עדכון הפרסום" : "פרסום לחניכים"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Unpublish confirmation modal - shared by admin and authorized-instructor
// actors alike (see openUnpublishModal's capability guard); actor-neutral copy,
// never naming who is unpublishing.
function UnpublishConfirmModal({
  open,
  isPending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  isPending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title="ביטול פרסום לחניכים"
      onClose={() => {
        if (isPending) return;
        onClose();
      }}
    >
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-sm text-card-foreground">
          {[
            "החניכים לא יקבלו יותר את השיבוץ המפורסם",
            "הטיוטה והתכנון המורכב לא יימחקו",
            "ניתן לפרסם שוב בהמשך",
          ].map((line) => (
            <li key={line} className="flex gap-1.5">
              <span className="text-muted-foreground">·</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
            ביטול
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? "מבטל..." : "ביטול פרסום"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Single-select, searchable, group/subgroup-grouped trainee picker for one
// pair slot - used to fine-tune a pair's trainees after it already exists
// (creation of a new pair goes through ContextualPairPicker below instead).
function TraineePicker({
  candidates,
  value,
  onChange,
  placeholder,
  disabledStudentIds,
  onOccupiedSelect,
}: {
  candidates: RidingSlotComplexTraineeCandidate[];
  value: string;
  onChange: (studentId: string) => void;
  placeholder: string;
  // Optional (schedule-board pair dialog): trainees already assigned elsewhere
  // in the overlapping session are unavailable and cannot be picked - the SAME
  // availability rule ContextualPairPicker applies. The currently-selected value
  // is never disabled (so it can be kept/seen). Omitted in the legacy editor,
  // whose dropdowns stay fully enabled (validation still guards duplicates).
  disabledStudentIds?: Set<string>;
  // RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.2): when provided (the saved-pair
  // dialog), an already-assigned trainee is no longer blindly disabled - picking
  // one routes here (never to onChange, so the local draft is untouched) so the
  // parent can offer an atomic Move/Swap proposal. Omitted in CREATE mode and in
  // the legacy editor, where an occupied trainee stays disabled as before.
  onOccupiedSelect?: (studentId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const selected = candidates.find((c) => c.studentId === value) ?? null;
  const filtered = candidates.filter((c) => c.studentName.toLowerCase().includes(search.trim().toLowerCase()));
  const sections = groupByGroupAndSubgroup(filtered);

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-right text-sm"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <>
              <span className="font-medium text-card-foreground">{selected.studentName}</span>{" "}
              <span className="text-xs text-muted-foreground">
                {selected.groupName ? `קבוצה ${selected.groupName}` : "ללא קבוצה"}
                {selected.subgroupNumber != null ? ` / ${selected.subgroupNumber}` : ""}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <span className="shrink-0 text-muted-foreground">▾</span>
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-1 max-h-64 w-full min-w-[14rem] overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש חניכ/ה..."
            autoFocus
            className="w-full border-b border-border px-3 py-2 text-sm"
          />
          {value && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange("");
                setIsOpen(false);
                setSearch("");
              }}
              className="block w-full px-3 py-2 text-right text-sm text-danger hover:bg-muted"
            >
              נקה בחירה
            </button>
          )}
          {sections.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">לא נמצאו חניכים</p>
          ) : (
            sections.map((section) => (
              <div key={section.groupName ?? "__none__"}>
                <p className="bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                  {section.groupName ? `קבוצה ${section.groupName}` : "ללא קבוצה"}
                </p>
                {section.subgroups.map((sub) => (
                  <div key={sub.subgroupNumber ?? "__none__"}>
                    {sub.items.map((c) => {
                      const isAssignedElsewhere =
                        c.studentId !== value && Boolean(disabledStudentIds?.has(c.studentId));
                      // An already-assigned trainee is clickable (routed to a
                      // Move/Swap proposal) only when the parent supplied
                      // onOccupiedSelect; otherwise it stays disabled as before.
                      const routeOccupied = isAssignedElsewhere && Boolean(onOccupiedSelect);
                      const isUnavailable = isAssignedElsewhere && !routeOccupied;
                      return (
                        <button
                          key={c.studentId}
                          type="button"
                          disabled={isUnavailable}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (routeOccupied) {
                              // Never mutate the local draft for an occupied
                              // trainee - hand it to the parent's proposal flow.
                              onOccupiedSelect?.(c.studentId);
                            } else {
                              onChange(c.studentId);
                            }
                            setIsOpen(false);
                            setSearch("");
                          }}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
                            c.studentId === value ? "bg-primary/10" : ""
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium text-card-foreground">
                            {c.studentName}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {isAssignedElsewhere
                              ? "כבר בשיבוץ"
                              : sub.subgroupNumber != null
                                ? `תת-קבוצה ${sub.subgroupNumber}`
                                : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Single-select coach dropdown for a station, with an explicit "no coach"
// option (unlike TraineePicker's clear button, this is a dedicated row so
// it's always visible even when nothing is search-filtered out).
function StationCoachPicker({
  instructors,
  value,
  onChange,
}: {
  instructors: InstructorOption[];
  value: string;
  onChange: (instructorId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const selected = instructors.find((i) => i.id === value) ?? null;
  const filtered = instructors.filter((i) => i.fullName.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div ref={containerRef} className="relative min-w-0 w-full">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-right text-sm"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? selected.fullName : <span className="text-muted-foreground">ללא מאמן</span>}
        </span>
        <span className="shrink-0 text-muted-foreground">▾</span>
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש מאמן/ת..."
            autoFocus
            className="w-full border-b border-border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setIsOpen(false);
              setSearch("");
            }}
            className={`block w-full px-3 py-2 text-right text-sm hover:bg-muted ${
              !value ? "bg-primary/10 font-medium text-card-foreground" : "text-muted-foreground"
            }`}
          >
            ללא מאמן
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">לא נמצאו מאמנים</p>
          ) : (
            filtered.map((i) => (
              <button
                key={i.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(i.id);
                  setIsOpen(false);
                  setSearch("");
                }}
                className={`block w-full px-3 py-2 text-right text-sm hover:bg-muted ${
                  i.id === value ? "bg-primary/10 font-medium text-card-foreground" : ""
                }`}
              >
                {i.fullName}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface PairDraft {
  key: number;
  trainee1Id: string;
  trainee2Id: string;
  horseName: string;
  note: string;
}

let pairDraftKeySeq = 0;
function newPairDraftFrom(trainee1Id: string, trainee2Id: string, horseName: string): PairDraft {
  pairDraftKeySeq += 1;
  return { key: pairDraftKeySeq, trainee1Id, trainee2Id, horseName, note: "" };
}
function pairDraftFromRow(row: RidingSlotComplexPairRow): PairDraft {
  pairDraftKeySeq += 1;
  // pairRowToFields is the single, pure row -> editable-fields projection shared
  // with the Stage 2B pair dialog, so both initialize a pair identically.
  return { key: pairDraftKeySeq, ...pairRowToFields(row) };
}

// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 2B) - the single active inline edit
// target plus its live draft (see the inlineEdit state comment). blockTime and
// stationMeta are edited inline on the board; pair is edited in a focused
// sub-dialog. The *Id fields are source identity used only for lookup/save
// routing and are never rendered.
type InlineEditState =
  | null
  | { kind: "blockTime"; blockId: string; startTime: string; endTime: string }
  | { kind: "stationMeta"; blockId: string; stationId: string; instructorId: string; arena: string }
  // pairId null = CREATE (append a new pair); a string = EDIT/REMOVE an existing
  // pair. draft holds the live trainee/horse/note edit for either mode.
  | { kind: "pair"; blockId: string; stationId: string; pairId: string | null; draft: PairDraft };

// Compact per-station summary of every OTHER station already in the block -
// exactly the data computeStationClientIssues needs to mirror the server's
// cross-station hard-validation (trainee/horse/instructor duplicates,
// deliberately NOT arena - same-block arena reuse across coaches is allowed).
interface OtherStationSummary {
  instructorId: string | null;
  traineeIds: string[];
  horseKeys: string[];
}

function summarizeOtherStations(
  block: RidingSlotComplexBlockRow,
  excludeStationId: string | null
): OtherStationSummary[] {
  return block.stations
    .filter((s) => s.id !== excludeStationId)
    .map((s) => ({
      instructorId: s.instructorId,
      traineeIds: s.pairs.flatMap((p) => [p.trainee1Id, p.trainee2Id].filter((id): id is string => Boolean(id))),
      horseKeys: s.pairs.map((p) => p.horseName?.trim().toLowerCase()).filter((h): h is string => Boolean(h)),
    }));
}

// Client-side pre-checks only - mirrors the exact P5b hard-validation rules
// (same Hebrew text) so a mistake is caught before a round trip, but the
// server remains the sole authority; these never block typing/selecting,
// only the station Save button. Arena duplicates are intentionally never
// checked here (explicitly allowed across stations in the same block).
function computeStationClientIssues(
  pairs: PairDraft[],
  instructorId: string | null,
  otherStations: OtherStationSummary[]
): string[] {
  const issues: string[] = [];

  const hasMalformed = pairs.some((p) => !p.trainee1Id && (p.trainee2Id || p.horseName.trim() || p.note.trim()));
  if (hasMalformed) {
    issues.push("יש לבחור חניכ/ה ראשונ/ה לכל זוג שמכיל פרטים (סוס, הערה או חניכ/ה שני/ה)");
  }

  const meaningfulPairs = pairs.filter((p) => p.trainee1Id);

  if (meaningfulPairs.some((p) => p.trainee2Id && p.trainee2Id === p.trainee1Id)) {
    issues.push("לא ניתן לבחור את אותו/ה חניכ/ה פעמיים באותו זוג");
  }

  const traineeCounts = new Map<string, number>();
  for (const p of meaningfulPairs) {
    traineeCounts.set(p.trainee1Id, (traineeCounts.get(p.trainee1Id) ?? 0) + 1);
    if (p.trainee2Id) traineeCounts.set(p.trainee2Id, (traineeCounts.get(p.trainee2Id) ?? 0) + 1);
  }
  const otherTraineeIds = new Set(otherStations.flatMap((s) => s.traineeIds));
  const hasTraineeDuplicate =
    Array.from(traineeCounts.values()).some((c) => c > 1) ||
    Array.from(traineeCounts.keys()).some((id) => otherTraineeIds.has(id));
  if (hasTraineeDuplicate) {
    issues.push("אותו/ה חניכ/ה נבחר/ה יותר מפעם אחת באותו טווח שעות");
  }

  const horseCounts = new Map<string, number>();
  for (const p of meaningfulPairs) {
    const h = p.horseName.trim();
    if (!h) continue;
    horseCounts.set(h.toLowerCase(), (horseCounts.get(h.toLowerCase()) ?? 0) + 1);
  }
  const otherHorseKeys = new Set(otherStations.flatMap((s) => s.horseKeys));
  const hasHorseDuplicate =
    Array.from(horseCounts.values()).some((c) => c > 1) ||
    Array.from(horseCounts.keys()).some((k) => otherHorseKeys.has(k));
  if (hasHorseDuplicate) {
    issues.push("אותו שם סוס נבחר יותר מפעם אחת באותו טווח שעות");
  }

  if (instructorId && otherStations.some((s) => s.instructorId === instructorId)) {
    issues.push("אותו/ה מאמן/ת משובצ/ת ליותר מתחנה אחת באותו טווח שעות");
  }

  return issues;
}

// Trainees already paired somewhere in this block - every OTHER persisted
// station's pairs, plus the CURRENT station's own local (possibly unsaved)
// draft pairs. Deliberately excludes the picker's own in-progress selection
// (that state lives separately in ContextualPairPicker), so a candidate just
// tapped in the picker reads as "selected", never as "already used".
function computeUsedTraineeIds(
  block: RidingSlotComplexBlockRow,
  currentStationId: string | null,
  currentDraftPairs: PairDraft[]
): Set<string> {
  const used = new Set<string>();
  for (const station of block.stations) {
    if (station.id === currentStationId) continue;
    for (const pair of station.pairs) {
      if (pair.trainee1Id) used.add(pair.trainee1Id);
      if (pair.trainee2Id) used.add(pair.trainee2Id);
    }
  }
  for (const pair of currentDraftPairs) {
    if (pair.trainee1Id) used.add(pair.trainee1Id);
    if (pair.trainee2Id) used.add(pair.trainee2Id);
  }
  return used;
}

// Trainees already paired somewhere in an EARLIER time block of the same
// plan (by block.sortOrder, the server-guaranteed ordering - never array
// position on its own and never compared across unrelated RidingSlots).
// Informational only: unlike computeUsedTraineeIds this never disables
// selection and is not treated as a validation error - repeated scheduling
// across blocks is allowed and common (e.g. a trainee riding twice).
function computeEarlierAssignedTraineeIds(earlierBlocks: RidingSlotComplexBlockRow[]): Set<string> {
  const ids = new Set<string>();
  for (const block of earlierBlocks) {
    for (const station of block.stations) {
      for (const pair of station.pairs) {
        if (pair.trainee1Id) ids.add(pair.trainee1Id);
        if (pair.trainee2Id) ids.add(pair.trainee2Id);
      }
    }
  }
  return ids;
}

function candidateMatchesStationCoach(
  candidate: RidingSlotComplexTraineeCandidate,
  stationInstructorName: string | null
): boolean {
  if (!stationInstructorName || !candidate.responsibleInstructorNames) return false;
  return candidate.responsibleInstructorNames.includes(stationInstructorName);
}

// Applied once, at pair-creation time only, never re-applied afterward and
// never written back to Student/RidingLessonNote: one trainee -> use their
// assigned horse; two trainees with the same horse (case-insensitive) -> use
// the first-selected trainee's capitalization; otherwise leave blank.
function computePrefillHorse(
  candidate1: RidingSlotComplexTraineeCandidate | null,
  candidate2: RidingSlotComplexTraineeCandidate | null
): string {
  if (candidate1 && !candidate2) {
    return candidate1.horseName ?? "";
  }
  if (candidate1 && candidate2) {
    const h1 = candidate1.horseName?.trim();
    const h2 = candidate2.horseName?.trim();
    if (h1 && h2 && h1.toLowerCase() === h2.toLowerCase()) {
      return candidate1.horseName ?? "";
    }
  }
  return "";
}

// Read-only context shown under a pair's trainee selectors - each trainee's
// assigned horse and responsible coach, derived by studentId from the
// already-loaded candidate list. Never persisted; explains why a pair's
// horse field may have been left blank (different horses / no assignment).
function PairContextInfo({
  pair,
  candidates,
}: {
  pair: PairDraft;
  candidates: RidingSlotComplexTraineeCandidate[];
}) {
  const trainee1 = candidates.find((c) => c.studentId === pair.trainee1Id) ?? null;
  const trainee2 = pair.trainee2Id ? (candidates.find((c) => c.studentId === pair.trainee2Id) ?? null) : null;
  if (!trainee1) return null;
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground">
      <p className="truncate">
        סוס מוקצה ל{trainee1.studentName}: {trainee1.horseName ? trainee1.horseNameDisplay : "לא הוגדר סוס"}
        {" · "}מאמן/ת: {trainee1.responsibleInstructorNames ?? "לא הוגדר מאמן"}
      </p>
      {trainee2 && (
        <p className="truncate">
          סוס מוקצה ל{trainee2.studentName}: {trainee2.horseName ? trainee2.horseNameDisplay : "לא הוגדר סוס"}
          {" · "}מאמן/ת: {trainee2.responsibleInstructorNames ?? "לא הוגדר מאמן"}
        </p>
      )}
    </div>
  );
}

// Contextual candidate picker for creating ONE new pair in the currently
// open station. Rendered as an inline sub-view inside the station editor
// (never a nested modal). Already-used trainees are disabled for selection,
// not just badged; a coach-match badge is informational only (no sorting,
// no hard restriction) - matches must appear in their normal group/subgroup
// position.
function ContextualPairPicker({
  candidates,
  usedTraineeIds,
  earlierAssignedTraineeIds,
  stationInstructorName,
  initialSelectedIds,
  onConfirm,
  onCancel,
  onOccupiedClick,
}: {
  candidates: RidingSlotComplexTraineeCandidate[];
  usedTraineeIds: Set<string>;
  // Empty set when the current block is the plan's first block (by
  // sortOrder) - the "not yet scheduled" summary below is only rendered
  // when there is at least one earlier block, so it never claims "0 trainees
  // scheduled" clutter on the very first block.
  earlierAssignedTraineeIds: { ids: Set<string>; hasEarlierBlocks: boolean };
  stationInstructorName: string | null;
  // Trainees to pre-select when opened (the pair's current trainees when
  // editing an existing pair). Omitted / empty for a brand-new pair. Purely the
  // selector's own temporary UI state - Confirm is what copies it outward.
  initialSelectedIds?: string[];
  onConfirm: (trainee1Id: string, trainee2Id: string | null, prefillHorse: string) => void;
  onCancel: () => void;
  // RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.2): when provided (saved-pair
  // dialog), clicking an already-assigned trainee routes here to build one
  // atomic Move/Swap proposal instead of toggling - so an occupied trainee never
  // enters selectedIds. Omitted in CREATE mode and the legacy editor, where an
  // already-used trainee stays disabled as before.
  onOccupiedClick?: (studentId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialSelectedIds ?? []);
  const confirmedRef = useRef(false);

  function toggle(studentId: string) {
    setSelectedIds((current) => toggleTraineeSelection(current, studentId));
  }

  function handleConfirm() {
    if (selectedIds.length === 0 || confirmedRef.current) return;
    confirmedRef.current = true;
    const [id1, id2] = selectedIds;
    const c1 = candidates.find((c) => c.studentId === id1) ?? null;
    const c2 = id2 ? (candidates.find((c) => c.studentId === id2) ?? null) : null;
    onConfirm(id1, id2 ?? null, computePrefillHorse(c1, c2));
  }

  const filtered = candidates.filter((c) => c.studentName.toLowerCase().includes(search.trim().toLowerCase()));
  const sections = groupByGroupAndSubgroup(filtered);

  const notYetScheduledCount = earlierAssignedTraineeIds.hasEarlierBlocks
    ? candidates.filter((c) => !earlierAssignedTraineeIds.ids.has(c.studentId)).length
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="text-sm font-semibold text-card-foreground">בחירת חניכים לזוג</p>
        <span className="text-xs text-muted-foreground">נבחרו {selectedIds.length} מתוך 2</span>
      </div>
      {notYetScheduledCount !== null && (
        <p className="shrink-0 text-xs text-muted-foreground">טרם שובצו קודם: {notYetScheduledCount}</p>
      )}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="חיפוש חניכ/ה..."
        className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1">
        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">לא נמצאו חניכים</p>
        ) : (
          sections.map((section) => (
            <div key={section.groupName ?? "__none__"} className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                {section.groupName ? `קבוצה ${section.groupName}` : "ללא קבוצה"}
              </p>
              {section.subgroups.map((sub) => (
                <div key={sub.subgroupNumber ?? "__none__"} className="flex flex-col gap-1.5">
                  {sub.subgroupNumber != null && (
                    <p className="text-[11px] text-muted-foreground">תת-קבוצה {sub.subgroupNumber}</p>
                  )}
                  {sub.items.map((c) => {
                    const isUsed = usedTraineeIds.has(c.studentId);
                    const isSelected = selectedIds.includes(c.studentId);
                    const atCap = !isSelected && selectedIds.length >= 2;
                    // An already-used trainee is clickable (routed to a Move/Swap
                    // proposal) only when onOccupiedClick is supplied; otherwise
                    // it stays disabled exactly as before. A used trainee never
                    // enters the checkbox selection.
                    const routeOccupied = isUsed && Boolean(onOccupiedClick);
                    const disableTap = routeOccupied ? false : isUsed || atCap;
                    const isCoachMatch = candidateMatchesStationCoach(c, stationInstructorName);
                    // Non-blocking - never disables the trainee, never
                    // treated as a validation issue, does not prevent
                    // repeated scheduling across blocks.
                    const isScheduledEarlier = earlierAssignedTraineeIds.ids.has(c.studentId);
                    return (
                      <button
                        key={c.studentId}
                        type="button"
                        disabled={disableTap}
                        onClick={() => (routeOccupied ? onOccupiedClick?.(c.studentId) : toggle(c.studentId))}
                        className={`flex w-full flex-col gap-1 rounded-lg border p-2.5 text-right disabled:cursor-not-allowed ${
                          isSelected ? "border-primary bg-primary/10" : "border-border bg-card"
                        } ${disableTap ? "opacity-50" : "hover:bg-muted"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-card-foreground">
                            {c.studentName}
                          </span>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={disableTap}
                            readOnly
                            className="h-4 w-4 shrink-0"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                          <span>
                            {c.groupName ? `קבוצה ${c.groupName}` : "ללא קבוצה"}
                            {c.subgroupNumber != null ? ` / ${c.subgroupNumber}` : ""}
                          </span>
                          <span>· סוס: {c.horseName ? c.horseNameDisplay : "לא הוגדר סוס"}</span>
                          <span>· מאמן/ת: {c.responsibleInstructorNames ?? "לא הוגדר מאמן"}</span>
                        </div>
                        {(isUsed || isCoachMatch || isScheduledEarlier) && (
                          <div className="flex flex-wrap gap-1.5">
                            {isUsed && (
                              <span className="rounded-full bg-warning-muted px-2 py-0.5 text-[10px] font-medium text-warning">
                                כבר בזוג אחר בטווח הזה
                              </span>
                            )}
                            {isCoachMatch && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                מהקבוצה של המאמן/ת
                              </span>
                            )}
                            {isScheduledEarlier && (
                              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
                                שובץ בטווח קודם
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          ביטול
        </Button>
        <Button type="button" disabled={selectedIds.length === 0} onClick={handleConfirm}>
          אישור
        </Button>
      </div>
    </div>
  );
}

// One pair row - stacks vertically on narrow screens (no wide table), large
// tap targets. The trainee selectors here remain fully editable after
// creation (via the picker or directly loaded from the server) - only the
// picker itself is reserved for creating a brand-new pair.
// Quick-choice horse buttons for a pair row, derived from the two selected
// trainees' currently assigned horses (candidate.horseName - same raw,
// original-capitalization field computePrefillHorse already uses for the
// one-time pair-creation prefill). Suggestions only: clicking never disables
// further manual edits, and nothing here re-runs automatically when the
// trainee selection changes later (that would silently overwrite a horse the
// user already chose) - see PairRowEditor's own render for the trigger.
function quickHorseChoices(
  trainee1: RidingSlotComplexTraineeCandidate | null,
  trainee2: RidingSlotComplexTraineeCandidate | null
): string[] {
  const h1 = trainee1?.horseName?.trim() || null;
  const h2 = trainee2?.horseName?.trim() || null;
  const choices: string[] = [];
  if (h1) choices.push(h1);
  if (h2 && (!h1 || h2.toLowerCase() !== h1.toLowerCase())) choices.push(h2);
  return choices;
}

function PairRowEditor({
  pair,
  candidates,
  knownHorseNames,
  onChange,
  onRemove,
  onPickFromList,
  disabledTraineeIds,
  onOccupiedTraineeSelect,
}: {
  pair: PairDraft;
  candidates: RidingSlotComplexTraineeCandidate[];
  knownHorseNames: string[];
  onChange: (next: PairDraft) => void;
  // Optional: the legacy station editor passes it (a pair can be removed there);
  // the Stage 2B pair sub-dialog omits it (it edits fields only), so no remove
  // control is shown in that context.
  onRemove?: () => void;
  // Optional (schedule-board pair dialog): when provided, a secondary
  // "בחירה מרשימה" button is shown ALONGSIDE the two searchable trainee
  // dropdowns, opening the shared grouped ContextualPairPicker. Both methods
  // edit the same pair draft. Omitted in the legacy editor, whose dropdowns are
  // unchanged. Horse/note editing is identical in both.
  onPickFromList?: () => void;
  // Optional (schedule-board pair dialog): trainees assigned elsewhere in the
  // overlapping session, disabled in BOTH dropdowns so they follow the same
  // availability rule as the full selector. Omitted in the legacy editor.
  disabledTraineeIds?: Set<string>;
  // RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.2, saved-pair dialog): picking an
  // already-assigned trainee in either dropdown routes here with the target seat
  // (1 or 2) so the parent can offer an atomic Move/Swap instead of a local draft
  // edit. Omitted in CREATE mode and the legacy editor.
  onOccupiedTraineeSelect?: (slot: TraineeSlot, studentId: string) => void;
}) {
  const [showNote, setShowNote] = useState(Boolean(pair.note));
  const horseInputRef = useRef<{ focus: () => void } | null>(null);

  const trainee1 = candidates.find((c) => c.studentId === pair.trainee1Id) ?? null;
  const trainee2 = pair.trainee2Id ? (candidates.find((c) => c.studentId === pair.trainee2Id) ?? null) : null;
  const horseChoices = quickHorseChoices(trainee1, trainee2);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TraineePicker
          candidates={candidates}
          value={pair.trainee1Id}
          onChange={(id) => onChange({ ...pair, trainee1Id: id })}
          placeholder="חניכ/ה 1"
          disabledStudentIds={disabledTraineeIds}
          onOccupiedSelect={onOccupiedTraineeSelect ? (id) => onOccupiedTraineeSelect(1, id) : undefined}
        />
        <span className="hidden shrink-0 text-muted-foreground sm:inline">+</span>
        <TraineePicker
          candidates={candidates}
          value={pair.trainee2Id}
          onChange={(id) => onChange({ ...pair, trainee2Id: id })}
          placeholder="חניכ/ה 2 (אופציונלי)"
          disabledStudentIds={disabledTraineeIds}
          onOccupiedSelect={onOccupiedTraineeSelect ? (id) => onOccupiedTraineeSelect(2, id) : undefined}
        />
      </div>
      {onPickFromList && (
        <div className="flex justify-start">
          <Button type="button" variant="ghost" className="!px-2 !py-1 !text-xs" onClick={onPickFromList}>
            בחירה מרשימה
          </Button>
        </div>
      )}
      <PairContextInfo pair={pair} candidates={candidates} />
      {(horseChoices.length > 0 || pair.trainee1Id) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {horseChoices.map((h) => (
            <Button
              key={h}
              type="button"
              variant="secondary"
              className="!px-2 !py-1 !text-xs"
              onClick={() => onChange({ ...pair, horseName: h })}
            >
              {h}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="!px-2 !py-1 !text-xs"
            onClick={() => horseInputRef.current?.focus()}
          >
            סוס אחר
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <SuggestInput
            ref={horseInputRef}
            value={pair.horseName}
            onChange={(v) => onChange({ ...pair, horseName: v })}
            suggestions={knownHorseNames}
            placeholder="סוס"
          />
        </div>
        <Button type="button" variant="ghost" className="!px-2 !py-1 !text-xs" onClick={() => setShowNote((v) => !v)}>
          {showNote ? "הסתרת הערה" : "הוספת הערה"}
        </Button>
        {onRemove && (
          <Button type="button" variant="ghost" className="!px-2 !py-1 !text-xs text-danger" onClick={onRemove}>
            הסרת זוג
          </Button>
        )}
      </div>
      {showNote && (
        <input
          type="text"
          value={pair.note}
          onChange={(e) => onChange({ ...pair, note: e.target.value })}
          placeholder="הערה קצרה"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}

// Level 1.5: time-only block editor, shared for both a brand-new block and
// an existing one - keyed by the parent on view.blockId, so switching
// targets always remounts fresh rather than reusing stale draft state.
function BlockTimeEditorForm({
  actor,
  ridingSlotId,
  planVersion,
  block,
  onSaved,
  onCancel,
}: {
  actor: RidingComplexPlanEditorActor;
  ridingSlotId: string;
  // RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - the plan.version of the loaded
  // snapshot this form was opened against, sent back as expectedVersion. On a
  // STALE_PLAN conflict the server's generic message surfaces in saveError and
  // the draft is kept; the parent must be reopened to advance the version (this
  // form never silently re-derives it behind the draft).
  planVersion: number;
  block: RidingSlotComplexBlockRow | null;
  onSaved: (
    plan: RidingSlotComplexPlanRow,
    overlapWarning: string | undefined,
    savedBlockId: string | null,
    missingNewBlockId: boolean
  ) => void;
  onCancel: () => void;
}) {
  const [startTime, setStartTime] = useState(block?.startTime ?? "");
  const [endTime, setEndTime] = useState(block?.endTime ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const isSavingRef = useRef(false);

  const canSave = canSaveBlockTimes(startTime, endTime);

  function handleSave() {
    if (!canSave || isSavingRef.current) return;
    isSavingRef.current = true;
    setSaveError(null);
    startSaveTransition(async () => {
      const result = await saveComplexBlock(actor, {
        ridingSlotId,
        expectedVersion: planVersion,
        blockId: block ? block.id : undefined,
        startTime,
        endTime,
      });
      isSavingRef.current = false;
      if (!result.success || !result.plan) {
        setSaveError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      // Editing an existing block: its id is already known, never inferred.
      // Creating a new block: only the server-returned newBlockId identifies
      // it - never the last array element, max sortOrder, createdAt, or an
      // id diff, none of which are a stable identity guarantee under
      // concurrent creation or equal/changed sort ordering.
      if (block) {
        onSaved(result.plan, result.overlapWarning, block.id, false);
      } else {
        onSaved(result.plan, result.overlapWarning, result.newBlockId ?? null, !result.newBlockId);
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            שעת התחלה
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            שעת סיום
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
        </div>
        {saveError && <p className="text-sm text-danger">{saveError}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          ביטול
        </Button>
        <Button type="button" disabled={!canSave || isSaving} onClick={handleSave}>
          {isSaving ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </div>
  );
}

// Level 3: single coach station editor - coach, arena, and this station's
// own pairs only. Keyed by the parent on view.stationId, so switching
// targets always remounts fresh.
function StationEditorForm({
  actor,
  ridingSlotId,
  planVersion,
  blockId,
  block,
  earlierBlocks,
  station,
  canEdit,
  instructors,
  candidates,
  knownHorseNames,
  onSaved,
  onCancel,
}: {
  actor: RidingComplexPlanEditorActor;
  ridingSlotId: string;
  // RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - see BlockTimeEditorForm's
  // identical planVersion prop. Sent back as expectedVersion; a STALE_PLAN
  // conflict keeps this station draft and shows the generic conflict message.
  planVersion: number;
  blockId: string;
  block: RidingSlotComplexBlockRow;
  // Every block in the same plan that sorts before this one (by
  // block.sortOrder) - used only for the non-blocking "assigned in an
  // earlier block" indicator in ContextualPairPicker.
  earlierBlocks: RidingSlotComplexBlockRow[];
  station: RidingSlotComplexStationRow | null;
  // When false, this renders a read-only detail view instead (below) - a
  // read-only viewer only ever reaches this via "צפייה" on an EXISTING
  // station (StationCard hides "+ הוספת תחנת מאמן" entirely for canEdit
  // false), so `station` is always non-null in that branch.
  canEdit: boolean;
  instructors: InstructorOption[];
  candidates: RidingSlotComplexTraineeCandidate[];
  knownHorseNames: string[];
  onSaved: (plan: RidingSlotComplexPlanRow, warnings: RidingSlotComplexSaveWarnings) => void;
  onCancel: () => void;
}) {
  const [instructorId, setInstructorId] = useState(station?.instructorId ?? "");
  const [arena, setArena] = useState(station?.arena ?? "");
  const [pairs, setPairs] = useState<PairDraft[]>(station ? station.pairs.map(pairDraftFromRow) : []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const isSavingRef = useRef(false);

  function updatePair(key: number, next: PairDraft) {
    setPairs((current) => current.map((p) => (p.key === key ? next : p)));
  }
  function removePair(key: number) {
    setPairs((current) => current.filter((p) => p.key !== key));
  }

  const otherStations = summarizeOtherStations(block, station?.id ?? null);
  const clientIssues = computeStationClientIssues(pairs, instructorId || null, otherStations);
  const canSave = clientIssues.length === 0;

  const usedTraineeIds = computeUsedTraineeIds(block, station?.id ?? null, pairs);
  const stationInstructorName = instructors.find((i) => i.id === instructorId)?.fullName ?? null;
  const earlierAssignedTraineeIds = {
    ids: computeEarlierAssignedTraineeIds(earlierBlocks),
    hasEarlierBlocks: earlierBlocks.length > 0,
  };

  function handleSave() {
    if (!canSave || isSavingRef.current) return;
    isSavingRef.current = true;
    setSaveError(null);
    startSaveTransition(async () => {
      const result = await saveComplexStation(
        actor,
        buildStationSavePayload({
          ridingSlotId,
          expectedVersion: planVersion,
          blockId,
          stationId: station ? station.id : undefined,
          instructorId: instructorId || null,
          arena: arena || null,
          pairs: pairs.map(pairFieldsToInput),
        })
      );
      isSavingRef.current = false;
      if (!result.success || !result.plan) {
        setSaveError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      onSaved(
        result.plan,
        result.warnings ?? {
          noInstructor: !instructorId,
          noArena: !arena,
          zeroPairs: pairs.filter((p) => p.trainee1Id).length === 0,
          pairsMissingTrainee2: 0,
          pairsMissingHorse: 0,
        }
      );
    });
  }

  function handlePickerConfirm(trainee1Id: string, trainee2Id: string | null, prefillHorse: string) {
    setPairs((current) => [...current, newPairDraftFrom(trainee1Id, trainee2Id ?? "", prefillHorse)]);
    setPickerOpen(false);
  }

  // Read-only detail view - static text only, no inputs, no picker, no
  // Save - just a Back button. `station` is always non-null here (see the
  // canEdit prop's own comment above).
  if (!canEdit) {
    const coachName = instructors.find((i) => i.id === instructorId)?.fullName ?? null;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1 text-sm">
          <p>
            <span className="text-muted-foreground">מאמן/ת: </span>
            {coachName ?? "לא הוגדר מאמן"}
          </p>
          <p>
            <span className="text-muted-foreground">מגרש: </span>
            {arena || "לא הוגדר מגרש"}
          </p>
          <div className="flex flex-col gap-2">
            <p className="font-semibold text-card-foreground">זוגות</p>
            {pairs.length === 0 ? (
              <p className="text-muted-foreground">אין זוגות בתחנה זו</p>
            ) : (
              pairs.map((pair) => {
                const trainee1 = candidates.find((c) => c.studentId === pair.trainee1Id);
                const trainee2 = candidates.find((c) => c.studentId === pair.trainee2Id);
                return (
                  <div key={pair.key} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2.5">
                    <p className="font-medium text-card-foreground">
                      {trainee1?.studentName ?? "לא נבחר/ה"}
                      {trainee2 ? ` + ${trainee2.studentName}` : ""}
                    </p>
                    <p className="text-muted-foreground">סוס: {pair.horseName || "לא הוגדר"}</p>
                    {pair.note && <p className="text-muted-foreground">הערה: {pair.note}</p>}
                    <PairContextInfo pair={pair} candidates={candidates} />
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="flex shrink-0 justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            חזרה
          </Button>
        </div>
      </div>
    );
  }

  if (pickerOpen) {
    return (
      <ContextualPairPicker
        candidates={candidates}
        usedTraineeIds={usedTraineeIds}
        earlierAssignedTraineeIds={earlierAssignedTraineeIds}
        stationInstructorName={stationInstructorName}
        onConfirm={handlePickerConfirm}
        onCancel={() => setPickerOpen(false)}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1">
        <label className="flex flex-col gap-1 text-sm">
          מאמן/ת
          <StationCoachPicker instructors={instructors} value={instructorId} onChange={setInstructorId} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          מגרש
          <input
            type="text"
            value={arena}
            onChange={(e) => setArena(e.target.value)}
            placeholder="למשל: מגרש 1"
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-card-foreground">זוגות</p>
            <Button
              type="button"
              variant="secondary"
              className="!px-2 !py-1 !text-xs"
              onClick={() => setPickerOpen(true)}
            >
              + הוספת זוג
            </Button>
          </div>
          {pairs.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין עדיין זוגות בתחנה זו</p>
          ) : (
            <div className="flex flex-col gap-2">
              {pairs.map((pair) => (
                <PairRowEditor
                  key={pair.key}
                  pair={pair}
                  candidates={candidates}
                  knownHorseNames={knownHorseNames}
                  onChange={(next) => updatePair(pair.key, next)}
                  onRemove={() => removePair(pair.key)}
                />
              ))}
            </div>
          )}
        </div>

        {clientIssues.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
            {clientIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        )}
        {saveError && <p className="text-sm text-danger">{saveError}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          ביטול
        </Button>
        <Button type="button" disabled={!canSave || isSaving} onClick={handleSave}>
          {isSaving ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </div>
  );
}

// Level 1 list card - one time block, summarized by station/pair counts and
// live incompleteness/overlap badges.
function BlockCard({
  block,
  index,
  total,
  canEdit,
  hasOverlap,
  onOpenStations,
  onEditTimes,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  pendingDisabled,
}: {
  block: RidingSlotComplexBlockRow;
  index: number;
  total: number;
  canEdit: boolean;
  hasOverlap: boolean;
  onOpenStations: () => void;
  onEditTimes: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  pendingDisabled: boolean;
}) {
  const totalPairs = block.stations.reduce((sum, s) => sum + s.pairs.length, 0);
  const warningBadges = blockStationWarningBadges(block);

  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-base font-bold text-card-foreground">
          {block.startTime}–{block.endTime}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {block.stations.length} תחנות
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{totalPairs} זוגות</span>
          {hasOverlap && (
            <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning">
              חופף לטווח אחר
            </span>
          )}
        </div>
      </div>
      {warningBadges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {warningBadges.map((b) => (
            <span key={b} className="rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
              {b}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onOpenStations} disabled={pendingDisabled}>
          {canEdit ? "פתיחה / ניהול תחנות" : "צפייה בתחנות"}
        </Button>
        {canEdit && (
          <>
            <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onEditTimes} disabled={pendingDisabled}>
              עריכת שעות
            </Button>
            <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onDuplicate} disabled={pendingDisabled}>
              שכפול
            </Button>
            <Button variant="danger" className="!px-2 !py-1 !text-xs" onClick={onDelete} disabled={pendingDisabled}>
              מחיקה
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={onMoveUp}
              disabled={pendingDisabled || index === 0}
              aria-label="הזזה למעלה"
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={onMoveDown}
              disabled={pendingDisabled || index === total - 1}
              aria-label="הזזה למטה"
            >
              ↓
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// Level 2 list card - one coach station within a block. Deliberately no
// duplicate action (stations are not duplicable, only blocks are).
function StationCard({
  station,
  index,
  total,
  canEdit,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  pendingDisabled,
}: {
  station: RidingSlotComplexStationRow;
  index: number;
  total: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  pendingDisabled: boolean;
}) {
  const badges = stationWarningBadges(station);

  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-base font-bold text-card-foreground">
          {station.instructor?.fullName ?? "לא הוגדר מאמן"}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {station.pairs.length} זוגות
        </span>
      </div>
      <p className="truncate text-sm text-card-foreground">מגרש: {station.arena ?? "לא הוגדר מגרש"}</p>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span key={b} className="rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
              {b}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onEdit} disabled={pendingDisabled}>
          {canEdit ? "עריכה" : "צפייה"}
        </Button>
        {canEdit && (
          <>
            <Button variant="danger" className="!px-2 !py-1 !text-xs" onClick={onDelete} disabled={pendingDisabled}>
              מחיקה
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={onMoveUp}
              disabled={pendingDisabled || index === 0}
              aria-label="הזזה למעלה"
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={onMoveDown}
              disabled={pendingDisabled || index === total - 1}
              aria-label="הזזה למטה"
            >
              ↓
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// Read-only "show all" overview of one station - same fields as StationCard
// plus each pair's trainees/horse/note inline, so a read-only instructor can
// read the whole block without opening every station's own detail view (that
// detail view, StationEditorForm's canEdit===false branch, stays reachable
// via "פתיחת תחנה" for anyone who still wants it focused on one station).
// Never rendered for an editable actor - no mutation controls exist here at
// all, matching StationEditorForm's own read-only branch.
function StationOverviewCard({
  station,
  candidates,
  onOpenDetail,
}: {
  station: RidingSlotComplexStationRow;
  candidates: RidingSlotComplexTraineeCandidate[];
  onOpenDetail: () => void;
}) {
  const badges = stationWarningBadges(station);

  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-base font-bold text-card-foreground">
          {station.instructor?.fullName ?? "לא הוגדר מאמן"}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {station.pairs.length} זוגות
        </span>
      </div>
      <p className="truncate text-sm text-card-foreground">מגרש: {station.arena ?? "לא הוגדר מגרש"}</p>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span key={b} className="rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
              {b}
            </span>
          ))}
        </div>
      )}
      {station.pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין זוגות בתחנה זו</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {station.pairs.map((pair) => {
            const trainee1 = candidates.find((c) => c.studentId === pair.trainee1Id);
            const trainee2 = candidates.find((c) => c.studentId === pair.trainee2Id);
            return (
              <div key={pair.id} className="rounded-lg bg-muted/50 p-2 text-xs">
                <p className="font-medium text-card-foreground">
                  {trainee1?.studentName ?? pair.trainee1Name ?? "לא נבחר/ה"}
                  {trainee2 || pair.trainee2Name ? ` + ${trainee2?.studentName ?? pair.trainee2Name}` : ""}
                </p>
                <p className="text-muted-foreground">
                  סוס: {pair.horseName || "לא הוגדר"}
                  {pair.note ? ` · הערה: ${pair.note}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" className="!px-2 !py-1 !text-xs" onClick={onOpenDetail}>
          פתיחת תחנה
        </Button>
      </div>
    </div>
  );
}

// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 2B) - inline time-range editor injected
// into a schedule-board block header. Presentational only: the parent owns the
// draft (value), the save/cancel handlers, and the single saveComplexBlock
// call. Reuses the exact canSaveBlockTimes rule the legacy block editor uses.
function InlineBlockTimeEditor({
  startTime,
  endTime,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  startTime: string;
  endTime: string;
  saving: boolean;
  error: string | null;
  onChange: (patch: { startTime?: string; endTime?: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const canSave = canSaveBlockTimes(startTime, endTime);
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          שעת התחלה
          <input
            type="time"
            value={startTime}
            onChange={(e) => onChange({ startTime: e.target.value })}
            className="rounded-lg border border-border px-2 py-1 text-sm text-card-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          שעת סיום
          <input
            type="time"
            value={endTime}
            onChange={(e) => onChange({ endTime: e.target.value })}
            className="rounded-lg border border-border px-2 py-1 text-sm text-card-foreground"
          />
        </label>
        <Button type="button" className="!px-2 !py-1 !text-xs" disabled={!canSave || saving} onClick={onSave}>
          {saving ? "שומר..." : "שמירה"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="!px-2 !py-1 !text-xs"
          disabled={saving}
          onClick={onCancel}
        >
          ביטול
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 2B) - inline station metadata (instructor
// + arena) editor injected into a schedule-board station card. Presentational
// only: the parent owns the draft and the single full-snapshot saveComplexStation
// call. Reuses the shared StationCoachPicker; `issues` are the exact
// computeStationClientIssues warnings (e.g. duplicate instructor in the block),
// computed by the parent, that gate Save.
function InlineStationMetaEditor({
  instructors,
  instructorId,
  arena,
  issues,
  saving,
  error,
  onChangeInstructor,
  onChangeArena,
  onSave,
  onCancel,
}: {
  instructors: InstructorOption[];
  instructorId: string;
  arena: string;
  issues: string[];
  saving: boolean;
  error: string | null;
  onChangeInstructor: (instructorId: string) => void;
  onChangeArena: (arena: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const canSave = issues.length === 0;
  return (
    <div className="flex w-full flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        מאמן/ת
        <StationCoachPicker instructors={instructors} value={instructorId} onChange={onChangeInstructor} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        מגרש
        <input
          type="text"
          value={arena}
          onChange={(e) => onChangeArena(e.target.value)}
          placeholder="למשל: מגרש 1"
          className="rounded-lg border border-border px-3 py-2 text-sm text-card-foreground"
        />
      </label>
      {issues.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning-muted/30 p-2 text-xs text-warning">
          {issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          className="!px-2 !py-1 !text-xs"
          disabled={saving}
          onClick={onCancel}
        >
          ביטול
        </Button>
        <Button type="button" className="!px-2 !py-1 !text-xs" disabled={!canSave || saving} onClick={onSave}>
          {saving ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </div>
  );
}

// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 2B) - focused pair sub-dialog. A nested
// Modal (the same nested-Modal pattern this file already uses for the publish/
// unpublish confirmations), reusing the exact PairRowEditor field editors
// (trainee 1, trainee 2, horse, note) - no field control is duplicated. The
// parent owns the draft and the single full-snapshot saveComplexStation call;
// `issues` are the exact computeStationClientIssues warnings for the whole
// station (with this pair's edit applied) that gate Save. Cancel/backdrop/X
// perform zero write; a failed save keeps the dialog and draft open.
// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 2B) - focused pair editor sub-dialog for
// CREATE (mode "create") and EDIT (mode "edit"). Trainees can be chosen TWO
// ways, both editing the SAME parent draft: (1) the two fast searchable
// TraineePicker dropdowns in the reused PairRowEditor, and (2) a secondary
// "בחירה מרשימה" button that opens the EXISTING shared grouped selector
// (ContextualPairPicker), which temporarily replaces the dialog body (no third
// nested Modal) and returns on Confirm/Cancel - Confirm copies the choice into
// the parent draft (onConfirmTrainees, seeded from the current draft so it
// reflects any dropdown changes), Cancel leaves the draft untouched. Horse/note
// are edited in the same PairRowEditor. The parent owns the draft and the single
// saveComplexStation write; this component holds only the selector-open toggle.
// Save is disabled without a first trainee. Remove (edit mode) delegates to the
// parent's confirm+save.
//
// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.2 - trainee Move/Swap): when the parent
// prepares a `proposal` (from an occupied-trainee click in a saved-pair dialog),
// this dialog's body is REPLACED by a safe Hebrew before/after confirmation - the
// same body-swap pattern the selector already uses, so there is never a third
// nested Modal. Confirm/Cancel are the parent's; occupied clicks in either the
// dropdowns or the full list route out via onOccupiedTraineeSelect /
// onOccupiedListClick and NEVER mutate the local draft.
function InlinePairDialog({
  mode,
  draft,
  candidates,
  knownHorseNames,
  usedTraineeIds,
  earlierAssignedTraineeIds,
  stationInstructorName,
  issues,
  saving,
  error,
  onChange,
  onConfirmTrainees,
  onSave,
  onRemove,
  onClose,
  onOccupiedTraineeSelect,
  onOccupiedListClick,
  proposal,
  proposalSubmitting,
  proposalError,
  onConfirmProposal,
  onCancelProposal,
}: {
  mode: "create" | "edit";
  draft: PairDraft;
  candidates: RidingSlotComplexTraineeCandidate[];
  knownHorseNames: string[];
  usedTraineeIds: Set<string>;
  earlierAssignedTraineeIds: { ids: Set<string>; hasEarlierBlocks: boolean };
  stationInstructorName: string | null;
  issues: string[];
  saving: boolean;
  error: string | null;
  onChange: (next: PairDraft) => void;
  onConfirmTrainees: (trainee1Id: string, trainee2Id: string | null, prefillHorse: string) => void;
  onSave: () => void;
  onRemove?: () => void;
  onClose: () => void;
  // Occupied-trainee routes (saved-pair dialog only); absent -> occupied
  // trainees stay disabled (CREATE mode / legacy behavior).
  onOccupiedTraineeSelect?: (slot: TraineeSlot, studentId: string) => void;
  onOccupiedListClick?: (studentId: string) => void;
  // The prepared Move/Swap confirmation view model, or null when no proposal is
  // pending. When set, the body renders the confirmation instead of the editor.
  proposal?: ProposalViewModel | null;
  proposalSubmitting?: boolean;
  proposalError?: string | null;
  onConfirmProposal?: () => void;
  onCancelProposal?: () => void;
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const canSave = Boolean(draft.trainee1Id) && issues.length === 0;
  const proposalOpen = Boolean(proposal);

  return (
    <Modal
      open
      title={proposal ? proposal.title : mode === "create" ? "הוספת זוג" : "עריכת זוג"}
      size="wide"
      onClose={() => {
        // Never dismiss mid-save/mid-submit via backdrop click or the header X.
        // A pending proposal is cancelled (zero write) before anything else;
        // then the selector; then the whole dialog.
        if (saving || proposalSubmitting) return;
        if (proposalOpen) {
          onCancelProposal?.();
          return;
        }
        if (selectorOpen) {
          setSelectorOpen(false);
          return;
        }
        onClose();
      }}
    >
      {proposal ? (
        // Confirmation body: renders ONLY the Stage 3C.1 view-model display
        // fields. No id/version appears in any text, attribute, or key.
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="text-card-foreground">{proposal.before}</p>
            <p className="font-medium text-card-foreground">{proposal.after}</p>
          </div>
          {proposalError && <p className="text-sm text-danger">{proposalError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={proposalSubmitting}
              onClick={() => onCancelProposal?.()}
            >
              {proposal.cancelLabel}
            </Button>
            <Button type="button" disabled={proposalSubmitting} onClick={() => onConfirmProposal?.()}>
              {proposalSubmitting ? "מבצע..." : proposal.confirmLabel}
            </Button>
          </div>
        </div>
      ) : selectorOpen ? (
        <div className="flex max-h-[70vh] min-h-0 flex-1 flex-col gap-2">
          {error && <p className="shrink-0 text-sm text-danger">{error}</p>}
          <ContextualPairPicker
            candidates={candidates}
            usedTraineeIds={usedTraineeIds}
            earlierAssignedTraineeIds={earlierAssignedTraineeIds}
            stationInstructorName={stationInstructorName}
            initialSelectedIds={initialTraineeSelection(draft.trainee1Id, draft.trainee2Id)}
            onConfirm={(t1, t2, prefillHorse) => {
              onConfirmTrainees(t1, t2, prefillHorse);
              setSelectorOpen(false);
            }}
            onCancel={() => setSelectorOpen(false)}
            onOccupiedClick={onOccupiedListClick}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <PairRowEditor
            pair={draft}
            candidates={candidates}
            knownHorseNames={knownHorseNames}
            onChange={onChange}
            onPickFromList={() => setSelectorOpen(true)}
            disabledTraineeIds={usedTraineeIds}
            onOccupiedTraineeSelect={onOccupiedTraineeSelect}
          />
          {issues.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
              {issues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {mode === "edit" && onRemove && (
                <Button type="button" variant="danger" className="!text-xs" disabled={saving} onClick={onRemove}>
                  הסרת זוג
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
                ביטול
              </Button>
              <Button type="button" disabled={!canSave || saving} onClick={onSave}>
                {saving ? "שומר..." : "שמירה"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Shared complex-session editor, opened as its own Modal exactly like
// RidingHorseListEditor - entirely self-contained (fetches on open, saves
// via the P5b actions routed through the actor prop) so the caller only
// needs to own the open/close boolean and pass ridingSlotId/instructors/actor.
// Reused unchanged by both the admin RidingSlotModal and the instructor
// screen - every operation routes through the eight small private helpers
// above; canEdit (server-returned) gates every mutating control, and
// whole-plan deletion stays admin-only regardless of canEdit.
export function RidingComplexPlanEditor({
  open,
  onClose,
  ridingSlotId,
  contextLabel,
  instructors,
  actor,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  ridingSlotId: string;
  contextLabel?: string;
  instructors: InstructorOption[];
  actor: RidingComplexPlanEditorActor;
  onDeleted: () => void;
}) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [editing, setEditing] = useState<RidingSlotComplexPlanForEditing | null>(null);
  const [view, setView] = useState<EditorView>({ type: "blockList" });
  // RIDING-COMPLEX-SCHEDULE-BOARD - presentation switch. When true (the Stage 2B
  // default, initialBoardView), the whole plan is shown at once as an editable
  // schedule board (ComplexPlanScheduleBoard); when false, the legacy
  // step-by-step editor ("עריכה קיימת") renders unchanged as a fallback. This
  // flag only chooses which presentation is visible - it never touches the
  // `view` state machine, any draft, or any save path.
  const [boardView, setBoardView] = useState(initialBoardView);
  // RIDING-COMPLEX-SCHEDULE-BOARD (Stage 2B - inline editing) - the single
  // active inline edit target opened from the schedule board (block time,
  // station metadata, or one pair), together with its draft. This is the ONE
  // draft authority for board editing; at most one target is ever set (enforced
  // by canOpenInlineTarget + the board's editLocked). null when nothing is
  // being edited inline. inlineError/inlineSaving are the shared save state for
  // whichever target is active. Source ids inside the target are used only for
  // routing/lookup and are never rendered.
  const [inlineEdit, setInlineEdit] = useState<InlineEditState>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isInlineSaving, startInlineSaveTransition] = useTransition();
  const isInlineSavingRef = useRef(false);
  // RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.2 - trainee Move/Swap) - the single
  // prepared confirmation view model (null when none pending), its own submit
  // transition/ref (kept separate from the station-save one above so neither
  // interferes), its own error, and a board-level notice shown after a
  // reload-closing outcome. Set only from a saved-pair dialog occupied-trainee
  // click; the pair dialog stays open (inlineEdit set) beneath the confirmation.
  const [moveSwapProposal, setMoveSwapProposal] = useState<ProposalViewModel | null>(null);
  const [moveSwapError, setMoveSwapError] = useState<string | null>(null);
  const [isApplyingMoveSwap, startMoveSwapTransition] = useTransition();
  const isApplyingMoveSwapRef = useRef(false);
  const [boardNotice, setBoardNotice] = useState<string | null>(null);
  const [lastOverlapWarning, setLastOverlapWarning] = useState<string | null>(null);
  const [lastStationWarnings, setLastStationWarnings] = useState<RidingSlotComplexSaveWarnings | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [stationListError, setStationListError] = useState<string | null>(null);
  const [busyBlockId, setBusyBlockId] = useState<string | null>(null);
  const [busyStationId, setBusyStationId] = useState<string | null>(null);
  // Read-only-instructor-only compact overview toggle for the station list
  // (see StationOverviewCard) - never affects an editable actor's station
  // list, which always renders the original StationCard-per-station view.
  const [showAllStations, setShowAllStations] = useState(false);
  const [isReorderingBlocks, startReorderBlocksTransition] = useTransition();
  const [isDuplicatingBlock, startDuplicateBlockTransition] = useTransition();
  const [isDeletingBlock, startDeleteBlockTransition] = useTransition();
  const [isReorderingStations, startReorderStationsTransition] = useTransition();
  const [isDeletingStation, startDeleteStationTransition] = useTransition();
  const [isDeletingPlan, startDeletePlanTransition] = useTransition();
  const [deletePlanError, setDeletePlanError] = useState<string | null>(null);

  // RIDING-COMPLEX-PUBLICATION P7B - publication status/publish/unpublish
  // state. Kept entirely separate from the `status`/`editing` load-state
  // machine above (publicationStatusLoading is its own flag) so a slow
  // status fetch never blocks the rest of the editor from rendering.
  const [publicationStatus, setPublicationStatus] = useState<ComplexRidingPlanPublicationStatus | null>(null);
  const [publicationStatusLoading, setPublicationStatusLoading] = useState(false);
  const [publicationStatusError, setPublicationStatusError] = useState<string | null>(null);
  // Monotonically increasing token, bumped on every fetch start (whether
  // from the target-keyed load effect below or a post-mutation/post-publish
  // refresh) - a resolving fetch only applies its result if it's still the
  // most recent one requested. This is what makes a slow status fetch safe
  // against a later ridingSlotId switch, a later mutation-triggered refresh,
  // or a publish/unpublish completing while an earlier fetch is still
  // in-flight - the same stale-response problem the main plan load effect's
  // `cancelled` flag solves, generalized to also cover refreshes triggered
  // outside that effect.
  const publicationStatusGenerationRef = useRef(0);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPublishing, startPublishTransition] = useTransition();
  const isPublishingRef = useRef(false);
  const [unpublishModalOpen, setUnpublishModalOpen] = useState(false);
  const [unpublishError, setUnpublishError] = useState<string | null>(null);
  const [isUnpublishing, startUnpublishTransition] = useTransition();
  const isUnpublishingRef = useRef(false);

  const anyBlockActionPending = isReorderingBlocks || isDuplicatingBlock || isDeletingBlock;
  const anyStationActionPending = isReorderingStations || isDeletingStation;

  // Resets ALL local state every time the modal opens (or targets a
  // different RidingSlot) - same convention as RidingHorseListEditor's own
  // load effect. `cancelled` guards against a stale response landing after
  // the target changed or the modal closed/unmounted.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("loading");
    setEditing(null);
    setView({ type: "blockList" });
    // Every open / ridingSlot change resets to the default schedule board.
    setBoardView(initialBoardView());
    setInlineEdit(null);
    setInlineError(null);
    setMoveSwapProposal(null);
    setMoveSwapError(null);
    setBoardNotice(null);
    setLastOverlapWarning(null);
    setLastStationWarnings(null);
    setListError(null);
    setStationListError(null);
    setDeletePlanError(null);
    setShowAllStations(false);

    readComplexPlan(actor, ridingSlotId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setStatus("not-found");
          return;
        }
        setEditing(result);
        setStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
    // actor is not included: it identifies WHO is looking, not WHAT is being
    // looked at - re-fetching only needs to react to open/ridingSlotId, same
    // as every other editor in this app keys its load effect on the target,
    // not the caller's own identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ridingSlotId]);

  // RIDING-COMPLEX-PUBLICATION P7B - reusable status (re)fetch, guarded by
  // publicationStatusGenerationRef (see that ref's own comment) rather than
  // a per-call `cancelled` closure, since this is called both from the
  // target-keyed effect below AND from several later, independent call
  // sites (post-mutation refresh, post-publish/unpublish refresh) that each
  // need the exact same staleness guard. showLoading is false for a
  // background refresh (status is already showing something useful) and
  // true only for the initial per-target load, so a background refresh
  // never flashes "טוען..." over an already-displayed badge.
  function loadPublicationStatus(showLoading: boolean) {
    publicationStatusGenerationRef.current += 1;
    const generation = publicationStatusGenerationRef.current;
    setPublicationStatusError(null);
    if (showLoading) setPublicationStatusLoading(true);

    readComplexPublicationStatus(actor, ridingSlotId)
      .then((result) => {
        if (publicationStatusGenerationRef.current !== generation) return;
        setPublicationStatus(result);
        if (!result) setPublicationStatusError("לא הצלחנו לטעון את מצב הפרסום");
      })
      .catch(() => {
        if (publicationStatusGenerationRef.current !== generation) return;
        setPublicationStatusError("לא הצלחנו לטעון את מצב הפרסום");
      })
      .finally(() => {
        if (publicationStatusGenerationRef.current !== generation) return;
        setPublicationStatusLoading(false);
      });
  }

  // Same target-keyed reset/cancel convention as the main plan load effect
  // above (deliberately not keyed on `actor`, for the identical reason that
  // effect's own comment gives) - resets to a clean "nothing loaded yet"
  // state on every open/ridingSlotId change so a previous plan's status can
  // never flash before the fresh fetch resolves.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPublicationStatus(null);
    setPublicationStatusError(null);
    loadPublicationStatus(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ridingSlotId]);

  // RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - reload the authoritative plan
  // after a lost-update (STALE_PLAN) conflict on a LIST operation (delete/
  // reorder/duplicate) that carries no open draft. Per the approved contract,
  // list ops re-read the authoritative plan (advancing the next expectedVersion
  // via refreshPlan) and surface the conflict notice, but NEVER auto-replay the
  // operation. Open block/station/pair drafts deliberately do NOT call this:
  // they keep their draft and require an explicit Cancel/Reopen so the version
  // is never silently advanced behind an in-progress edit.
  function reloadPlanAfterStaleConflict() {
    readComplexPlan(actor, ridingSlotId)
      .then((result) => {
        if (result) refreshPlan(result.plan);
      })
      .catch(() => {
        // A failed reload leaves the existing (stale) plan and the already-shown
        // conflict notice in place - the user can still refresh/reopen manually.
      });
  }

  function refreshPlan(plan: RidingSlotComplexPlanRow) {
    setEditing((prev) => (prev ? { ...prev, plan } : prev));
    // RIDING-COMPLEX-PUBLICATION P7B - every block/station/pair mutation's
    // success path already calls refreshPlan (see every handle* function
    // below), so hooking the post-mutation status refresh in here once is
    // sufficient to cover all of them without touching each handler
    // individually. A background refresh (showLoading=false) - the status
    // area already shows something, this only updates it once the server
    // confirms the new version (e.g. UNPUBLISHED/CURRENT -> STALE).
    loadPublicationStatus(false);
  }

  // RIDING-COMPLEX-SCHEDULE-BOARD (Stage 2B - inline editing) ------------------
  // Every handler below mutates ONLY local inline-edit state, or routes a save
  // through the existing saveComplexBlock / saveComplexStation writers (the same
  // authoritative path the legacy editor uses - no second, weaker writer).
  // Opening or cancelling performs zero query/write. Every station/pair save
  // resubmits the FULL station snapshot (the writer is full-replace, see audit),
  // so unedited pairs and untouched metadata are always preserved.

  // Any inline editor or the pair dialog is active - the board hides every other
  // edit control (editLocked), so only one target is ever open and switching
  // away always requires an explicit Cancel first (no silent draft discard).
  const inlineEditActive = inlineEdit !== null || isInlineSaving || isApplyingMoveSwap;
  // Switching between the schedule board and the legacy editor is blocked while
  // an inline draft is active/saving or a publication action is pending.
  const viewSwitchBlocked = isEditorActionBlocked(inlineEditActive, isPublishing || isUnpublishing);

  // A validation-only PairDraft for a pair NOT being edited (keys are negative
  // and render-stable, never colliding with the live editing draft's positive
  // key; only the field values matter to computeStationClientIssues / the
  // payload). Reuses the shared pairRowToFields projection.
  function otherPairDraft(row: RidingSlotComplexPairRow, index: number): PairDraft {
    return { key: -1 - index, ...pairRowToFields(row) };
  }

  // Adapt a full-station-snapshot pairs payload (built by the shared
  // buildPairSaveSnapshotPairs) back into PairDraft[] purely so the EXISTING
  // computeStationClientIssues validator can run over it. Validation-only:
  // keys are throwaway negatives and nulls coalesce to "" (the validator reads
  // string fields); this performs no pair replacement itself - the single
  // authoritative replacement lives in the pure helper.
  function snapshotToValidationDrafts(pairs: StationSavePairInput[]): PairDraft[] {
    return pairs.map((p, index) => ({
      key: -1 - index,
      trainee1Id: p.trainee1Id,
      trainee2Id: p.trainee2Id ?? "",
      horseName: p.horseName ?? "",
      note: p.note ?? "",
    }));
  }

  // Generic, non-PII Hebrew message for a failed pair-snapshot build - never a
  // raw id, and the same wording whether it surfaces during create, edit, or
  // remove.
  function pairSnapshotErrorMessage(reason: Extract<PairSnapshotResult, { ok: false }>["reason"]): string {
    switch (reason) {
      case "NO_TRAINEE":
        return "יש לבחור לפחות חניכ/ה אחת לזוג.";
      case "DUPLICATE_TARGET":
        return "אירעה שגיאה בזיהוי הזוג. רעננו ונסו שוב.";
      default:
        return "הזוג כבר לא קיים. רעננו ונסו שוב.";
    }
  }

  // Resolve a pair draft's trainee display NAMES (never ids) for the remove
  // confirmation copy.
  function pairTraineeNames(draft: PairDraft): string {
    const names = [draft.trainee1Id, draft.trainee2Id]
      .filter(Boolean)
      .map((id) => editing?.candidates.find((c) => c.studentId === id)?.studentName ?? "חניכ/ה");
    return names.length > 0 ? names.join(" ו-") : "ללא חניכים";
  }

  function openInlineBlockTime(blockId: string) {
    if (!plan || !canOpenInlineTarget(inlineEdit) || !boardEditTargetExists(plan.blocks, blockId, null)) return;
    const block = plan.blocks.find((b) => b.id === blockId);
    if (!block) return;
    setInlineError(null);
    setLastOverlapWarning(null);
    setInlineEdit({ kind: "blockTime", blockId, startTime: block.startTime, endTime: block.endTime });
  }

  function openInlineStationMeta(blockId: string, stationId: string) {
    if (!plan || !canOpenInlineTarget(inlineEdit) || !boardEditTargetExists(plan.blocks, blockId, stationId)) return;
    const station = plan.blocks.find((b) => b.id === blockId)?.stations.find((s) => s.id === stationId);
    if (!station) return;
    setInlineError(null);
    setLastStationWarnings(null);
    setInlineEdit({
      kind: "stationMeta",
      blockId,
      stationId,
      instructorId: station.instructorId ?? "",
      arena: station.arena ?? "",
    });
  }

  function openInlinePair(blockId: string, stationId: string, pairId: string) {
    if (!plan || !canOpenInlineTarget(inlineEdit) || !stationPairExists(plan.blocks, blockId, stationId, pairId)) return;
    const pairRow = plan.blocks
      .find((b) => b.id === blockId)
      ?.stations.find((s) => s.id === stationId)
      ?.pairs.find((p) => p.id === pairId);
    if (!pairRow) return;
    setInlineError(null);
    setLastStationWarnings(null);
    setBoardNotice(null);
    setInlineEdit({ kind: "pair", blockId, stationId, pairId, draft: pairDraftFromRow(pairRow) });
  }

  // CREATE mode: open the pair editor on a fresh empty pair (pairId null). The
  // station must still exist (fail closed on a stale card).
  function openInlineCreatePair(blockId: string, stationId: string) {
    if (!plan || !canOpenInlineTarget(inlineEdit) || !boardEditTargetExists(plan.blocks, blockId, stationId)) return;
    setInlineError(null);
    setLastStationWarnings(null);
    setBoardNotice(null);
    setInlineEdit({ kind: "pair", blockId, stationId, pairId: null, draft: newPairDraftFrom("", "", "") });
  }

  // Copy a confirmed trainee selection into the active pair draft (trainees +
  // contextual horse prefill only when the horse is still blank; note left
  // untouched). Local draft only - no server write.
  function applyInlineTraineeSelection(trainee1Id: string, trainee2Id: string | null, prefillHorse: string) {
    setInlineEdit((prev) =>
      prev?.kind === "pair"
        ? { ...prev, draft: { ...prev.draft, ...applyTraineeSelectionToDraft(prev.draft, trainee1Id, trainee2Id, prefillHorse) } }
        : prev
    );
  }

  function cancelInlineEdit() {
    // Never abandon a save or a Move/Swap that is already in flight.
    if (isInlineSavingRef.current || isApplyingMoveSwapRef.current) return;
    setInlineEdit(null);
    setInlineError(null);
    setMoveSwapProposal(null);
    setMoveSwapError(null);
  }

  // RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.2 - trainee Move/Swap) --------------
  // A saved-pair dialog is the ONLY entry point (occupied trainees are disabled
  // in CREATE mode and in the legacy editor). Every occupied click runs the
  // committed Stage 3C.1 decision core over the CURRENTLY LOADED authoritative
  // plan; nothing here re-derives a business rule or mutates the pair draft.

  // Build the block-scoped placement index from the loaded plan. Rebuilt per
  // click (plans are small) so it always reflects the latest refreshPlan.
  function currentPlacementIndex(): TraineePlacementIndex | null {
    return plan ? buildTraineePlacementIndex(plan) : null;
  }

  // studentId -> already-visible name; pairId -> an already-visible station label
  // (coach / arena / time range). Names only - never an id - so the proposal copy
  // stays id-free.
  function moveSwapLabelMaps(): { traineeNames: Map<string, string>; stationLabels: Map<string, string> } {
    const traineeNames = new Map<string, string>();
    for (const c of editing?.candidates ?? []) traineeNames.set(c.studentId, c.studentName);
    const stationLabels = new Map<string, string>();
    if (plan) {
      for (const block of plan.blocks) {
        for (const station of block.stations) {
          const label = station.instructor?.fullName ?? station.arena ?? `${block.startTime}–${block.endTime}`;
          for (const pair of station.pairs) stationLabels.set(pair.id, label);
        }
      }
    }
    return { traineeNames, stationLabels };
  }

  // Generic, non-PII Hebrew guidance for a decision that cannot become a
  // proposal. No id, name, or note.
  function moveSwapUnavailableMessage(): string {
    return "לא ניתן לבצע את הפעולה על החניכ/ה הזה. רעננו ונסו שוב.";
  }

  // Turn a decision into UI: MOVE/SWAP -> prepare the confirmation; NO_CHANGE ->
  // nothing; EXPLICIT_SLOT_REQUIRED -> ask for an explicit seat (full pair, both
  // held); AMBIGUOUS / UNAVAILABLE -> safe guidance; STALE_TARGET -> reload the
  // authoritative plan and close the (now stale) pair UI, never retrying.
  // LOCAL_SELECTION never reaches here (occupied clicks only).
  function dispatchTraineeDecision(decision: FullListTraineeDecision, candidateTraineeId: string) {
    if (inlineEdit?.kind !== "pair") return;
    if (decision.kind === "MOVE_PROPOSAL" || decision.kind === "SWAP_PROPOSAL") {
      const proposalInput = decisionToProposalInput(decision);
      const index = currentPlacementIndex();
      if (!proposalInput || !index) return;
      const { traineeNames, stationLabels } = moveSwapLabelMaps();
      const labels = buildMoveSwapProposalLabels(proposalInput, {
        index,
        blockId: inlineEdit.blockId,
        candidateTraineeName: traineeNames.get(candidateTraineeId) ?? null,
        traineeNames,
        stationLabels,
      });
      setMoveSwapError(null);
      setMoveSwapProposal(buildProposalViewModel(proposalInput, labels));
      return;
    }
    if (decision.kind === "STALE_TARGET") {
      reloadPlanAndClosePairUI("העמדה השתנתה. רעננו את התצוגה.");
      return;
    }
    if (decision.kind === "EXPLICIT_SLOT_REQUIRED") {
      // Both destination seats are held: a swap is required but the full list
      // cannot say with whom. Zero action; ask for an explicit seat. Draft kept.
      setInlineError("כדי לבחור עם מי לבצע החלפה, יש לבחור את החניך דרך השדה חניך 1 או חניך 2.");
      return;
    }
    if (decision.kind === "AMBIGUOUS" || decision.kind === "UNAVAILABLE") {
      setInlineError(moveSwapUnavailableMessage());
      return;
    }
    // NO_CHANGE / LOCAL_SELECTION: nothing to do (draft untouched).
  }

  // A saved-pair dropdown occupied-select: the destination seat is explicit.
  function handleOccupiedDropdownSelect(slot: TraineeSlot, candidateTraineeId: string) {
    if (!plan || inlineEdit?.kind !== "pair") return;
    const index = currentPlacementIndex();
    if (!index) return;
    const decision = decideTraineeSelection({
      index,
      blockId: inlineEdit.blockId,
      candidateTraineeId,
      destinationPairId: inlineEdit.pairId,
      destinationSlot: slot,
      expectedVersion: plan.version,
    });
    dispatchTraineeDecision(decision, candidateTraineeId);
  }

  // A saved-pair full-list occupied click: the seat is resolved by the core.
  function handleOccupiedListClick(candidateTraineeId: string) {
    if (!plan || inlineEdit?.kind !== "pair") return;
    const index = currentPlacementIndex();
    if (!index) return;
    const decision = decideFullListTraineeClick({
      index,
      blockId: inlineEdit.blockId,
      candidateTraineeId,
      destinationPairId: inlineEdit.pairId,
      expectedVersion: plan.version,
    });
    dispatchTraineeDecision(decision, candidateTraineeId);
  }

  // The ONE authoritative reload-and-close path for a Move/Swap outcome that
  // discards the pair dialog (APPLIED / STALE_RELOAD / STALE_TARGET): reload via
  // the committed reader, close the proposal + pair dialog, clear the now-stale
  // draft, and surface an optional board notice. Never auto-retries.
  function reloadPlanAndClosePairUI(notice: string | null) {
    setMoveSwapProposal(null);
    setMoveSwapError(null);
    setInlineEdit(null);
    setInlineError(null);
    setBoardNotice(notice);
    readComplexPlan(actor, ridingSlotId)
      .then((result) => {
        if (result) refreshPlan(result.plan);
      })
      .catch(() => {
        // A failed reload leaves the dialog closed and the existing plan in
        // place; the user can refresh manually. No retry.
      });
  }

  // Confirm the pending proposal: protected against double-submit, calls exactly
  // one actor-routed Move/Swap action with the command produced by Stage 3C.1
  // UNCHANGED, then maps the result via decideProposalActionResult. Never
  // constructs a second command; never auto-retries.
  function confirmMoveSwapProposal() {
    if (!moveSwapProposal || isApplyingMoveSwapRef.current) return;
    const command = moveSwapProposal.command;
    isApplyingMoveSwapRef.current = true;
    setMoveSwapError(null);
    startMoveSwapTransition(async () => {
      const result = await applyComplexMoveSwap(actor, ridingSlotId, command);
      isApplyingMoveSwapRef.current = false;
      const directive = decideProposalActionResult({ success: result.success, reason: result.reason });
      if (directive.outcome === "APPLIED") {
        reloadPlanAndClosePairUI(null);
        return;
      }
      if (directive.outcome === "STALE_RELOAD") {
        reloadPlanAndClosePairUI("התכנון עודכן בינתיים. רעננו ונסו שוב.");
        return;
      }
      // FAILED: keep the proposal open with a generic message; never retry.
      setMoveSwapError(result.error ?? "אירעה שגיאה. נסו שוב.");
    });
  }

  // Cancel the pending proposal: zero action, zero write, no draft mutation -
  // returns to the pair dialog / selector exactly as it was.
  function cancelMoveSwapProposal() {
    if (isApplyingMoveSwapRef.current) return;
    setMoveSwapProposal(null);
    setMoveSwapError(null);
  }

  function saveInlineBlockTime() {
    if (inlineEdit?.kind !== "blockTime" || isInlineSavingRef.current) return;
    const { blockId, startTime, endTime } = inlineEdit;
    if (!canSaveBlockTimes(startTime, endTime)) return;
    if (!plan || !boardEditTargetExists(plan.blocks, blockId, null)) {
      setInlineError("טווח השעות כבר לא קיים. רעננו ונסו שוב.");
      return;
    }
    isInlineSavingRef.current = true;
    setInlineError(null);
    startInlineSaveTransition(async () => {
      const result = await saveComplexBlock(actor, {
        ridingSlotId,
        expectedVersion: plan.version,
        blockId,
        startTime,
        endTime,
      });
      isInlineSavingRef.current = false;
      if (!result.success || !result.plan) {
        // STALE_PLAN keeps this open inline draft (its generic message is in
        // result.error); the version is never silently advanced behind it.
        setInlineError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      refreshPlan(result.plan);
      setLastOverlapWarning(result.overlapWarning ?? null);
      setInlineEdit(null);
    });
  }

  function saveInlineStationMeta() {
    if (inlineEdit?.kind !== "stationMeta" || isInlineSavingRef.current) return;
    const { blockId, stationId, instructorId, arena } = inlineEdit;
    if (!plan) return;
    const block = plan.blocks.find((b) => b.id === blockId);
    const station = block?.stations.find((s) => s.id === stationId);
    if (!block || !station) {
      setInlineError("התחנה כבר לא קיימת. רעננו ונסו שוב.");
      return;
    }
    // Full-station snapshot: new instructor/arena + EVERY existing pair unchanged.
    const pairDrafts = station.pairs.map((row, index) => otherPairDraft(row, index));
    const issues = computeStationClientIssues(pairDrafts, instructorId || null, summarizeOtherStations(block, stationId));
    if (issues.length > 0) {
      setInlineError(issues.join(" · "));
      return;
    }
    isInlineSavingRef.current = true;
    setInlineError(null);
    startInlineSaveTransition(async () => {
      const result = await saveComplexStation(
        actor,
        buildStationSavePayload({
          ridingSlotId,
          expectedVersion: plan.version,
          blockId,
          stationId,
          instructorId: instructorId || null,
          arena: arena || null,
          pairs: pairDrafts.map(pairFieldsToInput),
        })
      );
      isInlineSavingRef.current = false;
      if (!result.success || !result.plan) {
        setInlineError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      refreshPlan(result.plan);
      if (result.warnings) setLastStationWarnings(result.warnings);
      setInlineEdit(null);
    });
  }

  function saveInlinePair() {
    if (inlineEdit?.kind !== "pair" || isInlineSavingRef.current) return;
    const { blockId, stationId, pairId, draft } = inlineEdit;
    if (!plan) return;
    const block = plan.blocks.find((b) => b.id === blockId);
    const station = block?.stations.find((s) => s.id === stationId);
    if (!block || !station) {
      setInlineError("הזוג כבר לא קיים. רעננו ונסו שוב.");
      return;
    }
    // Full-station snapshot from the single authoritative pure helper: CREATE
    // (pairId null) appends one pair at the end; EDIT replaces exactly the
    // target pair. Both forward every other pair unchanged, in order, with no
    // ids. Fails closed (no write) with a generic non-PII message, keeping the
    // dialog and draft open.
    const snapshot =
      pairId === null
        ? appendPairToStationSnapshot(station.pairs, draft)
        : buildPairSaveSnapshotPairs(station.pairs, pairId, draft);
    if (!snapshot.ok) {
      setInlineError(pairSnapshotErrorMessage(snapshot.reason));
      return;
    }
    const issues = computeStationClientIssues(
      snapshotToValidationDrafts(snapshot.pairs),
      station.instructorId || null,
      summarizeOtherStations(block, stationId)
    );
    if (issues.length > 0) {
      setInlineError(issues.join(" · "));
      return;
    }
    savePairStationSnapshot(blockId, stationId, station.instructorId || null, station.arena || null, snapshot.pairs);
  }

  // Remove the pair currently being edited: an explicit confirmation showing the
  // pair's trainee NAMES (never ids), then a full-station snapshot with exactly
  // that pair omitted. Reuses the one saveComplexStation write; fails closed on
  // a missing/duplicate target. Only valid in EDIT mode (pairId set).
  function removeInlinePair() {
    if (inlineEdit?.kind !== "pair" || inlineEdit.pairId === null || isInlineSavingRef.current) return;
    const { blockId, stationId, pairId } = inlineEdit;
    if (!plan) return;
    const block = plan.blocks.find((b) => b.id === blockId);
    const station = block?.stations.find((s) => s.id === stationId);
    if (!block || !station) {
      setInlineError("הזוג כבר לא קיים. רעננו ונסו שוב.");
      return;
    }
    const names = pairTraineeNames(inlineEdit.draft);
    if (!window.confirm(`להסיר את הזוג ${names}? לא ניתן לשחזר את הפעולה.`)) return;
    const snapshot = removePairFromStationSnapshot(station.pairs, pairId);
    if (!snapshot.ok) {
      setInlineError(pairSnapshotErrorMessage(snapshot.reason));
      return;
    }
    savePairStationSnapshot(blockId, stationId, station.instructorId || null, station.arena || null, snapshot.pairs);
  }

  // Shared write tail for every pair create/edit/remove: submits the complete
  // station snapshot through the one saveComplexStation path, refreshes the
  // authoritative plan, and closes the dialog. A failed save keeps the dialog
  // and draft open with the existing error behavior.
  function savePairStationSnapshot(
    blockId: string,
    stationId: string,
    instructorId: string | null,
    arena: string | null,
    pairs: StationSavePairInput[]
  ) {
    // Both callers (saveInlinePair/removeInlinePair) already guard `plan`; this
    // re-guard is only so plan.version can be read as the expectedVersion.
    if (!plan) return;
    const expectedVersion = plan.version;
    isInlineSavingRef.current = true;
    setInlineError(null);
    startInlineSaveTransition(async () => {
      const result = await saveComplexStation(
        actor,
        buildStationSavePayload({ ridingSlotId, expectedVersion, blockId, stationId, instructorId, arena, pairs })
      );
      isInlineSavingRef.current = false;
      if (!result.success || !result.plan) {
        // STALE_PLAN keeps this open pair draft (generic message in
        // result.error); the version is never silently advanced behind it.
        setInlineError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      refreshPlan(result.plan);
      if (result.warnings) setLastStationWarnings(result.warnings);
      setInlineEdit(null);
    });
  }

  function handleBlockTimeSaved(
    plan: RidingSlotComplexPlanRow,
    overlapWarning: string | undefined,
    savedBlockId: string | null,
    missingNewBlockId: boolean
  ) {
    refreshPlan(plan);
    setLastOverlapWarning(overlapWarning ?? null);
    setStationListError(null);
    setLastStationWarnings(null);
    if (savedBlockId) {
      setView({ type: "stationList", blockId: savedBlockId });
      return;
    }
    // A successful create that unexpectedly came back without newBlockId -
    // never guess which block was just created; fall back to the block list
    // (the refreshed plan already includes it) and surface a small notice.
    setListError(missingNewBlockId ? "טווח השעות נוצר, אך לא ניתן היה לפתוח את תחנות המאמן שלו אוטומטית" : null);
    setView({ type: "blockList" });
  }

  function handleCancelBlockEdit() {
    setView({ type: "blockList" });
  }

  function handleOpenStations(blockId: string) {
    setStationListError(null);
    setLastStationWarnings(null);
    setShowAllStations(false);
    setView({ type: "stationList", blockId });
  }

  function handleBackToBlockList() {
    setView({ type: "blockList" });
  }

  function handleDuplicateBlock(blockId: string) {
    if (anyBlockActionPending || !plan) return;
    const expectedVersion = plan.version;
    setListError(null);
    setBusyBlockId(blockId);
    startDuplicateBlockTransition(async () => {
      const result = await duplicateComplexBlock(actor, ridingSlotId, blockId, expectedVersion);
      setBusyBlockId(null);
      if (!result.success || !result.plan) {
        setListError(result.error ?? "אירעה שגיאה בשכפול הבלוק");
        // List op with no draft: on a lost-update conflict reload the
        // authoritative plan (advancing the version) but never auto-replay.
        if (result.staleConflict) reloadPlanAfterStaleConflict();
        return;
      }
      refreshPlan(result.plan);
    });
  }

  function handleDeleteBlock(blockId: string) {
    if (anyBlockActionPending || !plan) return;
    if (!window.confirm("למחוק את טווח השעות הזה? כל התחנות והזוגות בו יימחקו. לא ניתן לשחזר את הפעולה.")) return;
    const expectedVersion = plan.version;
    setListError(null);
    setBusyBlockId(blockId);
    startDeleteBlockTransition(async () => {
      const result = await deleteComplexBlock(actor, ridingSlotId, blockId, expectedVersion);
      setBusyBlockId(null);
      if (!result.success || !result.plan) {
        setListError(result.error ?? "אירעה שגיאה במחיקת טווח השעות");
        if (result.staleConflict) reloadPlanAfterStaleConflict();
        return;
      }
      refreshPlan(result.plan);
    });
  }

  function handleMoveBlock(blockId: string, direction: "up" | "down") {
    if (anyBlockActionPending || !editing) return;
    const expectedVersion = editing.plan.version;
    const ids = editing.plan.blocks.map((b) => b.id);
    const index = ids.indexOf(blockId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= ids.length) return;
    const reordered = [...ids];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

    setListError(null);
    startReorderBlocksTransition(async () => {
      const result = await reorderComplexBlocks(actor, ridingSlotId, reordered, expectedVersion);
      if (!result.success || !result.plan) {
        setListError(result.error ?? "אירעה שגיאה בסידור טווחי השעות");
        if (result.staleConflict) reloadPlanAfterStaleConflict();
        return;
      }
      refreshPlan(result.plan);
    });
  }

  function handleStationSaved(plan: RidingSlotComplexPlanRow, warnings: RidingSlotComplexSaveWarnings) {
    refreshPlan(plan);
    setLastStationWarnings(warnings);
    if (view.type === "editStation") {
      setView({ type: "stationList", blockId: view.blockId });
    }
  }

  function handleCancelStationEdit() {
    if (view.type === "editStation") {
      setView({ type: "stationList", blockId: view.blockId });
    } else {
      setView({ type: "blockList" });
    }
  }

  function handleDeleteStation(blockId: string, stationId: string) {
    if (anyStationActionPending || !plan) return;
    if (!window.confirm("למחוק את תחנת המאמן הזו? כל הזוגות בה יימחקו. לא ניתן לשחזר את הפעולה.")) return;
    const expectedVersion = plan.version;
    setStationListError(null);
    setBusyStationId(stationId);
    startDeleteStationTransition(async () => {
      const result = await deleteComplexStation(actor, ridingSlotId, blockId, stationId, expectedVersion);
      setBusyStationId(null);
      if (!result.success || !result.plan) {
        setStationListError(result.error ?? "אירעה שגיאה במחיקת התחנה");
        if (result.staleConflict) reloadPlanAfterStaleConflict();
        return;
      }
      refreshPlan(result.plan);
    });
  }

  function handleMoveStation(blockId: string, stationId: string, direction: "up" | "down") {
    if (anyStationActionPending || !editing) return;
    const expectedVersion = editing.plan.version;
    const block = editing.plan.blocks.find((b) => b.id === blockId);
    if (!block) return;
    const ids = block.stations.map((s) => s.id);
    const index = ids.indexOf(stationId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= ids.length) return;
    const reordered = [...ids];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

    setStationListError(null);
    startReorderStationsTransition(async () => {
      const result = await reorderComplexStations(actor, ridingSlotId, blockId, reordered, expectedVersion);
      if (!result.success || !result.plan) {
        setStationListError(result.error ?? "אירעה שגיאה בסידור התחנות");
        if (result.staleConflict) reloadPlanAfterStaleConflict();
        return;
      }
      refreshPlan(result.plan);
    });
  }

  // Admin-only regardless of canEdit - an instructor actor never reaches
  // this (the button itself is never rendered for actor.type === "instructor",
  // see the render below), but the guard is kept here too since the server
  // action itself has no instructor variant to call by mistake.
  function handleDeletePlan() {
    if (actor.type !== "admin" || isDeletingPlan) return;
    if (
      !window.confirm(
        "למחוק את כל תכנון הרכיבה המורכב? כל טווחי השעות, התחנות והזוגות בתכנון זה יימחקו לצמיתות. לא ניתן לשחזר את הפעולה."
      )
    ) {
      return;
    }
    setDeletePlanError(null);
    startDeletePlanTransition(async () => {
      const result = await deleteRidingSlotComplexPlanAsAdmin(ridingSlotId);
      if (!result.success) {
        setDeletePlanError(result.error ?? "אירעה שגיאה במחיקת התכנון");
        return;
      }
      onDeleted();
    });
  }

  // RIDING-COMPLEX-PUBLICATION P7B - publish/republish. canEdit already
  // reflects the server-checked permission (admin, or an active instructor
  // with canEditRidingNotes) - this only adds the client-side "never open a
  // misleading confirmation for a zero-block plan" guard; the server action
  // remains the sole authority on every actual permission/hard-block check.
  function openPublishModal() {
    if (!canEdit || !plan || plan.blocks.length === 0 || isPublishingRef.current) return;
    setPublishError(null);
    setPublishModalOpen(true);
  }

  function closePublishModal() {
    if (isPublishingRef.current) return;
    setPublishModalOpen(false);
  }

  function handleConfirmPublish() {
    if (isPublishingRef.current) return;
    isPublishingRef.current = true;
    setPublishError(null);
    startPublishTransition(async () => {
      const result = await publishComplexPlan(actor, ridingSlotId);
      isPublishingRef.current = false;
      if (!result.success) {
        setPublishError(result.error ?? "לא הצלחנו לפרסם את התכנון");
        return;
      }
      setPublishModalOpen(false);
      // The publish action returns its own just-computed, server-authoritative
      // status object - using it directly avoids an extra round trip and is
      // never a client computation (it's exactly what the transaction that
      // just committed produced). Falling back to a refetch only guards the
      // (never actually expected) case of a successful result with no status.
      if (result.status) {
        setPublicationStatus(result.status);
        setPublicationStatusError(null);
      } else {
        loadPublicationStatus(false);
      }
    });
  }

  // RIDING-COMPLEX-PUBLICATION - unpublish is now available to an admin OR an
  // authorized instructor (canEdit, the server-checked isActive &&
  // canEditRidingNotes read - see canUnpublishComplexPlan), matching the
  // publish/republish trust tier. Same belt-and-suspenders guard convention as
  // openPublishModal above; the server actions remain the sole authority.
  function openUnpublishModal() {
    if (!canUnpublishComplexPlan(actor.type === "admin", canEdit)) return;
    if (!publicationStatus || publicationStatus.status === "UNPUBLISHED") return;
    if (isUnpublishingRef.current) return;
    setUnpublishError(null);
    setUnpublishModalOpen(true);
  }

  function closeUnpublishModal() {
    if (isUnpublishingRef.current) return;
    setUnpublishModalOpen(false);
  }

  function handleConfirmUnpublish() {
    if (!canUnpublishComplexPlan(actor.type === "admin", canEdit) || isUnpublishingRef.current) return;
    isUnpublishingRef.current = true;
    setUnpublishError(null);
    startUnpublishTransition(async () => {
      const result = await unpublishComplexPlan(actor, ridingSlotId);
      isUnpublishingRef.current = false;
      if (!result.success) {
        setUnpublishError(result.error ?? "לא הצלחנו לבטל את הפרסום");
        return;
      }
      // Handles the "already unpublished" case gracefully too - either way
      // the true current state is UNPUBLISHED, so a plain refetch (rather
      // than trusting a client-guessed status) is the correct, simplest
      // outcome for both branches of alreadyUnpublished.
      setUnpublishModalOpen(false);
      loadPublicationStatus(false);
    });
  }

  const plan = editing?.plan ?? null;
  const scheduleMeta = editing?.scheduleMeta ?? null;
  // Server-returned, never a client-side assumption - always true for admin
  // (see getRidingSlotComplexPlanForAdmin), reflects canEditRidingNotes for
  // an instructor actor. Gates every mutating control below; the P5b actions
  // themselves remain the actual authority regardless of what this hides.
  const canEdit = editing?.canEdit ?? false;

  const overlappingBlockIds = plan ? computeOverlappingBlockIds(plan.blocks) : new Set<string>();

  // Defensive fallback if the block/station targeted by `view` no longer
  // exists in the refreshed plan (e.g. deleted from another tab) - avoids a
  // crash, simply drops back to the block list.
  const activeBlock =
    plan && (view.type === "stationList" || view.type === "editStation")
      ? (plan.blocks.find((b) => b.id === view.blockId) ?? null)
      : null;
  if (plan && (view.type === "stationList" || view.type === "editStation") && !activeBlock) {
    setView({ type: "blockList" });
  }
  const activeStation =
    activeBlock && view.type === "editStation" && view.stationId
      ? (activeBlock.stations.find((s) => s.id === view.stationId) ?? null)
      : null;

  // RIDING-COMPLEX-SCHEDULE-BOARD (Stage 2B) - live client validation for
  // whichever inline target is active, computed with the SAME
  // computeStationClientIssues the legacy editor uses (full-station snapshot),
  // so an inline Save is gated identically. Empty unless a station/pair target
  // is active. Also builds the inline editor nodes injected into the board's
  // header/card slots (the board only decides placement).
  let inlineStationMetaIssues: string[] = [];
  let inlinePairIssues: string[] = [];
  if (plan && inlineEdit?.kind === "stationMeta") {
    const block = plan.blocks.find((b) => b.id === inlineEdit.blockId);
    const station = block?.stations.find((s) => s.id === inlineEdit.stationId);
    if (block && station) {
      const pairDrafts = station.pairs.map((row, index) => otherPairDraft(row, index));
      inlineStationMetaIssues = computeStationClientIssues(
        pairDrafts,
        inlineEdit.instructorId || null,
        summarizeOtherStations(block, station.id)
      );
    }
  } else if (plan && inlineEdit?.kind === "pair") {
    const block = plan.blocks.find((b) => b.id === inlineEdit.blockId);
    const station = block?.stations.find((s) => s.id === inlineEdit.stationId);
    if (block && station) {
      // Same single authoritative snapshot builders the save uses (CREATE
      // appends, EDIT replaces), so the dialog's Save gate and the save path
      // never diverge. A missing/ambiguous target fails closed to a generic
      // non-PII issue that disables Save; a NO_TRAINEE empty create draft shows
      // no warning box (the dialog's Save stays disabled until a trainee is
      // chosen).
      const snapshot =
        inlineEdit.pairId === null
          ? appendPairToStationSnapshot(station.pairs, inlineEdit.draft)
          : buildPairSaveSnapshotPairs(station.pairs, inlineEdit.pairId, inlineEdit.draft);
      if (snapshot.ok) {
        inlinePairIssues = computeStationClientIssues(
          snapshotToValidationDrafts(snapshot.pairs),
          station.instructorId || null,
          summarizeOtherStations(block, station.id)
        );
      } else if (snapshot.reason !== "NO_TRAINEE") {
        inlinePairIssues = ["לא ניתן לשמור זוג זה. רעננו ונסו שוב."];
      }
    }
  }

  const inlineBlockTimeNode =
    inlineEdit?.kind === "blockTime" ? (
      <InlineBlockTimeEditor
        startTime={inlineEdit.startTime}
        endTime={inlineEdit.endTime}
        saving={isInlineSaving}
        error={inlineError}
        onChange={(patch) => setInlineEdit((prev) => (prev?.kind === "blockTime" ? { ...prev, ...patch } : prev))}
        onSave={saveInlineBlockTime}
        onCancel={cancelInlineEdit}
      />
    ) : null;

  const inlineStationMetaNode =
    inlineEdit?.kind === "stationMeta" ? (
      <InlineStationMetaEditor
        instructors={instructors}
        instructorId={inlineEdit.instructorId}
        arena={inlineEdit.arena}
        issues={inlineStationMetaIssues}
        saving={isInlineSaving}
        error={inlineError}
        onChangeInstructor={(id) =>
          setInlineEdit((prev) => (prev?.kind === "stationMeta" ? { ...prev, instructorId: id } : prev))
        }
        onChangeArena={(a) => setInlineEdit((prev) => (prev?.kind === "stationMeta" ? { ...prev, arena: a } : prev))}
        onSave={saveInlineStationMeta}
        onCancel={cancelInlineEdit}
      />
    ) : null;

  const activePairEdit = inlineEdit?.kind === "pair" ? inlineEdit : null;

  // Grouped-selector inputs for the active pair dialog, computed with the exact
  // legacy helpers (availability, earlier-block, coach-match). The edited pair's
  // own trainees are excluded from "used" so they can stay selected; for a new
  // pair (pairId null) every existing pair of the station counts as used.
  let pairSelectorContext: {
    usedTraineeIds: Set<string>;
    earlierAssignedTraineeIds: { ids: Set<string>; hasEarlierBlocks: boolean };
    stationInstructorName: string | null;
  } | null = null;
  if (plan && activePairEdit) {
    const block = plan.blocks.find((b) => b.id === activePairEdit.blockId);
    const station = block?.stations.find((s) => s.id === activePairEdit.stationId);
    if (block && station) {
      const otherPairs = station.pairs
        .filter((p) => activePairEdit.pairId === null || p.id !== activePairEdit.pairId)
        .map((row, index) => otherPairDraft(row, index));
      const earlierBlocks = plan.blocks.filter((b) => b.sortOrder < block.sortOrder);
      pairSelectorContext = {
        usedTraineeIds: computeUsedTraineeIds(block, station.id, otherPairs),
        earlierAssignedTraineeIds: {
          ids: computeEarlierAssignedTraineeIds(earlierBlocks),
          hasEarlierBlocks: earlierBlocks.length > 0,
        },
        stationInstructorName: instructors.find((i) => i.id === station.instructorId)?.fullName ?? null,
      };
    }
  }

  return (
    <Modal
      open={open}
      title={contextLabel ? `תכנון רכיבה מורכבת - ${contextLabel}` : "תכנון רכיבה מורכבת"}
      size="large"
      onClose={onClose}
    >
      <div className="flex h-full flex-col gap-3">
        {status === "loading" && <p className="text-sm text-muted-foreground">טוען...</p>}
        {status === "not-found" && (
          <p className="text-sm text-danger">רכיבה זו לא נמצאה. ייתכן שנמחקה - סגרו ורעננו את העמוד.</p>
        )}
        {status === "error" && <p className="text-sm text-danger">שגיאה בטעינת התכנון. נסו לרענן.</p>}

        {status === "loaded" && editing && plan && (
          <>
            <div className="shrink-0 rounded-lg bg-secondary p-2.5 text-xs text-secondary-foreground">
              {scheduleMeta && (
                <p className="font-semibold">
                  {cleanScheduleTitle(scheduleMeta.activityTitle)} ·{" "}
                  {formatHebrewDate(parseDateKey(scheduleMeta.dateKey))} · {scheduleMeta.startTime}-
                  {scheduleMeta.endTime}
                </p>
              )}
              <p className="mt-0.5">
                עודכן ע&quot;י {plan.updatedByName} · {formatHebrewDateTime(new Date(plan.updatedAt))}
              </p>
            </div>

            {/* RIDING-COMPLEX-SCHEDULE-BOARD - read-only presentation switch.
                Defaults to the existing editor ("עריכה קיימת"); "תצוגת לוז"
                shows the whole plan at once. Additive only - no save controls.
                Only rendered from the safe list states (blockList/stationList)
                or while the board is already showing, so it can never unmount
                a BlockTimeEditorForm/StationEditorForm that holds an unsaved
                draft; when boardView is true it stays available so the user can
                always return to the editor. */}
            {(boardView || view.type === "blockList" || view.type === "stationList") && (
              <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-1">
                <Button
                  variant={boardView ? "secondary" : "ghost"}
                  aria-pressed={!boardView}
                  // Disabled while an inline draft is active/saving or a
                  // publication action is pending, so switching presentation can
                  // never silently orphan an unsaved draft - the user must Save
                  // or Cancel first.
                  disabled={viewSwitchBlocked}
                  className={`!flex-1 !py-1 !text-xs ${boardView ? "" : "!bg-card !shadow-sm"}`}
                  onClick={() => setBoardView(false)}
                >
                  עריכה קיימת
                </Button>
                <Button
                  variant={boardView ? "ghost" : "secondary"}
                  aria-pressed={boardView}
                  disabled={viewSwitchBlocked}
                  className={`!flex-1 !py-1 !text-xs ${boardView ? "!bg-card !shadow-sm" : ""}`}
                  onClick={() => setBoardView(true)}
                >
                  תצוגת לוז
                </Button>
              </div>
            )}

            {/* RIDING-COMPLEX-PUBLICATION - editor-level status/publish toolbar,
                the ONE publication control, shown in both "תצוגת לוז" and the
                legacy "עריכה קיימת" root. Uses the exact same state, handlers,
                confirmation modals, and server actions as before; blockedByEdit
                disables Publish/Unpublish (with an explanation) while an inline
                draft/selector/save or a publication action is in flight. */}
            {(boardView || view.type === "blockList") && (
              <PublicationStatusPanel
                status={publicationStatus}
                loading={publicationStatusLoading}
                error={publicationStatusError}
                canPublish={canEdit}
                canUnpublish={canUnpublishComplexPlan(actor.type === "admin", canEdit)}
                hasBlocks={plan.blocks.length > 0}
                blockedByEdit={inlineEditActive}
                onOpenPublish={openPublishModal}
                onOpenUnpublish={openUnpublishModal}
              />
            )}

            {boardView && boardNotice && (
              <p className="shrink-0 rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
                {boardNotice}
              </p>
            )}

            {boardView && (
              <ComplexPlanScheduleBoard
                plan={plan}
                candidates={editing.candidates}
                canEdit={canEdit}
                editLocked={inlineEditActive}
                inlineBlockTimeId={inlineEdit?.kind === "blockTime" ? inlineEdit.blockId : null}
                renderBlockTimeEditor={() => inlineBlockTimeNode}
                inlineStationMetaId={inlineEdit?.kind === "stationMeta" ? inlineEdit.stationId : null}
                renderStationMetaEditor={() => inlineStationMetaNode}
                onEditBlockTime={openInlineBlockTime}
                onEditStationMeta={openInlineStationMeta}
                onEditPair={openInlinePair}
                onAddPair={openInlineCreatePair}
              />
            )}

            {!boardView && view.type === "blockList" && (
              <>
                {/* Publication status/toolbar is now rendered once at editor
                    level above (shared by board + legacy root) - not here. */}
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-card-foreground">טווחי שעות</p>
                  {canEdit && (
                    <Button
                      variant="secondary"
                      className="!px-2 !py-1 !text-xs"
                      onClick={() => setView({ type: "editBlock", blockId: null })}
                      disabled={anyBlockActionPending}
                    >
                      + הוספת טווח שעות
                    </Button>
                  )}
                </div>

                {lastOverlapWarning && (
                  <p className="shrink-0 rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
                    {lastOverlapWarning}
                  </p>
                )}
                {listError && <p className="shrink-0 text-sm text-danger">{listError}</p>}

                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto ps-1">
                  {plan.blocks.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-6 text-center">
                      <p className="text-sm text-muted-foreground">עדיין לא הוגדרו טווחי שעות לתכנון זה</p>
                      {canEdit && (
                        <Button onClick={() => setView({ type: "editBlock", blockId: null })}>
                          הוספת טווח שעות ראשון
                        </Button>
                      )}
                    </div>
                  ) : (
                    plan.blocks.map((block, index) => (
                      <BlockCard
                        key={block.id}
                        block={block}
                        index={index}
                        total={plan.blocks.length}
                        canEdit={canEdit}
                        hasOverlap={overlappingBlockIds.has(block.id)}
                        pendingDisabled={anyBlockActionPending || busyBlockId === block.id}
                        onOpenStations={() => handleOpenStations(block.id)}
                        onEditTimes={() => setView({ type: "editBlock", blockId: block.id })}
                        onDuplicate={() => handleDuplicateBlock(block.id)}
                        onDelete={() => handleDeleteBlock(block.id)}
                        onMoveUp={() => handleMoveBlock(block.id, "up")}
                        onMoveDown={() => handleMoveBlock(block.id, "down")}
                      />
                    ))
                  )}
                </div>

                {actor.type === "admin" && (
                  <div className="shrink-0 border-t border-border pt-3">
                    {deletePlanError && <p className="mb-2 text-sm text-danger">{deletePlanError}</p>}
                    <Button variant="danger" className="!text-xs" onClick={handleDeletePlan} disabled={isDeletingPlan}>
                      {isDeletingPlan ? "מוחק..." : "מחיקת התכנון המורכב"}
                    </Button>
                  </div>
                )}
              </>
            )}

            {!boardView && view.type === "editBlock" && (
              <BlockTimeEditorForm
                key={view.blockId ?? "new"}
                actor={actor}
                ridingSlotId={ridingSlotId}
                planVersion={plan.version}
                block={view.blockId ? (plan.blocks.find((b) => b.id === view.blockId) ?? null) : null}
                onSaved={handleBlockTimeSaved}
                onCancel={handleCancelBlockEdit}
              />
            )}

            {!boardView && view.type === "stationList" && activeBlock && (
              <>
                <p className="shrink-0 truncate text-xs text-muted-foreground">
                  תכנון רכיבה מורכבת › {activeBlock.startTime}–{activeBlock.endTime} › תחנות מאמן
                </p>
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <Button variant="ghost" className="!px-2 !py-1 !text-xs" onClick={handleBackToBlockList}>
                    ← חזרה לטווחי השעות
                  </Button>
                  {canEdit ? (
                    <Button
                      variant="secondary"
                      className="!px-2 !py-1 !text-xs"
                      onClick={() => setView({ type: "editStation", blockId: activeBlock.id, stationId: null })}
                      disabled={anyStationActionPending}
                    >
                      + הוספת תחנת מאמן
                    </Button>
                  ) : (
                    activeBlock.stations.length > 0 && (
                      <Button
                        variant="secondary"
                        className="!px-2 !py-1 !text-xs"
                        onClick={() => setShowAllStations((v) => !v)}
                      >
                        {showAllStations ? "הצגת רשימה מקוצרת" : "הצגת כל השיבוץ"}
                      </Button>
                    )
                  )}
                </div>

                {lastStationWarnings && buildStationWarningMessages(lastStationWarnings).length > 0 && (
                  <div className="shrink-0 rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
                    {buildStationWarningMessages(lastStationWarnings).map((m) => (
                      <p key={m}>{m}</p>
                    ))}
                  </div>
                )}
                {stationListError && <p className="shrink-0 text-sm text-danger">{stationListError}</p>}

                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto ps-1">
                  {activeBlock.stations.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-6 text-center">
                      <p className="text-sm text-muted-foreground">עדיין לא הוגדרו תחנות מאמן בטווח זה</p>
                      {canEdit && (
                        <Button
                          onClick={() => setView({ type: "editStation", blockId: activeBlock.id, stationId: null })}
                        >
                          הוספת תחנת מאמן ראשונה
                        </Button>
                      )}
                    </div>
                  ) : !canEdit && showAllStations ? (
                    activeBlock.stations.map((station) => (
                      <StationOverviewCard
                        key={station.id}
                        station={station}
                        candidates={editing.candidates}
                        onOpenDetail={() =>
                          setView({ type: "editStation", blockId: activeBlock.id, stationId: station.id })
                        }
                      />
                    ))
                  ) : (
                    activeBlock.stations.map((station, index) => (
                      <StationCard
                        key={station.id}
                        station={station}
                        index={index}
                        total={activeBlock.stations.length}
                        canEdit={canEdit}
                        pendingDisabled={anyStationActionPending || busyStationId === station.id}
                        onEdit={() => setView({ type: "editStation", blockId: activeBlock.id, stationId: station.id })}
                        onDelete={() => handleDeleteStation(activeBlock.id, station.id)}
                        onMoveUp={() => handleMoveStation(activeBlock.id, station.id, "up")}
                        onMoveDown={() => handleMoveStation(activeBlock.id, station.id, "down")}
                      />
                    ))
                  )}
                </div>
              </>
            )}

            {!boardView && view.type === "editStation" && activeBlock && (
              <StationEditorForm
                key={view.stationId ?? "new"}
                actor={actor}
                ridingSlotId={ridingSlotId}
                planVersion={plan.version}
                blockId={activeBlock.id}
                block={activeBlock}
                earlierBlocks={plan.blocks.filter((b) => b.sortOrder < activeBlock.sortOrder)}
                station={activeStation}
                canEdit={canEdit}
                instructors={instructors}
                candidates={editing.candidates}
                knownHorseNames={editing.knownHorseNames}
                onSaved={handleStationSaved}
                onCancel={handleCancelStationEdit}
              />
            )}
          </>
        )}
      </div>

      <PublishConfirmModal
        open={publishModalOpen}
        isRepublish={publicationStatus?.status === "STALE"}
        warnings={plan ? buildPlanPublishWarnings(plan.blocks) : []}
        isPending={isPublishing}
        error={publishError}
        onConfirm={handleConfirmPublish}
        onClose={closePublishModal}
      />
      <UnpublishConfirmModal
        open={unpublishModalOpen}
        isPending={isUnpublishing}
        error={unpublishError}
        onConfirm={handleConfirmUnpublish}
        onClose={closeUnpublishModal}
      />
      {/* RIDING-COMPLEX-SCHEDULE-BOARD (Stage 2B) - the pair sub-dialog, opened
          only from the schedule board (openInlinePair). Reuses the exact
          PairRowEditor + computeStationClientIssues; Save routes through the one
          full-snapshot saveComplexStation path. */}
      {activePairEdit && (
        <InlinePairDialog
          mode={activePairEdit.pairId === null ? "create" : "edit"}
          draft={activePairEdit.draft}
          candidates={editing?.candidates ?? []}
          knownHorseNames={editing?.knownHorseNames ?? []}
          usedTraineeIds={pairSelectorContext?.usedTraineeIds ?? new Set<string>()}
          earlierAssignedTraineeIds={
            pairSelectorContext?.earlierAssignedTraineeIds ?? { ids: new Set<string>(), hasEarlierBlocks: false }
          }
          stationInstructorName={pairSelectorContext?.stationInstructorName ?? null}
          issues={inlinePairIssues}
          saving={isInlineSaving}
          error={inlineError}
          onChange={(next) => setInlineEdit((prev) => (prev?.kind === "pair" ? { ...prev, draft: next } : prev))}
          onConfirmTrainees={applyInlineTraineeSelection}
          onSave={saveInlinePair}
          onRemove={activePairEdit.pairId === null ? undefined : removeInlinePair}
          onClose={cancelInlineEdit}
          // Move/Swap affordances are EDIT-mode only (a saved pair). In CREATE
          // mode an occupied trainee stays unavailable (disabled) - never
          // auto-saved then moved.
          onOccupiedTraineeSelect={activePairEdit.pairId === null ? undefined : handleOccupiedDropdownSelect}
          onOccupiedListClick={activePairEdit.pairId === null ? undefined : handleOccupiedListClick}
          proposal={moveSwapProposal}
          proposalSubmitting={isApplyingMoveSwap}
          proposalError={moveSwapError}
          onConfirmProposal={confirmMoveSwapProposal}
          onCancelProposal={cancelMoveSwapProposal}
        />
      )}
    </Modal>
  );
}
