import { formatDutyDescriptionForDisplay } from "@/lib/duty-description";

// Renders a DutyType.description for display only - splits visually on
// bullet separators/newlines (see formatDutyDescriptionForDisplay) without
// ever changing the underlying text. A single-segment description renders
// as plain text (no bullet), matching how it always looked before; 2+
// segments render as a simple list.
export function DutyDescriptionText({
  description,
  className,
}: {
  description: string | null | undefined;
  className?: string;
}) {
  const parts = formatDutyDescriptionForDisplay(description);
  if (parts.length === 0) return null;

  if (parts.length === 1) {
    return <p className={className}>{parts[0]}</p>;
  }

  return (
    <ul className={`list-disc space-y-0.5 ps-5 ${className ?? ""}`}>
      {parts.map((part, i) => (
        <li key={i}>{part}</li>
      ))}
    </ul>
  );
}
