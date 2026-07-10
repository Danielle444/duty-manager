"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getStudentRidingHistoryForAdmin, type RidingHistoryRow } from "@/lib/actions/riding-slots";
import { RidingHistoryList } from "@/lib/components/RidingHistoryList";
import { getHorseDisplayInfo } from "@/lib/horse-info";

// Pure, reusable across future topics (Teaching Practice, combined timeline)
// - takes an average already converted to the 1.0-5.0 scale (half-points
// divided by 2) and produces the same "ממוצע X.X" / "אין דירוגים" label
// convention everywhere this pattern gets repeated, so P2/P3 only need to
// compute their own average and call this, never re-invent the wording.
function formatTopicAverageLabel(average: number | null): string {
  if (average == null) return "אין דירוגים";
  return `ממוצע ${average.toFixed(1)}`;
}

// Average of ratingHalfPoints (2-10, i.e. 1.0-5.0 in 0.5 steps) across every
// row that has one - rows without a rating are ignored entirely rather than
// counted as 0, same "missing = not yet rated, not a zero" convention
// RidingLessonNote itself already uses. null means "no rated rows at all"
// (including "still loading"), which formatTopicAverageLabel renders as
// "אין דירוגים" - callers should only invoke this once rows have loaded.
function averageRatingFromHalfPoints(ratingsHalfPoints: (number | null)[]): number | null {
  const rated = ratingsHalfPoints.filter((v): v is number => v != null);
  if (rated.length === 0) return null;
  return rated.reduce((sum, v) => sum + v, 0) / rated.length / 2;
}

// Reusable across future topics, same as formatTopicAverageLabel -
// no-ratings is always the neutral/gray tier, regardless of threshold.
// The two "good" tiers (4.5+ and 3.5-4.49) are deliberately two different
// hues (this app's own success green vs. plain sky blue, since there's no
// dedicated "info" semantic color token in globals.css) rather than two
// shades of the same color, so they stay visually distinguishable from each
// other, not just from the warning/danger tiers.
function topicAverageBadgeClasses(average: number | null): string {
  if (average == null) return "bg-muted text-muted-foreground";
  if (average >= 4.5) return "bg-success-muted text-success";
  if (average >= 3.5) return "bg-sky-100 text-sky-800";
  if (average >= 2.5) return "bg-warning-muted text-warning";
  return "bg-danger-muted text-danger";
}

// Small reusable badge - later topics (Teaching Practice, combined
// timeline) can render this same component next to their own title with
// their own computed average, keeping color/label rules in exactly one
// place.
function TopicAverageBadge({ average }: { average: number | null }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${topicAverageBadgeClasses(average)}`}
    >
      {formatTopicAverageLabel(average)}
    </span>
  );
}

export interface TraineeProgressStudentListItem {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  isActive: boolean;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// Stage P1 - a single tab ("רכיבות"), rendered as a labeled section rather
// than a real tab bar since there's nothing else to switch between yet.
// Later stages (P2/P3) add more tabs here without touching this file's
// existing riding logic.
type ProgressTab = "riding";

export function TraineeProgressClient({
  students,
  initialStudentId = null,
}: {
  students: TraineeProgressStudentListItem[];
  // Already validated server-side (page.tsx checks it against the loaded
  // roster before passing it down) - trusted as-is here, same as any other
  // server-provided initial prop in this app.
  initialStudentId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(initialStudentId);
  const [tab, setTab] = useState<ProgressTab>("riding");

  // Keeps the URL's studentId in sync with the in-page selection (deep-
  // linkable/shareable/refresh-safe), without forcing a full page reload -
  // router.replace navigates client-side, and since TraineeProgressClient
  // stays mounted at the same position across that navigation, this
  // component's own state (search text, selectedStudentId, tab, loaded
  // rows) is preserved rather than reset; only the URL bar changes.
  useEffect(() => {
    if (!selectedStudentId) return;
    router.replace(`${pathname}?studentId=${selectedStudentId}`, { scroll: false });
  }, [selectedStudentId, pathname, router]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.fullName.toLowerCase().includes(q));
  }, [search, students]);

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
  );

  const [ridingRows, setRidingRows] = useState<RidingHistoryRow[] | null>(null);
  const [, startTransition] = useTransition();

  // Read-only fetch, re-run whenever a different trainee is selected - same
  // getStudentRidingHistoryForAdmin call the existing riding-history page
  // uses, no new server action.
  useEffect(() => {
    if (!selectedStudentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRidingRows(null);
      return;
    }
    let cancelled = false;
    setRidingRows(null);
    startTransition(async () => {
      const result = await getStudentRidingHistoryForAdmin(selectedStudentId);
      if (!cancelled) {
        setRidingRows(result?.rows ?? []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId]);

  // Based on ALL loaded rows (not whatever RidingHistoryList's own internal
  // date/topic filters currently show) - per product direction, the topic-
  // level average reflects the trainee's whole riding history, not the
  // admin's momentary filter selection. RidingHistoryList's internals are
  // untouched; this reads the same rows array already passed to it.
  const ridingAverageRating = useMemo(
    () => (ridingRows ? averageRatingFromHalfPoints(ridingRows.map((r) => r.ratingHalfPoints)) : null),
    [ridingRows]
  );

  function handleSelectStudent(studentId: string) {
    setSelectedStudentId(studentId);
    setIsSearchOpen(false);
    setSearch("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        {selectedStudent && !isSearchOpen && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-card-foreground">
              חניך/ה נבחר/ת: <span className="font-semibold">{selectedStudent.fullName}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setIsSearchOpen(true);
                searchInputRef.current?.focus();
              }}
              className="text-xs font-medium text-secondary-foreground underline hover:opacity-80"
            >
              החלפת חניך/ה
            </button>
          </div>
        )}

        {/* Compact combobox - the results list is a popup that only opens
            while the input is focused/being typed into, rather than an
            always-open list permanently taking up page space. Closing on
            blur uses a short delay (rather than closing immediately) so a
            mouse click on a result still registers - onMouseDown on each
            result additionally prevents the input from blurring before that
            click's onClick fires, so mouse selection never races the close. */}
        <div className="relative">
          <label className="flex flex-col gap-1 text-sm">
            {selectedStudent ? "חיפוש/החלפת חניך/ה" : "חיפוש חניך/ה לפי שם"}
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              onBlur={() => {
                setTimeout(() => setIsSearchOpen(false), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsSearchOpen(false);
                  e.currentTarget.blur();
                }
              }}
              placeholder="הקלד/י שם..."
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>

          {isSearchOpen && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
              {filteredStudents.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">לא נמצאו חניכים לפי החיפוש</p>
              ) : (
                filteredStudents.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectStudent(s.id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-sm transition-colors ${
                      selectedStudentId === s.id
                        ? "bg-primary text-primary-foreground"
                        : "text-card-foreground hover:bg-muted"
                    }`}
                  >
                    <span>
                      {s.fullName}
                      {s.groupName ? ` · קבוצה ${s.groupName}` : ""}
                      {s.subgroupNumber != null ? ` · תת-קבוצה ${s.subgroupNumber}` : ""}
                    </span>
                    {!s.isActive && (
                      <span className="rounded-full bg-muted-foreground/20 px-2 py-0.5 text-xs">
                        לא פעיל/ה
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {selectedStudent && (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-lg font-bold text-card-foreground">{selectedStudent.fullName}</p>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  selectedStudent.isActive
                    ? "bg-success-muted text-success"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {selectedStudent.isActive ? "פעיל/ה" : "לא פעיל/ה"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {selectedStudent.groupName ? `קבוצה ${selectedStudent.groupName}` : "ללא קבוצה"}
              {selectedStudent.subgroupNumber != null
                ? ` · תת-קבוצה ${selectedStudent.subgroupNumber}`
                : ""}
              {" · "}
              {getHorseDisplayInfo(selectedStudent).horseNameDisplay}
            </p>
          </div>

          <div className="flex gap-2 rounded-xl border border-border bg-muted p-1">
            <button
              type="button"
              onClick={() => setTab("riding")}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
                tab === "riding" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              רכיבות
            </button>
          </div>

          {tab === "riding" &&
            (ridingRows === null ? (
              <p className="text-sm text-muted-foreground">טוען...</p>
            ) : (
              <>
                {/* Section header with the average badge sitting next to
                    the title itself, rather than a separate muted line -
                    same TopicAverageBadge/averageRatingFromHalfPoints pair
                    to reuse verbatim for future topics (Teaching Practice,
                    combined timeline), each computing its own average and
                    rendering its own title + badge this same way. */}
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-card-foreground">רכיבות</h3>
                  <TopicAverageBadge average={ridingAverageRating} />
                </div>
                <RidingHistoryList rows={ridingRows} />
              </>
            ))}
        </>
      )}
    </div>
  );
}
