"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getStudentRidingHistoryForAdmin, type RidingHistoryRow } from "@/lib/actions/riding-slots";
import { RidingHistoryList } from "@/lib/components/RidingHistoryList";
import { getHorseDisplayInfo } from "@/lib/horse-info";

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

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <label className="flex flex-col gap-1 text-sm">
          חיפוש חניך/ה לפי שם
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="הקלד/י שם..."
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>

        <div className="mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto">
          {filteredStudents.length === 0 ? (
            <p className="text-sm text-muted-foreground">לא נמצאו חניכים לפי החיפוש</p>
          ) : (
            filteredStudents.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedStudentId(s.id)}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-sm transition-colors ${
                  selectedStudentId === s.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-card-foreground hover:bg-muted/70"
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
              <RidingHistoryList rows={ridingRows} />
            ))}
        </>
      )}
    </div>
  );
}
