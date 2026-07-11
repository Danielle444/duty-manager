// Pure path-building for the parent-signatures Supabase Storage bucket
// (lib/supabase.ts's PARENT_SIGNATURES_BUCKET) - no DB/Storage access, no
// "use server". Kept separate and pure so the path convention itself is
// easy to verify/reuse - e.g. a later stage's PDF generation will need to
// read the same signature image back by re-deriving this exact path from a
// TeachingPracticeSignedForm row.

// Mirrors the sanitizeFileName() convention already used in
// app/api/admin/materials/upload/route.ts, applied here to courseCycle
// specifically (the only segment that isn't already a safe cuid/enum value -
// courseCycle is a free-text Hebrew label like "קורס מדריכים 2026" and must
// not be trusted verbatim as a Storage path segment).
function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
  return cleaned || "_";
}

export function buildParentSignatureImagePath(params: {
  courseCycle: string;
  childId: string;
  formType: string;
  signedFormId: string;
}): string {
  return [
    sanitizePathSegment(params.courseCycle),
    params.childId,
    params.formType,
    `${params.signedFormId}-signature.png`,
  ].join("/");
}
