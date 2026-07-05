"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Logo } from "@/lib/components/Logo";
import { WeekDayPicker, type WeekOption } from "@/lib/components/WeekDayPicker";
import { BottomTabs, type MainTabId } from "@/lib/components/BottomTabs";
import { CourseBookletSection } from "@/lib/components/CourseBookletSection";
import {
  getInstructorProfile,
  searchInstructors,
  verifyInstructorLogin,
  type InstructorSearchResult,
} from "@/lib/actions/instructor-auth";
import { getWeeklyScheduleSelection } from "@/lib/actions/weekly-schedule";
import { InstructorScheduleSection } from "@/app/instructor/InstructorScheduleSection";
import { InstructorDutiesSection } from "@/app/instructor/InstructorDutiesSection";
import { InstructorHorsesSection } from "@/app/instructor/InstructorHorsesSection";
import { InstructorMessagesSection } from "@/app/instructor/InstructorMessagesSection";
import { InstructorContactsSection } from "@/app/instructor/InstructorContactsSection";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey, todayDateKey } from "@/lib/dates";

const STORAGE_KEY = "duty-manager-instructor-v2";

// Instructor has its own 5 main bottom tabs (independent of the student
// MAIN_TABS, which stays untouched) plus a "more" menu for lower-frequency
// sections, so the bar doesn't keep growing as instructor features are added.
const INSTRUCTOR_MAIN_TABS: { id: MainTabId; label: string }[] = [
  { id: "today", label: "היום" },
  { id: "schedule", label: 'לו"ז' },
  { id: "duties", label: "תורנויות" },
  { id: "horses", label: "סוסים" },
  { id: "more", label: "עוד" },
];

const INSTRUCTOR_MORE_ITEMS: { id: MainTabId; label: string }[] = [
  { id: "booklet", label: "חוברת קורס" },
  { id: "profile", label: "פרופיל" },
  { id: "messages", label: "הודעות ומשימות" },
  { id: "contacts", label: "אנשי קשר" },
];

const INSTRUCTOR_ALL_TABS = [...INSTRUCTOR_MAIN_TABS, ...INSTRUCTOR_MORE_ITEMS];

interface StoredSession {
  id: string;
  fullName: string;
  canEditHorseAssignments: boolean;
  canSendMessages: boolean;
}

interface StudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

interface DutyTypeOption {
  id: string;
  name: string;
}

export function InstructorClient({
  students,
  dutyTypes,
}: {
  students: StudentOption[];
  dutyTypes: DutyTypeOption[];
}) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InstructorSearchResult[]>([]);
  const [selected, setSelected] = useState<InstructorSearchResult | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<MainTabId>("today");
  const [weeks, setWeeks] = useState<WeekOption[] | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | "all">("all");

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSession(JSON.parse(raw));
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Refresh the profile fields from the DB whenever a session is active -
    // a long-remembered session (or one saved before canEditHorseAssignments
    // existed, or whose permission an admin just changed) would otherwise
    // keep showing stale data. Mirrors StudentClient's profile-refresh effect.
    if (!session) return;
    let cancelled = false;
    getInstructorProfile(session.id).then((profile) => {
      if (cancelled || !profile) return;
      setSession(profile);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getWeeklyScheduleSelection().then((sel) => {
      if (cancelled) return;
      setWeeks(sel.weeks);
      setSelectedWeekId(sel.defaultWeekId);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (selected || query.trim().length < 2) return;
    const timeout = setTimeout(() => {
      startTransition(async () => {
        const found = await searchInstructors(query);
        setResults(found);
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, selected]);

  const visibleResults = selected || query.trim().length < 2 ? [] : results;

  function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    setLoginError(null);
    const formData = new FormData(e.currentTarget);
    const identityNumber = String(formData.get("identityNumber"));
    startTransition(async () => {
      const result = await verifyInstructorLogin(selected.id, identityNumber);
      if (!result.success || !result.instructor) {
        setLoginError(result.error ?? "מספר תעודת זהות שגוי");
        return;
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result.instructor));
      setSession(result.instructor);
    });
  }

  function handleSwitch() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setSelected(null);
    setQuery("");
    setActiveTab("today");
  }

  if (!hydrated) return null;

  if (!session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
        <Logo width={220} />
        <p className="-mt-4 text-sm font-semibold text-muted-foreground">אזור מדריכים</p>
        <div className="w-full rounded-2xl border border-border bg-card p-6">
          <h1 className="mb-1 text-2xl font-bold text-card-foreground">כניסת מדריך/ה</h1>
          <p className="mb-4 text-base text-muted-foreground">
            הקלידו את שמכם ובחרו אותו מהרשימה
          </p>

          {!selected ? (
            <div className="flex flex-col gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="הקלידו שם..."
                className="rounded-xl border border-border px-4 py-3 text-base"
                autoFocus
              />
              {visibleResults.length > 0 && (
                <ul className="overflow-hidden rounded-xl border border-border">
                  {visibleResults.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(s);
                          setLoginError(null);
                        }}
                        className="w-full px-4 py-3 text-right text-base hover:bg-muted"
                      >
                        {s.fullName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3 text-base">
                <span className="font-medium text-card-foreground">{selected.fullName}</span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-sm text-muted-foreground underline"
                >
                  שינוי
                </button>
              </div>
              <label className="flex flex-col gap-1 text-base">
                מספר תעודת זהות
                <input
                  name="identityNumber"
                  inputMode="numeric"
                  required
                  autoFocus
                  className="rounded-xl border border-border px-4 py-3 text-base"
                />
              </label>
              {loginError && <p className="text-base text-danger">{loginError}</p>}
              <Button type="submit" disabled={isPending} className="!py-3 !text-base">
                {isPending ? "מתחבר/ת..." : "כניסה"}
              </Button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const todayKey = todayDateKey();
  const todayWeek = weeks?.find((w) => w.startDate <= todayKey && todayKey <= w.endDate) ?? null;

  const activeTabLabel = INSTRUCTOR_ALL_TABS.find((t) => t.id === activeTab)?.label ?? "";
  const isMoreItem = INSTRUCTOR_MORE_ITEMS.some((item) => item.id === activeTab);
  const bottomActiveTab: MainTabId = isMoreItem ? "more" : activeTab;

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <Logo variant="mark" width={28} />
        <div>
          <p className="text-xs font-semibold text-muted-foreground">אזור מדריכים</p>
          <p className="text-base font-bold text-card-foreground">{activeTabLabel}</p>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 pb-28">
        {activeTab === "today" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-sm font-semibold text-muted-foreground">שלום, {session.fullName}</p>
              <p className="text-xl font-bold text-card-foreground">
                {formatHebrewWeekday(parseDateKey(todayKey))} · {formatHebrewDate(parseDateKey(todayKey))}
              </p>
            </div>

            <InstructorDutiesSection
              weeklyScheduleId={todayWeek?.id ?? null}
              dayFilter={todayKey}
              students={students}
              dutyTypes={dutyTypes}
            />

            {weeks === null ? (
              <p className="text-base text-muted-foreground">טוען...</p>
            ) : todayWeek ? (
              <InstructorScheduleSection
                instructorId={session.id}
                weeklyScheduleId={todayWeek.id}
                dayFilter={todayKey}
              />
            ) : (
              <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
                עדיין לא הועלה לו&quot;ז להיום
              </p>
            )}
          </div>
        )}

        {activeTab === "schedule" && (
          <div className="flex flex-col gap-4">
            {weeks === null ? (
              <p className="text-base text-muted-foreground">טוען...</p>
            ) : (
              <WeekDayPicker
                weeks={weeks}
                selectedWeekId={selectedWeekId}
                onSelectWeek={(id) => {
                  setSelectedWeekId(id);
                  setDayFilter("all");
                }}
                dayFilter={dayFilter}
                onSelectDay={setDayFilter}
              />
            )}
            <InstructorScheduleSection
              instructorId={session.id}
              weeklyScheduleId={selectedWeekId}
              dayFilter={dayFilter}
            />
          </div>
        )}

        {activeTab === "duties" && (
          <div className="flex flex-col gap-4">
            {weeks === null ? (
              <p className="text-base text-muted-foreground">טוען...</p>
            ) : (
              <WeekDayPicker
                weeks={weeks}
                selectedWeekId={selectedWeekId}
                onSelectWeek={(id) => {
                  setSelectedWeekId(id);
                  setDayFilter("all");
                }}
                dayFilter={dayFilter}
                onSelectDay={setDayFilter}
              />
            )}
            <InstructorDutiesSection
              weeklyScheduleId={selectedWeekId}
              dayFilter={dayFilter}
              students={students}
              dutyTypes={dutyTypes}
            />
          </div>
        )}

        {activeTab === "horses" && (
          <InstructorHorsesSection
            instructorId={session.id}
            canEdit={session.canEditHorseAssignments}
          />
        )}

        {activeTab === "more" && (
          <div className="flex flex-col gap-3">
            {INSTRUCTOR_MORE_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className="flex items-center justify-between rounded-2xl border border-border bg-card p-5 text-right"
              >
                <span className="text-lg font-bold text-card-foreground">{item.label}</span>
                <span className="text-muted-foreground">‹</span>
              </button>
            ))}
          </div>
        )}

        {isMoreItem && (
          <button
            type="button"
            onClick={() => setActiveTab("more")}
            className="mb-3 text-sm text-muted-foreground underline"
          >
            ‹ חזרה לתפריט
          </button>
        )}

        {activeTab === "booklet" && <CourseBookletSection />}

        {activeTab === "profile" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="text-sm font-semibold text-muted-foreground">שם מלא</p>
              <p className="text-xl font-bold text-card-foreground">{session.fullName}</p>
            </div>
            <Button variant="secondary" onClick={handleSwitch} className="!py-3 !text-base">
              החלפת מדריך/ה
            </Button>
          </div>
        )}

        {activeTab === "messages" && (
          <InstructorMessagesSection
            instructorId={session.id}
            canSend={session.canSendMessages}
            students={students}
          />
        )}

        {activeTab === "contacts" && <InstructorContactsSection />}
      </main>

      <BottomTabs active={bottomActiveTab} onChange={setActiveTab} tabs={INSTRUCTOR_MAIN_TABS} />
    </div>
  );
}
