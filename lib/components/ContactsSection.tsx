"use client";

import { useState } from "react";
import { InstructorContactsSection } from "@/app/instructor/InstructorContactsSection";
import { StudentInstructorContactsSection } from "@/app/student/StudentInstructorContactsSection";

type ContactsTab = "students" | "instructors";

// Shared by both the student and instructor apps - a full course contact
// directory now intentionally open to both roles. Reuses the two existing
// list components as-is rather than duplicating their logic:
// InstructorContactsSection already renders the grouped student-contacts
// list (group/subgroup sections, name/phone search), and
// StudentInstructorContactsSection already renders the flat
// instructor-contacts list (name/phone search) - their names undersell how
// broadly they're used now, but renaming/moving them wasn't worth the extra
// churn for this change.
export function ContactsSection() {
  const [tab, setTab] = useState<ContactsTab>("students");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("students")}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold ${
            tab === "students"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          תלמידים
        </button>
        <button
          type="button"
          onClick={() => setTab("instructors")}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold ${
            tab === "instructors"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          מדריכים / מאמנים
        </button>
      </div>

      {tab === "students" ? <InstructorContactsSection /> : <StudentInstructorContactsSection />}
    </div>
  );
}
