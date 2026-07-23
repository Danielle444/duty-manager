/**
 * MULTI-COURSE (Slice 4) - the explicit admin CourseOffering selection page.
 *
 * This page is the always-available safe fallback: it lists every selectable
 * offering (PLANNED, ACTIVE, ARCHIVED) in the committed deterministic order and
 * lets the admin pick one explicitly. Selecting submits the offering id to the
 * validated server action - the page never builds a trusted destination from a
 * client value and never reads the convenience cookie.
 */
import { requireAdmin } from "@/lib/auth/require-admin";
import { listSelectableCourseOfferingsForAdmin } from "@/lib/course/offering-by-id";
import { listActivityYearOptions } from "@/lib/course/create-offering";
import {
  selectAdminCourseOffering,
  createCourseOfferingAction,
} from "@/app/admin/courses/actions";
import {
  CourseStatusBadge,
  formatCourseDateRange,
} from "@/app/admin/courses/CourseOfferingSelector";

export const dynamic = "force-dynamic";

/**
 * Stable error-code -> Hebrew message map for the ?error= state. Includes the
 * existing selection code ("invalid") and the W9A-2 creation codes. An unknown
 * code falls back to the generic message; only a stable code is ever reflected.
 */
const COURSE_ERROR_MESSAGES: Record<string, string> = {
  invalid: "הבחירה אינה תקפה. נא לבחור מחזור קורס מהרשימה.",
  activity_year_required: "יש לבחור שנת פעילות.",
  activity_year_not_found: "שנת הפעילות שנבחרה אינה קיימת.",
  name_required: "יש להזין שם קורס.",
  level_invalid: "רמת הקורס חייבת להיות מספר שלם חיובי.",
  date_invalid: "תאריך לא תקין.",
  date_range_invalid: "תאריך ההתחלה חייב להיות מוקדם מתאריך הסיום או שווה לו.",
  duplicate_name: "כבר קיים קורס בשם זה בשנת הפעילות הזו.",
  unexpected: "אירעה שגיאה. נסו שוב.",
};

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Explicit admin gate even though the parent layout also authorizes.
  await requireAdmin();
  const { error } = await searchParams;
  const [offerings, activityYears] = await Promise.all([
    listSelectableCourseOfferingsForAdmin(),
    listActivityYearOptions(),
  ]);
  const errorMessage = error
    ? (COURSE_ERROR_MESSAGES[error] ?? COURSE_ERROR_MESSAGES.unexpected)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-card-foreground">קורסים</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          בחירת מחזור קורס לניהול. הבחירה נשמרת לנוחות בלבד — כתובת ה־URL של הקורס
          היא המקור המחייב, וכל דף מאמת מחדש את ההרשאה.
        </p>
      </div>

      {errorMessage && (
        <div className="rounded-lg bg-danger-muted px-4 py-3 text-sm font-medium text-danger">
          {errorMessage}
        </div>
      )}

      {activityYears.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            לא קיימת שנת פעילות. יש להגדיר שנת פעילות לפני יצירת קורס חדש.
          </p>
        </div>
      ) : (
        <form
          action={createCourseOfferingAction}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
        >
          <div>
            <h2 className="text-base font-semibold text-card-foreground">יצירת קורס חדש</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              הקורס נוצר במצב &quot;מתוכנן&quot; בלבד ואינו משפיע על הקורס הפעיל. אין מודולים
              תפעוליים לקורס חדש בשלב זה.
            </p>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-card-foreground">שנת פעילות</span>
            <select
              name="activityYearId"
              required
              defaultValue={activityYears[0]?.id ?? ""}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
            >
              {activityYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-card-foreground">שם הקורס</span>
            <input
              type="text"
              name="name"
              required
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-card-foreground">רמה</span>
            <input
              type="number"
              name="level"
              min={1}
              step={1}
              required
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium text-card-foreground">תאריך התחלה (רשות)</span>
              <input
                type="date"
                name="startDate"
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium text-card-foreground">תאריך סיום (רשות)</span>
              <input
                type="date"
                name="endDate"
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
              />
            </label>
          </div>

          <div>
            <button
              type="submit"
              className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80"
            >
              צור קורס
            </button>
          </div>
        </form>
      )}

      {offerings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            לא קיימים מחזורי קורס להצגה עדיין.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {offerings.map((offering) => {
            const dateRange = formatCourseDateRange(offering.startDate, offering.endDate);
            const isArchived = offering.status === "ARCHIVED";
            return (
              <li key={offering.id}>
                <form action={selectAdminCourseOffering}>
                  <input type="hidden" name="courseOfferingId" value={offering.id} />
                  <button
                    type="submit"
                    className={`flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:bg-muted ${
                      isArchived ? "opacity-80" : ""
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-base font-semibold text-card-foreground">
                        {offering.name}
                      </span>
                      <CourseStatusBadge status={offering.status} />
                    </span>
                    <span className="text-sm text-muted-foreground">רמה {offering.level}</span>
                    <span className="text-sm text-muted-foreground">
                      {offering.activityYearName}
                    </span>
                    {dateRange && (
                      <span className="text-xs text-muted-foreground">{dateRange}</span>
                    )}
                    {isArchived && (
                      <span className="text-xs font-medium text-muted-foreground">
                        ארכיון · קריאה בלבד
                      </span>
                    )}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
