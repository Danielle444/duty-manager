"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";

const NOT_FOUND_COMPLEX_PLAN = "תכנון הרכיבה המורכבת לא נמצא. ייתכן שטרם נוצר - נסי לרענן את העמוד.";
const NO_BLOCKS = "לא ניתן לפרסם תכנון ללא טווחי שעות - יש להוסיף לפחות טווח שעות אחד לפני הפרסום.";
const NO_PERMISSION = "אין הרשאה לפרסם תכנון רכיבה מורכבת לחניכים";

// ---------- Actor plumbing ----------
//
// Duplicated (not imported) from the private, identically-shaped
// ComplexPlanActor/adminActor/instructorActor/actorWriteFields in
// riding-slot-complex.ts - same small-local-helper convention already
// established by resolveRidingSlotScheduleMeta in
// riding-slot-horse-publications.ts, rather than exporting those private
// symbols out of riding-slot-complex.ts for one extra call site.
interface ComplexPublicationActor {
  instructorId: string | null;
  adminEmail: string | null;
  adminName: string | null;
  displayName: string;
}

function adminPublicationActor(admin: { email: string; name: string | null }): ComplexPublicationActor {
  return {
    instructorId: null,
    adminEmail: admin.email,
    adminName: admin.name ?? null,
    displayName: admin.name ?? admin.email,
  };
}

function instructorPublicationActor(instructor: { id: string; fullName: string }): ComplexPublicationActor {
  return { instructorId: instructor.id, adminEmail: null, adminName: null, displayName: instructor.fullName };
}

function publicationActorWriteFields(actor: ComplexPublicationActor) {
  return {
    updatedByInstructorId: actor.instructorId,
    updatedByAdminEmail: actor.adminEmail,
    updatedByAdminName: actor.adminName,
    updatedByName: actor.displayName,
  };
}

// ---------- Status (read-only) ----------

export type ComplexRidingPlanPublicationStatusLabel = "UNPUBLISHED" | "CURRENT" | "STALE";

// Smallest DTO needed for a future status badge - never exposes snapshot
// internals (no block/station/pair data here at all, see the student read
// action below for that). STALE is only ever produced by this action and
// its two callers below (admin/instructor) - the trainee read action never
// computes or returns a status at all, so STALE can never reach a trainee.
export interface ComplexRidingPlanPublicationStatus {
  ridingSlotId: string;
  status: ComplexRidingPlanPublicationStatusLabel;
  sourceVersion: number | null;
  liveVersion: number | null;
  firstPublishedAt: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

// Shared by both status actions below (admin and instructor alike) - the
// shape of "unpublished/current/stale" is identical regardless of who's
// asking, same convention as buildHorsePublicationStatus in
// riding-slot-horse-publications.ts. liveVersion === null is how a caller
// distinguishes "no plan created yet" from "plan exists, never published"
// (both report status UNPUBLISHED) without a separate boolean field.
async function buildComplexPublicationStatus(ridingSlotId: string): Promise<ComplexRidingPlanPublicationStatus> {
  const plan = await prisma.ridingSlotComplexPlan.findUnique({
    where: { ridingSlotId },
    include: { publication: true },
  });

  if (!plan) {
    return {
      ridingSlotId,
      status: "UNPUBLISHED",
      sourceVersion: null,
      liveVersion: null,
      firstPublishedAt: null,
      updatedAt: null,
      updatedByName: null,
    };
  }

  const pub = plan.publication;
  if (!pub) {
    return {
      ridingSlotId,
      status: "UNPUBLISHED",
      sourceVersion: null,
      liveVersion: plan.version,
      firstPublishedAt: null,
      updatedAt: null,
      updatedByName: null,
    };
  }

  return {
    ridingSlotId,
    status: pub.sourceVersion === plan.version ? "CURRENT" : "STALE",
    sourceVersion: pub.sourceVersion,
    liveVersion: plan.version,
    firstPublishedAt: pub.firstPublishedAt.toISOString(),
    updatedAt: pub.updatedAt.toISOString(),
    updatedByName: pub.updatedByName,
  };
}

export async function getComplexRidingPlanPublicationStatusForAdmin(
  ridingSlotId: string
): Promise<ComplexRidingPlanPublicationStatus> {
  await requireAdmin();
  return buildComplexPublicationStatus(ridingSlotId);
}

// instructorId is checked for existence/isActive only - NOT
// canEditRidingNotes. Reading status has no permission-level gate beyond
// being an active instructor, matching getRidingSlotComplexPlanForInstructor
// and getInstructorHorsePublicationStatusForInstructor's identical read
// convention; only publishing is gated. Returns null (not an error) for an
// instructor who doesn't exist or isn't active.
export async function getComplexRidingPlanPublicationStatusForInstructor(
  instructorId: string,
  ridingSlotId: string
): Promise<ComplexRidingPlanPublicationStatus | null> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return null;
  return buildComplexPublicationStatus(ridingSlotId);
}

// ---------- Publish / republish (write) ----------

export interface PublishComplexRidingPlanResult extends ActionResult {
  status?: ComplexRidingPlanPublicationStatus;
}

// Shared core of publishComplexRidingPlanAsAdmin/AsInstructor.
//
// Consistency: the live plan + its full blocks/stations/pairs tree is read
// INSIDE the transaction below, and the publication upsert/snapshot-replace
// uses exactly that read's version/blocks/stations/pairs - never a value
// read before the transaction opened. Same guarantee as
// publishRidingHorseListToInstructorsInternal's identical comment.
//
// Concurrency: the publication upsert is a single atomic
// INSERT ... ON CONFLICT DO UPDATE keyed on the planId unique constraint -
// two concurrent publish calls for the same plan can never both "create"
// and collide (same reasoning as the horse-list publish's own upsert, which
// also needs no advisory lock for this same reason). Beyond that, Postgres
// takes a row lock on the conflicting key for the transaction that reaches
// the upsert first, so a second concurrent publish call simply waits for
// the first transaction to fully commit (upsert + delete + recreate, all of
// it) before it can even start its own upsert - no interleaving of one
// publish's delete+recreate with another's is possible, so no partially
// rebuilt snapshot can ever become visible to a reader.
async function publishComplexRidingPlanInternal(
  ridingSlotId: string,
  actor: ComplexPublicationActor
): Promise<PublishComplexRidingPlanResult> {
  const trimmedId = ridingSlotId?.trim();
  if (!trimmedId) {
    return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
  }

  const actorData = publicationActorWriteFields(actor);

  const txResult = await prisma.$transaction(async (tx) => {
    // The one consistent transactional read this whole publish is built
    // from - plan.version and every block/station/pair below are never
    // re-read or mixed with a value obtained outside this call.
    const plan = await tx.ridingSlotComplexPlan.findUnique({
      where: { ridingSlotId: trimmedId },
      include: {
        blocks: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            stations: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              include: {
                instructor: { select: { fullName: true } },
                pairs: {
                  orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                  include: {
                    trainee1: { select: { fullName: true } },
                    trainee2: { select: { fullName: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!plan) {
      return { ok: false as const, error: NOT_FOUND_COMPLEX_PLAN };
    }
    // The one hard blocker beyond "plan exists" - directly mirrors
    // publishRidingHorseListToInstructorsInternal's NOT_FOUND_HORSE_LIST
    // precedent (must have something to publish). Every other
    // incompleteness (station without coach/arena, pair without trainee2/
    // horse, empty station, block with no stations) stays a warning only,
    // exactly as it already is at station-save time - never invented here.
    if (plan.blocks.length === 0) {
      return { ok: false as const, error: NO_BLOCKS };
    }

    const publication = await tx.ridingSlotComplexPublication.upsert({
      where: { planId: plan.id },
      create: {
        planId: plan.id,
        sourceVersion: plan.version,
        ...actorData,
        // firstPublishedAt intentionally omitted - uses the schema default
        // (now()) on create, and is never listed in `update` below, so an
        // existing value is always left untouched on every republish.
      },
      update: {
        sourceVersion: plan.version,
        ...actorData,
      },
    });

    // Wholesale delete+recreate of every snapshot child row - same
    // convention as saveComplexStationInternal's pair replace and
    // publishRidingHorseListToInstructorsInternal's item replace. Deleting
    // this publication's blocks is enough: the schema's onDelete: Cascade
    // (publication -> blocks -> stations -> pairs) removes every station/
    // pair snapshot underneath them in the same statement.
    await tx.ridingSlotComplexPublicationBlock.deleteMany({ where: { publicationId: publication.id } });

    // Pair/station/block counts per plan are small (a handful of time
    // blocks, a handful of coach stations each, a handful of pairs each) -
    // sequential per-block/per-station creates (needed so each child's
    // generated id is available for its own children) stay comfortably
    // within the default Prisma interactive-transaction timeout, same
    // "no custom timeout without justification" convention already used by
    // every other transaction in this feature.
    for (const block of plan.blocks) {
      const pubBlock = await tx.ridingSlotComplexPublicationBlock.create({
        data: {
          publicationId: publication.id,
          sourceBlockId: block.id,
          startTime: block.startTime,
          endTime: block.endTime,
          sortOrder: block.sortOrder,
        },
      });

      for (const station of block.stations) {
        const pubStation = await tx.ridingSlotComplexPublicationStation.create({
          data: {
            publicationBlockId: pubBlock.id,
            sourceStationId: station.id,
            instructorId: station.instructorId,
            instructorNameSnapshot: station.instructor?.fullName ?? null,
            arena: station.arena,
            sortOrder: station.sortOrder,
          },
        });

        if (station.pairs.length > 0) {
          // note is deliberately never included here - see
          // RidingSlotComplexPublicationPair's own schema comment.
          await tx.ridingSlotComplexPublicationPair.createMany({
            data: station.pairs.map((pair) => ({
              publicationStationId: pubStation.id,
              sourcePairId: pair.id,
              trainee1Id: pair.trainee1Id,
              trainee1NameSnapshot: pair.trainee1?.fullName ?? null,
              trainee2Id: pair.trainee2Id,
              trainee2NameSnapshot: pair.trainee2?.fullName ?? null,
              horseName: pair.horseName,
              sortOrder: pair.sortOrder,
            })),
          });
        }
      }
    }

    return { ok: true as const, publication };
  });

  if (!txResult.ok) {
    return { success: false, error: txResult.error };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");
  revalidatePath("/student");

  const pub = txResult.publication;
  return {
    success: true,
    status: {
      ridingSlotId: trimmedId,
      // sourceVersion was just set to the exact live version read above, so
      // the publication is always CURRENT immediately after a successful call.
      status: "CURRENT",
      sourceVersion: pub.sourceVersion,
      liveVersion: pub.sourceVersion,
      firstPublishedAt: pub.firstPublishedAt.toISOString(),
      updatedAt: pub.updatedAt.toISOString(),
      updatedByName: pub.updatedByName,
    },
  };
}

export async function publishComplexRidingPlanAsAdmin(
  ridingSlotId: string
): Promise<PublishComplexRidingPlanResult> {
  const admin = await requireAdmin();
  return publishComplexRidingPlanInternal(ridingSlotId, adminPublicationActor(admin));
}

// Instructors have no NextAuth session in this app, so isActive/
// canEditRidingNotes are re-read from the DB on every call - never trusted
// from the client. Reuses the exact flag that already gates every write in
// riding-slot-complex.ts - no new permission introduced.
export async function publishComplexRidingPlanAsInstructor(
  instructorId: string,
  ridingSlotId: string
): Promise<PublishComplexRidingPlanResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return publishComplexRidingPlanInternal(ridingSlotId, instructorPublicationActor(instructor));
}

// ---------- Unpublish (write, admin-only) ----------

export interface UnpublishComplexRidingPlanResult extends ActionResult {
  // true when there was nothing to unpublish (already unpublished, or the
  // plan doesn't exist) - success stays true either way, matching this
  // action's "friendly, idempotent" requirement rather than surfacing that
  // as an error.
  alreadyUnpublished?: boolean;
}

// Admin-only by design (no AsInstructor variant exists for this action) -
// same trust tier as deleteRidingSlotComplexPlanAsAdmin's whole-plan
// deletion, which is also admin-only regardless of canEditRidingNotes:
// unpublish is the one action that actively removes trainee-visible
// content, not merely edits the draft.
export async function unpublishComplexRidingPlanAsAdmin(
  ridingSlotId: string
): Promise<UnpublishComplexRidingPlanResult> {
  await requireAdmin();

  const trimmedId = ridingSlotId?.trim();
  if (!trimmedId) {
    return { success: true, alreadyUnpublished: true };
  }

  const plan = await prisma.ridingSlotComplexPlan.findUnique({
    where: { ridingSlotId: trimmedId },
    select: { id: true },
  });
  if (!plan) {
    return { success: true, alreadyUnpublished: true };
  }

  // deleteMany (not delete-by-id) - never throws not-found, tolerant of a
  // concurrent unpublish already having removed the row, same convention as
  // every deleteMany in riding-slot-complex.ts. Cascade (schema
  // onDelete: Cascade, publication -> blocks -> stations -> pairs) removes
  // every snapshot child row in the same statement; the live plan/blocks/
  // stations/pairs are never touched by this call.
  const deleted = await prisma.ridingSlotComplexPublication.deleteMany({ where: { planId: plan.id } });

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");
  revalidatePath("/student");

  return { success: true, alreadyUnpublished: deleted.count === 0 };
}

// ---------- Trainee-scoped read (read-only) ----------
//
// RIDING-COMPLEX-PUBLICATION P7C - product decision changed from "trainee
// sees only their own pair" to "trainee sees the entire published plan for
// the relevant riding slot, with their own name highlighted client-side by
// ID." getPublishedComplexRidingAssignmentsForStudentInternal (the P7A
// own-pair-only shape) is removed entirely rather than kept alongside this -
// it was never wired into any caller (confirmed: no other file referenced
// it), so there is nothing depending on the old shape.

export interface PublishedComplexRidingPlanPairForStudent {
  // Kept only so the client can compare by stable ID to highlight the
  // logged-in trainee and to render the second trainee slot only when
  // present - never used for anything beyond that (no name matching, no
  // click-through target exposed here). null when the snapshot's trainee FK
  // has gone null via onDelete: SetNull (see RidingSlotComplexPublicationPair's
  // own schema comment) - the *Name snapshot fields remain the source of
  // truth for display regardless.
  trainee1Id: string | null;
  trainee1Name: string;
  trainee2Id: string | null;
  trainee2Name: string | null;
  horseName: string | null;
  sortOrder: number;
}

export interface PublishedComplexRidingPlanStationForStudent {
  coachName: string | null;
  arena: string | null;
  sortOrder: number;
  pairs: PublishedComplexRidingPlanPairForStudent[];
}

export interface PublishedComplexRidingPlanBlockForStudent {
  startTime: string;
  endTime: string;
  sortOrder: number;
  stations: PublishedComplexRidingPlanStationForStudent[];
}

// Never includes publication id, sourceVersion, updatedBy* fields, source*Id
// traceability columns, pair.note, or any warning/status concept - none of
// that exists anywhere in this return shape, not merely omitted by
// convention.
export interface PublishedComplexRidingPlanForStudent {
  ridingSlotId: string;
  blocks: PublishedComplexRidingPlanBlockForStudent[];
}

// Batched by ridingSlotIds - suitable for a single call from
// getScheduleForStudent covering every riding-linked item in one week/day
// view, so resolving N riding slots never costs N round trips. Exported (not
// module-private) so lib/actions/student-schedule.ts can call it directly -
// see that file's own integration for how ridingSlotIds is derived (always
// from that student's own server-resolved, already-published-week schedule
// items, never a client-supplied list).
//
// Privacy has two independent layers, since any exported function in a
// "use server" file is directly callable by a client, not merely through
// whatever caller happens to import it - this must be safe to call with an
// attacker-chosen ridingSlotIds array, not just a well-behaved one:
//   1. Re-reads Student.isActive fresh from the DB by studentId on every
//      call - the client-held session's own copy is never trusted, same
//      convention as getRidingHorsePublicationsForStudent.
//   2. The publication query itself additionally requires each riding slot's
//      anchor ScheduleItem to belong to a currently PUBLISHED WeeklySchedule
//      (plan.ridingSlot.scheduleItem.weeklySchedule.isPublished) - the exact
//      same "a stale/tampered id must never leak unpublished content" defense-
//      in-depth check getScheduleForStudent's own week.isPublished guard
//      already performs, applied here so this action can never become a
//      "fetch any complex plan by riding slot id" backdoor around that check.
// Reads ONLY the publication snapshot tables for actual plan content
// (RidingSlotComplexPublication/Block/Station/Pair) - the one touch of
// RidingSlotComplexPlan/RidingSlot/ScheduleItem/WeeklySchedule below is
// exclusively to resolve the join-key/publication-gate above, never to read
// live block/station/pair content or any draft data. Returns an empty map
// uniformly for a nonexistent/inactive student, an empty ridingSlotIds list,
// or riding slots with no (or no publicly-visible) publication - never a
// distinguishable error.
export async function getPublishedComplexRidingPlansForStudentInternal(
  studentId: string,
  ridingSlotIds: string[]
): Promise<Map<string, PublishedComplexRidingPlanForStudent>> {
  if (ridingSlotIds.length === 0) return new Map();

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { isActive: true },
  });
  if (!student || !student.isActive) return new Map();

  const publications = await prisma.ridingSlotComplexPublication.findMany({
    where: {
      plan: {
        ridingSlotId: { in: ridingSlotIds },
        ridingSlot: { scheduleItem: { weeklySchedule: { isPublished: true } } },
      },
    },
    select: {
      plan: { select: { ridingSlotId: true } },
      blocks: {
        orderBy: { sortOrder: "asc" },
        select: {
          startTime: true,
          endTime: true,
          sortOrder: true,
          stations: {
            orderBy: { sortOrder: "asc" },
            select: {
              instructorNameSnapshot: true,
              arena: true,
              sortOrder: true,
              pairs: {
                orderBy: { sortOrder: "asc" },
                select: {
                  trainee1Id: true,
                  trainee1NameSnapshot: true,
                  trainee2Id: true,
                  trainee2NameSnapshot: true,
                  horseName: true,
                  sortOrder: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const result = new Map<string, PublishedComplexRidingPlanForStudent>();
  for (const pub of publications) {
    result.set(pub.plan.ridingSlotId, {
      ridingSlotId: pub.plan.ridingSlotId,
      blocks: pub.blocks.map((block) => ({
        startTime: block.startTime,
        endTime: block.endTime,
        sortOrder: block.sortOrder,
        stations: block.stations.map((station) => ({
          coachName: station.instructorNameSnapshot,
          arena: station.arena,
          sortOrder: station.sortOrder,
          pairs: station.pairs.map((pair) => ({
            trainee1Id: pair.trainee1Id,
            // Always populated at publish time in practice (see
            // RidingSlotComplexPublicationPair's own schema comment on why
            // trainee1NameSnapshot is never actually null) - the `?? ""`
            // fallback exists only to keep this field's type honest as a
            // required string without inventing a new placeholder message
            // for a case that should never occur.
            trainee1Name: pair.trainee1NameSnapshot ?? "",
            trainee2Id: pair.trainee2Id,
            trainee2Name: pair.trainee2NameSnapshot,
            horseName: pair.horseName,
            sortOrder: pair.sortOrder,
          })),
        })),
      })),
    });
  }

  return result;
}
