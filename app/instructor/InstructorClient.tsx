"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Logo } from "@/lib/components/Logo";
import { WeekDayPicker, type WeekOption } from "@/lib/components/WeekDayPicker";
import { BottomTabs, TabIcon, type MainTabId } from "@/lib/components/BottomTabs";
import { CourseMaterialsSection } from "@/lib/components/CourseMaterialsSection";
import {
  getInstructorProfile,
  searchInstructors,
  verifyInstructorLogin,
  type InstructorSearchResult,
} from "@/lib/actions/instructor-auth";
import { getWeeklyScheduleSelection } from "@/lib/actions/weekly-schedule";
import {
  getRidingAssignmentSummaryForInstructor,
  type InstructorRidingAssignmentSummary,
} from "@/lib/actions/riding-assignment-summary";
import { InstructorScheduleSection } from "@/app/instructor/InstructorScheduleSection";
import { InstructorDutiesSection } from "@/app/instructor/InstructorDutiesSection";
import { InstructorHorsesSection } from "@/app/instructor/InstructorHorsesSection";
import { InstructorMessagesSection } from "@/app/instructor/InstructorMessagesSection";
import { InstructorAttendanceSection } from "@/app/instructor/InstructorAttendanceSection";
import { InstructorRidingSlotsSection } from "@/app/instructor/InstructorRidingSlotsSection";
import { ContactsSection } from "@/lib/components/ContactsSection";
import { HelpContent } from "@/lib/components/HelpContent";
import { NotificationsList } from "@/lib/components/NotificationsList";
import {
  getNotificationsForInstructor,
  markNotificationReadAsInstructor,
} from "@/lib/actions/notifications";
import {
  formatHebrewDate,
  formatHebrewWeekday,
  getDefaultDayFilter,
  getLocalDateKey,
  parseDateKey,
} from "@/lib/dates";

const STORAGE_KEY = "duty-manager-instructor-v2";

// Instructor has its own 6 main bottom tabs (independent of the student
// MAIN_TABS, which stays untouched) plus a "more" menu for lower-frequency
// sections. "riding" ("רכיבות") was promoted from "more" to a main tab since
// instructors use it often enough that burying it under "עוד" was
// inconvenient - it's used here, never redefined or duplicated.
const INSTRUCTOR_MAIN_TABS: { id: MainTabId; label: string }[] = [
  { id: "today", label: "היום" },
  { id: "schedule", label: 'לו"ז' },
  { id: "duties", label: "תורנויות" },
  { id: "horses", label: "סוסים" },
  { id: "riding", label: "רכיבות" },
  { id: "more", label: "עוד" },
];

const INSTRUCTOR_MORE_ITEMS: { id: MainTabId; label: string }[] = [
  { id: "profile", label: "פרופיל" },
  { id: "attendance", label: "נוכחות" },
  { id: "messages", label: "הודעות ומשימות" },
  { id: "contacts", label: "אנשי קשר" },
  { id: "materials", label: "חומרי קורס" },
  { id: "notifications", label: "עדכונים" },
  { id: "help", label: "עזרה" },
];

const INSTRUCTOR_ALL_TABS = [...INSTRUCTOR_MAIN_TABS, ...INSTRUCTOR_MORE_ITEMS];

// Shortcut grid shown on the "today" home screen - covers every instructor
// section except "today" itself (navigating to the screen you're already on
// would be a dead click) and "more" (that's a menu, not a destination).
// Each button just calls setActiveTab, exactly like the bottom tabs and the
// "more" menu buttons already do - these are navigation shortcuts only,
// they unlock nothing new, and the destination sections enforce their own
// permissions server-side regardless of how the instructor got there.
// Kept as two constants purely for readability of this file - both render
// together in one flat, compact grid (see homeShortcuts below), not as
// separate labeled sections, to keep the home screen's quick-nav area small.
const INSTRUCTOR_ACTIVITY_SHORTCUTS: { id: MainTabId; label: string }[] = [
  { id: "riding", label: "רכיבות" },
  { id: "schedule", label: 'לו"ז' },
  { id: "duties", label: "תורנויות" },
  { id: "horses", label: "סוסים" },
];

const INSTRUCTOR_INFO_SHORTCUTS: { id: MainTabId; label: string }[] = [
  { id: "messages", label: "הודעות ומשימות" },
  { id: "contacts", label: "אנשי קשר" },
  { id: "materials", label: "חומרי קורס" },
  { id: "attendance", label: "נוכחות" },
  { id: "profile", label: "פרופיל" },
];

interface StoredSession {
  id: string;
  fullName: string;
  canEditHorseAssignments: boolean;
  canSendMessages: boolean;
  canEditAttendance: boolean;
  canEditRidingNotes: boolean;
  canEditHorseFeeding: boolean;
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
  // Shown on the login screen after a background refresh discovers the
  // stored account is no longer valid (deactivated/deleted) and clears it.
  const [sessionInvalidMessage, setSessionInvalidMessage] = useState<string | null>(null);
  // Small non-blocking notice for a failed background refresh (network/DB
  // hiccup) - the existing stored session is deliberately left alone here,
  // this never forces a logout.
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<MainTabId>("today");
  const [weeks, setWeeks] = useState<WeekOption[] | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | "all">("all");
  const [ridingSummary, setRidingSummary] = useState<InstructorRidingAssignmentSummary | null>(null);

  // Recomputed every minute (not just once at mount) so "today" rolls over
  // to the new local day on its own if the app is left open across
  // midnight, instead of staying frozen on the day the page first loaded.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

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
    getInstructorProfile(session.id)
      .then((profile) => {
        if (cancelled) return;
        if (!profile) {
          // Account deactivated/deleted since it was last stored - the
          // stale session must not keep rendering the full app, so it's
          // cleared here rather than silently left in place.
          window.localStorage.removeItem(STORAGE_KEY);
          setSession(null);
          setSessionInvalidMessage("המשתמש/ת אינו/ה פעיל/ה יותר - יש להתחבר מחדש");
          return;
        }
        setRefreshError(null);
        setSession(profile);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      })
      .catch(() => {
        // Network/server hiccup - never log the user out for this; the
        // already-stored session keeps being used as-is.
        if (cancelled) return;
        setRefreshError("לא ניתן היה לרענן את פרטי המשתמש כרגע");
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
      const defaultWeek = sel.weeks.find((w) => w.id === sel.defaultWeekId) ?? null;
      setDayFilter(getDefaultDayFilter(defaultWeek, getLocalDateKey()));
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session || !weeks) return;
    const currentWeek =
      weeks.find((w) => w.startDate <= getLocalDateKey() && getLocalDateKey() <= w.endDate) ?? null;
    if (!currentWeek) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRidingSummary(null);
      return;
    }
    let cancelled = false;
    getRidingAssignmentSummaryForInstructor(session.id, currentWeek.startDate, currentWeek.endDate).then(
      (summary) => {
        if (!cancelled) setRidingSummary(summary);
      }
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, weeks]);

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
      setSessionInvalidMessage(null);
    });
  }

  function handleSwitch() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setSelected(null);
    setQuery("");
    setActiveTab("today");
    setSessionInvalidMessage(null);
    setRefreshError(null);
  }

  if (!hydrated) return null;

  if (!session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
        <Logo width={220} className="h-auto w-full max-w-[220px]" />
        <div className="-mt-4 text-center">
          <p className="text-lg font-bold tracking-tight text-card-foreground">Double K Top</p>
          <p className="text-sm font-semibold text-muted-foreground">קורס מדריכים · אזור מדריכים</p>
        </div>
        <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-2xl font-bold text-card-foreground">כניסת מדריך/ה</h1>
          <p className="mb-4 text-base text-muted-foreground">
            הקלידו את שמכם ובחרו אותו מהרשימה
          </p>

          {sessionInvalidMessage && (
            <p className="mb-4 rounded-lg bg-danger-muted p-3 text-sm text-danger">
              {sessionInvalidMessage}
            </p>
          )}

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

  const todayKey = getLocalDateKey(now);
  const todayWeek = weeks?.find((w) => w.startDate <= todayKey && todayKey <= w.endDate) ?? null;

  const activeTabLabel = INSTRUCTOR_ALL_TABS.find((t) => t.id === activeTab)?.label ?? "";
  const isMoreItem = INSTRUCTOR_MORE_ITEMS.some((item) => item.id === activeTab);
  const bottomActiveTab: MainTabId = isMoreItem ? "more" : activeTab;

  // One flat, compact quick-nav grid instead of two labeled groups - "שליחת
  // הודעה/משימה" navigates to the exact same "messages" tab as "הודעות
  // ומשימות" and is just one more entry here, gated behind the same
  // canSendMessages permission the old standalone button used.
  const homeShortcuts: { id: MainTabId; label: string }[] = [
    ...INSTRUCTOR_ACTIVITY_SHORTCUTS,
    ...INSTRUCTOR_INFO_SHORTCUTS,
    ...(session.canSendMessages ? [{ id: "messages" as MainTabId, label: "שליחת הודעה/משימה" }] : []),
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-border bg-card px-4 py-3 shadow-sm">
        <Logo variant="mark" width={36} className="shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-muted-foreground">
            Double K Top · אזור מדריכים
          </p>
          <p className="truncate text-base font-bold text-card-foreground">{activeTabLabel}</p>
        </div>
      </header>

      {refreshError && (
        <p className="bg-warning-muted px-4 py-2 text-center text-xs text-warning">{refreshError}</p>
      )}

      <main className="flex-1 px-4 py-4 pb-28">
        {activeTab === "today" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-sm font-semibold text-muted-foreground">שלום, {session.fullName}</p>
              <p className="text-2xl font-bold tracking-tight text-card-foreground">
                {formatHebrewWeekday(parseDateKey(todayKey))} · {formatHebrewDate(parseDateKey(todayKey))}
              </p>
              {ridingSummary && (
                <p className="mt-2 text-xs text-muted-foreground">
                  רכיבות משובצות השבוע:{" "}
                  <span className="font-semibold text-card-foreground">
                    {ridingSummary.totalAssigned}
                  </span>{" "}
                  · היום: {ridingSummary.todayAssigned} · עתידיות: {ridingSummary.upcomingAssigned} · עברו:{" "}
                  {ridingSummary.pastAssigned}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">מעבר מהיר</p>
              <div className="grid grid-cols-3 gap-1.5">
                {homeShortcuts.map((action) => (
                  <button
                    key={`${action.id}-${action.label}`}
                    type="button"
                    onClick={() => setActiveTab(action.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-2 text-right hover:bg-muted"
                  >
                    <TabIcon id={action.id} className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-card-foreground">
                      {action.label}
                    </span>
                  </button>
                ))}
              </div>
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
                  const week = weeks?.find((w) => w.id === id) ?? null;
                  setDayFilter(getDefaultDayFilter(week, getLocalDateKey()));
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
                  const week = weeks?.find((w) => w.id === id) ?? null;
                  setDayFilter(getDefaultDayFilter(week, getLocalDateKey()));
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
            canEditFeeding={session.canEditHorseFeeding}
          />
        )}

        {activeTab === "more" && (
          <div className="flex flex-col gap-3">
            {INSTRUCTOR_ALL_TABS.filter((item) => item.id !== "more").map((item) => (
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

        {activeTab === "attendance" && (
          <InstructorAttendanceSection
            instructorId={session.id}
            canEdit={session.canEditAttendance}
          />
        )}

        {activeTab === "riding" && (
          <InstructorRidingSlotsSection
            instructorId={session.id}
            canEdit={session.canEditRidingNotes}
            students={students}
          />
        )}

        {activeTab === "messages" && (
          <InstructorMessagesSection
            instructorId={session.id}
            canSend={session.canSendMessages}
            students={students}
          />
        )}

        {activeTab === "contacts" && <ContactsSection />}

        {activeTab === "materials" && <CourseMaterialsSection role="instructor" />}

        {activeTab === "help" && <HelpContent role="instructor" />}

        {activeTab === "notifications" && (
          <NotificationsList
            fetchNotifications={() => getNotificationsForInstructor(session.id)}
            onMarkRead={(notificationId) => markNotificationReadAsInstructor(notificationId, session.id)}
          />
        )}
      </main>

      <BottomTabs active={bottomActiveTab} onChange={setActiveTab} tabs={INSTRUCTOR_MAIN_TABS} />
    </div>
  );
}
