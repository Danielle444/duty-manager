// Client-only localStorage draft persistence for the in-progress parent
// signature form (Stage 1 - autosave/recovery only). Deliberately holds only
// the plain text/select fields that carry no attestation meaning on their
// own - never the signature stroke or the acknowledgment checkbox, since
// restoring those as truthy would let a recovered draft look like it was
// already signed. Never imported by any "use server" module: this is
// browser state, not part of the TeachingPracticeSignedForm record.

import type { ParentSignatureFormTypeValue } from "@/lib/parent-signatures/types";

const DRAFT_STORAGE_VERSION = 1;

export interface ParentSignatureDraftFields {
  address: string;
  parentEmail: string;
  medicalNotes: string;
  photoConsent: boolean | null;
  signerName: string;
  signerRole: string;
}

interface StoredParentSignatureDraft {
  storageVersion: number;
  savedAt: string;
  fields: ParentSignatureDraftFields;
}

export interface ParentSignatureDraftKeyParts {
  courseCycle: string;
  childId: string;
  formType: ParentSignatureFormTypeValue;
  formVersion: string;
}

// One draft per exact (courseCycle, childId, formType, formVersion) tuple -
// never a single global key - so a draft can never be offered for the wrong
// child, form, or course cycle.
export function buildDraftKey({
  courseCycle,
  childId,
  formType,
  formVersion,
}: ParentSignatureDraftKeyParts): string {
  return `parentSig:draft:${courseCycle}:${childId}:${formType}:${formVersion}`;
}

function isDraftFields(value: unknown): value is ParentSignatureDraftFields {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.address === "string" &&
    typeof v.parentEmail === "string" &&
    typeof v.medicalNotes === "string" &&
    (v.photoConsent === null || typeof v.photoConsent === "boolean") &&
    typeof v.signerName === "string" &&
    typeof v.signerRole === "string"
  );
}

// Returns null on any missing/malformed/wrong-version data, or when called
// during server rendering (no window) - callers treat null as "no draft to
// offer", never throwing.
export function loadDraft(key: string): ParentSignatureDraftFields | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const stored = parsed as Partial<StoredParentSignatureDraft>;
    if (stored.storageVersion !== DRAFT_STORAGE_VERSION || !isDraftFields(stored.fields)) {
      return null;
    }
    return stored.fields;
  } catch {
    return null;
  }
}

// Returns whether the write succeeded so the caller can surface a "couldn't
// save" indicator without ever throwing (private-browsing/quota errors are
// expected and must not block filling out the form).
export function saveDraft(key: string, fields: ParentSignatureDraftFields): boolean {
  if (typeof window === "undefined") return false;
  try {
    const payload: StoredParentSignatureDraft = {
      storageVersion: DRAFT_STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      fields,
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
