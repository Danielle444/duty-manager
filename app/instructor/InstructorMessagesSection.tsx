"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  createMessageTaskAsInstructor,
  type MessageAudienceValue,
  type MessageTaskTypeValue,
} from "@/lib/actions/messages";

interface StudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
}

const AUDIENCE_LABELS: Record<MessageAudienceValue, string> = {
  ALL: "כל התלמידים הפעילים",
  GROUP: "קבוצה",
  SPECIFIC: "תלמידים ספציפיים",
};

// Sending is gated on canSend, which InstructorClient refreshes from the DB
// on every session load - but the real gate is server-side, inside
// createMessageTaskAsInstructor itself, which re-checks canSendMessages by
// instructorId regardless of what this component renders.
export function InstructorMessagesSection({
  instructorId,
  canSend,
  students,
}: {
  instructorId: string;
  canSend: boolean;
  students: StudentOption[];
}) {
  const [type, setType] = useState<MessageTaskTypeValue>("MESSAGE");
  const [audience, setAudience] = useState<MessageAudienceValue>("ALL");
  const [groupName, setGroupName] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const groups = useMemo(
    () =>
      Array.from(new Set(students.map((s) => s.groupName).filter((g): g is string => Boolean(g)))).sort(),
    [students]
  );

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.fullName.toLowerCase().includes(q));
  }, [students, studentSearch]);

  function toggleStudent(id: string) {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function resetForm() {
    setType("MESSAGE");
    setAudience("ALL");
    setGroupName("");
    setSelectedStudentIds([]);
    setStudentSearch("");
    setTitle("");
    setBody("");
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const result = await createMessageTaskAsInstructor(instructorId, {
        type,
        title,
        body,
        audience,
        groupName: audience === "GROUP" ? groupName : undefined,
        studentIds: audience === "SPECIFIC" ? selectedStudentIds : undefined,
      });
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      resetForm();
      setSuccessMessage("נשלח בהצלחה");
    });
  }

  if (!canSend) {
    return (
      <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
        אין הרשאה לשליחת הודעות ומשימות
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-bold text-card-foreground">יצירת הודעה/משימה</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="type"
                checked={type === "MESSAGE"}
                onChange={() => setType("MESSAGE")}
              />
              הודעה
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="type"
                checked={type === "TASK"}
                onChange={() => setType("TASK")}
              />
              משימה
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            כותרת
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-xl border border-border px-3 py-2.5 text-base"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            תוכן
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="rounded-xl border border-border px-3 py-2.5 text-base"
              required
            />
          </label>

          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium text-card-foreground">נמענים</p>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === "ALL"}
                onChange={() => setAudience("ALL")}
              />
              {AUDIENCE_LABELS.ALL}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === "GROUP"}
                onChange={() => setAudience("GROUP")}
              />
              קבוצה
            </label>
            {audience === "GROUP" && (
              <select
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="rounded-xl border border-border px-3 py-2.5 text-base"
              >
                <option value="">בחרו קבוצה</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    קבוצה {g}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === "SPECIFIC"}
                onChange={() => setAudience("SPECIFIC")}
              />
              {AUDIENCE_LABELS.SPECIFIC}
            </label>
            {audience === "SPECIFIC" && (
              <div className="flex flex-col gap-2">
                <input
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="חיפוש לפי שם..."
                  className="rounded-xl border border-border px-3 py-2.5 text-base"
                />
                <p className="text-xs text-muted-foreground">נבחרו {selectedStudentIds.length}</p>
                <div className="max-h-60 overflow-y-auto rounded-xl border border-border">
                  {filteredStudents.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">לא נמצאו תלמידים</p>
                  ) : (
                    filteredStudents.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedStudentIds.includes(s.id)}
                          onChange={() => toggleStudent(s.id)}
                        />
                        {s.fullName}
                        {s.groupName && (
                          <span className="text-xs text-muted-foreground">קבוצה {s.groupName}</span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          {successMessage && <p className="text-sm text-success">{successMessage}</p>}
          <Button type="submit" disabled={isPending} className="!py-3 !text-base">
            {isPending ? "שולח..." : "שליחה"}
          </Button>
        </form>
      </div>
    </div>
  );
}
