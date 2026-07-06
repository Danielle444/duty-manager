"use server";

import webpush, { WebPushError } from "web-push";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/actions/students";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT;

const vapidConfigured = Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);
if (vapidConfigured) {
  webpush.setVapidDetails(vapidSubject!, vapidPublicKey!, vapidPrivateKey!);
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Students have no NextAuth session in this app, so ownership is scoped by
// studentId exactly like every other student-facing action (see
// getStudentMessages, markMessageRead) - never trusted beyond storing/
// deleting rows for that one studentId. endpoint is unique, so re-subscribing
// (e.g. the browser rotated it) just updates the existing row in place.
export async function subscribeStudentToPush(
  studentId: string,
  subscription: PushSubscriptionInput,
  userAgent: string | null
): Promise<ActionResult> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      recipientRole: "STUDENT",
      studentId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
    },
    update: {
      recipientRole: "STUDENT",
      studentId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
    },
  });
  return { success: true };
}

export async function unsubscribeStudentFromPush(
  studentId: string,
  endpoint: string
): Promise<ActionResult> {
  const subscription = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  if (!subscription || subscription.studentId !== studentId) {
    // Already gone, or never belonged to this student - either way there's
    // nothing left for this student's unsubscribe request to do.
    return { success: true };
  }
  await prisma.pushSubscription.delete({ where: { endpoint } });
  return { success: true };
}

const PUSH_TITLE = "עדכון חדש ב־Double K Top";
const PUSH_BODY = "נשלחה הודעה או משימה חדשה באפליקציה.";

// Best-effort push fanout, called from createMessageTaskInternal right after
// the student MessageTaskRecipient rows are created. Deliberately generic
// payload - no message/task title or body, since push notifications render
// on a lock screen. Never throws: a missing VAPID config, an empty
// subscription list, or a single subscription's send failure must never
// break message/task creation.
export async function sendNewMessagePushToStudents(studentIds: string[]): Promise<void> {
  if (!vapidConfigured || studentIds.length === 0) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { recipientRole: "STUDENT", studentId: { in: studentIds } },
  });
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({ title: PUSH_TITLE, body: PUSH_BODY });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (error) {
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error("Push send failed", error);
        }
      }
    })
  );
}
