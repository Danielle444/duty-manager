"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey, enumerateDateKeys, parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";

export interface NoDutyDayStatus {
  dateKey: string;
  isNoDuty: boolean;
  reason: string | null;
  assignmentCount: number;
}

// One row per date in the range, combining the no-duty flag with how many
// duty assignments already exist that day (so the admin UI can warn without
// a separate round trip). Read-only - never touches DutyAssignment rows.
export async function getNoDutyStatusForRange(
  startDateKey: string,
  endDateKey: string
): Promise<NoDutyDayStatus[]> {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);

  const [noDutyRows, assignmentGroups] = await Promise.all([
    prisma.noDutyDate.findMany({ where: { date: { gte: start, lte: end } } }),
    prisma.dutyAssignment.groupBy({
      by: ["date"],
      where: { date: { gte: start, lte: end } },
      _count: { _all: true },
    }),
  ]);

  const noDutyByDate = new Map(noDutyRows.map((r) => [dateKey(r.date), r.reason]));
  const countByDate = new Map(assignmentGroups.map((g) => [dateKey(g.date), g._count._all]));

  return enumerateDateKeys(start, end).map((dk) => ({
    dateKey: dk,
    isNoDuty: noDutyByDate.has(dk),
    reason: noDutyByDate.get(dk) ?? null,
    assignmentCount: countByDate.get(dk) ?? 0,
  }));
}

// Marking/unmarking never touches DutyAssignment rows - only the scheduler's
// generation step (lib/scheduler.ts) reads this to decide what to skip.
export async function markNoDutyDate(dateKeyStr: string, reason?: string): Promise<ActionResult> {
  // ADMIN-WRITE-A2: admin authorization is the FIRST operation - before the
  // date is even parsed - so a non-admin caller of this "use server" endpoint
  // can neither mark a day as no-duty nor probe dates through parse errors.
  await requireAdmin();

  const date = parseDateKey(dateKeyStr);
  await prisma.noDutyDate.upsert({
    where: { date },
    update: { reason: reason ?? null },
    create: { date, reason: reason ?? null },
  });

  revalidatePath("/admin/weekly-schedule");
  return { success: true };
}

export async function unmarkNoDutyDate(dateKeyStr: string): Promise<ActionResult> {
  // ADMIN-WRITE-A2: authorization precedes parsing and the deleteMany, so an
  // unauthorized caller can neither clear a no-duty marking nor probe which
  // dates are marked.
  await requireAdmin();

  const date = parseDateKey(dateKeyStr);
  await prisma.noDutyDate.deleteMany({ where: { date } });

  revalidatePath("/admin/weekly-schedule");
  return { success: true };
}
