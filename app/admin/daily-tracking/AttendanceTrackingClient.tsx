"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  formatHebrewDate,
  formatHebrewWeekday,
  formatHebrewWeekdayShort,
  getWeekDateKeys,
  parseDateKey,
} from "@/lib/dates";
import {
  getAttendanceTrackingForAdmin,
  upsertAttendanceAsAdmin,
  clearAttendanceAsAdmin,
  markStudentUnavailableForDuty,
  type AttendanceTrackingRow,
  type AttendanceStatusValue,
} from "@/lib/actions/attendance";

const STATUS_LABELS: Record<AttendanceStatusValue, string> = {
  PRESENT: 'נוכח/ת',
  ABSENT: 'נעדר/ת',
  PARTIAL: 'חלקי',
};

const STATUS_SHORT_LABELS: Record<AttendanceStatusValue, string> = {
  PRESENT: "נוכח",
  ABSENT: "נעדר",
  PARTIAL: "חלקי",
};

const STATUS_BADGE_CLASS: Record<AttendanceStatusValue, string> = {
  PRESENT: "bg-success-muted text-success",
  ABSENT: "bg-danger-muted text-danger",
  PARTIAL: "bg-warning-muted text-warning",
};

// A missing record is the normal, expected case (most students, most days) -
// it must never read like a warning or an unfinished task.
const DEFAULT_LABEL = "אין היעדרות ידועה";
const DEFAULT_BADGE_CLASS = "bg-muted text-muted-foreground";
const DEFAULT_CELL_CLASS = "bg-muted/40 text-muted-foreground border-border";

type ViewMode = "day" | "week";

interface AttendanceForm {
  // null only for a brand-new exception the admin hasn't chosen a type for
  // yet - Save is blocked until it's set, so nothing is ever written by
  // just opening the modal.
  status: AttendanceStatusValue | null;
  arrivalTime: string;
  departureTime: string;
  notes: string;
}

function defaultFormFromRow(row: AttendanceTrackingRow): AttendanceForm {
  return {
    status: row.attendance?.status ?? null,
    arrivalTime: row.attendance?.arrivalTime ?? "",
    departureTime: row.attendance?.departureTime ?? "",
    notes: row.attendance?.notes ?? "",
  };
}

interface StudentGroup {
  studentId: string;
  studentName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  cells: AttendanceTrackingRow[];
}

function groupRowsByStudent(rows: AttendanceTrackingRow[]): StudentGroup[] {
  const map = new Map<string, StudentGroup>();
  for (const row of rows) {
    if (!map.has(row.studentId)) {
      map.set(row.studentId, {
        studentId: row.studentId,
        studentName: row.studentName,
        groupName: row.groupName,
        subgroupNumber: row.subgroupNumber,
        cells: [],
      });
    }
    map.get(row.studentId)!.cells.push(row);
  }
  return Array.from(map.values());
}

export function AttendanceTrackingClient({
  initialDateKey,
  initialRows,
  courseStartDateKey,
  courseEndDateKey,
}: {
  initialDateKey: string;
  initialRows: AttendanceTrackingRow[];
  courseStartDateKey: string | null;
  courseEndDateKey: string | null;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [selectedDate, setSelectedDate] = useState(initialDateKey);
  const [rows, setRows] = useState<AttendanceTrackingRow[] | null>(initialRows);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [groupFilter, setGroupFilter] = useState("");
  const [subgroupFilter, setSubgroupFilter] = useState("");
  const [nameQuery, setNameQuery] = useState("");

  const [modalRow, setModalRow] = useState<AttendanceTrackingRow | null>(null);
  const [form, setForm] = useState<AttendanceForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();

  // Which student's row currently has a quick action in flight, so only
  // that row's buttons disable - not the whole list.
  const [pendingStudentId, setPendingStudentId] = useState<string | null>(null);

  const rangeKeys = useMemo(() => {
    if (viewMode === "day") return [selectedDate];
    const week = getWeekDateKeys(selectedDate);
    return week.filter(
      (dk) =>
        (!courseStartDateKey || dk >= courseStartDateKey) &&
        (!courseEndDateKey || dk <= courseEndDateKey)
    );
  }, [viewMode, selectedDate, courseStartDateKey, courseEndDateKey]);

  const rangeStart = rangeKeys[0] ?? selectedDate;
  const rangeEnd = rangeKeys[rangeKeys.length - 1] ?? selectedDate;

  function refetchRange() {
    setLoadError(null);
    setRows(null);
    getAttendanceTrackingForAdmin(rangeStart, rangeEnd)
      .then((r) => setRows(r))
      .catch(() => {
        setRows([]);
        setLoadError("שגיאה בטעינת נתוני נוכחות. נסי לרענן.");
      });
  }

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Reset to the loading state on every range change so a slow request
    // never leaves a different day/week's rows visible under the new one.
    // `cancelled` guards against a stale request (e.g. a wide week fetch)
    // resolving after a newer, faster one (e.g. switching back to a single
    // day) and clobbering `rows` with mismatched-range data - that mismatch
    // was the root cause of the duplicate-key bug, since a day view row list
    // isn't itself deduplicated by date.
    let cancelled = false;
    setLoadError(null);
    setRows(null);
    getAttendanceTrackingForAdmin(rangeStart, rangeEnd)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setLoadError("שגיאה בטעינת נתוני נוכחות. נסי לרענן.");
      });
    return () => {
      cancelled = true;
    };
  }, [rangeStart, rangeEnd]);

  const groups = useMemo(
    () =>
      Array.from(
        new Set((rows ?? []).map((r) => r.groupName).filter((g): g is string => Boolean(g)))
      ).sort(),
    [rows]
  );

  const subgroups = useMemo(
    () =>
      Array.from(
        new Set(
          (rows ?? [])
            .filter((r) => !groupFilter || r.groupName === groupFilter)
            .map((r) => r.subgroupNumber)
            .filter((n): n is number => n != null)
        )
      ).sort((a, b) => a - b),
    [rows, groupFilter]
  );

  // Day view always renders exactly one row per student for `selectedDate` -
  // filtering by dateKey here (not just relying on the fetched range) keeps
  // that guarantee even if `rows` momentarily holds a different range's data
  // (e.g. mid-transition between day/week fetches).
  const filteredRows = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => r.dateKey === selectedDate)
      .filter((r) => {
        if (groupFilter && r.groupName !== groupFilter) return false;
        if (subgroupFilter && String(r.subgroupNumber ?? "") !== subgroupFilter) return false;
        if (q && !r.studentName.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [rows, selectedDate, groupFilter, subgroupFilter, nameQuery]);

  const filteredStudents = useMemo(() => {
    const grouped = groupRowsByStudent(rows ?? []);
    const q = nameQuery.trim().toLowerCase();
    return grouped.filter((s) => {
      if (groupFilter && s.groupName !== groupFilter) return false;
      if (subgroupFilter && String(s.subgroupNumber ?? "") !== subgroupFilter) return false;
      if (q && !s.studentName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, groupFilter, subgroupFilter, nameQuery]);

  function handleQuickAbsent(row: AttendanceTrackingRow) {
    setPendingStudentId(row.studentId);
    startSaveTransition(async () => {
      const result = await upsertAttendanceAsAdmin({
        studentId: row.studentId,
        dateKey: row.dateKey,
        status: "ABSENT",
        arrivalTime: "",
        departureTime: "",
        // A quick mark only changes status - existing notes are kept.
        notes: row.attendance?.notes ?? "",
      });
      setPendingStudentId(null);
      if (!result.success) {
        setLoadError(result.error ?? "אירעה שגיאה");
        return;
      }
      refetchRange();
    });
  }

  function handleClear(row: AttendanceTrackingRow) {
    setPendingStudentId(row.studentId);
    startSaveTransition(async () => {
      const result = await clearAttendanceAsAdmin(row.studentId, row.dateKey);
      setPendingStudentId(null);
      if (!result.success) {
        setLoadError(result.error ?? "אירעה שגיאה");
        return;
      }
      refetchRange();
    });
  }

  function handleMarkUnavailable(row: AttendanceTrackingRow) {
    setPendingStudentId(row.studentId);
    startSaveTransition(async () => {
      const result = await markStudentUnavailableForDuty(row.studentId, row.dateKey);
      setPendingStudentId(null);
      if (!result.success) {
        setLoadError(result.error ?? "אירעה שגיאה");
        return;
      }
      refetchRange();
    });
  }

  function openDetails(row: AttendanceTrackingRow) {
    setModalRow(row);
    setForm(defaultFormFromRow(row));
    setFormError(null);
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modalRow || !form) return;
    setFormError(null);

    if (!form.status) {
      setFormError("יש לבחור סטטוס נוכחות");
      return;
    }
    if (form.status === "PARTIAL" && !form.arrivalTime && !form.departureTime) {
      setFormError("יש להזין שעת הגעה או שעת עזיבה עבור נוכחות חלקית");
      return;
    }

    const status = form.status;
    startSaveTransition(async () => {
      const result = await upsertAttendanceAsAdmin({
        studentId: modalRow.studentId,
        dateKey: modalRow.dateKey,
        status,
        arrivalTime: status === "PARTIAL" ? form.arrivalTime : "",
        departureTime: status === "PARTIAL" ? form.departureTime : "",
        notes: form.notes,
      });
      if (!result.success) {
        setFormError(result.error ?? "אירעה שגיאה");
        return;
      }
      setModalRow(null);
      setForm(null);
      refetchRange();
    });
  }

  function handleClearFromModal() {
    if (!modalRow) return;
    setFormError(null);
    startSaveTransition(async () => {
      const result = await clearAttendanceAsAdmin(modalRow.studentId, modalRow.dateKey);
      if (!result.success) {
        setFormError(result.error ?? "אירעה שגיאה");
        return;
      }
      setModalRow(null);
      setForm(null);
      refetchRange();
    });
  }

  function renderWarnings(row: AttendanceTrackingRow) {
    if (row.warnings.length === 0) return null;
    return (
      <div className="mb-2 flex flex-col gap-1 rounded-lg bg-warning-muted p-2">
        {row.warnings.map((w) => (
          <p key={w.type} className="text-xs text-warning">
            {w.message}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-1 text-sm">
          תצוגה
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setViewMode("day")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                viewMode === "day"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              יום
            </button>
            <button
              type="button"
              onClick={() => setViewMode("week")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                viewMode === "week"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              שבוע
            </button>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          תאריך
          <input
            type="date"
            value={selectedDate}
            min={courseStartDateKey ?? undefined}
            max={courseEndDateKey ?? undefined}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          חיפוש לפי שם
          <input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="שם תלמיד/ה..."
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          קבוצה
          <select
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
              setSubgroupFilter("");
            }}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                קבוצה {g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          תת-קבוצה
          <select
            value={subgroupFilter}
            onChange={(e) => setSubgroupFilter(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {subgroups.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          {viewMode === "day" ? (
            <>
              {formatHebrewWeekday(parseDateKey(selectedDate))} ·{" "}
              {formatHebrewDate(parseDateKey(selectedDate))}
            </>
          ) : (
            <>
              {formatHebrewDate(parseDateKey(rangeStart))} - {formatHebrewDate(parseDateKey(rangeEnd))}
            </>
          )}
        </p>
      </div>

      {loadError && (
        <p className="rounded-lg bg-danger-muted p-3 text-sm text-danger">{loadError}</p>
      )}

      {rows === null ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          טוען...
        </p>
      ) : viewMode === "day" ? (
        filteredRows.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            אין תלמידים להצגה
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredRows.map((row) => {
              const status = row.attendance?.status ?? null;
              const isPending = pendingStudentId === row.studentId && isSaving;
              const showUnavailableButton = status === "ABSENT" && row.isAvailable;

              return (
                <div
                  key={`${row.studentId}-${row.dateKey}`}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-card-foreground">{row.studentName}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.groupName && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          קבוצה {row.groupName}
                          {row.subgroupNumber != null ? ` / ${row.subgroupNumber}` : ""}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          status ? STATUS_BADGE_CLASS[status] : DEFAULT_BADGE_CLASS
                        }`}
                      >
                        {status ? STATUS_LABELS[status] : DEFAULT_LABEL}
                      </span>
                    </div>
                  </div>

                  {status === "PARTIAL" &&
                    (row.attendance?.arrivalTime || row.attendance?.departureTime) && (
                      <p className="mb-1 text-xs text-muted-foreground">
                        {row.attendance.arrivalTime && `הגעה: ${row.attendance.arrivalTime}`}
                        {row.attendance.arrivalTime && row.attendance.departureTime && " · "}
                        {row.attendance.departureTime && `עזיבה: ${row.attendance.departureTime}`}
                      </p>
                    )}

                  <p className="mb-1 text-xs text-muted-foreground">
                    זמינות לתורנויות היום:{" "}
                    <span className={row.isAvailable ? "text-success" : "text-danger"}>
                      {row.isAvailable ? "זמין/ה" : "לא זמין/ה"}
                    </span>
                  </p>

                  <p className="mb-1 text-xs text-muted-foreground">
                    {row.assignedDuty ? (
                      <>
                        תורנות: {row.assignedDuty.dutyTypeName}
                        {" · "}
                        <span
                          className={
                            row.assignedDuty.isCompleted ? "text-success" : "text-muted-foreground"
                          }
                        >
                          {row.assignedDuty.isCompleted ? "בוצע" : "טרם בוצע"}
                        </span>
                        {!row.assignedDuty.isPublished && " · טיוטה"}
                      </>
                    ) : (
                      "אין תורנות משובצת היום"
                    )}
                  </p>

                  {row.attendance?.notes && (
                    <p className="mb-1 text-xs text-muted-foreground">
                      הערות / סיבה / החלפה: {row.attendance.notes}
                    </p>
                  )}

                  {renderWarnings(row)}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      className="!px-2 !py-1 !text-xs"
                      disabled={isPending}
                      onClick={() => handleQuickAbsent(row)}
                    >
                      סימון כנעדר/ת
                    </Button>
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1 !text-xs"
                      disabled={isPending}
                      onClick={() => openDetails(row)}
                    >
                      פרטים / עריכה
                    </Button>
                    {row.attendance && (
                      <Button
                        variant="ghost"
                        className="!px-2 !py-1 !text-xs"
                        disabled={isPending}
                        onClick={() => handleClear(row)}
                      >
                        נקה סימון
                      </Button>
                    )}
                    {showUnavailableButton && (
                      <Button
                        variant="danger"
                        className="!px-2 !py-1 !text-xs"
                        disabled={isPending}
                        onClick={() => handleMarkUnavailable(row)}
                      >
                        סמני גם כלא זמין/ה לתורנויות
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : filteredStudents.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          אין תלמידים להצגה
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredStudents.map((s) => (
            <div key={s.studentId} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-card-foreground">{s.studentName}</span>
                {s.groupName && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    קבוצה {s.groupName}
                    {s.subgroupNumber != null ? ` / ${s.subgroupNumber}` : ""}
                  </span>
                )}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {s.cells.map((cell) => {
                  const status = cell.attendance?.status ?? null;
                  const hasNote = Boolean(cell.attendance?.notes);
                  const hasWarning = cell.warnings.length > 0;
                  return (
                    <button
                      key={`${s.studentId}-${cell.dateKey}`}
                      type="button"
                      onClick={() => openDetails(cell)}
                      className={`relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 text-xs ${
                        status ? STATUS_BADGE_CLASS[status] : DEFAULT_CELL_CLASS
                      }`}
                    >
                      <span className="text-[10px] opacity-80">
                        {formatHebrewWeekdayShort(parseDateKey(cell.dateKey))}
                      </span>
                      <span className="font-medium">
                        {status ? STATUS_SHORT_LABELS[status] : "–"}
                      </span>
                      {(hasWarning || hasNote) && (
                        <span className="absolute -top-1 -left-1 flex gap-0.5">
                          {hasWarning && (
                            <span title="קיימת אזהרה" className="h-1.5 w-1.5 rounded-full bg-warning" />
                          )}
                          {hasNote && (
                            <span
                              title="קיימת הערה"
                              className="h-1.5 w-1.5 rounded-full bg-secondary-foreground"
                            />
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalRow !== null}
        title={
          modalRow
            ? `נוכחות - ${modalRow.studentName} - ${formatHebrewDate(parseDateKey(modalRow.dateKey))}`
            : "נוכחות"
        }
        onClose={() => {
          setModalRow(null);
          setForm(null);
        }}
      >
        {form && modalRow && (
          <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
            {renderWarnings(modalRow)}

            <div className="flex flex-wrap gap-2">
              {(["ABSENT", "PARTIAL"] as AttendanceStatusValue[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            status: s,
                            ...(s === "PARTIAL" ? {} : { arrivalTime: "", departureTime: "" }),
                          }
                        : f
                    )
                  }
                  className={`rounded-full px-4 py-2 text-sm font-medium ${
                    form.status === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                setForm((f) => (f ? { ...f, status: "PRESENT", arrivalTime: "", departureTime: "" } : f))
              }
              className={`self-start text-xs underline decoration-dotted ${
                form.status === "PRESENT" ? "text-card-foreground" : "text-muted-foreground"
              }`}
            >
              נוכח/ת — שמירה כסימון חריג
            </button>

            {form.status === "PARTIAL" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  שעת הגעה (איחור)
                  <input
                    value={form.arrivalTime}
                    onChange={(e) => setForm((f) => (f ? { ...f, arrivalTime: e.target.value } : f))}
                    placeholder="HH:MM"
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  שעת עזיבה (מוקדמת)
                  <input
                    value={form.departureTime}
                    onChange={(e) =>
                      setForm((f) => (f ? { ...f, departureTime: e.target.value } : f))
                    }
                    placeholder="HH:MM"
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
              </div>
            )}

            <label className="flex flex-col gap-1 text-sm">
              הערות / סיבה / החלפה
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => (f ? { ...f, notes: e.target.value } : f))}
                rows={3}
                placeholder="למשל: סיבת היעדרות, מי מחליף/ה בטיפול בסוס, הוראות מיוחדות ליום זה"
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>

            {formError && <p className="text-sm text-danger">{formError}</p>}
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {modalRow.attendance && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isSaving}
                  onClick={handleClearFromModal}
                >
                  נקה סימון
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setModalRow(null);
                  setForm(null);
                }}
              >
                ביטול
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "שומר..." : "שמירה"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
