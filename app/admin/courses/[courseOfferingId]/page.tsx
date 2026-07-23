/**
 * MULTI-COURSE (Slice 4/6) - the minimal course dashboard shell.
 *
 * Intentionally thin: the persistent course identity banner is owned by the
 * nested layout, so this page does NOT refetch the CourseOffering merely to repeat
 * it. It runs no operational counts or global Student/Schedule/Duty/Feedback
 * queries.
 *
 * As of Slice 6 it re-validates the URL [courseOfferingId] through
 * requireAdminCourseOffering() (admin-authorization-first, exact-id lookup, no
 * cookie, no fallback) so the ONE course-scoped module link it now exposes - the
 * read-only groups view - is built from the validated context id, never the raw
 * param. Additional course-scoped modules will be added here one at a time, each
 * with its own server data boundary.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import { evaluateCourseOperationPolicy } from "@/lib/course/operation-policy-core";
import { renameCourseOfferingAction } from "./actions";
import { RenameOfferingForm } from "./RenameOfferingForm";

export const dynamic = "force-dynamic";

/**
 * Stable rename error-code -> Hebrew message map for the ?error= state. Only a
 * stable code is ever reflected; an unknown code falls back to the generic
 * message. The offering_id_required/expected_name_required codes are not
 * reachable through the UI (the id is server-bound and the hidden field is always
 * present) but are mapped defensively to the generic message.
 */
const RENAME_ERROR_MESSAGES: Record<string, string> = {
  name_required: "יש להזין שם קורס.",
  duplicate_name: "כבר קיים קורס בשם זה בשנת הפעילות הזו.",
  stale_name:
    "שם הקורס השתנה מאז טעינת הדף. הדף רוענן עם השם העדכני — יש לבדוק אותו לפני ניסיון נוסף.",
  operation_not_allowed: "לא ניתן לשנות את שם הקורס במצב זה.",
  offering_id_required: "אירעה שגיאה. נסו שוב.",
  expected_name_required: "אירעה שגיאה. נסו שוב.",
  unexpected: "אירעה שגיאה. נסו שוב.",
};

export default async function CourseDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseOfferingId: string }>;
  searchParams: Promise<{ error?: string; renamed?: string }>;
}) {
  const { courseOfferingId } = await params;
  const { error, renamed } = await searchParams;

  // Admin-authorization-first, then an exact-id lookup of this offering. Only the
  // typed not-found fails closed as notFound(); auth redirects and unexpected
  // errors propagate.
  let context: AdminCourseContext;
  try {
    context = await requireAdminCourseOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  const groupsHref = `/admin/courses/${encodeURIComponent(context.id)}/groups`;
  const enrollmentsHref = `/admin/courses/${encodeURIComponent(context.id)}/enrollments`;

  // The rename affordance is shown only when a name change is permitted for this
  // offering's status (OFFERING_METADATA_UPDATE: PLANNED/ACTIVE, not ARCHIVED).
  // The action re-checks this server-side, so this only gates the visible form.
  const canRename = evaluateCourseOperationPolicy(
    context.status,
    "OFFERING_METADATA_UPDATE",
  ).allowed;
  const renameErrorMessage = error
    ? (RENAME_ERROR_MESSAGES[error] ?? RENAME_ERROR_MESSAGES.unexpected)
    : null;
  const renameSuccessMessage = renamed ? "שם הקורס עודכן." : null;

  return (
    <div className="flex flex-col gap-4">
      {renameErrorMessage && (
        <div className="rounded-lg bg-danger-muted px-4 py-3 text-sm font-medium text-danger">
          {renameErrorMessage}
        </div>
      )}
      {renameSuccessMessage && (
        <div className="rounded-lg bg-success-muted px-4 py-3 text-sm font-medium text-success">
          {renameSuccessMessage}
        </div>
      )}

      {canRename && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-card-foreground">שם הקורס</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            שינוי שם הקורס בלבד. אין בכך כדי לשנות רמה, תאריכים, שנת פעילות, מצב או
            נתונים תפעוליים.
          </p>
          <RenameOfferingForm
            action={renameCourseOfferingAction.bind(null, context.id)}
            currentName={context.name}
          />
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-card-foreground">לוח הקורס</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          זהו שלד ניהול הקורס. מודולי הקורס (חניכים, סוסים, שיבוץ, משוב ועוד)
          יועברו לכאן בהדרגה, מודול אחד בכל פעם. בשלב זה אין עדיין מודולים תפעוליים
          תחת הקורס — הניהול התפעולי הקיים ממשיך לפעול כרגיל בתפריט הכללי.
        </p>
      </div>

      <Link
        href={groupsHref}
        className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted"
      >
        <h3 className="text-base font-semibold text-card-foreground">קבוצות</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          מבנה הקבוצות והתת-קבוצות של הקורס, לקריאה בלבד.
        </p>
      </Link>

      <Link
        href={enrollmentsHref}
        className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted"
      >
        <h3 className="text-base font-semibold text-card-foreground">חניכים בקורס</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          רישום חניך קיים אחד לקורס ושיוכו לתת־קבוצה, וצפייה בחניכים הרשומים.
        </p>
      </Link>

      <div>
        <Link
          href="/admin"
          className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          חזרה ללוח הבקרה הכללי
        </Link>
      </div>
    </div>
  );
}
