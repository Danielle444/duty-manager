"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Logo } from "@/lib/components/Logo";
import { WeekDayPicker, type WeekOption } from "@/lib/components/WeekDayPicker";
import { BottomTabs, TabIcon, NAV_MAX_WIDTH_CLASSNAME, type MainTabId } from "@/lib/components/BottomTabs";
import { CourseMaterialsSection } from "@/lib/components/CourseMaterialsSection";
import {
  getInstructorProfile,
  logoutInstructor,
  searchInstructors,
  verifyInstructorLogin,
  type InstructorProfile,
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
import { InstructorRidingHorsePublicationsSection } from "@/app/instructor/InstructorRidingHorsePublicationsSection";
import { InstructorAttendanceSection } from "@/app/instructor/InstructorAttendanceSection";
import { InstructorRidingSlotsSection } from "@/app/instructor/InstructorRidingSlotsSection";
import {
  RidingStudentsModalController,
  type RidingStudentsModalControllerHandle,
} from "@/app/instructor/RidingStudentsModalController";
import type { InstructorSlotMode } from "@/app/instructor/instructor-riding-shared-types";
import { InstructorTeachingPracticeSection } from "@/app/instructor/InstructorTeachingPracticeSection";
import { InstructorChildSignaturesSection } from "@/app/instructor/InstructorChildSignaturesSection";
import { InstructorTraineeProgressSection } from "@/app/instructor/InstructorTraineeProgressSection";
import { canAccessTraineeProgress } from "@/lib/trainee-progress-permissions";
import { ContactsSection } from "@/lib/components/ContactsSection";
import { HelpContent } from "@/lib/components/HelpContent";
import { NotificationsList } from "@/lib/components/NotificationsList";
import {
  getNotificationsForInstructor,
  markNotificationReadAsInstructor,
  hasUnreadNotificationsForInstructor,
} from "@/lib/actions/notifications";
import { getMessageTasksForInstructorView } from "@/lib/actions/messages";
import {
  getKnownRidingLessonTopics,
  getKnownRidingHorseNames,
  getInstructorRidingSlots,
  type WeeklyRidingActivity,
} from "@/lib/actions/riding-slots";
import { getRidingSlotComplexPlanForInstructor } from "@/lib/actions/riding-slot-complex";
import { getRidingSlotHorseListForInstructor } from "@/lib/actions/riding-slot-horses";
import { buildScheduleItemActivityMap } from "@/app/instructor/instructor-riding-schedule-map-core";
import {
  formatHebrewDate,
  formatHebrewWeekday,
  getDefaultDayFilter,
  getLocalDateKey,
  parseDateKey,
} from "@/lib/dates";
import { useVersionGate } from "@/lib/version-gate/useVersionGate";

const STORAGE_KEY = "duty-manager-instructor-v2";

// Instructors have no per-recipient read tracking for messages/tasks (see
// InstructorMessageTaskRecipient revert), so the "new messages/tasks"
// shortcut dot uses a lightweight, device-local "created after I last opened
// the screen" timestamp instead of a real read state.
function instructorMessagesLastSeenKey(instructorId: string): string {
  return `duty-manager-instructor-messages-last-seen-${instructorId}`;
}

// Instructor has its own 5 main bottom tabs (independent of the student
// MAIN_TABS, which stays untouched) plus a "more" menu for lower-frequency
// sections. "riding" ("רכיבות") was promoted from "more" to a main tab since
// instructors use it often enough that burying it under "עוד" was
// inconvenient - it's used here, never redefined or duplicated. "horses"
// ("סוסים") was moved from the main bar into the "more" menu (kept to <=5
// main tabs incl. "more") - the horses screen itself is unchanged and is
// still opened via activeTab === "horses".
const INSTRUCTOR_MAIN_TABS: { id: MainTabId; label: string }[] = [
  { id: "today", label: "היום" },
  { id: "schedule", label: 'לו"ז' },
  { id: "duties", label: "תורנויות" },
  { id: "riding", label: "רכיבות" },
  { id: "more", label: "עוד" },
];

const INSTRUCTOR_MORE_ITEMS: { id: MainTabId; label: string }[] = [
  { id: "horses", label: "סוסים" },
  { id: "profile", label: "פרופיל" },
  { id: "attendance", label: "נוכחות" },
  { id: "messages", label: "הודעות ומשימות" },
  { id: "contacts", label: "אנשי קשר" },
  { id: "materials", label: "חומרי קורס" },
  { id: "notifications", label: "עדכונים" },
  { id: "teachingPractice", label: "התנסויות מתחילים" },
  { id: "help", label: "עזרה" },
];

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
  // Every instructor can at least view this section (edit access is its own,
  // separate permission enforced inside TeachingPracticeManager/its server
  // actions) - so unlike "messages" above, this shortcut is never filtered
  // out here.
  { id: "teachingPractice", label: "התנסויות מתחילים" },
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
  canManageTeachingPracticeAssignments: boolean;
  canManageTeachingPracticeHorses: boolean;
  canEditTeachingPracticeFeedback: boolean;
  canManageChildSignatures: boolean;
}

interface StudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

interface StudentHorseInfoOption {
  id: string;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

interface DutyTypeOption {
  id: string;
  name: string;
}

interface InstructorOption {
  id: string;
  fullName: string;
}

// Per-RidingSlot mode detection for slots surfaced by the schedule cards.
// Intentionally identical in behavior to InstructorRidingSlotsSection's own
// private detectInstructorRidingSlotMode: it is NOT exported there and that
// file is out of scope for this change, so rather than widen its surface the
// same two existing reads are composed here (complex plan first - a single
// cheap read that returns null fast when absent - then the simple horse list),
// so a schedule-opened riding session picks its initial "צפייה בחניכים" tab
// exactly as a riding-tab-opened one does. No new server action, no new read,
// no broadened authorization: both reads already back the instructor riding
// surface and re-check the caller is a real, active instructor server-side.
async function detectScheduleRidingSlotMode(
  instructorId: string,
  ridingSlotId: string
): Promise<InstructorSlotMode> {
  const complexPlan = await getRidingSlotComplexPlanForInstructor(instructorId, ridingSlotId);
  if (complexPlan) return "complex";
  const horseList = await getRidingSlotHorseListForInstructor(instructorId, ridingSlotId);
  if (horseList?.listId) return "simple";
  return "none";
}

export function InstructorClient({
  authenticated,
  students,
  dutyTypes,
  instructors,
  studentHorseInfo,
}: {
  // E0 - server-owned truth about whether this browser holds a valid signed
  // instructor session (page.tsx, via the Actor DAL). It is NOT derived from
  // localStorage and never round-trips through the client: when it is false the
  // sensitive props above are empty by construction, so restoring a stale
  // stored session would render the authenticated shell over no data. This flag
  // is a render/teardown signal only - it authorizes nothing on its own.
  authenticated: boolean;
  students: StudentOption[];
  dutyTypes: DutyTypeOption[];
  instructors: InstructorOption[];
  studentHorseInfo: StudentHorseInfoOption[];
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

  // Single shared riding-students popup + the inputs it needs, lifted here from
  // InstructorRidingSlotsSection (Stage B1) so exactly one controller is
  // mounted, independent of the active tab, ready for a later stage to open it
  // from today/schedule/riding. The riding section still owns days + mode
  // detection and writes modes through setModeByRidingSlotId; this only holds
  // the shared containers.
  const ridingStudentsModalRef = useRef<RidingStudentsModalControllerHandle>(null);
  const [modeByRidingSlotId, setModeByRidingSlotId] = useState<Record<string, InstructorSlotMode>>({});
  const [knownLessonTopics, setKnownLessonTopics] = useState<string[]>([]);
  const [knownHorseNames, setKnownHorseNames] = useState<string[]>([]);
  // Schedule-card (real ScheduleItem id) -> configured riding activity lookup
  // for whichever schedule surface is active (today / full schedule). Rebuilt
  // from ONE getInstructorRidingSlots read per selected range (never per card),
  // and reset whenever the range or tab changes so a card can never open an
  // activity from a previously-selected week. An id absent from this map means
  // that card is not a configured riding session and stays non-interactive.
  const [scheduleActivityMap, setScheduleActivityMap] = useState<Map<string, WeeklyRidingActivity>>(
    () => new Map()
  );

  // Same load/guard as the riding section's previous loadKnownValues; gated on
  // the riding tab being active so the query timing matches the section's prior
  // mount-driven load (not eagerly on page load, not for non-riding tabs).
  function loadKnownRidingValues() {
    if (!session?.canEditRidingNotes) return;
    getKnownRidingLessonTopics().then(setKnownLessonTopics);
    getKnownRidingHorseNames().then(setKnownHorseNames);
  }

  useEffect(() => {
    if (activeTab !== "riding") return;
    loadKnownRidingValues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, session?.canEditRidingNotes]);

  // Drives the "עוד" tab / "עדכונים" menu-row dot (a real unread count).
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  // Drives the "הודעות ומשימות" shortcut/menu-row dot - device-local "new
  // since last opened" only, not a real per-instructor read state (see
  // instructorMessagesLastSeenKey above).
  const [hasNewMessages, setHasNewMessages] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    hasUnreadNotificationsForInstructor(session.id).then((value) => {
      if (!cancelled) setHasUnreadNotifications(value);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getMessageTasksForInstructorView().then((items) => {
      if (cancelled) return;
      const lastSeenRaw = window.localStorage.getItem(instructorMessagesLastSeenKey(session.id));
      const lastSeen = lastSeenRaw ? new Date(lastSeenRaw).getTime() : 0;
      // Best-effort exclusion of the instructor's own messages: createdByName
      // is just the sender's display name (see createMessageTaskAsInstructor),
      // not a strict identity check, so two instructors sharing an exact full
      // name would under-count for each other here - acceptable since this
      // only suppresses a decorative dot, nothing else.
      const hasNew = items.some(
        (item) =>
          item.createdByName !== session.fullName && new Date(item.createdAt).getTime() > lastSeen
      );
      setHasNewMessages(hasNew);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.fullName]);

  useEffect(() => {
    if (!session || activeTab !== "messages") return;
    window.localStorage.setItem(instructorMessagesLastSeenKey(session.id), new Date().toISOString());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasNewMessages(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, session?.id]);

  // Recomputed every minute (not just once at mount) so "today" rolls over
  // to the new local day on its own if the app is left open across
  // midnight, instead of staying frozen on the day the page first loaded.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // A per-day string that only changes across a real local-day rollover (not
  // every minute like `now`), so keying the schedule-activities effect below on
  // it never refetches mid-day yet still moves to the new day if left open past
  // midnight.
  const nowDayKey = getLocalDateKey(now);

  // Loads the configured riding activities for whichever schedule surface is
  // active (today or the full schedule), builds the schedule-card lookup, and
  // detects each slot's mode - so a schedule card opens the single shared
  // riding-students popup exactly like a riding-tab card. Runs ONLY for those
  // two surfaces (no unrelated tab triggers a load), makes ONE bounded
  // activities read per selected range (no per-card N+1), writes nothing, and
  // reuses the same reads the riding surface already uses.
  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScheduleActivityMap(new Map());
      return;
    }
    // Range of the active schedule surface: today shows only today's items
    // (and only when a week actually covers today); the full schedule shows
    // the whole selected week.
    let rangeStart: string | null = null;
    let rangeEnd: string | null = null;
    if (activeTab === "today") {
      const todayWk = weeks?.find((w) => w.startDate <= nowDayKey && nowDayKey <= w.endDate) ?? null;
      if (todayWk) {
        rangeStart = nowDayKey;
        rangeEnd = nowDayKey;
      }
    } else if (activeTab === "schedule") {
      const week = weeks?.find((w) => w.id === selectedWeekId) ?? null;
      if (week) {
        rangeStart = week.startDate;
        rangeEnd = week.endDate;
      }
    }

    // Any non-schedule tab (or a surface with no resolvable range) clears the
    // map and loads nothing - a stale mapping must never linger where a current
    // card could open a previous range's activity.
    if (!rangeStart || !rangeEnd) {
      setScheduleActivityMap(new Map());
      return;
    }

    let cancelled = false;
    // Replace the previous range's mapping up front so no card resolves against
    // stale data while this reload is in flight.
    setScheduleActivityMap(new Map());
    getInstructorRidingSlots(rangeStart, rangeEnd)
      .then((days) => {
        if (cancelled) return;
        const activities = days.flatMap((d) => d.activities);
        setScheduleActivityMap(buildScheduleItemActivityMap(activities));
        // Detect mode per real riding slot (same behavior as the riding tab),
        // merging into the shared modeByRidingSlotId the cards/controller
        // already read. A slot's mode is a stable property, so merging rather
        // than resetting never fights the riding section's own detection.
        const ridingSlotIds = Array.from(
          new Set(
            activities
              .map((a) => a.ridingSlot?.id)
              .filter((id): id is string => Boolean(id))
          )
        );
        for (const ridingSlotId of ridingSlotIds) {
          detectScheduleRidingSlotMode(session.id, ridingSlotId)
            .then((detected) => {
              if (cancelled) return;
              setModeByRidingSlotId((prev) => ({ ...prev, [ridingSlotId]: detected }));
            })
            .catch(() => {
              if (cancelled) return;
              setModeByRidingSlotId((prev) => ({ ...prev, [ridingSlotId]: "error" }));
            });
        }
      })
      .catch(() => {
        if (!cancelled) setScheduleActivityMap(new Map());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, activeTab, selectedWeekId, weeks, nowDayKey]);

  // Client version AWARENESS only (Stage 0B-1). Detects when this open bundle
  // is older than the currently-served one and offers a guarded full reload.
  // It is NOT authorization, blocks no Server Action, and never touches
  // identity/auth/localStorage. Excluded from /admin by construction (this hook
  // is mounted only in the instructor and trainee shells).
  const versionGate = useVersionGate();

  useEffect(() => {
    // E0 - the SERVER decides whether a valid signed instructor session exists;
    // stale localStorage must never override it. When the server says no, the
    // stored identity is torn down BEFORE any session state is set (and before
    // `hydrated` flips, since nothing renders until then), so the authenticated
    // shell never flashes over the empty payload - the login form renders
    // instead. When the server says yes, the stored session is restored exactly
    // as before: a valid instructor is never logged out by this branch.
    if (!authenticated) {
      const hadStoredSession = window.localStorage.getItem(STORAGE_KEY) !== null;
      window.localStorage.removeItem(STORAGE_KEY);
      if (hadStoredSession) {
        // Only after clearing something real - a first-time visitor should see
        // a clean login screen, not an error.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSessionInvalidMessage("פג תוקף החיבור - יש להתחבר מחדש");
      }
      setSession(null);
      setHydrated(true);
      return;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setSession(JSON.parse(raw));
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHydrated(true);
  }, [authenticated]);

  useEffect(() => {
    // Refresh the profile fields from the DB whenever a session is active -
    // a long-remembered session (or one saved before canEditHorseAssignments
    // existed, or whose permission an admin just changed) would otherwise
    // keep showing stale data. Mirrors StudentClient's profile-refresh effect.
    if (!session) return;
    let cancelled = false;
    const instructorId = session.id;

    // When the restored instructor is no longer valid/inactive/missing, route
    // the cleanup through one controlled async helper: clear the (non-
    // authoritative) instructor cookie FIRST (awaited), then tear down the
    // local identity/UI state in `finally` so teardown still happens even if
    // the cookie deletion throws. No cookie/secret detail is surfaced. This
    // never clears the trainee cookie and never mints.
    async function invalidateInstructorSession() {
      try {
        await logoutInstructor();
      } finally {
        if (!cancelled) {
          window.localStorage.removeItem(STORAGE_KEY);
          setSession(null);
          setSessionInvalidMessage("המשתמש/ת אינו/ה פעיל/ה יותר - יש להתחבר מחדש");
        }
      }
    }

    async function refreshInstructorProfile() {
      let profile: InstructorProfile | null;
      try {
        profile = await getInstructorProfile(instructorId);
      } catch {
        // Network/server hiccup - never log the user out for this; the
        // already-stored session keeps being used as-is.
        if (!cancelled) setRefreshError("לא ניתן היה לרענן את פרטי המשתמש כרגע");
        return;
      }
      if (cancelled) return;
      if (!profile) {
        // Account deactivated/deleted since it was last stored - the stale
        // session must not keep rendering the full app, so its cookie is
        // cleared and its local state torn down here rather than silently
        // left in place.
        try {
          await invalidateInstructorSession();
        } catch {
          // The local teardown already ran in `finally`; a cookie-clear
          // failure here is non-fatal and must never surface a cookie/secret
          // detail or leave an unhandled rejection.
        }
        return;
      }
      setRefreshError(null);
      setSession(profile);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    }

    void refreshInstructorProfile();

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
      try {
        const result = await verifyInstructorLogin(selected.id, identityNumber);
        if (!result.success || !result.instructor) {
          setLoginError(result.error ?? "מספר תעודת זהות שגוי");
          return;
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result.instructor));
        setSession(result.instructor);
        setSessionInvalidMessage(null);
      } catch {
        // A thrown login action (e.g. the server cookie mint failing closed)
        // must NOT persist the instructor, set a verified session, or fall
        // back to a client-only login. Show a safe generic message without
        // exposing the underlying error, and never touch trainee state.
        setLoginError("לא ניתן להתחבר כרגע. יש לנסות שוב.");
      }
    });
  }

  async function handleSwitch() {
    // Clear the (non-authoritative) instructor cookie FIRST, awaited, then run
    // the existing local teardown in `finally` so the UI/session reset still
    // happens even if the cookie deletion throws. No cookie/secret detail is
    // shown to the user; the trainee cookie is never touched.
    try {
      await logoutInstructor();
    } catch {
      // intentionally ignore cookie-clear failure because the cookie is
      // non-authoritative and local teardown must continue
    } finally {
      window.localStorage.removeItem(STORAGE_KEY);
      setSession(null);
      setSelected(null);
      setQuery("");
      setActiveTab("today");
      setSessionInvalidMessage(null);
      setRefreshError(null);
    }
  }

  // Opens the single shared riding-students popup for a schedule-card-resolved
  // activity, mirroring InstructorRidingSlotsSection's own onOpenRidingStudents:
  // read the slot's already-detected mode from the shared modeByRidingSlotId and
  // hand it to the one controller, which alone decides the initial tab
  // (complex -> "schedule", else -> "list") via the committed
  // resolveInitialStudentsTab. No second modal, no duplicated save path.
  function openScheduleRidingActivity(activity: WeeklyRidingActivity) {
    if (!activity.ridingSlot) return;
    ridingStudentsModalRef.current?.open(activity, modeByRidingSlotId[activity.ridingSlot.id]);
  }

  if (!hydrated) return null;

  // On a confirmed compatibility-epoch mismatch, stop rendering the normal
  // application surface and show the approved update screen with a guarded full
  // reload. Fail-open ("ok") renders the app unchanged. This never clears
  // identity/session state and never blocks any Server Action.
  if (versionGate.status !== "ok") {
    const isReloadFailed = versionGate.status === "reload-failed";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10 text-center">
        <Logo width={220} className="h-auto w-full max-w-[220px]" />
        <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="mb-2 text-lg font-bold text-card-foreground">
            {isReloadFailed
              ? "לא הצלחנו לטעון את הגרסה החדשה."
              : "גרסה חדשה של המערכת זמינה."}
          </p>
          <p className="mb-4 text-base text-muted-foreground">
            {isReloadFailed
              ? "יש לסגור את המערכת ולפתוח אותה מחדש."
              : "יש לרענן את העמוד כדי להמשיך."}
          </p>
          <Button onClick={() => versionGate.reload()} className="!py-3 !text-base">
            {isReloadFailed ? "ניסיון נוסף" : "רענון המערכת"}
          </Button>
        </div>
      </div>
    );
  }

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

  // "חתימות ילדים" is only inserted into the "עוד" menu (and thus into
  // instructorAllTabs below) for instructors with canManageChildSignatures -
  // unlike every other section on this screen, its status list exposes
  // parent contact details (and, once signing lands, medical notes), so the
  // nav entry itself is hidden rather than just gating the actions inside
  // it. This is a UX convenience only: the underlying server action
  // re-checks the flag fresh from the DB regardless of how this list was
  // built (see getParentSignatureStatusForInstructor).
  //
  // "מעקב חניכים" is inserted for instructors with canEditRidingNotes OR
  // canEditTeachingPracticeFeedback (canAccessTraineeProgress) - either
  // permission alone is enough to open the full trainee-progress detail
  // view; which edit controls appear once inside it is a separate, per-
  // section check (see InstructorTraineeProgressSection/
  // TraineeProgressDetail). Same UX-convenience-only caveat as
  // canManageChildSignatures below: every underlying action re-checks the
  // flags fresh from the DB regardless of how this list was built (see
  // lib/actions/trainee-progress-instructor-access.ts).
  let instructorMoreItems: { id: MainTabId; label: string }[] = INSTRUCTOR_MORE_ITEMS;
  if (session.canManageChildSignatures) {
    const items = [...instructorMoreItems];
    const helpIndex = items.findIndex((item) => item.id === "help");
    items.splice(helpIndex, 0, { id: "childSignatures", label: "חתימות ילדים" });
    instructorMoreItems = items;
  }
  if (canAccessTraineeProgress(session)) {
    const items = [...instructorMoreItems];
    const helpIndex = items.findIndex((item) => item.id === "help");
    items.splice(helpIndex, 0, { id: "traineeProgress", label: "מעקב חניכים" });
    instructorMoreItems = items;
  }
  const instructorAllTabs = [...INSTRUCTOR_MAIN_TABS, ...instructorMoreItems];

  const activeTabLabel = instructorAllTabs.find((t) => t.id === activeTab)?.label ?? "";
  const isMoreItem = instructorMoreItems.some((item) => item.id === activeTab);
  const bottomActiveTab: MainTabId = isMoreItem ? "more" : activeTab;

  // One flat, compact quick-nav grid instead of two labeled groups. Sending a
  // message/task is not a separate shortcut here - permitted instructors send
  // from inside the "הודעות ומשימות" screen itself (gated there by
  // canSendMessages), so this list only ever links to that one screen once.
  const homeShortcuts: { id: MainTabId; label: string }[] = [
    ...INSTRUCTOR_ACTIVITY_SHORTCUTS,
    ...INSTRUCTOR_INFO_SHORTCUTS,
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-card px-4 py-3 shadow-sm">
        <Logo variant="mark" width={44} className="shrink-0 ring-1 ring-border" />
        <div className="min-w-0">
          <p className="truncate text-base font-extrabold tracking-tight text-primary">
            Double K Top{" "}
            <span className="text-xs font-semibold text-muted-foreground">· אזור מדריכים</span>
          </p>
          <p className="truncate text-xs font-medium text-muted-foreground">{activeTabLabel}</p>
        </div>
      </header>

      {refreshError && (
        <p className="bg-warning-muted px-4 py-2 text-center text-xs text-warning">{refreshError}</p>
      )}

      <main className="flex-1 px-4 py-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
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
              <div className="grid grid-cols-2 gap-2">
                {homeShortcuts.map((action) => (
                  <button
                    key={`${action.id}-${action.label}`}
                    type="button"
                    onClick={() => setActiveTab(action.id)}
                    className="relative flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-right hover:bg-muted"
                  >
                    <TabIcon id={action.id} className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-card-foreground">
                      {action.label}
                    </span>
                    {action.id === "messages" && hasNewMessages && (
                      <span
                        className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Internal scroll (not full-page) so this + the duties box below
                keep the "today" screen a bounded height instead of growing
                arbitrarily long - each box scrolls its own content
                independently, same max-height/overflow-y-auto pattern already
                used for the riding-notes modal in InstructorRidingSlotsSection. */}
            {weeks === null ? (
              <p className="text-base text-muted-foreground">טוען...</p>
            ) : todayWeek ? (
              <div className="max-h-[40vh] overflow-y-auto">
                <InstructorScheduleSection
                  instructorId={session.id}
                  weeklyScheduleId={todayWeek.id}
                  dayFilter={todayKey}
                  resolveRidingActivity={(scheduleItemId) =>
                    scheduleActivityMap.get(scheduleItemId) ?? null
                  }
                  onOpenRidingActivity={openScheduleRidingActivity}
                />
              </div>
            ) : (
              <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
                עדיין לא הועלה לו&quot;ז להיום
              </p>
            )}

            <div className="max-h-[40vh] overflow-y-auto">
              <InstructorDutiesSection
                weeklyScheduleId={todayWeek?.id ?? null}
                dayFilter={todayKey}
                students={students}
                dutyTypes={dutyTypes}
                studentHorseInfo={studentHorseInfo}
              />
            </div>
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
            {/* Bounded internal scroll (unlike the unbounded "today" preview
                above, this is the primary full-week view) - the day-group
                labels inside InstructorScheduleSection are already
                `sticky top-0`; without this bounded box they'd resolve
                against the page's own scroll and collide with/hide behind
                the shell header's own `sticky top-0 z-20` above. Wrapping
                just this call (not the WeekDayPicker) gives the sticky day
                labels their own isolated scroll container, same fix shape
                already used for the "today" tab and for ScheduleGrid.tsx/
                TeachingPracticeManager.tsx. */}
            <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
              <InstructorScheduleSection
                instructorId={session.id}
                weeklyScheduleId={selectedWeekId}
                dayFilter={dayFilter}
                resolveRidingActivity={(scheduleItemId) =>
                  scheduleActivityMap.get(scheduleItemId) ?? null
                }
                onOpenRidingActivity={openScheduleRidingActivity}
              />
            </div>
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
              studentHorseInfo={studentHorseInfo}
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
            {instructorAllTabs.filter((item) => item.id !== "more").map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className="flex items-center justify-between rounded-2xl border border-border bg-card p-5 text-right"
              >
                <span className="flex items-center gap-1.5 text-lg font-bold text-card-foreground">
                  {item.label}
                  {((item.id === "notifications" && hasUnreadNotifications) ||
                    (item.id === "messages" && hasNewMessages)) && (
                    <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                  )}
                </span>
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
            <Button
              variant="secondary"
              onClick={() => void handleSwitch()}
              className="!py-3 !text-base"
            >
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
            modeByRidingSlotId={modeByRidingSlotId}
            setModeByRidingSlotId={setModeByRidingSlotId}
            onOpenRidingStudents={(activity, knownMode) =>
              ridingStudentsModalRef.current?.open(activity, knownMode)
            }
          />
        )}

        {activeTab === "messages" && (
          <div className="flex flex-col gap-4">
            <InstructorRidingHorsePublicationsSection instructorId={session.id} />
            <InstructorMessagesSection
              instructorId={session.id}
              canSend={session.canSendMessages}
              students={students}
            />
          </div>
        )}

        {activeTab === "contacts" && <ContactsSection />}

        {activeTab === "materials" && <CourseMaterialsSection role="instructor" />}

        {activeTab === "teachingPractice" && (
          <InstructorTeachingPracticeSection
            instructorId={session.id}
            canManageAssignments={session.canManageTeachingPracticeAssignments}
            canManageHorses={session.canManageTeachingPracticeHorses}
            canEditTeachingPracticeFeedback={session.canEditTeachingPracticeFeedback}
            students={students}
            instructors={instructors}
          />
        )}

        {activeTab === "childSignatures" && session.canManageChildSignatures && (
          <InstructorChildSignaturesSection instructorId={session.id} />
        )}

        {activeTab === "traineeProgress" && canAccessTraineeProgress(session) && (
          <InstructorTraineeProgressSection
            instructorId={session.id}
            students={students}
            studentHorseInfo={studentHorseInfo}
            canEditRidingNotes={session.canEditRidingNotes}
            canEditTeachingPracticeFeedback={session.canEditTeachingPracticeFeedback}
          />
        )}

        {activeTab === "help" && <HelpContent role="instructor" />}

        {activeTab === "notifications" && (
          <NotificationsList
            fetchNotifications={() => getNotificationsForInstructor(session.id)}
            onMarkRead={(notificationId) => markNotificationReadAsInstructor(notificationId, session.id)}
            onUnreadChange={setHasUnreadNotifications}
          />
        )}
      </main>

      {/* Single shared riding-students popup - mounted once here, independent
          of the active tab, so a later stage can open it from today/schedule
          as well as the riding tab. Opened today only via onOpenRidingStudents
          passed to InstructorRidingSlotsSection; no schedule-card opener yet. */}
      <RidingStudentsModalController
        ref={ridingStudentsModalRef}
        instructorId={session.id}
        canEdit={session.canEditRidingNotes}
        students={students}
        knownLessonTopics={knownLessonTopics}
        knownHorseNames={knownHorseNames}
        modeByRidingSlotId={modeByRidingSlotId}
        onReloadKnownValues={loadKnownRidingValues}
      />

      <BottomTabs
        active={bottomActiveTab}
        onChange={setActiveTab}
        tabs={INSTRUCTOR_MAIN_TABS}
        dotTabIds={hasUnreadNotifications || hasNewMessages ? (["more"] as MainTabId[]) : []}
        // Matches the widened shell in app/instructor/page.tsx so the fixed
        // bottom nav's width tracks the content above it at every breakpoint -
        // both read from the same NAV_MAX_WIDTH_CLASSNAME source of truth.
        maxWidthClassName={NAV_MAX_WIDTH_CLASSNAME}
      />
    </div>
  );
}
