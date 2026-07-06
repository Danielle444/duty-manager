"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  createInstructor,
  setInstructorActive,
  setInstructorCanEditHorseAssignments,
  setInstructorCanSendMessages,
  setInstructorCanEditAttendance,
  setInstructorCanEditRidingNotes,
  setInstructorCanEditHorseFeeding,
  updateInstructor,
} from "@/lib/actions/instructors";
import { maskIdentityNumber } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone-format";

interface InstructorRidingSummary {
  totalAssigned: number;
  pastAssigned: number;
  todayAssigned: number;
  upcomingAssigned: number;
}

interface InstructorRow {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  identityNumber: string;
  phone: string | null;
  isActive: boolean;
  canEditHorseAssignments: boolean;
  canSendMessages: boolean;
  canEditAttendance: boolean;
  canEditRidingNotes: boolean;
  canEditHorseFeeding: boolean;
  ridingSummary: InstructorRidingSummary;
}

export function InstructorsClient({ instructors }: { instructors: InstructorRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [modalInstructor, setModalInstructor] = useState<InstructorRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filteredInstructors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return instructors;
    return instructors.filter(
      (i) => i.fullName.toLowerCase().includes(q) || (i.phone ?? "").toLowerCase().includes(q)
    );
  }, [instructors, search]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result =
        modalInstructor && modalInstructor !== "new"
          ? await updateInstructor(modalInstructor.id, formData)
          : await createInstructor(formData);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setModalInstructor(null);
    });
  }

  function handleToggleActive(instructor: InstructorRow) {
    startTransition(async () => {
      await setInstructorActive(instructor.id, !instructor.isActive);
    });
  }

  function handleToggleCanEditHorseAssignments(instructor: InstructorRow) {
    startTransition(async () => {
      await setInstructorCanEditHorseAssignments(
        instructor.id,
        !instructor.canEditHorseAssignments
      );
    });
  }

  function handleToggleCanSendMessages(instructor: InstructorRow) {
    startTransition(async () => {
      await setInstructorCanSendMessages(instructor.id, !instructor.canSendMessages);
    });
  }

  function handleToggleCanEditAttendance(instructor: InstructorRow) {
    startTransition(async () => {
      await setInstructorCanEditAttendance(instructor.id, !instructor.canEditAttendance);
    });
  }

  function handleToggleCanEditRidingNotes(instructor: InstructorRow) {
    startTransition(async () => {
      await setInstructorCanEditRidingNotes(instructor.id, !instructor.canEditRidingNotes);
    });
  }

  function handleToggleCanEditHorseFeeding(instructor: InstructorRow) {
    startTransition(async () => {
      await setInstructorCanEditHorseFeeding(instructor.id, !instructor.canEditHorseFeeding);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setError(null);
            setModalInstructor("new");
          }}
        >
          + הוספת מדריך/ה
        </Button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם או טלפון..."
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-right font-medium">שם מלא</th>
              <th className="px-4 py-3 text-right font-medium">ת.ז.</th>
              <th className="px-4 py-3 text-right font-medium">טלפון</th>
              <th className="px-4 py-3 text-right font-medium">סטטוס</th>
              <th className="px-4 py-3 text-right font-medium">עריכת חלוקת סוסים</th>
              <th className="px-4 py-3 text-right font-medium">שליחת הודעות ומשימות</th>
              <th className="px-4 py-3 text-right font-medium">עריכת נוכחות</th>
              <th className="px-4 py-3 text-right font-medium">עריכת הערות רכיבה</th>
              <th className="px-4 py-3 text-right font-medium">עריכת האכלות</th>
              <th className="px-4 py-3 text-right font-medium">שיבוצי רכיבה (סה&quot;כ)</th>
              <th className="px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filteredInstructors.map((instructor) => (
              <tr key={instructor.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-card-foreground">
                  {instructor.fullName}
                </td>
                <td className="px-4 py-3 font-mono text-muted-foreground">
                  {maskIdentityNumber(instructor.identityNumber)}
                </td>
                <td
                  className={`px-4 py-3 ${
                    instructor.phone ? "text-muted-foreground" : "italic text-muted-foreground/70"
                  }`}
                >
                  {formatPhoneDisplay(instructor.phone)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      instructor.isActive
                        ? "bg-success-muted text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {instructor.isActive ? "פעיל/ה" : "לא פעיל/ה"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={instructor.canEditHorseAssignments}
                    disabled={isPending}
                    onChange={() => handleToggleCanEditHorseAssignments(instructor)}
                    aria-label={`יכול/ה לערוך חלוקת סוסים עבור ${instructor.fullName}`}
                    title="יכול/ה לערוך חלוקת סוסים"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={instructor.canSendMessages}
                    disabled={isPending}
                    onChange={() => handleToggleCanSendMessages(instructor)}
                    aria-label={`יכול/ה לשלוח הודעות ומשימות עבור ${instructor.fullName}`}
                    title="יכול/ה לשלוח הודעות ומשימות"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={instructor.canEditAttendance}
                    disabled={isPending}
                    onChange={() => handleToggleCanEditAttendance(instructor)}
                    aria-label={`יכול/ה לערוך נוכחות עבור ${instructor.fullName}`}
                    title="יכול/ה לערוך נוכחות"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={instructor.canEditRidingNotes}
                    disabled={isPending}
                    onChange={() => handleToggleCanEditRidingNotes(instructor)}
                    aria-label={`יכול/ה לערוך הערות רכיבה עבור ${instructor.fullName}`}
                    title="יכול/ה לערוך הערות רכיבה"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={instructor.canEditHorseFeeding}
                    disabled={isPending}
                    onChange={() => handleToggleCanEditHorseFeeding(instructor)}
                    aria-label={`יכול/ה לערוך האכלות עבור ${instructor.fullName}`}
                    title="יכול/ה לערוך האכלות"
                  />
                </td>
                <td
                  className="px-4 py-3 text-muted-foreground"
                  title={`היום: ${instructor.ridingSummary.todayAssigned} · עתידיות: ${instructor.ridingSummary.upcomingAssigned} · עברו: ${instructor.ridingSummary.pastAssigned}`}
                >
                  <span className="font-semibold text-card-foreground">
                    {instructor.ridingSummary.totalAssigned}
                  </span>{" "}
                  שיבוצים
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1"
                      onClick={() => {
                        setError(null);
                        setModalInstructor(instructor);
                      }}
                    >
                      עריכה
                    </Button>
                    <Button
                      variant={instructor.isActive ? "danger" : "secondary"}
                      className="!px-2 !py-1"
                      disabled={isPending}
                      onClick={() => handleToggleActive(instructor)}
                    >
                      {instructor.isActive ? "השבתה" : "הפעלה"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredInstructors.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                  {instructors.length === 0 ? "אין מדריכים עדיין" : "אין מדריכים התואמים את החיפוש"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalInstructor !== null}
        title={modalInstructor === "new" ? "הוספת מדריך/ה" : "עריכת מדריך/ה"}
        onClose={() => setModalInstructor(null)}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            שם פרטי
            <input
              name="firstName"
              defaultValue={modalInstructor !== "new" ? modalInstructor?.firstName : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            שם משפחה
            <input
              name="lastName"
              defaultValue={modalInstructor !== "new" ? modalInstructor?.lastName : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            תעודת זהות
            <input
              name="identityNumber"
              inputMode="numeric"
              defaultValue={modalInstructor !== "new" ? modalInstructor?.identityNumber : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            טלפון (אופציונלי)
            <input
              name="phone"
              defaultValue={modalInstructor !== "new" ? modalInstructor?.phone ?? "" : ""}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalInstructor(null)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
