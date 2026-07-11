"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import { getSupabaseClient, PARENT_SIGNATURES_BUCKET } from "@/lib/supabase";
import { CURRENT_TEACHING_PRACTICE_COURSE_CYCLE } from "@/lib/parent-signatures/course-cycle";
import { buildParentSignatureImagePath } from "@/lib/parent-signatures/storage-path";
import { requiredParentSignatureFormTypes } from "@/lib/parent-signatures/required-forms";
import { getFormContent, CURRENT_FORM_VERSION } from "@/lib/parent-signatures/form-definitions";
import type { ParentSignatureFormContent, ParentSignatureFormTypeValue } from "@/lib/parent-signatures/types";
import type { ActionResult } from "@/lib/actions/students";
import {
  buildParentSignatureChildStatus,
  type ParentSignatureAssignmentContext,
  type ParentSignatureChildStatusRow,
} from "@/lib/parent-signatures/status";

// Stage 2 read surface (which children are missing which forms) plus Stage 3
// writes (submitting a signed form - signature image to Supabase Storage,
// TeachingPracticeSignedForm row to the DB). Still no PDF generation
// (signedPdfPath stays null - Stage 4).

export interface ParentSignatureStatusResult {
  courseCycle: string;
  children: ParentSignatureChildStatusRow[];
}

// Same convention as getInstructorForAssignmentWrite in
// lib/actions/teaching-practice.ts: instructors have no NextAuth session, so
// permission is always re-verified by re-reading the instructor row fresh
// from a client-supplied instructorId, never trusted from stored client
// state. canManageChildSignatures gates this read (not just future writes) -
// unlike teaching practice scheduling, this surface exposes parent contact
// details and (once Stage 3 lands) medical notes, so it stays behind its own
// permission rather than being view-open to every active instructor.
async function getInstructorForSignatureRead(instructorId: string) {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageChildSignatures) {
    return null;
  }
  return instructor;
}

// Loads every active child's Teaching Practice assignments (all lessons,
// published or not - this is an internal staff readiness view, not the
// trainee-facing surface), groups them per child, and resolves each child's
// required forms against their ACTIVE TeachingPracticeSignedForm rows for
// the current course cycle. Shared by both the admin and instructor entry
// points below - the permission check happens before this is ever called.
async function loadParentSignatureStatusInternal(): Promise<ParentSignatureStatusResult> {
  const courseCycle = CURRENT_TEACHING_PRACTICE_COURSE_CYCLE;

  const assignments = await prisma.teachingPracticeChildAssignment.findMany({
    where: { child: { isActive: true } },
    select: {
      childId: true,
      child: {
        select: { fullName: true, age: true, parentName: true, parentPhone: true },
      },
      lesson: {
        select: { id: true, date: true, practiceType: true, groupName: true },
      },
    },
    orderBy: [{ lesson: { date: "asc" } }],
  });

  if (assignments.length === 0) {
    return { courseCycle, children: [] };
  }

  const childIds = Array.from(new Set(assignments.map((a) => a.childId)));

  const signedForms = await prisma.teachingPracticeSignedForm.findMany({
    where: { childId: { in: childIds }, courseCycle, status: "ACTIVE" },
    select: { id: true, childId: true, formType: true, signedAt: true },
  });

  const signedByChild = new Map<string, typeof signedForms>();
  for (const form of signedForms) {
    const list = signedByChild.get(form.childId);
    if (list) {
      list.push(form);
    } else {
      signedByChild.set(form.childId, [form]);
    }
  }

  interface ChildAccumulator {
    childId: string;
    childName: string;
    childAge: number | null;
    parentName: string | null;
    parentPhone: string | null;
    assignments: ParentSignatureAssignmentContext[];
  }

  const byChild = new Map<string, ChildAccumulator>();
  for (const a of assignments) {
    const assignmentContext: ParentSignatureAssignmentContext = {
      lessonId: a.lesson.id,
      date: dateKey(a.lesson.date),
      practiceType: a.lesson.practiceType,
      groupName: a.lesson.groupName,
    };
    const existing = byChild.get(a.childId);
    if (existing) {
      existing.assignments.push(assignmentContext);
    } else {
      byChild.set(a.childId, {
        childId: a.childId,
        childName: a.child.fullName,
        childAge: a.child.age,
        parentName: a.child.parentName,
        parentPhone: a.child.parentPhone,
        assignments: [assignmentContext],
      });
    }
  }

  const children = Array.from(byChild.values())
    .map((child) =>
      buildParentSignatureChildStatus({
        ...child,
        activeSignedForms: signedByChild.get(child.childId) ?? [],
      })
    )
    .sort((a, b) => a.childName.localeCompare(b.childName, "he"));

  return { courseCycle, children };
}

export async function getParentSignatureStatusForAdmin(): Promise<ParentSignatureStatusResult> {
  await requireAdmin();
  return loadParentSignatureStatusInternal();
}

export async function getParentSignatureStatusForInstructor(
  instructorId: string
): Promise<ParentSignatureStatusResult> {
  const instructor = await getInstructorForSignatureRead(instructorId);
  if (!instructor) {
    return { courseCycle: CURRENT_TEACHING_PRACTICE_COURSE_CYCLE, children: [] };
  }
  return loadParentSignatureStatusInternal();
}

// ---------------------------------------------------------------------------
// Submit a signed form (Stage 3) - write
// ---------------------------------------------------------------------------

export interface ParentSignatureSubmitInput {
  childId: string;
  formType: ParentSignatureFormTypeValue;
  // Not applicable to SAFETY_INSTRUCTIONS (no address/photoConsent field on
  // that source form) - ignored/stored null regardless of what's passed.
  address?: string | null;
  parentEmail?: string | null;
  // Only applicable to SAFETY_INSTRUCTIONS - ignored/stored null for the two
  // consent forms, which have no medical-notes field.
  medicalNotes?: string | null;
  // Required for LUNGE_CONSENT/BEGINNER_LESSON_CONSENT (their "אני מסכים/
  // לא מסכים שתמונות..." line), ignored for SAFETY_INSTRUCTIONS.
  photoConsent?: boolean | null;
  signerName: string;
  signerRole?: string | null;
  // A "data:image/png;base64,...." data URL from the on-screen signature
  // canvas - see lib/components/SignatureCanvas.tsx.
  signatureDataUrl: string;
}

export interface ParentSignatureSubmitResult extends ActionResult {
  signedFormId?: string;
}

const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Defensive floor only - not a real "did they actually draw a signature"
// check (that would need pixel inspection, out of scope for this stage).
// The UI enforces the real "signature required" rule by disabling submit
// until the canvas has recorded at least one stroke; this just rejects an
// obviously-empty/garbage payload if that client-side guard is ever bypassed.
const MIN_SIGNATURE_BYTES = 100;
// The signature canvas (lib/components/SignatureCanvas.tsx) renders at a
// small fixed internal resolution specifically so its exported PNG never
// approaches this - this is a defensive ceiling against a malicious/
// tampered payload, not a limit real signatures are expected to bump into.
// Signature images must stay small: only a storage path is ever written to
// Postgres (never the base64 data itself), and Stage 4's PDF generation is
// expected to embed this one small image alongside text-based PDF content,
// not a raster screenshot of the whole form.
const MAX_SIGNATURE_BYTES = 300 * 1024;

function decodeSignaturePng(dataUrl: string): Buffer | null {
  const match = /^data:image\/png;base64,([a-zA-Z0-9+/]+=*)$/.exec(dataUrl.trim());
  if (!match) return null;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
  if (buffer.length < MIN_SIGNATURE_BYTES || buffer.length > MAX_SIGNATURE_BYTES) return null;
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC_BYTES)) return null;
  return buffer;
}

type ParentSignatureCollector =
  | { kind: "instructor"; instructorId: string }
  | { kind: "admin"; email: string; name: string | null };

// Shared by both entry points below - the permission check (instructor
// canManageChildSignatures re-check, or requireAdmin()) always happens
// before this is ever called, never inside it.
async function submitParentSignatureInternal(
  input: ParentSignatureSubmitInput,
  collector: ParentSignatureCollector
): Promise<ParentSignatureSubmitResult> {
  const formType = input.formType;
  const content = getFormContent(formType, CURRENT_FORM_VERSION[formType]);
  if (!content) {
    return { success: false, error: "סוג טופס לא תקין" };
  }

  const signerName = input.signerName.trim();
  if (!signerName) {
    return { success: false, error: "יש להזין שם חותם/ת" };
  }

  const isSafety = formType === "SAFETY_INSTRUCTIONS";
  const signerRole = input.signerRole?.trim() || null;
  if (isSafety && !signerRole) {
    return { success: false, error: "יש לבחור מי חותם/ת (הרוכב/ה או ההורה)" };
  }

  // Per-form-type field applicability - mirrors the source documents exactly
  // (see lib/parent-signatures/form-definitions.ts): SAFETY_INSTRUCTIONS has
  // no address/photoConsent field and the two consent forms have no
  // medical-notes field, so each irrelevant field is force-nulled here
  // rather than trusting whatever the client happened to send.
  let address: string | null = null;
  let parentEmail: string | null = null;
  let medicalNotes: string | null = null;
  let photoConsent: boolean | null = null;

  if (isSafety) {
    medicalNotes = input.medicalNotes?.trim() || null;
  } else {
    address = input.address?.trim() || null;
    if (!address) {
      return { success: false, error: "יש להזין כתובת" };
    }
    parentEmail = input.parentEmail?.trim() || null;
    if (input.photoConsent === null || input.photoConsent === undefined) {
      return { success: false, error: "יש לבחור הסכמה או אי-הסכמה לצילום" };
    }
    photoConsent = input.photoConsent;
  }

  const signatureBuffer = decodeSignaturePng(input.signatureDataUrl);
  if (!signatureBuffer) {
    return { success: false, error: "חתימה חסרה או לא תקינה" };
  }

  const child = await prisma.teachingPracticeChild.findUnique({ where: { id: input.childId } });
  if (!child || !child.isActive) {
    return { success: false, error: "הילד/ה לא נמצא/ת" };
  }

  // formType must actually be required for this child right now - derived
  // fresh from their current assignments, same rule as
  // buildParentSignatureChildStatus (lib/parent-signatures/status.ts) uses
  // for the status list, so a form can never be signed here that wouldn't
  // even show up as required there.
  const assignments = await prisma.teachingPracticeChildAssignment.findMany({
    where: { childId: child.id },
    select: { lesson: { select: { practiceType: true } } },
  });
  const practiceTypes = Array.from(new Set(assignments.map((a) => a.lesson.practiceType)));
  const requiredFormTypes = new Set(practiceTypes.flatMap(requiredParentSignatureFormTypes));
  if (!requiredFormTypes.has(formType)) {
    return { success: false, error: "טופס זה אינו נדרש עבור ילד/ה זו" };
  }

  const courseCycle = CURRENT_TEACHING_PRACTICE_COURSE_CYCLE;
  const signedFormId = crypto.randomUUID();
  const storagePath = buildParentSignatureImagePath({
    courseCycle,
    childId: child.id,
    formType,
    signedFormId,
  });

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { success: false, error: "אחסון החתימות אינו מוגדר כראוי בשרת (חסרים משתני סביבה)" };
  }

  const { error: uploadError } = await supabase.storage
    .from(PARENT_SIGNATURES_BUCKET)
    .upload(storagePath, signatureBuffer, { contentType: "image/png", upsert: true });
  if (uploadError) {
    return { success: false, error: "העלאת החתימה לאחסון נכשלה" };
  }

  // Safe replace: an existing ACTIVE row for the same child+formType+
  // courseCycle is revoked (never deleted) inside the same transaction that
  // creates the new ACTIVE row, so the DB never has zero or two ACTIVE rows
  // for that key at once - matches the partial unique index added in Stage
  // 1 (teaching_practice_signed_forms_child_form_cycle_active_key).
  const existingActive = await prisma.teachingPracticeSignedForm.findFirst({
    where: { childId: child.id, formType, courseCycle, status: "ACTIVE" },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    if (existingActive) {
      await tx.teachingPracticeSignedForm.update({
        where: { id: existingActive.id },
        data: { status: "REVOKED" },
      });
    }
    await tx.teachingPracticeSignedForm.create({
      data: {
        id: signedFormId,
        childId: child.id,
        formType,
        courseCycle,
        // Snapshots taken fresh from the DB right now - never trusted from
        // client input (see model comment in prisma/schema.prisma).
        childNameSnapshot: child.fullName,
        childAgeSnapshot: child.age,
        parentNameSnapshot: child.parentName,
        parentPhoneSnapshot: child.parentPhone,
        parentEmail,
        address,
        medicalNotes,
        photoConsent,
        signerName,
        signerRole,
        signatureDataPath: storagePath,
        signedPdfPath: null,
        formVersion: CURRENT_FORM_VERSION[formType],
        signedAt: new Date(),
        collectedByInstructorId: collector.kind === "instructor" ? collector.instructorId : null,
        collectedByAdminEmail: collector.kind === "admin" ? collector.email : null,
        collectedByAdminName: collector.kind === "admin" ? collector.name : null,
        status: "ACTIVE",
      },
    });
  });

  revalidatePath("/admin/parent-signatures");
  revalidatePath("/instructor");

  return { success: true, signedFormId };
}

export async function submitTeachingPracticeSignedFormAsInstructor(
  instructorId: string,
  input: ParentSignatureSubmitInput
): Promise<ParentSignatureSubmitResult> {
  const instructor = await getInstructorForSignatureRead(instructorId);
  if (!instructor) {
    return { success: false, error: "אין הרשאה לנהל חתימות ילדים" };
  }
  return submitParentSignatureInternal(input, { kind: "instructor", instructorId: instructor.id });
}

export async function submitTeachingPracticeSignedFormAsAdmin(
  input: ParentSignatureSubmitInput
): Promise<ParentSignatureSubmitResult> {
  const admin = await requireAdmin();
  return submitParentSignatureInternal(input, { kind: "admin", email: admin.email, name: admin.name });
}

// ---------------------------------------------------------------------------
// View a signed form (Stage 4 alternative) - read, no PDF
// ---------------------------------------------------------------------------

// Deliberately much shorter than course-booklet.ts/materials.ts's 1-hour TTL
// - those are long-lived documents meant to stay openable for a while; a
// signature image is only ever needed for the few seconds a single viewer
// modal is open, so a short expiry limits how long a leaked/cached URL
// could possibly work.
const SIGNATURE_VIEW_URL_TTL_SECONDS = 10 * 60; // 10 minutes

// Everything the in-app viewer needs to reconstruct the signed form on
// screen - full form content (from form-definitions.ts, never summarized),
// every field snapshot actually collected at signing time, and a short-lived
// signed URL for the signature image (never a public URL, and never the raw
// Storage path - the parent-signatures bucket stays private; see
// lib/supabase.ts). No signedPdfPath field here - this stage never
// generates or reads a PDF.
export interface ParentSignatureViewerData {
  signedFormId: string;
  formType: ParentSignatureFormTypeValue;
  formVersion: string;
  courseCycle: string;
  signedAt: string;
  content: ParentSignatureFormContent;
  childNameSnapshot: string;
  childAgeSnapshot: number | null;
  parentNameSnapshot: string | null;
  parentPhoneSnapshot: string | null;
  parentEmail: string | null;
  address: string | null;
  medicalNotes: string | null;
  photoConsent: boolean | null;
  signerName: string;
  signerRole: string | null;
  // null if the Storage object/bucket is unreachable (e.g. Supabase env vars
  // missing) - the viewer still renders every other field in that case,
  // just without the signature image.
  signatureUrl: string | null;
}

// Shared by both entry points below - permission check always happens
// before this is ever called. Only ever resolves an ACTIVE row (a REVOKED
// form has no viewer in this stage - "history" UI is explicitly out of
// scope) and returns null for anything that doesn't resolve cleanly
// (missing row, wrong status, or a formType/formVersion combination that
// no longer has a content entry) rather than throwing, so the UI can show a
// plain "not available" state.
async function loadSignedFormViewerDataInternal(
  signedFormId: string
): Promise<ParentSignatureViewerData | null> {
  const form = await prisma.teachingPracticeSignedForm.findUnique({ where: { id: signedFormId } });
  if (!form || form.status !== "ACTIVE") return null;

  const content = getFormContent(form.formType, form.formVersion);
  if (!content) return null;

  let signatureUrl: string | null = null;
  if (form.signatureDataPath) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data } = await supabase.storage
        .from(PARENT_SIGNATURES_BUCKET)
        .createSignedUrl(form.signatureDataPath, SIGNATURE_VIEW_URL_TTL_SECONDS);
      signatureUrl = data?.signedUrl ?? null;
    }
  }

  return {
    signedFormId: form.id,
    formType: form.formType,
    formVersion: form.formVersion,
    courseCycle: form.courseCycle,
    signedAt: form.signedAt.toISOString(),
    content,
    childNameSnapshot: form.childNameSnapshot,
    childAgeSnapshot: form.childAgeSnapshot,
    parentNameSnapshot: form.parentNameSnapshot,
    parentPhoneSnapshot: form.parentPhoneSnapshot,
    parentEmail: form.parentEmail,
    address: form.address,
    medicalNotes: form.medicalNotes,
    photoConsent: form.photoConsent,
    signerName: form.signerName,
    signerRole: form.signerRole,
    signatureUrl,
  };
}

export async function getTeachingPracticeSignedFormForAdmin(
  signedFormId: string
): Promise<ParentSignatureViewerData | null> {
  await requireAdmin();
  return loadSignedFormViewerDataInternal(signedFormId);
}

export async function getTeachingPracticeSignedFormForInstructor(
  instructorId: string,
  signedFormId: string
): Promise<ParentSignatureViewerData | null> {
  const instructor = await getInstructorForSignatureRead(instructorId);
  if (!instructor) return null;
  return loadSignedFormViewerDataInternal(signedFormId);
}
