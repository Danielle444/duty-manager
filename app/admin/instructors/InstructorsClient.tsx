"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  createInstructor,
  setInstructorActive,
  setInstructorCanEditHorseAssignments,
  setInstructorCanSendMessages,
  updateInstructor,
} from "@/lib/actions/instructors";
import { maskIdentityNumber } from "@/lib/format";

interface InstructorRow {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  identityNumber: string;
  isActive: boolean;
  canEditHorseAssignments: boolean;
  canSendMessages: boolean;
}

export function InstructorsClient({ instructors }: { instructors: InstructorRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [modalInstructor, setModalInstructor] = useState<InstructorRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          onClick={() => {
            setError(null);
            setModalInstructor("new");
          }}
        >
          + הוספת מדריך/ה
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-right font-medium">שם מלא</th>
              <th className="px-4 py-3 text-right font-medium">ת.ז.</th>
              <th className="px-4 py-3 text-right font-medium">סטטוס</th>
              <th className="px-4 py-3 text-right font-medium">עריכת חלוקת סוסים</th>
              <th className="px-4 py-3 text-right font-medium">שליחת הודעות ומשימות</th>
              <th className="px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {instructors.map((instructor) => (
              <tr key={instructor.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-card-foreground">
                  {instructor.fullName}
                </td>
                <td className="px-4 py-3 font-mono text-muted-foreground">
                  {maskIdentityNumber(instructor.identityNumber)}
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
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={instructor.canEditHorseAssignments}
                      disabled={isPending}
                      onChange={() => handleToggleCanEditHorseAssignments(instructor)}
                    />
                    יכול/ה לערוך חלוקת סוסים
                  </label>
                </td>
                <td className="px-4 py-3">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={instructor.canSendMessages}
                      disabled={isPending}
                      onChange={() => handleToggleCanSendMessages(instructor)}
                    />
                    יכול/ה לשלוח הודעות ומשימות
                  </label>
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
            {instructors.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  אין מדריכים עדיין
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
