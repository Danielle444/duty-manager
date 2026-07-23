/**
 * MULTI-COURSE W9A-2 - server-side IO for creating exactly ONE PLANNED
 * CourseOffering under an EXISTING ActivityYear, plus the narrow ActivityYear
 * option reader the admin form needs.
 *
 * The single write boundary is `prisma.courseOffering.create`. The offering
 * `status` is hard-coded to "PLANNED" on the server and is never accepted from
 * the client (RawNewOfferingInput carries no status field). ActivityYear
 * existence is verified with a read (never created here). No transaction is used
 * because this slice performs exactly one write.
 *
 * The cardinality/validation decision lives in the PURE core
 * (create-offering-core.ts). The IO orchestration is dependency-injected
 * (createCourseOfferingWithDeps) so a DB-free test can prove the write boundary
 * without a live database (see create-offering.test.ts); the thin
 * createCourseOffering wrapper binds the real Prisma client.
 */
import { prisma } from "@/lib/prisma";
import {
  validateNewOfferingInput,
  type CreateOfferingValidationErrorCode,
  type RawNewOfferingInput,
} from "./create-offering-core";

/** The full result error surface: validation codes plus IO outcomes. */
export type CreateOfferingErrorCode =
  | CreateOfferingValidationErrorCode
  | "activity_year_not_found"
  | "duplicate_name"
  | "unexpected";

/** Discriminated result: the new offering id, or a stable non-PII error code. */
export type CreateOfferingResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: CreateOfferingErrorCode };

/** The exact data the single CourseOffering write receives (status is fixed). */
export interface NewOfferingWriteData {
  readonly activityYearId: string;
  readonly name: string;
  readonly level: number;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly status: "PLANNED";
}

/**
 * Injected boundary. `activityYearExists` is the existence read; `createOffering`
 * is the SOLE write. There is deliberately NO dependency capable of creating an
 * ActivityYear, capability, group, enrollment or membership - the operation is
 * structurally incapable of writing anything but one CourseOffering.
 */
export interface CreateOfferingDeps {
  activityYearExists: (activityYearId: string) => Promise<boolean>;
  createOffering: (data: NewOfferingWriteData) => Promise<{ id: string }>;
}

/** True only for a Prisma unique-constraint violation (P2002), structurally. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Create one PLANNED CourseOffering. Order (fail-closed): validate -> verify the
 * ActivityYear exists (before any write) -> write exactly one offering with
 * status hard-coded "PLANNED". A duplicate (activityYearId, name) surfaces as
 * P2002 -> "duplicate_name"; any other write failure collapses to "unexpected"
 * without exposing raw database details or submitted values.
 */
export async function createCourseOfferingWithDeps(
  input: RawNewOfferingInput,
  deps: CreateOfferingDeps,
): Promise<CreateOfferingResult> {
  const validated = validateNewOfferingInput(input);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }

  const exists = await deps.activityYearExists(validated.value.activityYearId);
  if (!exists) {
    // Rejected BEFORE any offering write.
    return { success: false, error: "activity_year_not_found" };
  }

  try {
    const created = await deps.createOffering({
      activityYearId: validated.value.activityYearId,
      name: validated.value.name,
      level: validated.value.level,
      startDate: validated.value.startDate,
      endDate: validated.value.endDate,
      status: "PLANNED",
    });
    return { success: true, id: created.id };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return { success: false, error: "duplicate_name" };
    }
    return { success: false, error: "unexpected" };
  }
}

/**
 * Thin wrapper binding the real Prisma client. The ActivityYear check is a read
 * (findUnique by exact id); the only write is prisma.courseOffering.create.
 */
export async function createCourseOffering(
  input: RawNewOfferingInput,
): Promise<CreateOfferingResult> {
  return createCourseOfferingWithDeps(input, {
    activityYearExists: async (activityYearId) => {
      const row = await prisma.activityYear.findUnique({
        where: { id: activityYearId },
        select: { id: true },
      });
      return row !== null;
    },
    createOffering: ({ activityYearId, name, level, startDate, endDate, status }) =>
      prisma.courseOffering.create({
        data: { activityYearId, name, level, startDate, endDate, status },
        select: { id: true },
      }),
  });
}

/** A single ActivityYear option for the admin creation form. */
export interface ActivityYearOption {
  readonly id: string;
  readonly name: string;
}

/**
 * Narrow reader for the creation form's ActivityYear select. Returns only id +
 * name, ordered by name, so the form never hard-codes a year id. Not a generic
 * repository abstraction - it exists solely for this creation surface.
 */
export async function listActivityYearOptions(): Promise<ActivityYearOption[]> {
  return prisma.activityYear.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
