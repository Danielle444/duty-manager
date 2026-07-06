"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";

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
}

export async function listMessageTasksForAdmin(
  includeArchived = false
): Promise<MessageTaskListItem[]> {
  await requireAdmin();

  const items = await prisma.messageTask.findMany({
    where: includeArchived ? undefined : { isArchived: false },
    orderBy: { createdAt: "desc" },
    include: {
      recipients: { select: { readAt: true, completedAt: true } },
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
}

// Read-only, no permission gate - same convention as getStudentProfile /
// getHorseAssignments, since students have no NextAuth session in this app.
// Archived items are always excluded - a message archived after a student
// already saw it disappears from their list too.
export async function getStudentMessages(studentId: string): Promise<StudentMessageItem[]> {
  const recipients = await prisma.messageTaskRecipient.findMany({
    where: { studentId, messageTask: { isArchived: false } },
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
  }));
}

// Students have no NextAuth session in this app (see requireAdmin), so
// ownership is verified by re-reading the recipient row and comparing
// studentId - the same convention already established by markDutyCompleted.
export async function markMessageRead(
  recipientId: string,
  studentId: string
): Promise<ActionResult> {
  const recipient = await prisma.messageTaskRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient || recipient.studentId !== studentId) {
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
  const recipient = await prisma.messageTaskRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient || recipient.studentId !== studentId) {
    return { success: false, error: "המשימה לא נמצאה" };
  }

  await prisma.messageTaskRecipient.update({
    where: { id: recipientId },
    data: { completedAt: isCompleted ? new Date() : null },
  });

  revalidatePath("/admin/messages");
  return { success: true };
}
