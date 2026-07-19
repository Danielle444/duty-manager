"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  changeTraineeGroup,
  createStudent,
  setStudentActive,
  updateStudent,
} from "@/lib/actions/students";
import type { GroupChangeOption } from "@/lib/course/group-change-options";
import { validateCreateTraineeForm } from "@/lib/course/create-trainee-form";
import { setStudentAvailabilityScheme } from "@/lib/actions/availability";
import { maskIdentityNumber } from "@/lib/format";
import { formatHebrewDate, parseDateKey } from "@/lib/dates";
import { formatPhoneDisplay } from "@/lib/phone-format";
import { ImportStudentsClient } from "@/app/admin/students/ImportStudentsClient";

interface StudentRow {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  identityNumber: string;
  phone: string | null;
  isActive: boolean;
}

interface PresetOption {
  id: string;
  name: string;
}

interface CourseRange {
  startDate: string;
  endDate: string;
}

type GroupFilter = "all" | "א" | "ב" | "none";
type ActiveFilter = "all" | "active" | "inactive";
type SortMode = "name" | "group-subgroup" | "subgroup-name";

function matchesGroupFilter(student: StudentRow, filter: GroupFilter): boolean {
  if (filter === "all") return true;
  if (filter === "none") return student.groupName === null;
  return student.groupName === filter;
}

// Which subgroup-select options are valid for the given group scope (`"all"`
// shows every subgroup in the whole list, a specific group/`"none"` scopes
// down to just that group's own subgroups) - used both to render the select
// and, on group change, to check whether the currently-picked subgroup is
// still one of them.
function subgroupOptionsFor(rows: StudentRow[], group: GroupFilter): { numbers: number[]; hasNone: boolean } {
  const scoped = group === "all" ? rows : rows.filter((s) => matchesGroupFilter(s, group));
  const numbers = Array.from(
    new Set(scoped.map((s) => s.subgroupNumber).filter((n): n is number => n !== null))
  ).sort((a, b) => a - b);
  const hasNone = scoped.some((s) => s.subgroupNumber === null);
  return { numbers, hasNone };
}

function matchesSubgroupFilter(student: StudentRow, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "none") return student.subgroupNumber === null;
  // Defensive Number() coercion on both sides - subgroupNumber is typed as
  // number|null from the server, but this keeps the comparison correct even
  // if it ever arrives as a numeric string.
  return student.subgroupNumber !== null && Number(student.subgroupNumber) === Number(filter);
}

// א before ב before any other (unexpected) group text, missing group last.
function groupRank(groupName: string | null): number {
  if (groupName === null) return 3;
  if (groupName === "א") return 0;
  if (groupName === "ב") return 1;
  return 2;
}

// Ascending numeric order (2 before 10), missing subgroup last - Number()
// coercion guards the same defensive case as matchesSubgroupFilter above.
function subgroupRank(subgroupNumber: number | null): number {
  if (subgroupNumber === null) return Number.POSITIVE_INFINITY;
  const n = Number(subgroupNumber);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function compareFullName(a: StudentRow, b: StudentRow): number {
  return a.fullName.localeCompare(b.fullName, "he");
}

function compareByName(a: StudentRow, b: StudentRow): number {
  return compareFullName(a, b);
}

function compareByGroupThenSubgroup(a: StudentRow, b: StudentRow): number {
  return (
    groupRank(a.groupName) - groupRank(b.groupName) ||
    subgroupRank(a.subgroupNumber) - subgroupRank(b.subgroupNumber) ||
    compareFullName(a, b)
  );
}

function compareBySubgroupThenName(a: StudentRow, b: StudentRow): number {
  return (
    subgroupRank(a.subgroupNumber) - subgroupRank(b.subgroupNumber) ||
    compareFullName(a, b) ||
    groupRank(a.groupName) - groupRank(b.groupName)
  );
}

function comparatorForSortMode(mode: SortMode): (a: StudentRow, b: StudentRow) => number {
  if (mode === "group-subgroup") return compareByGroupThenSubgroup;
  if (mode === "subgroup-name") return compareBySubgroupThenName;
  return compareByName;
}

export function StudentsClient({
  students,
  presets,
  courseRange,
  groupChangeOptions,
  groupChangeDisabledMessage,
}: {
  students: StudentRow[];
  presets: PresetOption[];
  courseRange: CourseRange | null;
  groupChangeOptions: GroupChangeOption[];
  groupChangeDisabledMessage: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [modalStudent, setModalStudent] = useState<StudentRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availabilityMode, setAvailabilityMode] = useState<"whole-course" | "range">(
    "whole-course"
  );
  const [availabilityStart, setAvailabilityStart] = useState("");
  const [availabilityEnd, setAvailabilityEnd] = useState("");
  const [availabilityPending, startAvailabilityTransition] = useTransition();
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [subgroupFilter, setSubgroupFilter] = useState("all");
  // "all" preserves the page's existing default of showing active and
  // inactive trainees together - no existing active/inactive filter existed
  // before this, so this default must not silently hide anyone.
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("group-subgroup");

  // W6D3: local, optimistic group overrides applied after a successful group
  // change so the moved trainee's row reflects the new group immediately (the
  // server revalidate converges the canonical value shortly after).
  const [groupOverrides, setGroupOverrides] = useState<
    Record<string, { groupName: string; subgroupNumber: number }>
  >({});
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupChangePending, startGroupChangeTransition] = useTransition();
  const [groupChangeMessage, setGroupChangeMessage] = useState<string | null>(null);
  const [groupChangeError, setGroupChangeError] = useState<string | null>(null);

  const effectiveStudents = useMemo(
    () =>
      students.map((s) => {
        const override = groupOverrides[s.id];
        return override
          ? { ...s, groupName: override.groupName, subgroupNumber: override.subgroupNumber }
          : s;
      }),
    [students, groupOverrides]
  );

  const hasNoGroup = useMemo(
    () => effectiveStudents.some((s) => s.groupName === null),
    [effectiveStudents]
  );
  const { numbers: subgroupNumbers, hasNone: hasNoSubgroup } = useMemo(
    () => subgroupOptionsFor(effectiveStudents, groupFilter),
    [effectiveStudents, groupFilter]
  );

  // Preselect the trainee's current matching leaf group, when one of the
  // server-provided options matches their current group + subgroup.
  function matchingOptionId(groupName: string | null, subgroupNumber: number | null): string {
    if (groupName === null || subgroupNumber === null) return "";
    const match = groupChangeOptions.find(
      (o) => o.parentName === groupName && o.subgroupNumber === subgroupNumber
    );
    return match ? match.courseGroupId : "";
  }

  // Changing the group can leave a previously-picked subgroup no longer
  // meaningful (e.g. "תת-קבוצה 3" picked while on "קבוצה א", then switching
  // to "קבוצה ב" which has no subgroup 3) - reset it back to "כל תתי
  // הקבוצות" rather than silently filtering against a stale, invisible value.
  function handleGroupFilterChange(next: GroupFilter) {
    setGroupFilter(next);
    const nextOptions = subgroupOptionsFor(effectiveStudents, next);
    const stillValid =
      subgroupFilter === "all" ||
      (subgroupFilter === "none" && nextOptions.hasNone) ||
      nextOptions.numbers.some((n) => String(n) === subgroupFilter);
    if (!stillValid) setSubgroupFilter("all");
  }

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = effectiveStudents.filter((s) => {
      if (activeFilter === "active" && !s.isActive) return false;
      if (activeFilter === "inactive" && s.isActive) return false;
      if (!matchesGroupFilter(s, groupFilter)) return false;
      if (!matchesSubgroupFilter(s, subgroupFilter)) return false;
      if (q && !(s.fullName.toLowerCase().includes(q) || (s.phone ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
    // Sort a copy - never mutate the original loaded `students` array.
    return [...matches].sort(comparatorForSortMode(sortMode));
  }, [effectiveStudents, search, groupFilter, subgroupFilter, activeFilter, sortMode]);

  function openModal(student: StudentRow | "new") {
    setError(null);
    setAvailabilityMessage(null);
    setAvailabilityError(null);
    setAvailabilityMode("whole-course");
    setAvailabilityStart(courseRange?.startDate ?? "");
    setAvailabilityEnd(courseRange?.endDate ?? "");
    setGroupChangeMessage(null);
    setGroupChangeError(null);
    setSelectedGroupId(
      student === "new" ? "" : matchingOptionId(student.groupName, student.subgroupNumber)
    );
    setModalStudent(student);
  }

  function handleSaveGroupChange() {
    if (modalStudent === "new" || modalStudent === null) return;
    const option = groupChangeOptions.find((o) => o.courseGroupId === selectedGroupId);
    if (!option) return;
    const studentId = modalStudent.id;
    setGroupChangeMessage(null);
    setGroupChangeError(null);
    startGroupChangeTransition(async () => {
      const result = await changeTraineeGroup(studentId, selectedGroupId);
      if (!result.success) {
        setGroupChangeError(result.error ?? "אירעה שגיאה");
        return;
      }
      // Reflect the new group on the row immediately (server revalidate follows).
      setGroupOverrides((prev) => ({
        ...prev,
        [studentId]: { groupName: option.parentName, subgroupNumber: option.subgroupNumber },
      }));
      setGroupChangeMessage("הקבוצה עודכנה בהצלחה");
    });
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const isCreate = modalStudent === "new";
    // W6B: a NEW trainee requires group + subgroup (the server refuses to create
    // otherwise). Block here with the same Hebrew wording. Edit is exempt so a
    // legacy trainee with a blank group/subgroup stays editable.
    if (isCreate) {
      const validationError = validateCreateTraineeForm({
        groupName: String(formData.get("groupName") ?? ""),
        subgroupNumber: String(formData.get("subgroupNumber") ?? ""),
      });
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    startTransition(async () => {
      const result =
        modalStudent && modalStudent !== "new"
          ? await updateStudent(modalStudent.id, formData)
          : await createStudent(formData);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setModalStudent(null);
    });
  }

  function handleToggleActive(student: StudentRow) {
    startTransition(async () => {
      await setStudentActive(student.id, !student.isActive);
    });
  }

  function handleSaveAvailability() {
    if (modalStudent === "new" || modalStudent === null) return;
    setAvailabilityMessage(null);
    setAvailabilityError(null);
    const studentId = modalStudent.id;
    startAvailabilityTransition(async () => {
      const result = await setStudentAvailabilityScheme(
        studentId,
        availabilityMode === "whole-course"
          ? { mode: "whole-course" }
          : { mode: "range", startDate: availabilityStart, endDate: availabilityEnd }
      );
      if (!result.success) {
        setAvailabilityError(result.error ?? "אירעה שגיאה");
        return;
      }
      setAvailabilityMessage("הזמינות נשמרה בהצלחה");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => openModal("new")}>+ הוספת חניך/ה</Button>
        <ImportStudentsClient presets={presets} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם או טלפון..."
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={groupFilter}
          onChange={(e) => handleGroupFilterChange(e.target.value as GroupFilter)}
          className="rounded-lg border border-border px-3 py-2 text-sm"
        >
          <option value="all">כל הקבוצות</option>
          <option value="א">קבוצה א</option>
          <option value="ב">קבוצה ב</option>
          {hasNoGroup && <option value="none">ללא קבוצה</option>}
        </select>
        <select
          value={subgroupFilter}
          onChange={(e) => setSubgroupFilter(e.target.value)}
          className="rounded-lg border border-border px-3 py-2 text-sm"
        >
          <option value="all">כל תתי הקבוצות</option>
          {subgroupNumbers.map((n) => (
            <option key={n} value={String(n)}>
              תת-קבוצה {n}
            </option>
          ))}
          {hasNoSubgroup && <option value="none">ללא תת־קבוצה</option>}
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
          className="rounded-lg border border-border px-3 py-2 text-sm"
        >
          <option value="all">כולם</option>
          <option value="active">פעילים</option>
          <option value="inactive">לא פעילים</option>
        </select>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="rounded-lg border border-border px-3 py-2 text-sm"
        >
          <option value="group-subgroup">קבוצה ותת־קבוצה</option>
          <option value="name">שם א׳–ב׳</option>
          <option value="subgroup-name">תת־קבוצה ושם</option>
        </select>
      </div>

      {/* Bounded self-contained scroll box (same max-h-[70vh] overflow-auto
          pattern as ScheduleGrid.tsx/TeachingPracticeManager.tsx) - the
          header row's sticky top-0 below sticks to the top of *this* box
          only, never the page, so it can't collide with the admin layout's
          own sticky header. A short filtered result never hits max-h, so it
          never looks boxed-in. */}
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">שם מלא</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">קבוצה</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">מס קבוצה</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">ת.ז.</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">טלפון</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">סטטוס</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.map((student) => (
              <tr key={student.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-card-foreground">
                  {student.fullName}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {student.groupName ?? "-"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {student.subgroupNumber ?? "-"}
                </td>
                <td className="px-4 py-3 font-mono text-muted-foreground">
                  {maskIdentityNumber(student.identityNumber)}
                </td>
                <td
                  className={`px-4 py-3 ${
                    student.phone ? "text-muted-foreground" : "italic text-muted-foreground/70"
                  }`}
                >
                  {formatPhoneDisplay(student.phone)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      student.isActive
                        ? "bg-success-muted text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {student.isActive ? "פעיל/ה" : "לא פעיל/ה"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1"
                      onClick={() => openModal(student)}
                    >
                      עריכה
                    </Button>
                    <Button
                      variant={student.isActive ? "danger" : "secondary"}
                      className="!px-2 !py-1"
                      disabled={isPending}
                      onClick={() => handleToggleActive(student)}
                    >
                      {student.isActive ? "השבתה" : "הפעלה"}
                    </Button>
                    <Link
                      href={`/admin/trainee-progress?studentId=${student.id}`}
                      className="rounded-lg px-2 py-1 text-sm font-medium text-secondary-foreground underline hover:opacity-80"
                    >
                      מעקב ומשובים
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {filteredStudents.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {students.length === 0 ? "אין חניכים עדיין" : "אין חניכים התואמים את הסינון הנוכחי"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalStudent !== null}
        title={modalStudent === "new" ? "הוספת חניך/ה" : "עריכת חניך/ה"}
        onClose={() => setModalStudent(null)}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            שם פרטי
            <input
              name="firstName"
              defaultValue={modalStudent !== "new" ? modalStudent?.firstName : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            שם משפחה
            <input
              name="lastName"
              defaultValue={modalStudent !== "new" ? modalStudent?.lastName : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            תעודת זהות
            <input
              name="identityNumber"
              inputMode="numeric"
              defaultValue={modalStudent !== "new" ? modalStudent?.identityNumber : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          {/* W6D3: the free-text group/subgroup inputs are for CREATION only.
              An existing trainee's group is changed via the dedicated
              "שינוי קבוצה בקורס הנוכחי" control below, which writes the
              authoritative GroupMembership - editing no longer writes group. */}
          {modalStudent === "new" && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                קבוצה
                <input
                  name="groupName"
                  placeholder="א / ב"
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                מס קבוצה
                <input
                  name="subgroupNumber"
                  type="number"
                  min={1}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                  required
                />
              </label>
            </>
          )}
          <label className="flex flex-col gap-1 text-sm">
            טלפון (אופציונלי)
            <input
              name="phone"
              defaultValue={modalStudent !== "new" ? modalStudent?.phone ?? "" : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalStudent(null)}
            >
              ביטול
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>

        {modalStudent !== null && modalStudent !== "new" && (
          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="text-sm font-bold text-card-foreground">שינוי קבוצה בקורס הנוכחי</h3>
            {groupChangeDisabledMessage ? (
              <p className="text-xs text-danger">{groupChangeDisabledMessage}</p>
            ) : groupChangeOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                לא הוגדרו קבוצות זמינות בקורס הנוכחי
              </p>
            ) : (
              <>
                <select
                  value={selectedGroupId}
                  onChange={(e) => {
                    setSelectedGroupId(e.target.value);
                    setGroupChangeMessage(null);
                    setGroupChangeError(null);
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <option value="">בחר/י קבוצה</option>
                  {groupChangeOptions.map((o) => (
                    <option key={o.courseGroupId} value={o.courseGroupId}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {groupChangeError && <p className="text-sm text-danger">{groupChangeError}</p>}
                {groupChangeMessage && (
                  <p className="text-sm text-success">{groupChangeMessage}</p>
                )}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={groupChangePending || !selectedGroupId}
                    onClick={handleSaveGroupChange}
                  >
                    {groupChangePending ? "שומר..." : "שמור שינוי קבוצה"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {modalStudent !== null && modalStudent !== "new" && (
          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="text-sm font-bold text-card-foreground">זמינות בקורס</h3>
            {courseRange ? (
              <p className="text-xs text-muted-foreground">
                טווח הקורס: {formatHebrewDate(parseDateKey(courseRange.startDate))} עד{" "}
                {formatHebrewDate(parseDateKey(courseRange.endDate))}
              </p>
            ) : (
              <p className="text-xs text-danger">לא הוגדר טווח תאריכים לקורס</p>
            )}

            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="availabilityMode"
                  checked={availabilityMode === "whole-course"}
                  onChange={() => setAvailabilityMode("whole-course")}
                />
                זמין/ה לכל הקורס
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="availabilityMode"
                  checked={availabilityMode === "range"}
                  onChange={() => setAvailabilityMode("range")}
                />
                זמין/ה בטווח תאריכים מסוים
              </label>
            </div>

            {availabilityMode === "range" && (
              <div className="flex flex-wrap gap-2">
                <label className="flex flex-col gap-1 text-xs">
                  מתאריך
                  <input
                    type="date"
                    value={availabilityStart}
                    min={courseRange?.startDate}
                    max={courseRange?.endDate}
                    onChange={(e) => setAvailabilityStart(e.target.value)}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  עד תאריך
                  <input
                    type="date"
                    value={availabilityEnd}
                    min={courseRange?.startDate}
                    max={courseRange?.endDate}
                    onChange={(e) => setAvailabilityEnd(e.target.value)}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </label>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              לעריכת זמינות מדויקת לפי תאריך בודד, ניתן להשתמש ב
              <a href="/admin/availability" className="mx-1 text-accent underline">
                מסך הזמינות
              </a>
              .
            </p>

            {availabilityError && <p className="text-sm text-danger">{availabilityError}</p>}
            {availabilityMessage && (
              <p className="text-sm text-success">{availabilityMessage}</p>
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                variant="secondary"
                disabled={availabilityPending || !courseRange}
                onClick={handleSaveAvailability}
              >
                {availabilityPending ? "שומר..." : "שמירת זמינות"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
