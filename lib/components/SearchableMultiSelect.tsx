"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export interface SearchableMultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SearchableMultiSelectProps {
  values: string[];
  options: SearchableMultiSelectOption[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
}

// Multi-select sibling of SearchableSelect: same search-to-filter combobox
// interaction, but toggles membership in a `values` array instead of
// replacing a single value. Selected options render as removable chips above
// the search input (always mounted, independent of the dropdown's open
// state) and stay checked in the dropdown list rather than disappearing once
// picked, so several can be chosen in a row without reopening anything.
export function SearchableMultiSelect({
  values,
  options,
  onChange,
  placeholder = "בחר...",
  searchPlaceholder = "הקלידו לחיפוש...",
  emptyMessage = "לא נמצאו תוצאות",
  disabled = false,
  className = "",
}: SearchableMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedOptions = options.filter((o) => values.includes(o.value));

  const filteredOptions = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, searchText]);

  useEffect(() => {
    const firstEnabledIndex = filteredOptions.findIndex((o) => !o.disabled);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightedIndex(firstEnabledIndex === -1 ? 0 : firstEnabledIndex);
  }, [filteredOptions]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchText("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function openDropdown() {
    if (disabled) return;
    setIsOpen(true);
  }

  function closeDropdown() {
    setIsOpen(false);
    setSearchText("");
  }

  function toggleOption(option: SearchableMultiSelectOption) {
    if (option.disabled) return;
    onChange(values.includes(option.value) ? values.filter((v) => v !== option.value) : [...values, option.value]);
  }

  function removeValue(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  function moveHighlight(direction: 1 | -1) {
    if (filteredOptions.length === 0) return;
    setHighlightedIndex((prev) => {
      let next = prev;
      for (let i = 0; i < filteredOptions.length; i++) {
        next = (next + direction + filteredOptions.length) % filteredOptions.length;
        if (!filteredOptions[next]?.disabled) break;
      }
      return next;
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filteredOptions[highlightedIndex];
      if (option) toggleOption(option);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeDropdown();
      inputRef.current?.blur();
    } else if (e.key === "Backspace" && searchText === "" && values.length > 0) {
      // Backspace on an empty search removes the last-selected chip - same
      // quick-undo affordance as native tag inputs.
      removeValue(values[values.length - 1]);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {selectedOptions.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selectedOptions.map((o) => (
            <span
              key={o.value}
              className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
            >
              {o.label}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeValue(o.value)}
                  aria-label={`הסרת ${o.label}`}
                  className="text-secondary-foreground/70 hover:text-secondary-foreground"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-controls={listboxId}
        value={searchText}
        onChange={(e) => {
          if (!isOpen) setIsOpen(true);
          setSearchText(e.target.value);
        }}
        onFocus={openDropdown}
        onBlur={closeDropdown}
        onKeyDown={handleKeyDown}
        placeholder={selectedOptions.length > 0 ? searchPlaceholder : placeholder}
        disabled={disabled}
        autoComplete="off"
        className={`w-full rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50 ${className}`}
      />
      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
        >
          {filteredOptions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</li>
          ) : (
            filteredOptions.map((option, index) => {
              const isSelected = values.includes(option.value);
              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled}
                  // mousedown (not click) fires before the input's onBlur, so
                  // the toggle registers before the click-outside/blur close
                  // logic would otherwise dismiss the dropdown first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    toggleOption(option);
                  }}
                  onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm ${
                    option.disabled
                      ? "cursor-not-allowed text-muted-foreground opacity-60"
                      : `cursor-pointer ${
                          index === highlightedIndex
                            ? "bg-secondary text-secondary-foreground"
                            : "text-card-foreground hover:bg-muted"
                        }`
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                      isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {isSelected ? "✓" : ""}
                  </span>
                  {option.label}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
