import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only: this must only ever be imported from "use server" action
// files. SUPABASE_SERVICE_ROLE_KEY bypasses RLS and must never reach the
// client bundle.
export const COURSE_BOOKLET_BUCKET = "course-booklets";
export const COURSE_BOOKLET_STORAGE_PATH = "current.pdf";

// Separate bucket from the booklet's - materials are many rows, each with
// its own path (${materialId}/${sanitizedFileName}), not a single fixed path.
export const COURSE_MATERIALS_BUCKET = "course-materials";

// Signature images for the Teaching Practice parent-signature feature (see
// lib/actions/parent-signatures.ts) - one PNG per signed form, path
// "{courseCycle}/{childId}/{formType}/{signedFormId}-signature.png" (see
// lib/parent-signatures/storage-path.ts). Private, same as the other two
// buckets - never made public, no signed URLs generated yet (Stage 3 has no
// download/preview UI for these).
export const PARENT_SIGNATURES_BUCKET = "parent-signatures";

let cachedClient: SupabaseClient | null | undefined;

// Returns null (rather than throwing) whenever Supabase isn't configured,
// so every caller can degrade gracefully instead of crashing a page.
export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    cachedClient = null;
    return null;
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
