"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { createStudent, setStudentActive, updateStudent } from "@/lib/actions/students";
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

export function StudentsClient({
  students,
  presets,
  courseRange,
}: {
  students: StudentRow[];
  presets: PresetOption[];
  courseRange: CourseRange | null;
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

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) || (s.phone ?? "").toLowerCase().includes(q)
    );
  }, [students, search]);

  function openModal(student: StudentRow | "new") {
    setError(null);
    setAvailabilityMessage(null);
    setAvailabilityError(null);
    setAvailabilityMode("whole-course");
    setAvailabilityStart(courseRange?.startDate ?? "");
    setAvailabilityEnd(courseRange?.endDate ?? "");
    setModalStudent(student);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
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
                      href={`/admin/students/${student.id}/riding-history`}
                      className="rounded-lg px-2 py-1 text-sm font-medium text-secondary-foreground underline hover:opacity-80"
                    >
                      היסטוריית רכיבה
                    </Link>
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
                  {students.length === 0 ? "אין חניכים עדיין" : "אין חניכים התואמים את החיפוש"}
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
          <label className="flex flex-col gap-1 text-sm">
            קבוצה (אופציונלי)
            <input
              name="groupName"
              defaultValue={modalStudent !== "new" ? modalStudent?.groupName ?? "" : ""}
              placeholder="א / ב"
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            מס קבוצה (אופציונלי)
            <input
              name="subgroupNumber"
              type="number"
              min={1}
              defaultValue={modalStudent !== "new" ? modalStudent?.subgroupNumber ?? "" : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
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
