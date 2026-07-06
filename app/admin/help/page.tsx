import { requireAdmin } from "@/lib/auth/require-admin";
import { HelpContent } from "@/lib/components/HelpContent";

export const dynamic = "force-dynamic";

export default async function AdminHelpPage() {
  await requireAdmin();

  return <HelpContent role="admin" />;
}
