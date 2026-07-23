"use client";

/**
 * MULTI-COURSE (enrollment slice E3) - the minimal client enrollment form.
 *
 * The ONLY reason this is a client component is the "disable duplicate submission
 * while pending" requirement: useFormStatus() (which must run inside the <form>)
 * disables the submit button while the server action is in flight. It holds NO
 * other client state.
 *
 * It renders EXACTLY two selects - one trainee (studentId) and one leaf subgroup
 * (courseGroupId) - plus the submit button. Both option lists are supplied by the
 * server page: the trainee options carry a PRE-MASKED label (the raw identity
 * number never reaches the client), and the subgroup options are ONLY leaf
 * subgroups (top-level groups are excluded server-side). The submitted values are
 * the exact CourseGroup / Student cuids.
 *
 * There is deliberately NO status / isPrimary / effectiveFrom / startDate input
 * and NO offering selector: the offering id is bound into the server action on
 * the server, and every operational value is server-derived inside E1.
 */
import { useFormStatus } from "react-dom";

/** A trainee option: value = studentId, label = pre-masked "name — ••••1234". */
export interface TraineeOption {
  readonly id: string;
  readonly label: string;
}

/** A leaf-subgroup option: value = courseGroupId, label = e.g. "ג / 1". */
export interface SubgroupOption {
  readonly id: string;
  readonly label: string;
}

function EnrollSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "רושם…" : "רישום"}
    </button>
  );
}

export function EnrollExistingTraineeForm({
  action,
  trainees,
  subgroups,
}: {
  action: (formData: FormData) => void | Promise<void>;
  trainees: readonly TraineeOption[];
  subgroups: readonly SubgroupOption[];
}) {
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">חניך</span>
        <select
          name="studentId"
          required
          defaultValue=""
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
        >
          <option value="" disabled>
            בחרו חניך…
          </option>
          {trainees.map((trainee) => (
            <option key={trainee.id} value={trainee.id}>
              {trainee.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">תת־קבוצה</span>
        <select
          name="courseGroupId"
          required
          defaultValue=""
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
        >
          <option value="" disabled>
            בחרו תת־קבוצה…
          </option>
          {subgroups.map((subgroup) => (
            <option key={subgroup.id} value={subgroup.id}>
              {subgroup.label}
            </option>
          ))}
        </select>
      </label>

      <div>
        <EnrollSubmitButton />
      </div>
    </form>
  );
}
