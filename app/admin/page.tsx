import Link from "next/link";
import { formatHebrewDate, formatHebrewDateTime } from "@/lib/dates";
import { Logo } from "@/lib/components/Logo";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getAdminDashboardData } from "@/lib/actions/admin-dashboard";

export const dynamic = "force-dynamic";

const QUICK_ACTIONS = [
  { href: "/admin/students", label: "ניהול חניכים" },
  { href: "/admin/instructors", label: "ניהול מדריכים" },
  { href: "/admin/weekly-schedule", label: 'לו"ז שבועי' },
  { href: "/admin/schedule", label: "שיבוץ תורנויות" },
  { href: "/admin/messages", label: "הודעות ומשימות" },
  { href: "/admin/horses", label: "חלוקת סוסים" },
  { href: "/admin/materials", label: "חומרי קורס" },
];

const MESSAGE_TYPE_LABELS: Record<"MESSAGE" | "TASK", string> = {
  MESSAGE: "הודעה",
  TASK: "משימה",
};

const MATERIAL_TYPE_LABELS: Record<"FILE" | "LINK", string> = {
  FILE: "קובץ",
  LINK: "קישור",
};

export default async function AdminDashboardPage() {
  await requireAdmin();
  const data = await getAdminDashboardData();

  const attentionItems: { key: string; label: string; href: string }[] = [];
  if (!data.courseRange) {
    attentionItems.push({
      key: "no-course-range",
      label: "לא הוגדר טווח תאריכי הקורס",
      href: "/admin/availability",
    });
  }
  if (data.studentsWithoutPhone > 0) {
    attentionItems.push({
      key: "no-phone",
      label: `${data.studentsWithoutPhone} חניכים ללא מספר טלפון`,
      href: "/admin/students",
    });
  }
  if (data.studentsWithoutHorse !== null && data.studentsWithoutHorse > 0) {
    attentionItems.push({
      key: "no-horse",
      label: `${data.studentsWithoutHorse} חניכים ללא שיבוץ סוס`,
      href: "/admin/horses",
    });
  }
  if (data.incompleteTaskRecipients > 0) {
    attentionItems.push({
      key: "open-tasks",
      label: `${data.incompleteTaskRecipients} משימות שטרם הושלמו`,
      href: "/admin/messages",
    });
  }
  if (data.activeMaterialsCount === 0) {
    attentionItems.push({
      key: "no-materials",
      label: "לא נוספו חומרי קורס עדיין",
      href: "/admin/materials",
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Logo width={160} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="חניכים פעילים" value={data.activeStudents} />
        <StatCard label="מדריכים פעילים" value={data.activeInstructors} />
        <StatCard
          label="טווח תאריכי הקורס"
          value={
            data.courseRange
              ? `${formatHebrewDate(data.courseRange.startDate)} - ${formatHebrewDate(data.courseRange.endDate)}`
              : "טרם הוגדר"
          }
          small
        />
        <StatCard
          label="ביצוע תורנויות היום"
          value={
            data.todayAssignmentsTotal === 0
              ? "אין שיבוצים שפורסמו היום"
              : `${data.todayAssignmentsCompleted} / ${data.todayAssignmentsTotal} בוצעו`
          }
          small
        />
        <StatCard label="חומרי קורס פעילים" value={data.activeMaterialsCount} />
      </div>

      {attentionItems.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-card-foreground">דורש תשומת לב</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {attentionItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="rounded-lg bg-warning-muted p-4 text-sm font-medium text-warning underline-offset-2 hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-card-foreground">פעולות מהירות</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="rounded-xl border border-border bg-card p-4 text-center text-sm font-semibold text-card-foreground hover:bg-muted"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold text-card-foreground">
            הודעות ומשימות אחרונות
          </h2>
          {data.recentMessageTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">עדיין לא נשלחו הודעות או משימות</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.recentMessageTasks.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                      {MESSAGE_TYPE_LABELS[item.type]}
                    </span>
                    <span className="text-card-foreground">{item.title}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatHebrewDateTime(item.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold text-card-foreground">חומרי קורס אחרונים</h2>
          {data.recentMaterials.length === 0 ? (
            <p className="text-sm text-muted-foreground">עדיין לא נוספו חומרי קורס</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.recentMaterials.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                      {MATERIAL_TYPE_LABELS[item.materialType]}
                    </span>
                    <span className="text-card-foreground">{item.title}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatHebrewDateTime(item.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  small,
}: {
  label: string;
  value: string | number;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-bold text-card-foreground ${small ? "text-base" : "text-2xl"}`}
      >
        {value}
      </p>
    </div>
  );
}
