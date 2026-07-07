"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// A free-text input with a lightweight, self-contained suggestions dropdown -
// used instead of the native <input list> + <datalist> combo, which has
// spotty/inconsistent support (notably on mobile Safari) and doesn't
// reliably show Hebrew suggestions everywhere. Typing a value not in
// `suggestions` is always allowed and never blocked; clicking a suggestion
// just fills the input, it doesn't "select" anything exclusive. Shared by
// HorseFeedingSection (hay/concentrate types) and the riding lesson note
// editor (lesson topic, session horse).
export function SuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q
      ? suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      : suggestions;
    return list.slice(0, 8);
  }, [value, suggestions]);

  return (
    <div ref={containerRef} className="relative min-w-0 w-full">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm"
      />
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(s);
                setIsOpen(false);
              }}
              className="block w-full px-3 py-2 text-right text-sm hover:bg-muted"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
