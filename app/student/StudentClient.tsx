"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Logo } from "@/lib/components/Logo";
import { WeekDayPicker, type WeekOption } from "@/lib/components/WeekDayPicker";
import { BottomTabs, type MainTabId } from "@/lib/components/BottomTabs";
import { CourseMaterialsSection } from "@/lib/components/CourseMaterialsSection";
import {
  getStudentProfile,
  searchStudents,
  verifyStudentLogin,
  type StudentSearchResult,
} from "@/lib/actions/auth";
import { getWeeklyScheduleSelection } from "@/lib/actions/weekly-schedule";
import { updateOwnPrivateHorseName } from "@/lib/actions/horses";
import { ScheduleSection } from "@/app/student/ScheduleSection";
import { DutiesSection } from "@/app/student/DutiesSection";
import { StudentMessagesSection } from "@/app/student/StudentMessagesSection";
import { StudentMessagesSummary } from "@/app/student/StudentMessagesSummary";
import { ContactsSection } from "@/lib/components/ContactsSection";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey, todayDateKey } from "@/lib/dates";
import { getHorseDisplayInfo } from "@/lib/horse-info";

const STORAGE_KEY = "duty-manager-student";

// Student has its own 5 main bottom tabs (independent of the shared
// MAIN_TABS default, which BottomTabs still falls back to elsewhere) plus a
// "more" menu for lower-frequency sections, mirroring the instructor nav.
// Messages stays a main tab (not under "more") so new tasks/messages are
// noticeable.
const STUDENT_MAIN_TABS: { id: MainTabId; label: string }[] = [
  { id: "today", label: "היום" },
  { id: "schedule", label: 'לו"ז' },
  { id: "duties", label: "תורנויות" },
  { id: "messages", label: "הודעות" },
  { id: "more", label: "עוד" },
];

const STUDENT_MORE_ITEMS: { id: MainTabId; label: string }[] = [
  { id: "profile", label: "פרופיל" },
  { id: "contacts", label: "אנשי קשר" },
  { id: "materials", label: "חומרי קורס" },
];

const STUDENT_ALL_TABS = [...STUDENT_MAIN_TABS, ...STUDENT_MORE_ITEMS];

// Quick-action shortcuts shown on the "today" home screen - each just calls
// setActiveTab, exactly like the instructor "today" dashboard's shortcuts and
// the "more" menu buttons already do.
const STUDENT_QUICK_ACTIONS: { id: MainTabId; label: string }[] = [
  { id: "schedule", label: 'לו"ז' },
  { id: "duties", label: "תורנויות" },
  { id: "messages", label: "הודעות ומשימות" },
  { id: "profile", label: "פרופיל" },
  { id: "contacts", label: "אנשי קשר" },
  { id: "materials", label: "חומרי קורס" },
];

interface StoredSession {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

export function StudentClient() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [selected, setSelected] = useState<StudentSearchResult | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<MainTabId>("today");
  const [weeks, setWeeks] = useState<WeekOption[] | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | "all">("all");

  const [isEditingHorseName, setIsEditingHorseName] = useState(false);
  const [horseNameDraft, setHorseNameDraft] = useState("");
  const [horseSaveError, setHorseSaveError] = useState<string | null>(null);
  const [horseSavePending, startHorseSaveTransition] = useTransition();

  useEffect(() => {
    // One-time sync from localStorage (an external system unavailable during
    // SSR) into React state on mount - not a subscription, so this must run
    // in an effect rather than a lazy useState initializer.
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
    // a long-remembered session (or one saved before a profile field like
    // subgroupNumber existed) would otherwise keep showing stale/missing data.
    if (!session) return;
    let cancelled = false;
    getStudentProfile(session.id).then((profile) => {
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
        const found = await searchStudents(query);
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
      const result = await verifyStudentLogin(selected.id, identityNumber);
      if (!result.success || !result.student) {
        setLoginError(result.error ?? "מספר תעודת זהות שגוי");
        return;
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result.student));
      setSession(result.student);
    });
  }

  function handleSwitchStudent() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setSelected(null);
    setQuery("");
    setActiveTab("today");
  }

  function startEditingHorseName() {
    if (!session) return;
    setHorseSaveError(null);
    setHorseNameDraft(session.privateHorseName ?? "");
    setIsEditingHorseName(true);
  }

  function handleSaveHorseName() {
    if (!session) return;
    setHorseSaveError(null);
    const studentId = session.id;
    const trimmed = horseNameDraft.trim();
    startHorseSaveTransition(async () => {
      const result = await updateOwnPrivateHorseName(studentId, trimmed);
      if (!result.success) {
        setHorseSaveError(result.error ?? "אירעה שגיאה");
        return;
      }
      setSession((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, privateHorseName: trimmed || null };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
      setIsEditingHorseName(false);
    });
  }

  if (!hydrated) return null;

  if (!session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
        <Logo width={220} />
        <p className="-mt-4 text-sm font-semibold text-muted-foreground">אזור חניכים</p>
        <div className="w-full rounded-2xl border border-border bg-card p-6">
          <h1 className="mb-1 text-2xl font-bold text-card-foreground">כניסת תלמיד/ה</h1>
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

  const selectedWeek = weeks?.find((w) => w.id === selectedWeekId) ?? null;
  const rangeStart = selectedWeek
    ? dayFilter === "all"
      ? selectedWeek.startDate
      : dayFilter
    : null;
  const rangeEnd = selectedWeek ? (dayFilter === "all" ? selectedWeek.endDate : dayFilter) : null;

  const activeTabLabel = STUDENT_ALL_TABS.find((t) => t.id === activeTab)?.label ?? "";
  const isMoreItem = STUDENT_MORE_ITEMS.some((item) => item.id === activeTab);
  const bottomActiveTab: MainTabId = isMoreItem ? "more" : activeTab;

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <Logo variant="mark" width={28} />
        <div>
          <p className="text-xs font-semibold text-muted-foreground">אזור חניכים</p>
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

            <div className="grid grid-cols-3 gap-2">
              {STUDENT_QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => setActiveTab(action.id)}
                  className="rounded-xl border border-border bg-card p-3 text-center text-sm font-semibold text-card-foreground hover:bg-muted"
                >
                  {action.label}
                </button>
              ))}
            </div>

            <StudentMessagesSummary
              studentId={session.id}
              onOpen={() => setActiveTab("messages")}
            />

            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="mb-2 text-sm font-semibold text-muted-foreground">סוס</p>
              {(() => {
                const horseInfo = getHorseDisplayInfo(session);
                return (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-sm font-medium ${
                          horseInfo.badgeType === "private"
                            ? "bg-success-muted text-success"
                            : horseInfo.badgeType === "assigned"
                              ? "bg-secondary text-secondary-foreground"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {horseInfo.badgeLabel}
                      </span>
                      <span
                        className={`text-lg font-bold ${
                          horseInfo.horseName ? "text-card-foreground" : "italic text-muted-foreground"
                        }`}
                      >
                        {horseInfo.horseNameDisplay}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("profile")}
                      className="text-sm font-medium text-primary underline"
                    >
                      עריכה בפרופיל
                    </button>
                  </div>
                );
              })()}
            </div>

            <DutiesSection studentId={session.id} startDateKey={todayKey} endDateKey={todayKey} />

            {weeks === null ? (
              <p className="text-base text-muted-foreground">טוען...</p>
            ) : todayWeek ? (
              <ScheduleSection studentId={session.id} weeklyScheduleId={todayWeek.id} dayFilter={todayKey} />
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
            <ScheduleSection
              studentId={session.id}
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
            <DutiesSection studentId={session.id} startDateKey={rangeStart} endDateKey={rangeEnd} />
          </div>
        )}

        {activeTab === "more" && (
          <div className="flex flex-col gap-3">
            {STUDENT_ALL_TABS.filter((item) => item.id !== "more").map((item) => (
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
              <p className="mb-4 text-xl font-bold text-card-foreground">{session.fullName}</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">קבוצה</p>
                  <p className="text-lg font-bold text-card-foreground">{session.groupName ?? "–"}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">תת-קבוצה</p>
                  <p className="text-lg font-bold text-card-foreground">
                    {session.subgroupNumber != null ? session.subgroupNumber : "לא הוגדר"}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="mb-2 text-sm font-semibold text-muted-foreground">סוס</p>
              {(() => {
                const horseInfo = getHorseDisplayInfo(session);
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-medium ${
                        horseInfo.badgeType === "private"
                          ? "bg-success-muted text-success"
                          : horseInfo.badgeType === "assigned"
                            ? "bg-secondary text-secondary-foreground"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {horseInfo.badgeLabel}
                    </span>
                    <span
                      className={`text-lg font-bold ${
                        horseInfo.horseName ? "text-card-foreground" : "italic text-muted-foreground"
                      }`}
                    >
                      {horseInfo.horseNameDisplay}
                    </span>
                  </div>
                );
              })()}

              {session.hasPrivateHorse &&
                (isEditingHorseName ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <input
                      value={horseNameDraft}
                      onChange={(e) => setHorseNameDraft(e.target.value)}
                      placeholder="שם הסוס הפרטי"
                      className="rounded-xl border border-border px-3 py-2.5 text-base"
                      autoFocus
                    />
                    {horseSaveError && <p className="text-sm text-danger">{horseSaveError}</p>}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="!py-2 !text-sm"
                        disabled={horseSavePending}
                        onClick={() => setIsEditingHorseName(false)}
                      >
                        ביטול
                      </Button>
                      <Button
                        type="button"
                        className="!py-2 !text-sm"
                        disabled={horseSavePending}
                        onClick={handleSaveHorseName}
                      >
                        {horseSavePending ? "שומר..." : "שמירה"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-3 !py-2 !text-sm"
                    onClick={startEditingHorseName}
                  >
                    {session.privateHorseName ? "עדכון שם הסוס" : "הוספת שם הסוס"}
                  </Button>
                ))}
            </div>
            <Button variant="secondary" onClick={handleSwitchStudent} className="!py-3 !text-base">
              החלפת תלמיד/ה
            </Button>
          </div>
        )}

        {activeTab === "messages" && <StudentMessagesSection studentId={session.id} />}

        {activeTab === "contacts" && <ContactsSection />}

        {activeTab === "materials" && <CourseMaterialsSection role="student" />}
      </main>

      <BottomTabs active={bottomActiveTab} onChange={setActiveTab} tabs={STUDENT_MAIN_TABS} />
    </div>
  );
}
