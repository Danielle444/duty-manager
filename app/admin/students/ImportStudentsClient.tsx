"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  commitStudentImport,
  parseStudentsExcel,
  type AvailabilityChoice,
  type StudentImportCandidate,
  type StudentImportRowAction,
} from "@/lib/actions/student-import";

interface EditableCandidate extends StudentImportCandidate {
  action: StudentImportRowAction;
}

interface PresetOption {
  id: string;
  name: string;
}

export function ImportStudentsClient({ presets }: { presets: PresetOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<EditableCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const [availabilityMode, setAvailabilityMode] =
    useState<AvailabilityChoice["mode"]>("whole-course");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [presetId, setPresetId] = useState("");

  function reset() {
    setCandidates(null);
    setError(null);
    setSummary(null);
  }

  function handleParse(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSummary(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await parseStudentsExcel(formData);
      if (!result.success || !result.candidates) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setCandidates(
        result.candidates.map((c) => ({
          ...c,
          action: c.matchedStudentId ? "update" : "create",
        }))
      );
    });
  }

  function updateCandidate(key: string, patch: Partial<EditableCandidate>) {
    setCandidates((prev) =>
      prev ? prev.map((c) => (c.key === key ? { ...c, ...patch } : c)) : prev
    );
  }

  function handleConfirm() {
    if (!candidates) return;
    setError(null);

    let availabilityChoice: AvailabilityChoice;
    if (availabilityMode === "range") {
      if (!rangeStart || !rangeEnd) {
        setError("יש לבחור טווח תאריכים");
        return;
      }
      availabilityChoice = { mode: "range", startDate: rangeStart, endDate: rangeEnd };
    } else if (availabilityMode === "preset") {
      if (!presetId) {
        setError("יש לבחור פריסט");
        return;
      }
      availabilityChoice = { mode: "preset", presetId };
    } else {
      availabilityChoice = { mode: "whole-course" };
    }

    startTransition(async () => {
      const result = await commitStudentImport(
        candidates.map((c) => ({
          firstName: c.firstName,
          lastName: c.lastName,
          groupName: c.groupName,
          subgroupNumber: c.subgroupNumber,
          identityNumber: c.identityNumber,
          phone: c.phone,
          action: c.action,
          matchedStudentId: c.matchedStudentId,
        })),
        availabilityChoice
      );
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      setSummary(`נוצרו ${result.createdCount} תלמידים, עודכנו ${result.updatedCount}`);
      setCandidates(null);
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        ייבוא מקובץ Excel
      </Button>

      <Modal open={open} title="ייבוא תלמידים מקובץ Excel" onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-4">
          {!candidates && (
            <form onSubmit={handleParse} className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                העמודות הנדרשות בקובץ: קבוצה, מס קבוצה, שם משפחה, שם פרטי, ת.ז. (טלפון אופציונלי)
              </p>
              <input
                type="file"
                name="file"
                accept=".xlsx"
                required
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" disabled={isPending}>
                {isPending ? "מפענח..." : "פענוח קובץ"}
              </Button>
            </form>
          )}

          {candidates && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                נמצאו {candidates.length} תלמידים. ניתן לערוך כל שדה ולבחור פעולה לכל שורה.
              </p>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                {candidates.map((c) => (
                  <div key={c.key} className="border-b border-border p-3 last:border-0">
                    <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <input
                        value={c.firstName}
                        onChange={(e) =>
                          updateCandidate(c.key, { firstName: e.target.value })
                        }
                        placeholder="שם פרטי"
                        className="rounded-lg border border-border px-2 py-1 text-sm"
                      />
                      <input
                        value={c.lastName}
                        onChange={(e) =>
                          updateCandidate(c.key, { lastName: e.target.value })
                        }
                        placeholder="שם משפחה"
                        className="rounded-lg border border-border px-2 py-1 text-sm"
                      />
                      <input
                        value={c.identityNumber}
                        onChange={(e) =>
                          updateCandidate(c.key, { identityNumber: e.target.value })
                        }
                        placeholder="ת.ז."
                        className="rounded-lg border border-border px-2 py-1 text-sm font-mono"
                      />
                      <input
                        value={c.groupName}
                        onChange={(e) =>
                          updateCandidate(c.key, { groupName: e.target.value })
                        }
                        placeholder="קבוצה"
                        className="rounded-lg border border-border px-2 py-1 text-sm"
                      />
                      <input
                        value={c.subgroupNumber ?? ""}
                        onChange={(e) =>
                          updateCandidate(c.key, {
                            subgroupNumber: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        type="number"
                        min={1}
                        placeholder="מס קבוצה"
                        className="rounded-lg border border-border px-2 py-1 text-sm"
                      />
                      <input
                        value={c.phone}
                        onChange={(e) => updateCandidate(c.key, { phone: e.target.value })}
                        placeholder="טלפון"
                        className="rounded-lg border border-border px-2 py-1 text-sm"
                      />
                    </div>
                    <select
                      value={c.action}
                      onChange={(e) =>
                        updateCandidate(c.key, {
                          action: e.target.value as StudentImportRowAction,
                        })
                      }
                      className="rounded-lg border border-border px-2 py-1 text-sm"
                    >
                      {c.matchedStudentId && <option value="update">עדכון קיים</option>}
                      <option value="create">יצירת חדש</option>
                      <option value="skip">דילוג</option>
                    </select>
                    {c.matchedStudentId && (
                      <span className="mr-2 text-xs text-muted-foreground">
                        נמצא/ת תלמיד/ה קיימ/ת עם ת.ז. זהה
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-lg bg-muted p-3">
                <p className="mb-2 text-sm font-medium text-card-foreground">
                  זמינות התלמידים המיובאים
                </p>
                <div className="flex flex-col gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="availabilityMode"
                      checked={availabilityMode === "whole-course"}
                      onChange={() => setAvailabilityMode("whole-course")}
                    />
                    זמינים לאורך כל הקורס
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="availabilityMode"
                      checked={availabilityMode === "range"}
                      onChange={() => setAvailabilityMode("range")}
                    />
                    זמינים בטווח תאריכים ספציפי
                  </label>
                  {availabilityMode === "range" && (
                    <div className="flex gap-2 pr-6">
                      <input
                        type="date"
                        value={rangeStart}
                        onChange={(e) => setRangeStart(e.target.value)}
                        className="rounded-lg border border-border px-2 py-1 text-sm"
                      />
                      <input
                        type="date"
                        value={rangeEnd}
                        onChange={(e) => setRangeEnd(e.target.value)}
                        className="rounded-lg border border-border px-2 py-1 text-sm"
                      />
                    </div>
                  )}
                  {presets.length > 0 && (
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="availabilityMode"
                        checked={availabilityMode === "preset"}
                        onChange={() => setAvailabilityMode("preset")}
                      />
                      לפי פריסט שמור
                    </label>
                  )}
                  {availabilityMode === "preset" && (
                    <select
                      value={presetId}
                      onChange={(e) => setPresetId(e.target.value)}
                      className="mr-6 rounded-lg border border-border px-2 py-1 text-sm"
                    >
                      <option value="">בחרו פריסט</option>
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setCandidates(null)}>
                  ביטול
                </Button>
                <Button type="button" onClick={handleConfirm} disabled={isPending}>
                  {isPending ? "שומר..." : "שמירת הייבוא"}
                </Button>
              </div>
            </div>
          )}

          {summary && <p className="text-sm text-success">{summary}</p>}
        </div>
      </Modal>
    </>
  );
}
