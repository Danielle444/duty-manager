"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";
import { sendNewMessagePushToStudents } from "@/lib/actions/push";
// SECURITY / LEVEL 2 SLICE L2-C3 - server-derived trainee identity + course
// context for the trainee-facing message/task surface at the bottom of this
// file. Nothing above it (admin creation/fan-out, instructor view) changes.
import { requireCurrentTrainee } from "@/lib/auth/actor";
import { resolveTraineeCourseOffering } from "@/lib/course/actor-course-offering";
import { getEffectiveCapabilities } from "@/lib/course/capabilities/offering-capabilities";
import type { CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import {
  authorizeTraineeModuleWithDeps,
  loadAuthorizedTraineeModuleRowsWithDeps,
  type TraineeModuleContextDeps,
} from "@/lib/course/trainee-module-containment-core";

const messageTaskTypeSchema = z.enum(["MESSAGE", "TASK"]);
const messageAudienceSchema = z.enum(["ALL", "GROUP", "SPECIFIC"]);

export type MessageTaskTypeValue = z.infer<typeof messageTaskTypeSchema>;
export type MessageAudienceValue = z.infer<typeof messageAudienceSchema>;

const createSchema = z.object({
  type: messageTaskTypeSchema,
  title: z.string().trim().min(1, "יש להזין כותרת"),
  body: z.string().trim().min(1, "יש להזין תוכן"),
  audience: messageAudienceSchema,
  groupName: z.string().trim().optional(),
  studentIds: z.array(z.string()).optional(),
});

export interface CreateMessageTaskInput {
  type: MessageTaskTypeValue;
  title: string;
  body: string;
  audience: MessageAudienceValue;
  groupName?: string;
  studentIds?: string[];
}

// Shared by the admin and instructor create actions - resolves the audience
// into a concrete student id list at send time. Later group/roster changes
// never retroactively change who this was sent to.
async function resolveRecipientIds(
  data: z.infer<typeof createSchema>
): Promise<{ ids: string[] } | { error: string }> {
  if (data.audience === "ALL") {
    const students = await prisma.student.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    return { ids: students.map((s) => s.id) };
  }
  if (data.audience === "GROUP") {
    if (!data.groupName) {
      return { error: "יש לבחור קבוצה" };
    }
    const students = await prisma.student.findMany({
      where: { isActive: true, groupName: data.groupName },
      select: { id: true },
    });
    return { ids: students.map((s) => s.id) };
  }
  const ids = data.studentIds ?? [];
  if (ids.length === 0) {
    return { error: "יש לבחור לפחות חניך/ה אחד/ת" };
  }
  const students = await prisma.student.findMany({
    where: { isActive: true, id: { in: ids } },
    select: { id: true },
  });
  return { ids: students.map((s) => s.id) };
}

async function createMessageTaskInternal(
  input: CreateMessageTaskInput,
  createdByName: string
): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const data = parsed.data;

  const resolved = await resolveRecipientIds(data);
  if ("error" in resolved) {
    return { success: false, error: resolved.error };
  }
  if (resolved.ids.length === 0) {
    return { success: false, error: "לא נמצאו נמענים מתאימים" };
  }

  await prisma.messageTask.create({
    data: {
      type: data.type,
      title: data.title,
      body: data.body,
      audience: data.audience,
      groupName: data.audience === "GROUP" ? data.groupName : null,
      createdByName,
      recipients: {
        create: resolved.ids.map((studentId) => ({ studentId })),
      },
    },
  });

  // Best-effort push fanout - must never fail message/task creation, which
  // has already succeeded above by this point.
  try {
    await sendNewMessagePushToStudents(resolved.ids);
  } catch (error) {
    console.error("Push fanout failed for new message/task", error);
  }

  revalidatePath("/admin/messages");
  return { success: true };
}

// Admin-created messages always show a fixed "מנהלת" sender label to
// students, regardless of which admin account sent it.
export async function createMessageTask(input: CreateMessageTaskInput): Promise<ActionResult> {
  await requireAdmin();
  return createMessageTaskInternal(input, "מנהלת");
}

// Instructors have no NextAuth session in this app (see requireAdmin), so
// this re-reads canSendMessages from the DB by instructorId on every call -
// it never trusts a client-supplied boolean.
export async function createMessageTaskAsInstructor(
  instructorId: string,
  input: CreateMessageTaskInput
): Promise<ActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canSendMessages) {
    return { success: false, error: "אין הרשאה לשליחת הודעות ומשימות" };
  }
  return createMessageTaskInternal(input, instructor.fullName);
}

const updateSchema = z.object({
  title: z.string().trim().min(1, "יש להזין כותרת"),
  body: z.string().trim().min(1, "יש להזין תוכן"),
});

// Only title/body are editable after sending - type, audience, groupName and
// recipients are fixed at creation time (see resolveRecipientIds) so editing
// them post-send would create confusing, inconsistent history.
export async function updateMessageTask(
  messageTaskId: string,
  data: { title: string; body: string }
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = updateSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  await prisma.messageTask.update({
    where: { id: messageTaskId },
    data: { title: parsed.data.title, body: parsed.data.body },
  });

  revalidatePath("/admin/messages");
  return { success: true };
}

// Soft delete only - recipient rows (and their readAt/completedAt history)
// are never touched or deleted. isArchived=true just hides the item from the
// default admin list and from all student views.
export async function archiveMessageTask(
  messageTaskId: string,
  isArchived: boolean
): Promise<ActionResult> {
  await requireAdmin();

  await prisma.messageTask.update({
    where: { id: messageTaskId },
    data: { isArchived },
  });

  revalidatePath("/admin/messages");
  return { success: true };
}

export interface MessageTaskListItem {
  id: string;
  type: MessageTaskTypeValue;
  title: string;
  body: string;
  audience: MessageAudienceValue;
  groupName: string | null;
  createdByName: string | null;
  isArchived: boolean;
  createdAt: string;
  totalCount: number;
  readCount: number;
  completedCount: number;
  // Only meaningful for audience=SPECIFIC (used to show actual trainee
  // names instead of a generic label) - populated regardless of audience for
  // a simpler, uniform query, but ALL/GROUP callers just ignore it.
  recipientNames: string[];
}

export async function listMessageTasksForAdmin(
  includeArchived = false
): Promise<MessageTaskListItem[]> {
  await requireAdmin();

  const items = await prisma.messageTask.findMany({
    where: includeArchived ? undefined : { isArchived: false },
    orderBy: { createdAt: "desc" },
    include: {
      recipients: {
        select: { readAt: true, completedAt: true, student: { select: { fullName: true } } },
      },
    },
  });

  return items.map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    audience: item.audience,
    groupName: item.groupName,
    createdByName: item.createdByName,
    isArchived: item.isArchived,
    createdAt: item.createdAt.toISOString(),
    totalCount: item.recipients.length,
    readCount: item.recipients.filter((r) => r.readAt !== null).length,
    completedCount: item.recipients.filter((r) => r.completedAt !== null).length,
    recipientNames: item.recipients.map((r) => r.student.fullName),
  }));
}

export interface MessageTaskRecipientRow {
  id: string;
  studentId: string;
  studentFullName: string;
  readAt: string | null;
  completedAt: string | null;
}

export async function getMessageTaskRecipients(
  messageTaskId: string
): Promise<MessageTaskRecipientRow[]> {
  await requireAdmin();

  const recipients = await prisma.messageTaskRecipient.findMany({
    where: { messageTaskId },
    include: { student: { select: { fullName: true } } },
    orderBy: { student: { fullName: "asc" } },
  });

  return recipients.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    studentFullName: r.student.fullName,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  }));
}

export interface InstructorMessageTaskView {
  id: string;
  type: MessageTaskTypeValue;
  title: string;
  body: string;
  audience: MessageAudienceValue;
  groupName: string | null;
  createdByName: string | null;
  createdAt: string;
  // Only meaningful for audience=SPECIFIC (shows actual trainee names
  // instead of a generic label) - instructors already see this message's
  // full content/audience regardless of sender, so this is not a new
  // privacy boundary. No per-recipient read/completed status is exposed
  // here (that stays admin-only via getMessageTaskRecipients).
  recipientNames: string[];
}

// Read-only, no permission gate - same convention as getHorseAssignments,
// since instructors have no NextAuth session in this app. Every instructor
// can see this list regardless of canSendMessages - it's content-only, no
// per-recipient read/completed status is exposed here (that stays
// admin-only via getMessageTaskRecipients).
export async function getMessageTasksForInstructorView(): Promise<InstructorMessageTaskView[]> {
  const items = await prisma.messageTask.findMany({
    where: { isArchived: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      audience: true,
      groupName: true,
      createdByName: true,
      createdAt: true,
      recipients: { select: { student: { select: { fullName: true } } } },
    },
  });

  return items.map((m) => ({
    id: m.id,
    type: m.type,
    title: m.title,
    body: m.body,
    audience: m.audience,
    groupName: m.groupName,
    createdByName: m.createdByName,
    createdAt: m.createdAt.toISOString(),
    recipientNames: m.recipients.map((r) => r.student.fullName),
  }));
}

export interface StudentMessageItem {
  recipientId: string;
  messageTaskId: string;
  type: MessageTaskTypeValue;
  title: string;
  body: string;
  createdByName: string | null;
  createdAt: string;
  readAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
}

// ---------------------------------------------------------------------------
// TRAINEE-FACING MESSAGE / TASK SURFACE - SECURITY / LEVEL 2 SLICE L2-C3
// ---------------------------------------------------------------------------
//
// Everything below is CONTAINED: identity comes from the signed trainee
// session, the course context is server-resolved from that trainee's own
// enrollment, and the resolved offering's MESSAGES capability must be
// positively ENABLED before a single MessageTaskRecipient row is read or
// written.
//
// This closes an ANONYMOUS exposure. These actions previously "authenticated" a
// caller by trusting the client-supplied studentId argument outright (the
// reader) or by re-reading the recipient row and comparing it to that same
// client-supplied id (the writers) - which authorizes nothing, because
// searchStudents() is unauthenticated by design (it powers the login screen)
// and returns real student ids. Any caller, including an anonymous one, could
// therefore read another trainee's messages and tasks and mark them
// read/completed/archived.
//
// The studentId parameters are RETAINED for caller compatibility in this slice
// and are deliberately discarded; they are NEVER identity. The session-derived
// trainee id is the only one that reaches a query filter or an ownership
// comparison.

/**
 * The single capability that authorizes the trainee message/task module. It is
 * an EXISTING canonical key (capability-keys.ts) - this slice invents no key -
 * and the CapabilityKey annotation makes a typo a compile error.
 */
const TRAINEE_MESSAGES_CAPABILITY_KEY: CapabilityKey = "MESSAGES";

// The containment binding shared by every trainee action below. It supplies
// ONLY real, server-owned dependencies: the trainee id from the signed session
// via the canonical Actor DAL (requireCurrentTrainee rejects anonymous,
// expired, wrong-audience and INACTIVE sessions), the offering from the
// committed no-argument resolveTraineeCourseOffering(), and the capabilities of
// that exact resolved offering. There is deliberately no courseOfferingId
// parameter anywhere in this file, no legacy singleton offering resolver, no
// Level 1 fallback, and no group/name/level/date inference. All ordering and every
// allow/deny decision live in the pure core.
const TRAINEE_MESSAGES_DEPS: TraineeModuleContextDeps = {
  requireTraineeId: async () => (await requireCurrentTrainee()).id,
  resolveTraineeCourseOffering,
  getEffectiveCapabilities,
};

/**
 * The write-side gate: the session-derived trainee id, or null when the caller
 * is not an authorized MESSAGES trainee. Every denial - anonymous, expired,
 * wrong audience, inactive trainee, no/ambiguous offering, capability row
 * absent (the Level 2 state), DISABLED, READ_ONLY, malformed - is the same
 * null, and no MessageTaskRecipient row is read before it returns. Real
 * infrastructure/programming failures propagate out of the core unchanged.
 */
async function authorizedTraineeMessagesId(): Promise<string | null> {
  const authorization = await authorizeTraineeModuleWithDeps(
    TRAINEE_MESSAGES_CAPABILITY_KEY,
    TRAINEE_MESSAGES_DEPS
  );
  return authorization.authorized ? authorization.context.traineeId : null;
}

// Items admin has archived (MessageTask.isArchived, a separate global
// concept - see archiveMessageTask) are always excluded here. archivedAt is
// this trainee's own per-recipient archive instead - still returned so the
// component can split active/history/archived itself, rather than this
// function returning three different shapes.
export async function getStudentMessages(studentId: string): Promise<StudentMessageItem[]> {
  // L2-C3: accepted for caller compatibility and deliberately DISCARDED. It is
  // a client-supplied value and therefore never identity; see the header above.
  void studentId;
  return loadAuthorizedTraineeModuleRowsWithDeps(
    TRAINEE_MESSAGES_CAPABILITY_KEY,
    TRAINEE_MESSAGES_DEPS,
    async ({ traineeId }) => {
      const recipients = await prisma.messageTaskRecipient.findMany({
        where: { studentId: traineeId, messageTask: { isArchived: false } },
        include: { messageTask: true },
        orderBy: { createdAt: "desc" },
      });

      return recipients.map((r) => ({
        recipientId: r.id,
        messageTaskId: r.messageTaskId,
        type: r.messageTask.type,
        title: r.messageTask.title,
        body: r.messageTask.body,
        createdByName: r.messageTask.createdByName,
        createdAt: r.messageTask.createdAt.toISOString(),
        readAt: r.readAt ? r.readAt.toISOString() : null,
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
      }));
    }
  );
}

// Ownership is verified by re-reading the recipient row and comparing it to the
// SESSION-derived trainee id (never the client-supplied argument). An
// unauthorized caller gets the same "not found" failure as a genuinely missing
// row, so a recipient id can never be probed for existence, and nothing is
// mutated.
export async function markMessageRead(
  recipientId: string,
  studentId: string
): Promise<ActionResult> {
  // L2-C3: accepted for caller compatibility and deliberately DISCARDED.
  void studentId;
  const traineeId = await authorizedTraineeMessagesId();
  if (!traineeId) {
    return { success: false, error: "ההודעה לא נמצאה" };
  }

  const recipient = await prisma.messageTaskRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient || recipient.studentId !== traineeId) {
    return { success: false, error: "ההודעה לא נמצאה" };
  }
  if (recipient.readAt) {
    return { success: true };
  }

  await prisma.messageTaskRecipient.update({
    where: { id: recipientId },
    data: { readAt: new Date() },
  });

  revalidatePath("/admin/messages");
  return { success: true };
}

export async function setTaskCompleted(
  recipientId: string,
  studentId: string,
  isCompleted: boolean
): Promise<ActionResult> {
  // L2-C3: accepted for caller compatibility and deliberately DISCARDED.
  void studentId;
  const traineeId = await authorizedTraineeMessagesId();
  if (!traineeId) {
    return { success: false, error: "המשימה לא נמצאה" };
  }

  const recipient = await prisma.messageTaskRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient || recipient.studentId !== traineeId) {
    return { success: false, error: "המשימה לא נמצאה" };
  }

  await prisma.messageTaskRecipient.update({
    where: { id: recipientId },
    data: { completedAt: isCompleted ? new Date() : null },
  });

  revalidatePath("/admin/messages");
  return { success: true };
}

// Same ownership convention as markMessageRead/setTaskCompleted, plus a
// business-rule check re-read from the row itself (never trusted from the
// client): a MESSAGE can only be archived once read, a TASK only once
// completed. This is a per-trainee archive, unrelated to MessageTask's own
// isArchived (admin's global soft-delete/restore) - archiving here never
// touches that field.
export async function archiveMessageTaskForStudent(
  recipientId: string,
  studentId: string
): Promise<ActionResult> {
  // L2-C3: accepted for caller compatibility and deliberately DISCARDED.
  void studentId;
  const traineeId = await authorizedTraineeMessagesId();
  if (!traineeId) {
    return { success: false, error: "ההודעה לא נמצאה" };
  }

  const recipient = await prisma.messageTaskRecipient.findUnique({
    where: { id: recipientId },
    include: { messageTask: { select: { type: true } } },
  });
  if (!recipient || recipient.studentId !== traineeId) {
    return { success: false, error: "ההודעה לא נמצאה" };
  }

  const canArchive =
    recipient.messageTask.type === "TASK" ? recipient.completedAt !== null : recipient.readAt !== null;
  if (!canArchive) {
    return {
      success: false,
      error:
        recipient.messageTask.type === "TASK"
          ? "ניתן להעביר לארכיון רק לאחר השלמת המשימה"
          : "ניתן להעביר לארכיון רק לאחר קריאת ההודעה",
    };
  }

  if (recipient.archivedAt) {
    return { success: true };
  }

  await prisma.messageTaskRecipient.update({
    where: { id: recipientId },
    data: { archivedAt: new Date() },
  });

  revalidatePath("/admin/messages");
  return { success: true };
}

export async function unarchiveMessageTaskForStudent(
  recipientId: string,
  studentId: string
): Promise<ActionResult> {
  // L2-C3: accepted for caller compatibility and deliberately DISCARDED.
  void studentId;
  const traineeId = await authorizedTraineeMessagesId();
  if (!traineeId) {
    return { success: false, error: "ההודעה לא נמצאה" };
  }

  const recipient = await prisma.messageTaskRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient || recipient.studentId !== traineeId) {
    return { success: false, error: "ההודעה לא נמצאה" };
  }
  if (!recipient.archivedAt) {
    return { success: true };
  }

  await prisma.messageTaskRecipient.update({
    where: { id: recipientId },
    data: { archivedAt: null },
  });

  revalidatePath("/admin/messages");
  return { success: true };
}
