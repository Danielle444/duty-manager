/**
 * MULTI-COURSE (enrollment slice E3) - admin one-at-a-time trainee enrollment for
 * ONE exact CourseOffering.
 *
 * Server Component only. It takes the URL [courseOfferingId] as the sole
 * authoritative scope and, in a fixed order:
 *   1. re-validates the admin + exact offering via requireAdminCourseOffering()
 *      (admin-authorization-first, exact-id lookup, no cookie, no fallback, no
 *      singleton resolver);
 *   2. asserts the read is permitted for the offering's status via the pure
 *      default-deny policy (HISTORICAL_READ - allowed for PLANNED/ACTIVE/ARCHIVED),
 *      mirroring the committed groups page;
 *   3. reads EXACTLY this offering's enrollment verification list, the eligible
 *      trainees, and the leaf-subgroup options, all from the validated context id.
 *
 * The enrollment FORM (a mutation affordance) is shown ONLY for a PLANNED offering
 * whose status also permits ENROLLMENT_MANAGEMENT - which is the exact E1 contract
 * (PLANNED-only). ACTIVE/ARCHIVED never render the form; even a forged POST is
 * rejected by E1's transaction-local PLANNED re-check (operation_not_allowed). No
 * arbitrary target offering can be selected: the offering is bound into the action
 * from the validated context id.
 *
 * The existing-enrollment list is resolved at asOf = offering.startDate (not
 * today) so a freshly created enrollment whose initial membership begins on the
 * offering start date is shown as current, not mislabeled as broken.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import {
  assertCourseOperationAllowed,
  evaluateCourseOperationPolicy,
} from "@/lib/course/operation-policy-core";
import { listEnrollableTrainees } from "@/lib/course/enrollable-trainees";
import {
  getCourseGroupTreeByOfferingId,
  type CourseGroupTreeView,
} from "@/lib/course/course-group-tree";
import { readOfferingEnrollmentsForAdmin } from "@/lib/course/offering-enrollments-admin";
import { maskIdentityNumber } from "@/lib/format";
import { formatHebrewDate } from "@/lib/dates";
import {
  CourseStatusBadge,
  formatCourseDateRange,
} from "@/app/admin/courses/CourseOfferingSelector";
import { enrollExistingTraineeAction } from "./actions";
import {
  EnrollExistingTraineeForm,
  type SubgroupOption,
  type TraineeOption,
} from "./EnrollExistingTraineeForm";
import { enrollErrorMessage } from "./enroll-error-messages";

export const dynamic = "force-dynamic";

/** Manager-readable Hebrew label for an enrollment status. */
const ENROLLMENT_STATUS_LABELS: Record<"ACTIVE" | "INACTIVE", string> = {
  ACTIVE: "פעיל",
  INACTIVE: "לא פעיל",
};

/** Flatten a validated group tree to ONLY its leaf subgroups (top-level excluded). */
function toLeafSubgroupOptions(tree: CourseGroupTreeView): SubgroupOption[] {
  const options: SubgroupOption[] = [];
  for (const group of tree.topLevel) {
    for (const subgroup of group.subgroups) {
      // Value is the exact subgroup CourseGroup id; the label is display-only.
      options.push({ id: subgroup.id, label: `${group.name} / ${subgroup.name}` });
    }
  }
  return options;
}

export default async function CourseEnrollmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseOfferingId: string }>;
  searchParams: Promise<{ error?: string; enrolled?: string }>;
}) {
  const { courseOfferingId } = await params;
  const { error, enrolled } = await searchParams;

  // 1. Authorize the admin and re-validate EXACTLY this offering first. Auth
  //    redirects and unexpected errors propagate; only a typed not-found fails
  //    closed as notFound() without reflecting the id.
  let context: AdminCourseContext;
  try {
    context = await requireAdminCourseOffering(courseOfferingId);
  } catch (err) {
    if (err instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw err;
  }

  // 2. Gate the READ by the offering's status via the pure default-deny policy.
  assertCourseOperationAllowed(context.status, "HISTORICAL_READ");

  // 3a. Existing-enrollment verification list, resolved at the offering start
  //     date so a future-dated initial membership is shown as current.
  const enrollments = await readOfferingEnrollmentsForAdmin(context.id, context.startDate);

  // The enrollment mutation affordance is shown ONLY for a PLANNED offering whose
  // status also permits ENROLLMENT_MANAGEMENT (the exact E1 PLANNED-only contract).
  // E1 re-checks this server-side, so this only gates the visible form.
  const canEnroll =
    context.status === "PLANNED" &&
    evaluateCourseOperationPolicy(context.status, "ENROLLMENT_MANAGEMENT").allowed;

  // 3b. Only when the form may be shown do we read the eligible trainees and the
  //     leaf-subgroup options - both from the validated context id.
  let traineeOptions: TraineeOption[] = [];
  let subgroupOptions: SubgroupOption[] = [];
  if (canEnroll) {
    const [eligible, tree] = await Promise.all([
      listEnrollableTrainees(context.id),
      getCourseGroupTreeByOfferingId(context.id),
    ]);
    // Pre-mask the identity number on the server; the raw number never reaches
    // the client. The submitted value is the exact studentId.
    traineeOptions = eligible.map((trainee) => ({
      id: trainee.id,
      label: `${trainee.fullName} — ${maskIdentityNumber(trainee.identityNumber)}`,
    }));
    subgroupOptions = tree === null ? [] : toLeafSubgroupOptions(tree);
  }

  const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`;
  const dateRange = formatCourseDateRange(context.startDate, context.endDate);
  const errorMessage = error ? enrollErrorMessage(error) : null;
  const successMessage = enrolled ? "החניך נרשם לקורס בהצלחה." : null;

  return (
    <div className="flex flex-col gap-4">
      {/* A. Course context */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-card-foreground">חניכים בקורס</h2>
          <CourseStatusBadge status={context.status} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{context.name}</span>
          <span>רמה {context.level}</span>
          {dateRange && <span>{dateRange}</span>}
        </div>
        <div className="mt-3">
          <Link
            href={dashboardHref}
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            חזרה ללוח הקורס
          </Link>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg bg-danger-muted px-4 py-3 text-sm font-medium text-danger">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="rounded-lg bg-success-muted px-4 py-3 text-sm font-medium text-success">
          {successMessage}
        </div>
      )}

      {/* C. Enrollment form (PLANNED only) */}
      {canEnroll ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold text-card-foreground">רישום חניך לקורס</h3>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            רישום חניך קיים אחד לקורס זה ושיוכו לתת־קבוצה אחת. לא נוצר חניך חדש ולא
            משתנים פרטי החניך.
          </p>
          {traineeOptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted p-4">
              <p className="text-sm text-muted-foreground">
                אין כרגע חניכים פעילים הזמינים לרישום לקורס זה.
              </p>
            </div>
          ) : subgroupOptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted p-4">
              <p className="text-sm text-muted-foreground">
                לא הוגדרו תת־קבוצות עבור קורס זה. יש להוסיף תת־קבוצה לפני רישום חניך.
              </p>
            </div>
          ) : (
            <EnrollExistingTraineeForm
              action={enrollExistingTraineeAction.bind(null, context.id)}
              trainees={traineeOptions}
              subgroups={subgroupOptions}
            />
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted p-5">
          <p className="text-sm text-muted-foreground">
            ניתן לרשום חניכים רק בקורס במצב &quot;מתוכנן&quot;. רשימת החניכים הרשומים
            למטה מוצגת לקריאה בלבד.
          </p>
        </div>
      )}

      {/* B. Existing enrollments */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-base font-semibold text-card-foreground">חניכים רשומים</h3>
        {enrollments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            אין עדיין חניכים רשומים לקורס זה.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {enrollments.map((row) => (
              <li
                key={row.studentId}
                className="flex flex-col gap-1 rounded-lg border border-border bg-background p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-card-foreground">{row.fullName}</span>
                  <span className="text-xs text-muted-foreground">
                    {maskIdentityNumber(row.identityNumber)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>סטטוס: {ENROLLMENT_STATUS_LABELS[row.status]}</span>
                  <span>{row.isPrimary ? "קורס ראשי" : "קורס משני"}</span>
                  <span>
                    תת־קבוצה: {row.subgroupLabel ?? "—"}
                  </span>
                  {row.effectiveFrom && <span>החל מ-{formatHebrewDate(row.effectiveFrom)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
