import Link from "next/link";
import { Logo } from "@/lib/components/Logo";
import { requireAdmin } from "@/lib/auth/require-admin";
import { signOutAdmin } from "@/lib/actions/auth-actions";

// "זמינות" (/admin/availability) and "ביצוע" (/admin/completion) were
// removed from the top-level nav in favor of the single "מעקב יומי" entry,
// which now embeds both as tabs - the routes themselves are untouched and
// still load fine by direct URL, they're just no longer separate nav items.
const NAV_ITEMS = [
  { href: "/admin", label: "לוח בקרה" },
  { href: "/admin/students", label: "חניכים" },
  { href: "/admin/instructors", label: "מדריכים" },
  { href: "/admin/duties", label: "סוגי תורנות" },
  { href: "/admin/daily-tracking", label: "מעקב יומי" },
  { href: "/admin/day-plan", label: "תכנון קבוצות יומי" },
  { href: "/admin/weekly-schedule", label: "לו\"ז שבועי" },
  { href: "/admin/schedule", label: "שיבוץ" },
  { href: "/admin/materials", label: "חומרי קורס" },
  { href: "/admin/horses", label: "חלוקה לקבוצות וסוסים" },
  { href: "/admin/messages", label: "הודעות ומשימות" },
  { href: "/admin/admins", label: "מנהלים מורשים" },
  { href: "/admin/help", label: "מדריך שימוש" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const currentAdmin = await requireAdmin();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Logo variant="mark" width={36} />
            <h1 className="text-lg font-bold text-card-foreground">ניהול קורס</h1>
          </div>
          <nav className="flex flex-wrap items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-card-foreground"
              >
                {item.label}
              </Link>
            ))}
            <span className="px-2 text-xs text-muted-foreground">
              {currentAdmin.name ?? currentAdmin.email}
            </span>
            <form action={signOutAdmin}>
              <button
                type="submit"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-card-foreground"
              >
                התנתקות
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
