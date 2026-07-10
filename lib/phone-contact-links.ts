// Pure, DB-free, JSX-free helpers for turning a free-text phone number
// (Teaching Practice child.parentPhone is stored as free text - no
// type="tel", no stored-format validation anywhere it's entered, see the
// child create/edit form in lib/components/TeachingPracticeManager.tsx)
// into a tel:/WhatsApp link at display time. Never touches stored data -
// this only ever derives a link from whatever's already there. A number
// that doesn't look like a plausible Israeli number simply yields null
// (never a broken link) - callers must keep showing the raw phone text
// regardless of whether these return a link.

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

// Returns E.164 digits (country code + 9-digit subscriber number, no
// leading zero, no "+") for a plausible Israeli number, or null otherwise.
// Handles local numbers with a leading 0 ("0501234567", "050-1234567",
// "050 123 4567" - all reduce to the same digits once non-digits are
// stripped) and already-international numbers with a leading 972
// ("972501234567", "+972501234567"). Anything else - too short/long,
// doesn't start with 0 or 972 - is treated as not safely normalizable
// rather than guessed at.
export function toIsraeliInternationalDigits(phone: string): string | null {
  const digits = digitsOnly(phone);
  if (!digits) return null;

  if (digits.startsWith("972")) {
    const subscriber = digits.slice(3);
    return subscriber.length === 9 ? `972${subscriber}` : null;
  }
  if (digits.startsWith("0")) {
    const subscriber = digits.slice(1);
    return subscriber.length === 9 ? `972${subscriber}` : null;
  }
  return null;
}

export function buildTelLink(phone: string): string | null {
  const intl = toIsraeliInternationalDigits(phone);
  return intl ? `tel:+${intl}` : null;
}

export function buildWhatsAppLink(phone: string): string | null {
  const intl = toIsraeliInternationalDigits(phone);
  return intl ? `https://wa.me/${intl}` : null;
}
