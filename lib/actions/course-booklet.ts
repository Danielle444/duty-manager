"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getSupabaseClient, COURSE_BOOKLET_BUCKET } from "@/lib/supabase";
import type { ActionResult } from "@/lib/actions/students";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export interface CourseBookletAccess {
  fileName: string;
  uploadedAt: string;
  viewUrl: string;
  downloadUrl: string;
}

// Read-only, no auth gate - used by /student and /instructor. Returns null
// whenever there's no booklet, or Supabase isn't configured/reachable, so
// the UI always degrades to "not available yet" instead of crashing.
export async function getBookletAccess(): Promise<CourseBookletAccess | null> {
  const row = await prisma.courseBooklet.findUnique({ where: { id: 1 } });
  if (!row) return null;

  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const [viewResult, downloadResult] = await Promise.all([
    supabase.storage
      .from(COURSE_BOOKLET_BUCKET)
      .createSignedUrl(row.storagePath, SIGNED_URL_TTL_SECONDS),
    supabase.storage
      .from(COURSE_BOOKLET_BUCKET)
      .createSignedUrl(row.storagePath, SIGNED_URL_TTL_SECONDS, { download: row.fileName }),
  ]);

  if (!viewResult.data || !downloadResult.data) return null;

  return {
    fileName: row.fileName,
    uploadedAt: row.uploadedAt.toISOString(),
    viewUrl: viewResult.data.signedUrl,
    downloadUrl: downloadResult.data.signedUrl,
  };
}

// --- Admin-only below. Page-level gating on /admin/course-booklet is NOT the
// authorization boundary: a "use server" export is reachable directly, so the
// action enforces requireAdmin() itself. Uploading the PDF itself is handled by
// app/api/admin/course-booklet/upload/route.ts, not a Server Action - see that
// file for why.

export async function removeCourseBooklet(): Promise<ActionResult> {
  // ADMIN-WRITE-A1: authorize before reading the booklet row, before the
  // Supabase Storage object delete, and before the database row delete.
  await requireAdmin();

  const row = await prisma.courseBooklet.findUnique({ where: { id: 1 } });
  if (!row) return { success: true };

  const supabase = getSupabaseClient();
  if (supabase) {
    await supabase.storage.from(COURSE_BOOKLET_BUCKET).remove([row.storagePath]);
  }

  await prisma.courseBooklet.delete({ where: { id: 1 } });

  revalidatePath("/admin/course-booklet");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true };
}
