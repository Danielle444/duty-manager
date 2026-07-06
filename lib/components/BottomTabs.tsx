"use client";

import type { ReactNode } from "react";

export type MainTabId =
  | "today"
  | "schedule"
  | "duties"
  | "booklet"
  | "profile"
  | "horses"
  | "messages"
  | "contacts"
  | "materials"
  | "attendance"
  | "riding"
  | "more";

export const MAIN_TABS: { id: MainTabId; label: string }[] = [
  { id: "today", label: "היום" },
  { id: "schedule", label: 'לו"ז' },
  { id: "duties", label: "תורנויות" },
  { id: "booklet", label: "חוברת קורס" },
  { id: "profile", label: "פרופיל" },
];

// One simple stroke icon per tab, so the bar is scannable at a glance and
// not just a row of similar-looking text buttons. MainTabId is a small
// closed union, so a plain Record covers every case with no runtime
// fallback branch needed.
const TAB_ICON_PATHS: Record<MainTabId, ReactNode> = {
  today: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
    </>
  ),
  schedule: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  duties: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 11h6M9 15h6" />
    </>
  ),
  booklet: <path d="M4 5c2-1 5-1 7 0v14c-2-1-5-1-7 0V5zM20 5c-2-1-5-1-7 0v14c2-1 5-1 7 0V5z" />,
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
  horses: (
    <>
      <path d="M6 20v-6a6 6 0 1 1 12 0v6" />
      <circle cx="6" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </>
  ),
  messages: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="3" />
      <path d="M8 17l-2 3v-3" />
    </>
  ),
  contacts: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8" cy="12" r="2" />
      <path d="M13 10h6M13 14h4" />
    </>
  ),
  materials: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />,
  attendance: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  riding: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
    </>
  ),
};

// Renders one tab's icon on its own, so other screens (e.g. an instructor
// home-screen shortcut grid) can show the same icon set without duplicating
// the path data or adding an icon library.
export function TabIcon({ id, className = "h-5 w-5" }: { id: MainTabId; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {TAB_ICON_PATHS[id]}
    </svg>
  );
}

export function BottomTabs({
  active,
  onChange,
  tabs = MAIN_TABS,
}: {
  active: MainTabId;
  onChange: (id: MainTabId) => void;
  tabs?: { id: MainTabId; label: string }[];
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-lg overflow-hidden border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
      aria-label="ניווט ראשי"
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-[68px] flex-col items-center justify-center gap-1 px-1 py-2.5 text-center transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground active:bg-muted"
              }`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  isActive ? "bg-primary/10" : ""
                }`}
              >
                <TabIcon id={tab.id} />
              </span>
              <span
                className={`max-w-full truncate text-xs leading-tight ${
                  isActive ? "font-bold" : "font-medium"
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
