"use server";

import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import { getKnownRidingHorseNames } from "@/lib/actions/riding-slots";
// RIDING-PAIRS P4a - reuses the exact same horse/responsible-instructor
// resolution the simple horse list already uses, instead of a separate,
// reduced candidate shape. One-way dependency only (riding-slot-horses.ts
// imports nothing from this file) - see buildHorseCandidates's own comment.
import { buildHorseCandidates, type RidingHorseCandidate } from "@/lib/actions/riding-slot-horses";
// Fix 3, Stage 2 - transaction-scoped template lookup/sanitize (READ side).
// The WRITE side (creating the fresh destination blocks/stations/pairs) stays
// here because it needs the just-created plan id. resolveTemplateForNewPlan
// takes the interactive `tx` and issues NO global-prisma query.
import { resolveTemplateForNewPlan } from "@/lib/actions/riding-complex-template-lookup";

const NOT_FOUND_RIDING_SLOT = 'ניהול הרכיבה לא נמצא. נסי לרענן את העמוד.';
const NOT_FOUND_COMPLEX_PLAN = "תכנון הרכיבה המורכבת לא נמצא. ייתכן שטרם נוצר - נסי לרענן את העמוד.";
const NOT_FOUND_BLOCK = "הבלוק לא נמצא בתכנון רכיבה זה. ייתכן שנמחק - נסי לרענן את העמוד.";
const NOT_FOUND_STATION = "התחנה לא נמצאה בבלוק זה. ייתכן שנמחקה - נסי לרענן את העמוד.";
const NO_PERMISSION = "אין הרשאה לערוך תכנון רכיבה מורכבת";
const SIMPLE_LIST_EXISTS = "לא ניתן ליצור תכנון רכיבה מורכבת - קיימת כבר רשימת סוסים רגילה עבור רכיבה זו";
const INVALID_TIME = "פורמט שעה לא תקין (HH:MM)";
const END_BEFORE_START = "שעת הסיום חייבת להיות אחרי שעת ההתחלה";
const OVERLAP_WARNING = "קיים טווח שעות נוסף שחופף לטווח זה";
const SAME_TRAINEE_TWICE_IN_PAIR = "לא ניתן לבחור את אותו/ה חניכ/ה פעמיים באותו זוג";
const PAIR_MISSING_TRAINEE1 = "יש לבחור חניכ/ה ראשונ/ה לכל זוג שמכיל פרטים (סוס, הערה או חניכ/ה שני/ה)";
const LOCK_TIMEOUT = "המערכת עמוסה כרגע - נסי שוב בעוד רגע";
const DUPLICATE_TRAINEE_IN_BLOCK = "אותו/ה חניכ/ה נבחר/ה יותר מפעם אחת באותו טווח שעות";
const DUPLICATE_HORSE_IN_BLOCK = "אותו שם סוס נבחר יותר מפעם אחת באותו טווח שעות";
const DUPLICATE_INSTRUCTOR_IN_BLOCK = "אותו/ה מדריכ/ה משובצ/ת ליותר מתחנה אחת באותו טווח שעות";
const INVALID_INSTRUCTOR = "אחד או יותר מהמדריכים/ות שנבחרו אינם/ן פעילים/ות או לא נמצאו";
const INVALID_TRAINEE = "אחד או יותר מהחניכים שנבחרו אינם/ן פעילים/ות או לא נמצאו";
const INVALID_BLOCK_ORDER = "רשימת סדר הבלוקים אינה תואמת את הבלוקים הקיימים בתכנון זה";
const INVALID_STATION_ORDER = "רשימת סדר התחנות אינה תואמת את התחנות הקיימות בבלוק זה";
// RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - the single stable, non-PII Hebrew
// copy shown for a lost-update (optimistic-concurrency) conflict: the client's
// expectedVersion no longer matches the live plan.version because a cooperating
// writer (another structural edit, or a Move/Swap) committed first. The user
// must refresh/reopen before saving again - never a silent retry or overwrite.
const STALE_PLAN = "התכנון השתנה מאז שנפתח. יש לרענן ולבדוק מחדש לפני שמירה.";

// ---------- Shared read model ----------

// RIDING-PAIRS P4a - type alias to RidingHorseCandidate (lib/actions/riding-slot-horses.ts),
// which already carries exactly the fields needed here (horseName/
// horseNameDisplay/responsibleInstructorNames on top of the original
// studentId/studentName/groupName/subgroupNumber) - kept as its own named
// alias rather than importing RidingHorseCandidate directly everywhere, so
// every existing downstream reference to RidingSlotComplexTraineeCandidate
// (types, prop names) keeps working unchanged.
export type RidingSlotComplexTraineeCandidate = RidingHorseCandidate;

export interface RidingSlotComplexPairRow {
  id: string;
  trainee1Id: string | null;
  trainee1Name: string | null;
  trainee2Id: string | null;
  trainee2Name: string | null;
  horseName: string | null;
  note: string | null;
  sortOrder: number;
}

// RIDING-PAIRS P5b - one coach/arena station within a block. instructor is
// resolved live (not a snapshot), same convention as trainee1Name/
// trainee2Name on RidingSlotComplexPairRow - null-safe if the Instructor row
// is later deleted (the FK is onDelete: SetNull, so instructorId and this
// resolved object go null together, the station itself is never affected).
export interface RidingSlotComplexStationRow {
  id: string;
  instructorId: string | null;
  instructor: { id: string; fullName: string } | null;
  arena: string | null;
  sortOrder: number;
  pairs: RidingSlotComplexPairRow[];
}

// RIDING-PAIRS P5b - a block is now a pure time range; arena/instructor(s)/
// pairs all moved to RidingSlotComplexStationRow, one level deeper.
export interface RidingSlotComplexBlockRow {
  id: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  stations: RidingSlotComplexStationRow[];
}

export interface RidingSlotComplexPlanRow {
  id: string;
  ridingSlotId: string;
  updatedAt: string;
  updatedByName: string;
  // RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - the live optimistic-concurrency
  // counter (RidingSlotComplexPlan.version), surfaced to the editor so every
  // structural mutation can send it back as expectedVersion. It is the ONLY
  // authoritative source of expectedVersion the client may use - never a
  // module global or a guessed value. A successful mutation returns a fresh
  // plan carrying the incremented version, which becomes the next
  // expectedVersion automatically.
  version: number;
  blocks: RidingSlotComplexBlockRow[];
}

export interface RidingSlotComplexScheduleMeta {
  dateKey: string;
  startTime: string;
  endTime: string;
  activityTitle: string;
}

// RIDING-PAIRS P5b - now describes one STATION's completeness (a station has
// exactly one instructor, not a list - noInstructor is singular, renamed
// from the old block-level noInstructors).
export interface RidingSlotComplexSaveWarnings {
  noInstructor: boolean;
  noArena: boolean;
  zeroPairs: boolean;
  pairsMissingTrainee2: number;
  pairsMissingHorse: number;
}

export interface RidingSlotComplexPlanForEditing {
  ridingSlotId: string;
  plan: RidingSlotComplexPlanRow;
  scheduleMeta: RidingSlotComplexScheduleMeta | null;
  candidates: RidingSlotComplexTraineeCandidate[];
  knownHorseNames: string[];
  hasSimpleHorseList: boolean;
  canEdit: boolean;
}

export interface RidingSlotComplexPlanActionResult extends ActionResult {
  plan?: RidingSlotComplexPlanRow;
  // Station-save warnings only (see RidingSlotComplexSaveWarnings) - never
  // set by a block save, which uses overlapWarning below instead.
  warnings?: RidingSlotComplexSaveWarnings;
  newBlockId?: string;
  // Block-save only - a non-blocking notice that the saved time range
  // overlaps another block already in this plan (see saveComplexBlockInternal).
  // Never an error; the save still succeeds.
  overlapWarning?: string;
  // RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - set true (alongside a generic
  // error) ONLY when the mutation failed the optimistic-concurrency check: the
  // sent expectedVersion no longer matched the live plan.version. A stable,
  // non-PII signal the editor uses to distinguish a lost-update conflict from
  // an ordinary validation/not-found error (list ops reload the authoritative
  // plan; open drafts keep their draft and instruct refresh) - never carries an
  // id, name, or version number. Additive/optional: existing callers that
  // ignore it are unaffected.
  staleConflict?: boolean;
}

interface ComplexPlanActor {
  instructorId: string | null;
  adminEmail: string | null;
  adminName: string | null;
  displayName: string;
}

// Small mechanical helpers only - not a broader refactor. Every
// *AsAdmin/*AsInstructor wrapper below builds the same two actor shapes and
// every *Internal function derives the same write-fields shape from an
// actor; these three helpers just remove that repetition without touching
// any behavior.
function adminActor(admin: { email: string; name: string | null }): ComplexPlanActor {
  return {
    instructorId: null,
    adminEmail: admin.email,
    adminName: admin.name ?? null,
    displayName: admin.name ?? admin.email,
  };
}

function instructorActor(instructor: { id: string; fullName: string }): ComplexPlanActor {
  return { instructorId: instructor.id, adminEmail: null, adminName: null, displayName: instructor.fullName };
}

function actorWriteFields(actor: ComplexPlanActor) {
  return {
    updatedByInstructorId: actor.instructorId,
    updatedByAdminEmail: actor.adminEmail,
    updatedByAdminName: actor.adminName,
    updatedByName: actor.displayName,
  };
}

// Duplicated (not imported) from the private, identically-shaped
// resolveRidingSlotScheduleMeta helper in riding-slot-horse-publications.ts -
// same small-local-helper convention already established there rather than
// exporting it for reuse across features.
async function resolveComplexScheduleMeta(ridingSlotId: string): Promise<RidingSlotComplexScheduleMeta | null> {
  const links = await prisma.ridingSlotScheduleItem.findMany({
    where: { ridingSlotId },
    include: { scheduleItem: true },
  });
  if (links.length === 0) return null;

  const scheduleItems = links
    .map((link) => link.scheduleItem)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const first = scheduleItems[0];
  const last = scheduleItems[scheduleItems.length - 1];

  return {
    dateKey: dateKey(first.date),
    startTime: first.startTime,
    endTime: last.endTime,
    activityTitle: first.title,
  };
}

type PairWithRelations = {
  id: string;
  trainee1Id: string | null;
  trainee2Id: string | null;
  horseName: string | null;
  note: string | null;
  sortOrder: number;
  trainee1: { id: string; fullName: string } | null;
  trainee2: { id: string; fullName: string } | null;
};

type StationWithRelations = {
  id: string;
  instructorId: string | null;
  arena: string | null;
  sortOrder: number;
  instructor: { id: string; fullName: string } | null;
  pairs: PairWithRelations[];
};

type BlockWithRelations = {
  id: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  stations: StationWithRelations[];
};

type PlanWithRelations = {
  id: string;
  ridingSlotId: string;
  updatedAt: Date;
  updatedByName: string;
  version: number;
  blocks: BlockWithRelations[];
};

const COMPLEX_PLAN_INCLUDE = {
  blocks: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      stations: {
        orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
        include: {
          instructor: { select: { id: true, fullName: true } },
          pairs: {
            orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
            include: {
              trainee1: { select: { id: true, fullName: true } },
              trainee2: { select: { id: true, fullName: true } },
            },
          },
        },
      },
    },
  },
};

function toPairRow(p: PairWithRelations): RidingSlotComplexPairRow {
  return {
    id: p.id,
    trainee1Id: p.trainee1Id,
    trainee1Name: p.trainee1?.fullName ?? null,
    trainee2Id: p.trainee2Id,
    trainee2Name: p.trainee2?.fullName ?? null,
    horseName: p.horseName,
    note: p.note,
    sortOrder: p.sortOrder,
  };
}

function toStationRow(s: StationWithRelations): RidingSlotComplexStationRow {
  return {
    id: s.id,
    instructorId: s.instructorId,
    instructor: s.instructor,
    arena: s.arena,
    sortOrder: s.sortOrder,
    pairs: s.pairs.map(toPairRow),
  };
}

function toBlockRow(b: BlockWithRelations): RidingSlotComplexBlockRow {
  return {
    id: b.id,
    startTime: b.startTime,
    endTime: b.endTime,
    sortOrder: b.sortOrder,
    stations: b.stations.map(toStationRow),
  };
}

function toPlanRow(p: PlanWithRelations): RidingSlotComplexPlanRow {
  return {
    id: p.id,
    ridingSlotId: p.ridingSlotId,
    updatedAt: p.updatedAt.toISOString(),
    updatedByName: p.updatedByName,
    version: p.version,
    blocks: p.blocks.map(toBlockRow),
  };
}

// RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - these active-id checks now take
// the interactive `tx` client instead of the global prisma, so every hardened
// writer runs them INSIDE its transaction, AFTER the advisory lock. That both
// closes the small residual race the previous pre-transaction reads carried and
// keeps the contract's "no structural lookup before the lock" invariant. They
// issue no global-prisma query and never escape the caller's advisory lock.
async function validateActiveInstructorIds(tx: Prisma.TransactionClient, instructorIds: string[]): Promise<boolean> {
  if (instructorIds.length === 0) return true;
  const found = await tx.instructor.findMany({ where: { id: { in: instructorIds }, isActive: true } });
  return found.length === instructorIds.length;
}

async function validateActiveTraineeIds(tx: Prisma.TransactionClient, traineeIds: string[]): Promise<boolean> {
  if (traineeIds.length === 0) return true;
  const found = await tx.student.findMany({ where: { id: { in: traineeIds }, isActive: true } });
  return found.length === traineeIds.length;
}

// ---------------------------------------------------------------------------
// RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - shared optimistic-concurrency
// architecture for every structural complex-plan writer.
//
// The problem this closes: each writer used to be an unconditional
// last-write-wins update. A stale legacy save could land on top of - and
// silently overwrite - a concurrent Move/Swap (or another edit) that had
// already advanced the plan. Now every cooperating structural writer runs its
// mutation through withLockedComplexPlan, which:
//
//   1. opens ONE interactive transaction;
//   2. takes pg_advisory_xact_lock(hashtext(ridingSlotId)) as the FIRST in-tx
//      statement - the exact same transaction-scoped key convention as
//      createComplexPlanInternal / saveRidingSlotHorseListInternal / the Stage
//      3B Move/Swap action, so all of them serialize per slot;
//   3. re-reads the plan by exact ridingSlotId AFTER the lock (never a
//      pre-lock lookup) and resolves its authoritative id + version;
//   4. maps a missing plan to the existing not-found contract;
//   5. maps expectedVersion !== live version to the stable STALE_PLAN copy
//      (staleConflict: true) BEFORE any mutation - no write, no version bump;
//   6. runs the writer's own target-ownership + validation + child writes
//      (the `body`), all via `tx`, entirely under the lock;
//   7. claims the version with ONE conditional updateMany guarded by the
//      just-read version (increment + actor metadata). Because everything is
//      one transaction, a zero-row claim throws StalePlanRollback and rolls
//      back the body's child writes too - fail-closed, never a partial write
//      or a silent overwrite. Under the per-slot lock a cooperating writer
//      cannot commit between the step-5 read and this claim, so the claim is
//      the belt-and-suspenders guard the contract mandates rather than the
//      sole check.
//
// This is the same lock/read/validate/write/conditional-increment shape the
// committed Move/Swap action uses (writes precede the guarded increment; a
// zero-row match throws to roll everything back), factored into one helper so
// the seven writers share it instead of duplicating the raw SQL and stale
// logic. It is module-private: no client-callable bypass, no Prisma internals
// exported to the UI.
// ---------------------------------------------------------------------------

// Thrown from inside a writer's body/claim to force a full transaction rollback
// when a version claim (or a compound-where child write) unexpectedly matches
// zero rows - a concurrent, committed change moved the target. Caught by
// withLockedComplexPlan and mapped to the stable STALE_PLAN outcome, so no
// partial write ever commits.
class StalePlanRollback extends Error {
  constructor() {
    super("STALE_PLAN");
    this.name = "StalePlanRollback";
  }
}

// A writer body's result: `ok:false` carries a ready-to-return generic Hebrew
// error (and, for a lost update discovered inside the body, stale:true) and
// guarantees NO child write has been persisted yet, so the transaction may
// safely commit the (no-op) read work. `ok:true` carries the writer-specific
// success payload; withLockedComplexPlan then performs the single conditional
// version claim before committing.
type ComplexPlanMutationBody<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; stale?: boolean };

// The outcome the caller maps to a RidingSlotComplexPlanActionResult.
type ComplexPlanMutationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; staleConflict: boolean };

// Duck-typed Prisma error code check (P2028 lock timeout), identical convention
// to createComplexPlanInternal below and lib/actions/weekly-feedback.ts.
function prismaErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return null;
}

async function withLockedComplexPlan<T>(
  ridingSlotId: string,
  expectedVersion: number,
  actorData: ReturnType<typeof actorWriteFields>,
  body: (tx: Prisma.TransactionClient, planId: string) => Promise<ComplexPlanMutationBody<T>>
): Promise<ComplexPlanMutationOutcome<T>> {
  try {
    return await prisma.$transaction(async (tx) => {
      // (1) Advisory lock FIRST - transaction-scoped, auto-released at
      // commit/rollback, safe under pgbouncer transaction-mode pooling. No
      // global-prisma call is made anywhere inside this callback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ridingSlotId}))`;

      // (2) Re-read the plan by exact ridingSlotId AFTER the lock. Only the
      // id + version are needed here; the writer body re-reads its own targets.
      const plan = await tx.ridingSlotComplexPlan.findUnique({
        where: { ridingSlotId },
        select: { id: true, version: true },
      });
      if (!plan) {
        return { ok: false as const, error: NOT_FOUND_COMPLEX_PLAN, staleConflict: false };
      }

      // (3) In-transaction current-version check. A mismatch is a lost update:
      // fail closed with the stable STALE_PLAN copy BEFORE any mutation.
      if (plan.version !== expectedVersion) {
        return { ok: false as const, error: STALE_PLAN, staleConflict: true };
      }

      // (4) The writer's own target-ownership + validation + child writes,
      // all under the lock, all via `tx`. A false result means no write yet.
      const result = await body(tx, plan.id);
      if (!result.ok) {
        return { ok: false as const, error: result.error, staleConflict: result.stale ?? false };
      }

      // (5) Exactly one conditional version claim, guarded by the just-read
      // version, folded into the same actor-metadata update every writer
      // already performed. A zero-row match (a cooperating writer committed a
      // bump despite the lock - not reachable in practice, required by the
      // contract) throws to roll back the body's writes too.
      const bumped = await tx.ridingSlotComplexPlan.updateMany({
        where: { id: plan.id, version: expectedVersion },
        data: { ...actorData, version: { increment: 1 } },
      });
      if (bumped.count === 0) {
        throw new StalePlanRollback();
      }

      return { ok: true as const, value: result.value };
    });
  } catch (err) {
    if (err instanceof StalePlanRollback) {
      return { ok: false, error: STALE_PLAN, staleConflict: true };
    }
    if (prismaErrorCode(err) === "P2028") {
      return { ok: false, error: LOCK_TIMEOUT, staleConflict: false };
    }
    throw err;
  }
}

function timeToMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Builds the full editing shape for an EXISTING complex plan only - callers
// (get/create/save/delete/duplicate/reorder) all re-derive this after their
// own mutation so the caller always gets a fresh, complete snapshot rather
// than a partially-updated local copy. candidates reuse buildHorseCandidates
// (lib/actions/riding-slot-horses.ts) directly - the exact same group/
// subgroup/assignment roster derivation AND horse/responsible-instructor
// resolution the simple horse list already relies on, rather than
// maintaining a second, independently-drifting copy of that logic, per the
// approved "do not default to every active trainee" candidate-scope rule.
async function buildComplexPlanForEditing(
  ridingSlotId: string,
  opts: { canEdit: boolean }
): Promise<RidingSlotComplexPlanForEditing | null> {
  const plan = await prisma.ridingSlotComplexPlan.findUnique({
    where: { ridingSlotId },
    include: COMPLEX_PLAN_INCLUDE,
  });
  if (!plan) return null;

  const [scheduleMeta, candidates, knownHorseNames, simpleList] = await Promise.all([
    resolveComplexScheduleMeta(ridingSlotId),
    buildHorseCandidates(ridingSlotId),
    getKnownRidingHorseNames(),
    prisma.ridingSlotHorseList.findUnique({ where: { ridingSlotId }, select: { id: true } }),
  ]);

  return {
    ridingSlotId,
    plan: toPlanRow(plan),
    scheduleMeta,
    candidates,
    knownHorseNames,
    hasSimpleHorseList: Boolean(simpleList),
    canEdit: opts.canEdit,
  };
}

// ---------- Get (read-only, no mutation) ----------

// Returns null both when the RidingSlot doesn't exist AND when it exists but
// has no RidingSlotComplexPlan yet (mode not chosen) - same "collapse
// distinguishable-but-both-empty cases into one null return" convention
// already used by getRidingSlotHorseListForInstructor elsewhere in this
// app, since this function's return type has no separate error channel.
export async function getRidingSlotComplexPlanForAdmin(
  ridingSlotId: string
): Promise<RidingSlotComplexPlanForEditing | null> {
  await requireAdmin();
  return buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
}

// instructorId is checked for existence/isActive only - NOT
// canEditRidingNotes. Viewing has no permission-level gate, matching
// getRidingSlotHorseListForInstructor's identical read convention; canEdit
// is exposed to the caller so a read-only instructor's UI can hide edit
// controls without a second permission check.
export async function getRidingSlotComplexPlanForInstructor(
  instructorId: string,
  ridingSlotId: string
): Promise<RidingSlotComplexPlanForEditing | null> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return null;
  return buildComplexPlanForEditing(ridingSlotId, { canEdit: instructor.canEditRidingNotes });
}

// ---------- Create plan (mutual-exclusivity gate) ----------
// UNCHANGED from P2/P3a - not touched by the P5 station redesign.

// Shared core of createRidingSlotComplexPlanAsAdmin/AsInstructor. The
// simple-list-exists check and the plan insert happen inside ONE
// transaction, using the same discriminated-transaction-result convention
// (txResult.ok) already used by publishRidingHorseListToInstructorsInternal
// in riding-slot-horse-publications.ts, rather than throwing. This
// transaction and saveRidingSlotHorseListInternal's matching guard
// (lib/actions/riding-slot-horses.ts) take the same Postgres advisory
// transaction lock, keyed by ridingSlotId, as their very first statement -
// see the inline comment below for why a pre-transaction read alone cannot
// close the two-tab race, and why the *_xact_* (transaction-scoped, not
// session-scoped) lock variant is required under Supabase's pgbouncer
// transaction-mode pooling.
async function createComplexPlanInternal(ridingSlotId: string, actor: ComplexPlanActor): Promise<ActionResult> {
  const ridingSlot = await prisma.ridingSlot.findUnique({ where: { id: ridingSlotId } });
  if (!ridingSlot) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  const actorData = actorWriteFields(actor);

  // Fix 3, Stage 2 - the destination candidate roster is derived through
  // buildHorseCandidates, which uses the GLOBAL prisma client
  // (getRidingSlotStudentNotes + assignments), so it MUST be read here, before
  // the transaction opens - never from inside the tx callback, where a
  // global-prisma query would escape the advisory lock. We keep only the
  // candidate student ids; they are re-validated against ACTIVE Student rows
  // INSIDE the transaction below. A failure of this read is deliberately NOT
  // caught or mapped: it propagates through the same generic failure path as
  // any other unexpected DB error (only a real P2028 lock timeout is mapped to
  // LOCK_TIMEOUT, below), and since the transaction has not opened, no plan is
  // created. The roster is never broadened to all active students.
  const candidateStudentIds = Array.from(
    new Set((await buildHorseCandidates(ridingSlotId)).map((candidate) => candidate.studentId))
  );

  // Waiting on the advisory lock below counts against this transaction's
  // normal interactive-transaction timeout (Prisma default 5000ms) - it is
  // in-body wait time, not connection-acquisition wait time. No custom
  // timeout is added: this transaction's own work is a handful of point
  // reads/writes - the only thing that could make it run long is lock
  // contention, and extending the timeout would just make a genuinely stuck
  // caller wait longer for no benefit. If two callers contend for the same
  // ridingSlotId for more than 5s, Prisma aborts the losing transaction with
  // a P2028 timeout error - caught below and mapped to a clear Hebrew
  // message, same duck-typed error-code check already used for P2002 in
  // lib/actions/weekly-feedback.ts, so no raw Prisma error ever reaches the
  // client.
  let txResult: { ok: boolean };
  try {
    txResult = await prisma.$transaction(async (tx) => {
      // Read Committed (Postgres/Prisma's default) lets two concurrent
      // transactions each read "no simple list yet" before either commits -
      // a plain pre-transaction read cannot prevent that. This advisory lock
      // is not a schema object (no migration needed) and is
      // transaction-scoped (auto-released at commit/rollback), so it is safe
      // to take under a pooled connection and fully serializes any
      // concurrent create-plan / create-simple-list attempt for this exact
      // ridingSlotId - the second caller simply waits for the first's
      // transaction to finish, then re-checks with up-to-date data.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ridingSlotId}))`;

      const existingPlan = await tx.ridingSlotComplexPlan.findUnique({ where: { ridingSlotId } });
      // Idempotent: a genuinely-existing plan is never recopied. A second
      // concurrent caller waits on the advisory lock, then lands here and
      // returns without performing ANY template copy.
      if (existingPlan) return { ok: true as const }; // the caller re-reads below regardless

      const simpleList = await tx.ridingSlotHorseList.findUnique({
        where: { ridingSlotId },
        select: { id: true },
      });
      if (simpleList) {
        return { ok: false as const };
      }

      // Genuine-create branch (the ONLY branch that copies a template). Create
      // the fresh EMPTY plan first and capture its id; version stays at its
      // schema default (1) and is never bumped during initial creation.
      const createdPlan = await tx.ridingSlotComplexPlan.create({ data: { ridingSlotId, ...actorData } });

      // Re-validate the pre-read candidate ids against ACTIVE Student rows
      // inside the transaction. Small race boundary: buildHorseCandidates was
      // read before the tx, so a student could have gone inactive in the gap -
      // this in-tx active recheck contains it (only ids still active right now
      // form the roster). Never falls back to all active students.
      const rosterTraineeIds =
        candidateStudentIds.length > 0
          ? new Set(
              (
                await tx.student.findMany({
                  where: { id: { in: candidateStudentIds }, isActive: true },
                  select: { id: true },
                })
              ).map((student) => student.id)
            )
          : new Set<string>();

      // Optional template: sanitized create tree of a previous same-group
      // earlier plan, or null when none applies (ineligible anchor, no eligible
      // source, or a source that vanished/emptied). copyPlanForTemplate (inside
      // this helper) is the only payload sanitizer; the helper issues no
      // global-prisma query and never mutates a source row.
      const template = await resolveTemplateForNewPlan(tx, {
        destinationRidingSlotId: ridingSlotId,
        destinationRosterTraineeIds: rosterTraineeIds,
      });

      if (template) {
        // Explicitly create fresh blocks -> stations -> pairs under the new
        // plan id: fresh ids (DB), fresh parent FKs (from the just-created
        // rows), fresh sequential sortOrder (from the pure core). Any child
        // write error throws and rolls back this whole transaction - including
        // the plan create above - so the result is all-or-nothing, never a
        // partial or silently-emptied plan. No publication row is created.
        for (const block of template.blocks) {
          const createdBlock = await tx.ridingSlotComplexBlock.create({
            data: {
              planId: createdPlan.id,
              startTime: block.startTime,
              endTime: block.endTime,
              sortOrder: block.sortOrder,
            },
          });
          for (const station of block.stations) {
            const createdStation = await tx.ridingSlotComplexStation.create({
              data: {
                blockId: createdBlock.id,
                instructorId: station.instructorId,
                arena: station.arena,
                sortOrder: station.sortOrder,
              },
            });
            if (station.pairs.length > 0) {
              await tx.ridingSlotComplexPair.createMany({
                data: station.pairs.map((pair) => ({
                  stationId: createdStation.id,
                  trainee1Id: pair.trainee1Id,
                  trainee2Id: pair.trainee2Id,
                  horseName: pair.horseName,
                  note: pair.note,
                  sortOrder: pair.sortOrder,
                })),
              });
            }
          }
        }
      }

      return { ok: true as const };
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2028") {
      return { success: false, error: LOCK_TIMEOUT };
    }
    throw err;
  }

  if (!txResult.ok) {
    return { success: false, error: SIMPLE_LIST_EXISTS };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");
  return { success: true };
}

export async function createRidingSlotComplexPlanAsAdmin(
  ridingSlotId: string
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  const result = await createComplexPlanInternal(ridingSlotId, adminActor(admin));
  if (!result.success) return result;
  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

// Instructors have no NextAuth session in this app, so isActive/
// canEditRidingNotes are re-read from the DB on every call - never trusted
// from the client. Reuses the exact flag that already gates
// saveRidingSlotHorseListAsInstructor - no new permission introduced.
export async function createRidingSlotComplexPlanAsInstructor(
  instructorId: string,
  ridingSlotId: string
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  const result = await createComplexPlanInternal(ridingSlotId, instructorActor(instructor));
  if (!result.success) return result;
  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

// ---------- Save block (time range only) ----------

const blockSaveInputSchema = z.object({
  ridingSlotId: z.string().min(1),
  // RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - REQUIRED optimistic-concurrency
  // guard. Must be the integer plan.version of the exact loaded snapshot the
  // client edited; never optional, never defaulted server-side.
  expectedVersion: z.number().int(),
  blockId: z.string().trim().optional(),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/, INVALID_TIME),
  endTime: z.string().regex(/^\d{1,2}:\d{2}$/, INVALID_TIME),
});

export type RidingSlotComplexBlockSaveInput = z.infer<typeof blockSaveInputSchema>;

// RIDING-PAIRS P5b - a block save now only ever writes startTime/endTime.
// arena/instructor(s)/pairs moved to saveComplexStationInternal below.
// Overlap against every OTHER block in the plan is computed and returned as
// a non-blocking warning (never rejects the save) - see this file's
// OVERLAP_WARNING constant and the approved [start, end) interval-overlap
// rule. All read-only validation runs before the transaction; only the
// actual writes run inside it, kept short and DB-only, same pattern as
// every other save in this file.
async function saveComplexBlockInternal(
  input: RidingSlotComplexBlockSaveInput,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const parsed = blockSaveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const data = parsed.data;

  // Pure (DB-free) validation stays before the transaction - it dereferences
  // only the submitted input, never a structural target.
  if (timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) {
    return { success: false, error: END_BEFORE_START };
  }

  const actorData = actorWriteFields(actor);
  const newStart = timeToMinutes(data.startTime);
  const newEnd = timeToMinutes(data.endTime);

  // Everything structural (block ownership, overlap read, the write) now runs
  // inside the lock via withLockedComplexPlan, AFTER the version check.
  const outcome = await withLockedComplexPlan(
    data.ridingSlotId,
    data.expectedVersion,
    actorData,
    async (tx, planId) => {
      if (data.blockId) {
        const existingBlock = await tx.ridingSlotComplexBlock.findUnique({ where: { id: data.blockId } });
        if (!existingBlock || existingBlock.planId !== planId) {
          return { ok: false as const, error: NOT_FOUND_BLOCK };
        }
      }

      // Overlap check against every OTHER block already in this plan - a
      // warning only, never blocks the save (overlapping time blocks may be a
      // deliberate split or an in-progress draft). Excludes the block being
      // edited against itself.
      const otherBlocks = await tx.ridingSlotComplexBlock.findMany({
        where: { planId, ...(data.blockId ? { id: { not: data.blockId } } : {}) },
        select: { startTime: true, endTime: true },
      });
      const hasOverlap = otherBlocks.some(
        (b) => newStart < timeToMinutes(b.endTime) && newEnd > timeToMinutes(b.startTime)
      );

      // updateMany with a compound (id + planId) where re-enforces ownership
      // inside the transaction. Under the advisory lock a zero-row match means
      // the block vanished concurrently - fail closed via rollback.
      let createdBlockId: string | null = null;
      if (data.blockId) {
        const updated = await tx.ridingSlotComplexBlock.updateMany({
          where: { id: data.blockId, planId },
          data: { startTime: data.startTime, endTime: data.endTime },
        });
        if (updated.count === 0) {
          throw new StalePlanRollback();
        }
      } else {
        const maxSort = await tx.ridingSlotComplexBlock.aggregate({
          where: { planId },
          _max: { sortOrder: true },
        });
        const created = await tx.ridingSlotComplexBlock.create({
          data: {
            planId,
            startTime: data.startTime,
            endTime: data.endTime,
            sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
          },
        });
        createdBlockId = created.id;
      }

      return { ok: true as const, value: { createdBlockId, hasOverlap } };
    }
  );

  if (!outcome.ok) {
    return { success: false, error: outcome.error, staleConflict: outcome.staleConflict || undefined };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(data.ridingSlotId, { canEdit: true });
  return {
    success: true,
    plan: editing?.plan,
    overlapWarning: outcome.value.hasOverlap ? OVERLAP_WARNING : undefined,
    newBlockId: outcome.value.createdBlockId ?? undefined,
  };
}

export async function saveRidingSlotComplexBlockAsAdmin(
  input: RidingSlotComplexBlockSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return saveComplexBlockInternal(input, adminActor(admin));
}

export async function saveRidingSlotComplexBlockAsInstructor(
  instructorId: string,
  input: RidingSlotComplexBlockSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return saveComplexBlockInternal(input, instructorActor(instructor));
}

// ---------- Save station (create or update, full-replace only this station's pairs) ----------

const stationPairInputSchema = z.object({
  trainee1Id: z.string().trim(),
  trainee2Id: z.string().trim().nullish(),
  horseName: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
});

const stationSaveInputSchema = z.object({
  ridingSlotId: z.string().min(1),
  // RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - REQUIRED optimistic-concurrency
  // guard (see blockSaveInputSchema's identical field).
  expectedVersion: z.number().int(),
  blockId: z.string().min(1),
  stationId: z.string().trim().optional(),
  instructorId: z.string().trim().nullish(),
  arena: z.string().trim().nullish(),
  pairs: z.array(stationPairInputSchema).optional().default([]),
});

export type RidingSlotComplexPairInput = z.infer<typeof stationPairInputSchema>;
export type RidingSlotComplexStationSaveInput = z.infer<typeof stationSaveInputSchema>;

// Shared core of saveRidingSlotComplexStationAsAdmin/AsInstructor. Pure,
// DB-free validation (pair normalization, within-submission duplicate and
// same-trainee checks) runs BEFORE the transaction. Every structural read
// (plan/block/station ownership, active instructor/trainee checks, block-wide
// cross-station duplicate checks) and every write now runs INSIDE the
// transaction, after the advisory lock and version check, via
// withLockedComplexPlan. Moving the cross-station/active reads under the lock
// also closes the small residual race the previous pre-transaction reads
// carried (a concurrent save to a different station in the same block).
// Ownership (station belongs to this exact block) is still additionally
// re-enforced via the compound updateMany where-clause below.
async function saveComplexStationInternal(
  input: RidingSlotComplexStationSaveInput,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const parsed = stationSaveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const data = parsed.data;

  const instructorId = data.instructorId || null;
  const arena = data.arena || null;

  // Draft-friendly normalization - identical rule set to the original P2
  // block-level save: a completely blank pair placeholder is silently
  // dropped; a pair with meaningful data (trainee2/horse/note) but no
  // trainee1Id is malformed and rejects the whole save. Pure (no DB), so it
  // stays before the transaction.
  const normalizedRaw = data.pairs.map((p) => ({
    trainee1Id: p.trainee1Id || null,
    trainee2Id: p.trainee2Id || null,
    horseName: p.horseName || null,
    note: p.note || null,
  }));

  const hasMalformedPair = normalizedRaw.some(
    (p) => p.trainee1Id === null && (p.trainee2Id !== null || p.horseName !== null || p.note !== null)
  );
  if (hasMalformedPair) {
    return { success: false, error: PAIR_MISSING_TRAINEE1 };
  }

  const normalizedPairs = normalizedRaw.filter(
    (p): p is { trainee1Id: string; trainee2Id: string | null; horseName: string | null; note: string | null } =>
      p.trainee1Id !== null
  );

  for (const pair of normalizedPairs) {
    if (pair.trainee2Id && pair.trainee2Id === pair.trainee1Id) {
      return { success: false, error: SAME_TRAINEE_TWICE_IN_PAIR };
    }
  }

  // Within-submission duplicate checks, scoped to this station's own
  // submitted pairs - the cross-station, block-wide checks happen
  // separately (inside the transaction), against every OTHER already-persisted
  // station. Pure (no DB), so they stay before the transaction.
  const traineeOccurrences = new Map<string, number>();
  for (const pair of normalizedPairs) {
    traineeOccurrences.set(pair.trainee1Id, (traineeOccurrences.get(pair.trainee1Id) ?? 0) + 1);
    if (pair.trainee2Id) {
      traineeOccurrences.set(pair.trainee2Id, (traineeOccurrences.get(pair.trainee2Id) ?? 0) + 1);
    }
  }
  if (Array.from(traineeOccurrences.values()).some((count) => count > 1)) {
    return { success: false, error: DUPLICATE_TRAINEE_IN_BLOCK };
  }

  const horseOccurrences = new Map<string, number>();
  for (const pair of normalizedPairs) {
    if (!pair.horseName) continue;
    const key = pair.horseName.toLowerCase();
    horseOccurrences.set(key, (horseOccurrences.get(key) ?? 0) + 1);
  }
  if (Array.from(horseOccurrences.values()).some((count) => count > 1)) {
    return { success: false, error: DUPLICATE_HORSE_IN_BLOCK };
  }

  const allTraineeIds = Array.from(traineeOccurrences.keys());
  const actorData = actorWriteFields(actor);

  const outcome = await withLockedComplexPlan(
    data.ridingSlotId,
    data.expectedVersion,
    actorData,
    async (tx, planId) => {
      const block = await tx.ridingSlotComplexBlock.findUnique({ where: { id: data.blockId } });
      if (!block || block.planId !== planId) {
        return { ok: false as const, error: NOT_FOUND_BLOCK };
      }

      if (data.stationId) {
        const existingStation = await tx.ridingSlotComplexStation.findUnique({ where: { id: data.stationId } });
        if (!existingStation || existingStation.blockId !== block.id) {
          return { ok: false as const, error: NOT_FOUND_STATION };
        }
      }

      if (instructorId && !(await validateActiveInstructorIds(tx, [instructorId]))) {
        return { ok: false as const, error: INVALID_INSTRUCTOR };
      }

      if (!(await validateActiveTraineeIds(tx, allTraineeIds))) {
        return { ok: false as const, error: INVALID_TRAINEE };
      }

      // Block-wide cross-station validation: every OTHER station already
      // persisted in this block (excluding the one being saved, if editing an
      // existing one), checked against the submitted replacement data.
      const otherStations = await tx.ridingSlotComplexStation.findMany({
        where: {
          blockId: block.id,
          ...(data.stationId ? { id: { not: data.stationId } } : {}),
        },
        select: {
          instructorId: true,
          pairs: { select: { trainee1Id: true, trainee2Id: true, horseName: true } },
        },
      });

      if (instructorId && otherStations.some((s) => s.instructorId === instructorId)) {
        return { ok: false as const, error: DUPLICATE_INSTRUCTOR_IN_BLOCK };
      }

      const otherTraineeIds = new Set<string>();
      const otherHorseKeys = new Set<string>();
      for (const station of otherStations) {
        for (const pair of station.pairs) {
          if (pair.trainee1Id) otherTraineeIds.add(pair.trainee1Id);
          if (pair.trainee2Id) otherTraineeIds.add(pair.trainee2Id);
          if (pair.horseName) otherHorseKeys.add(pair.horseName.trim().toLowerCase());
        }
      }
      if (allTraineeIds.some((id) => otherTraineeIds.has(id))) {
        return { ok: false as const, error: DUPLICATE_TRAINEE_IN_BLOCK };
      }
      if (Array.from(horseOccurrences.keys()).some((key) => otherHorseKeys.has(key))) {
        return { ok: false as const, error: DUPLICATE_HORSE_IN_BLOCK };
      }

      let stationId = data.stationId;
      if (stationId) {
        const updated = await tx.ridingSlotComplexStation.updateMany({
          where: { id: stationId, blockId: block.id },
          data: { instructorId, arena },
        });
        if (updated.count === 0) {
          throw new StalePlanRollback();
        }
      } else {
        const maxSort = await tx.ridingSlotComplexStation.aggregate({
          where: { blockId: block.id },
          _max: { sortOrder: true },
        });
        const created = await tx.ridingSlotComplexStation.create({
          data: {
            blockId: block.id,
            instructorId,
            arena,
            sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
          },
        });
        stationId = created.id;
      }

      // Array order is the canonical pair sortOrder - client-submitted pair
      // ids are deliberately not part of the input shape at all (full-replace
      // semantics make them unnecessary, same convention as
      // RidingSlotHorseListItem's identical delete+recreate save).
      await tx.ridingSlotComplexPair.deleteMany({ where: { stationId } });
      if (normalizedPairs.length > 0) {
        await tx.ridingSlotComplexPair.createMany({
          data: normalizedPairs.map((p, index) => ({
            stationId: stationId!,
            trainee1Id: p.trainee1Id,
            trainee2Id: p.trainee2Id,
            horseName: p.horseName,
            note: p.note,
            sortOrder: index,
          })),
        });
      }

      return { ok: true as const, value: null };
    }
  );

  if (!outcome.ok) {
    return { success: false, error: outcome.error, staleConflict: outcome.staleConflict || undefined };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const warnings: RidingSlotComplexSaveWarnings = {
    noInstructor: !instructorId,
    noArena: !arena,
    zeroPairs: normalizedPairs.length === 0,
    pairsMissingTrainee2: normalizedPairs.filter((p) => !p.trainee2Id).length,
    pairsMissingHorse: normalizedPairs.filter((p) => !p.horseName).length,
  };

  const editing = await buildComplexPlanForEditing(data.ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan, warnings };
}

export async function saveRidingSlotComplexStationAsAdmin(
  input: RidingSlotComplexStationSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return saveComplexStationInternal(input, adminActor(admin));
}

export async function saveRidingSlotComplexStationAsInstructor(
  instructorId: string,
  input: RidingSlotComplexStationSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return saveComplexStationInternal(input, instructorActor(instructor));
}

// ---------- Delete station ----------

async function deleteComplexStationInternal(
  ridingSlotId: string,
  blockId: string,
  stationId: string,
  expectedVersion: number,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const actorData = actorWriteFields(actor);

  const outcome = await withLockedComplexPlan(ridingSlotId, expectedVersion, actorData, async (tx, planId) => {
    const block = await tx.ridingSlotComplexBlock.findUnique({ where: { id: blockId } });
    if (!block || block.planId !== planId) {
      return { ok: false as const, error: NOT_FOUND_BLOCK };
    }

    const station = await tx.ridingSlotComplexStation.findUnique({ where: { id: stationId } });
    if (!station || station.blockId !== block.id) {
      return { ok: false as const, error: NOT_FOUND_STATION };
    }

    // deleteMany with a compound (id + blockId) where re-enforces ownership
    // under the lock. Cascade (schema onDelete: Cascade) removes this station's
    // pairs - never the parent block. A zero-row match means the station
    // vanished concurrently - fail closed via rollback.
    const deleted = await tx.ridingSlotComplexStation.deleteMany({ where: { id: stationId, blockId: block.id } });
    if (deleted.count === 0) {
      throw new StalePlanRollback();
    }
    return { ok: true as const, value: null };
  });

  if (!outcome.ok) {
    return { success: false, error: outcome.error, staleConflict: outcome.staleConflict || undefined };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

export async function deleteRidingSlotComplexStationAsAdmin(
  ridingSlotId: string,
  blockId: string,
  stationId: string,
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return deleteComplexStationInternal(ridingSlotId, blockId, stationId, expectedVersion, adminActor(admin));
}

export async function deleteRidingSlotComplexStationAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  blockId: string,
  stationId: string,
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return deleteComplexStationInternal(ridingSlotId, blockId, stationId, expectedVersion, instructorActor(instructor));
}

// ---------- Reorder stations (within one block) ----------

async function reorderComplexStationsInternal(
  ridingSlotId: string,
  blockId: string,
  orderedStationIds: string[],
  expectedVersion: number,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const actorData = actorWriteFields(actor);

  const outcome = await withLockedComplexPlan(ridingSlotId, expectedVersion, actorData, async (tx, planId) => {
    const block = await tx.ridingSlotComplexBlock.findUnique({ where: { id: blockId } });
    if (!block || block.planId !== planId) {
      return { ok: false as const, error: NOT_FOUND_BLOCK };
    }

    const existingStations = await tx.ridingSlotComplexStation.findMany({
      where: { blockId: block.id },
      select: { id: true },
    });
    const existingIds = new Set(existingStations.map((s) => s.id));
    const submittedIds = new Set(orderedStationIds);

    if (
      orderedStationIds.length !== existingStations.length ||
      submittedIds.size !== orderedStationIds.length ||
      orderedStationIds.some((id) => !existingIds.has(id))
    ) {
      return { ok: false as const, error: INVALID_STATION_ORDER };
    }

    for (const [index, id] of orderedStationIds.entries()) {
      const updated = await tx.ridingSlotComplexStation.updateMany({
        where: { id, blockId: block.id },
        data: { sortOrder: index },
      });
      if (updated.count === 0) {
        throw new StalePlanRollback();
      }
    }
    return { ok: true as const, value: null };
  });

  if (!outcome.ok) {
    return { success: false, error: outcome.error, staleConflict: outcome.staleConflict || undefined };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

export async function reorderRidingSlotComplexStationsAsAdmin(
  ridingSlotId: string,
  blockId: string,
  orderedStationIds: string[],
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return reorderComplexStationsInternal(ridingSlotId, blockId, orderedStationIds, expectedVersion, adminActor(admin));
}

export async function reorderRidingSlotComplexStationsAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  blockId: string,
  orderedStationIds: string[],
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return reorderComplexStationsInternal(
    ridingSlotId,
    blockId,
    orderedStationIds,
    expectedVersion,
    instructorActor(instructor)
  );
}

// ---------- Delete block ----------
// UNCHANGED from P2 - a block delete never referenced arena/instructors/
// pairs directly, so nothing here needed to change; the schema's own
// cascade (block -> stations -> pairs) now runs one level deeper than
// before, entirely transparently to this code.

async function deleteComplexBlockInternal(
  ridingSlotId: string,
  blockId: string,
  expectedVersion: number,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const actorData = actorWriteFields(actor);

  const outcome = await withLockedComplexPlan(ridingSlotId, expectedVersion, actorData, async (tx, planId) => {
    const block = await tx.ridingSlotComplexBlock.findUnique({ where: { id: blockId } });
    if (!block || block.planId !== planId) {
      return { ok: false as const, error: NOT_FOUND_BLOCK };
    }

    // deleteMany with a compound (id + planId) where re-enforces ownership
    // under the lock. Cascades (schema onDelete: Cascade) remove this block's
    // stations, which cascade further to their pairs - never the parent plan.
    // A zero-row match means the block vanished concurrently - fail closed.
    const deleted = await tx.ridingSlotComplexBlock.deleteMany({ where: { id: blockId, planId } });
    if (deleted.count === 0) {
      throw new StalePlanRollback();
    }
    return { ok: true as const, value: null };
  });

  if (!outcome.ok) {
    return { success: false, error: outcome.error, staleConflict: outcome.staleConflict || undefined };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

export async function deleteRidingSlotComplexBlockAsAdmin(
  ridingSlotId: string,
  blockId: string,
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return deleteComplexBlockInternal(ridingSlotId, blockId, expectedVersion, adminActor(admin));
}

export async function deleteRidingSlotComplexBlockAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  blockId: string,
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return deleteComplexBlockInternal(ridingSlotId, blockId, expectedVersion, instructorActor(instructor));
}

// ---------- Duplicate block ----------

// RIDING-PAIRS P5b - now copies startTime/endTime plus every station's
// instructorId+arena (and station ordering) - never any pair, per the
// approved product decision. Cannot violate simple/complex mutual
// exclusivity: it only ever creates a new RidingSlotComplexBlock (and its
// station copies) inside an ALREADY-EXISTING plan, never a new
// RidingSlotComplexPlan row.
async function duplicateComplexBlockInternal(
  ridingSlotId: string,
  blockId: string,
  expectedVersion: number,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const actorData = actorWriteFields(actor);

  // The source block (and its stations) is read INSIDE the transaction, under
  // the advisory lock, AFTER the version check - never a pre-lock lookup - so
  // the copy always reflects the latest committed state.
  const outcome = await withLockedComplexPlan(ridingSlotId, expectedVersion, actorData, async (tx, planId) => {
    const sourceBlock = await tx.ridingSlotComplexBlock.findUnique({
      where: { id: blockId },
      include: { stations: { orderBy: { sortOrder: "asc" } } },
    });
    if (!sourceBlock || sourceBlock.planId !== planId) {
      return { ok: false as const, error: NOT_FOUND_BLOCK };
    }

    const maxSort = await tx.ridingSlotComplexBlock.aggregate({
      where: { planId },
      _max: { sortOrder: true },
    });
    const created = await tx.ridingSlotComplexBlock.create({
      data: {
        planId,
        startTime: sourceBlock.startTime,
        endTime: sourceBlock.endTime,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    if (sourceBlock.stations.length > 0) {
      // A copied instructorId may have gone inactive (or, defensively, no
      // longer exist) since the source station was saved. Rather than
      // failing the whole duplication over one now-inactive coach, that one
      // station's copy is created with instructorId null - every other
      // station in the source block still copies normally. This is the
      // approved rule: "create the duplicated station with instructorId
      // null rather than fail the entire duplication."
      const sourceInstructorIds = sourceBlock.stations
        .map((s) => s.instructorId)
        .filter((id): id is string => id !== null);
      const activeInstructorIds =
        sourceInstructorIds.length > 0
          ? new Set(
              (
                await tx.instructor.findMany({
                  where: { id: { in: sourceInstructorIds }, isActive: true },
                  select: { id: true },
                })
              ).map((i) => i.id)
            )
          : new Set<string>();

      await tx.ridingSlotComplexStation.createMany({
        data: sourceBlock.stations.map((s, index) => ({
          blockId: created.id,
          instructorId: s.instructorId && activeInstructorIds.has(s.instructorId) ? s.instructorId : null,
          arena: s.arena,
          sortOrder: index,
        })),
      });
    }

    return { ok: true as const, value: { newBlockId: created.id } };
  });

  if (!outcome.ok) {
    return { success: false, error: outcome.error, staleConflict: outcome.staleConflict || undefined };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan, newBlockId: outcome.value.newBlockId };
}

export async function duplicateRidingSlotComplexBlockAsAdmin(
  ridingSlotId: string,
  blockId: string,
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return duplicateComplexBlockInternal(ridingSlotId, blockId, expectedVersion, adminActor(admin));
}

export async function duplicateRidingSlotComplexBlockAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  blockId: string,
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return duplicateComplexBlockInternal(ridingSlotId, blockId, expectedVersion, instructorActor(instructor));
}

// ---------- Reorder blocks ----------
// UNCHANGED from P2 - never referenced arena/instructors/pairs.

async function reorderComplexBlocksInternal(
  ridingSlotId: string,
  orderedBlockIds: string[],
  expectedVersion: number,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const actorData = actorWriteFields(actor);

  const outcome = await withLockedComplexPlan(ridingSlotId, expectedVersion, actorData, async (tx, planId) => {
    const existingBlocks = await tx.ridingSlotComplexBlock.findMany({
      where: { planId },
      select: { id: true },
    });
    const existingIds = new Set(existingBlocks.map((b) => b.id));
    const submittedIds = new Set(orderedBlockIds);

    if (
      orderedBlockIds.length !== existingBlocks.length ||
      submittedIds.size !== orderedBlockIds.length ||
      orderedBlockIds.some((id) => !existingIds.has(id))
    ) {
      return { ok: false as const, error: INVALID_BLOCK_ORDER };
    }

    // updateMany with a compound (id + planId) where per block re-enforces
    // ownership under the lock. A zero-row match means a block vanished
    // concurrently - fail closed via rollback.
    for (const [index, id] of orderedBlockIds.entries()) {
      const updated = await tx.ridingSlotComplexBlock.updateMany({
        where: { id, planId },
        data: { sortOrder: index },
      });
      if (updated.count === 0) {
        throw new StalePlanRollback();
      }
    }
    return { ok: true as const, value: null };
  });

  if (!outcome.ok) {
    return { success: false, error: outcome.error, staleConflict: outcome.staleConflict || undefined };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

export async function reorderRidingSlotComplexBlocksAsAdmin(
  ridingSlotId: string,
  orderedBlockIds: string[],
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return reorderComplexBlocksInternal(ridingSlotId, orderedBlockIds, expectedVersion, adminActor(admin));
}

export async function reorderRidingSlotComplexBlocksAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  orderedBlockIds: string[],
  expectedVersion: number
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return reorderComplexBlocksInternal(ridingSlotId, orderedBlockIds, expectedVersion, instructorActor(instructor));
}

// ---------- Delete plan (admin only) ----------
//
// RIDING-COMPLEX-SCHEDULE-BOARD Stage 3B.1 - deliberately NOT given an
// expectedVersion gate. This is an admin-only, destructive "delete the entire
// complex plan, whatever it currently contains" action; gating it on a version
// would be a silent semantic change (an admin who means to wipe the plan should
// not be blocked because a station moved since the page loaded). Its business
// contract is unchanged.
//
// It IS now wrapped in one interactive transaction whose FIRST statement takes
// the same per-slot advisory lock every cooperating structural writer / the
// Move/Swap action uses, so a whole-plan delete can never interleave with an
// in-flight targeted mutation for the same slot: the delete either fully
// precedes or fully follows it, never lands mid-mutation. No version is read or
// bumped - the plan (and its cascade) simply goes away.
export async function deleteRidingSlotComplexPlanAsAdmin(ridingSlotId: string): Promise<ActionResult> {
  await requireAdmin();

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ridingSlotId}))`;
      const plan = await tx.ridingSlotComplexPlan.findUnique({
        where: { ridingSlotId },
        select: { id: true },
      });
      if (!plan) {
        return { ok: false as const };
      }
      await tx.ridingSlotComplexPlan.delete({ where: { id: plan.id } });
      return { ok: true as const };
    });

    if (!txResult.ok) {
      return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
    }
  } catch (err) {
    if (prismaErrorCode(err) === "P2028") {
      return { success: false, error: LOCK_TIMEOUT };
    }
    throw err;
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");
  return { success: true };
}
