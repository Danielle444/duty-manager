// Normalizes to a local "0XXXXXXXXX" Israeli mobile number, or null if the
// input doesn't match a recognizable shape. Never throws.
function normalizeIsraeliMobile(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length === 12 && digits.startsWith("972")) {
    return `0${digits.slice(3)}`;
  }
  if (digits.length === 10 && digits.startsWith("0")) {
    return digits;
  }
  if (digits.length === 9 && !digits.startsWith("0")) {
    return `0${digits}`;
  }
  return null;
}

export function formatPhoneDisplay(phone: string | null | undefined): string {
  const trimmed = phone?.trim();
  if (!trimmed) return "לא הוזן טלפון";

  const normalized = normalizeIsraeliMobile(trimmed);
  if (normalized) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  }

  // Unrecognized shape - show it readably rather than hide it or crash.
  const digits = trimmed.replace(/\D/g, "");
  return digits || trimmed;
}

export function getPhoneHref(phone: string | null | undefined): string | null {
  const normalized = normalizeIsraeliMobile(phone);
  return normalized ? `tel:${normalized}` : null;
}

export function getWhatsAppHref(phone: string | null | undefined): string | null {
  const normalized = normalizeIsraeliMobile(phone);
  return normalized ? `https://wa.me/972${normalized.slice(1)}` : null;
}
