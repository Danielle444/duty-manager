// Pure types for the parent digital-signature forms - no DB access, no
// "use server". Mirrors prisma/schema.prisma's TeachingPracticeSignedFormType
// as a plain string-literal union rather than importing the generated Prisma
// enum, matching the existing convention in lib/teaching-practice-rotation.ts
// (TeachingPracticeTypeValue) of keeping pure/logic modules decoupled from
// the generated Prisma client.

export type ParentSignatureFormTypeValue =
  | "SAFETY_INSTRUCTIONS"
  | "LUNGE_CONSENT"
  | "BEGINNER_LESSON_CONSENT";

// One fill-in-the-blank field from the source form. Descriptive metadata
// only in Stage 1 (no signing UI reads this yet) - key is a stable
// identifier a future form renderer/submit action can key off of; label is
// the exact Hebrew text from the source document.
export interface ParentSignatureFormField {
  key: string;
  label: string;
  required: boolean;
}

// A block of prose exactly as it appears in the source document, rendered in
// order. Bullets are a separate list rather than one-paragraph-per-bullet so
// a future renderer can lay them out as an actual bulleted list.
export interface ParentSignatureFormSection {
  paragraphs?: string[];
  bullets?: string[];
}

// A statement the signer responds to. ACKNOWLEDGMENT statements map to a
// single "I agree" checkbox; YES_NO statements (currently just the photo
// consent line) offer two explicit outcomes and map to a nullable boolean
// field on TeachingPracticeSignedForm (photoConsent).
export interface ParentSignatureConsentStatement {
  key: string;
  text: string;
  responseType: "ACKNOWLEDGMENT" | "YES_NO";
}

// The full content of one form, at one version. Immutable once any
// TeachingPracticeSignedForm.formVersion references it - see
// form-definitions.ts header for the versioning rule.
export interface ParentSignatureFormContent {
  formType: ParentSignatureFormTypeValue;
  formVersion: string;
  title: string;
  introSections: ParentSignatureFormSection[];
  fields: ParentSignatureFormField[];
  consentStatements: ParentSignatureConsentStatement[];
  signerLabel: string;
  dateLabel: string;
}
