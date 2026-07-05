"use client";

export type MainTabId =
  | "today"
  | "schedule"
  | "duties"
  | "booklet"
  | "profile"
  | "horses"
  | "messages"
  | "contacts"
  | "more";

export const MAIN_TABS: { id: MainTabId; label: string }[] = [
  { id: "today", label: "היום" },
  { id: "schedule", label: 'לו"ז' },
  { id: "duties", label: "תורנויות" },
  { id: "booklet", label: "חוברת קורס" },
  { id: "profile", label: "פרופיל" },
];

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
      className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-lg border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
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
              className={`flex min-h-[60px] flex-col items-center justify-center gap-1 border-t-2 px-1 py-2 text-center text-xs font-semibold leading-tight ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
