"use client";

import { useEffect, useMemo, useState } from "react";
import { getStudentContacts, type StudentContactRow } from "@/lib/actions/contacts";
import { formatPhoneDisplay, getPhoneHref, getWhatsAppHref } from "@/lib/phone-format";

const NO_GROUP_LABEL = "ללא קבוצה";
const NO_SUBGROUP_LABEL = "ללא תת-קבוצה";

// Only groups "א"/"ב" get a dedicated color - any other group value (or no
// group) falls back to the neutral card styling already used everywhere else.
// Mirrors InstructorHorsesSection's groupColorClasses.
function groupColorClasses(groupName: string | null): {
  section: string;
  header: string;
  subBox: string;
} {
  if (groupName === "א") {
    return {
      section: "border-blue-200 bg-blue-50",
      header: "text-blue-900",
      subBox: "border-blue-200 bg-white",
    };
  }
  if (groupName === "ב") {
    return {
      section: "border-violet-200 bg-violet-50",
      header: "text-violet-900",
      subBox: "border-violet-200 bg-white",
    };
  }
  return {
    section: "border-border bg-muted",
    header: "text-card-foreground",
    subBox: "border-border bg-card",
  };
}

interface SubgroupBucket {
  subgroupNumber: number | null;
  students: StudentContactRow[];
}

interface GroupSection {
  groupName: string | null;
  subgroups: SubgroupBucket[];
}

// Rows arrive from getStudentContacts already ordered by groupName ->
// subgroupNumber -> lastName, so grouping by simple insertion order here
// preserves that order without needing to re-sort.
function buildSections(rows: StudentContactRow[]): GroupSection[] {
  const sections: GroupSection[] = [];
  const sectionByGroup = new Map<string, GroupSection>();

  for (const row of rows) {
    const groupKey = row.groupName ?? "__none__";
    let section = sectionByGroup.get(groupKey);
    if (!section) {
      section = { groupName: row.groupName, subgroups: [] };
      sectionByGroup.set(groupKey, section);
      sections.push(section);
    }

    const subKey = row.subgroupNumber ?? -1;
    let bucket = section.subgroups.find((b) => (b.subgroupNumber ?? -1) === subKey);
    if (!bucket) {
      bucket = { subgroupNumber: row.subgroupNumber, students: [] };
      section.subgroups.push(bucket);
    }
    bucket.students.push(row);
  }

  return sections;
}

// View-only - there is no instructor edit action for contacts.
export function InstructorContactsSection() {
  const [rows, setRows] = useState<StudentContactRow[] | null>(null);
  const [groupTab, setGroupTab] = useState("all");
  const [subgroupFilter, setSubgroupFilter] = useState("all");
  const [nameQuery, setNameQuery] = useState("");
  const [phoneQuery, setPhoneQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    getStudentContacts().then((result) => {
      if (!cancelled) setRows(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => r.groupName).filter((g): g is string => Boolean(g)))).sort();
  }, [rows]);

  const subgroupOptions = useMemo(() => {
    if (!rows) return [];
    const relevant = groupTab === "all" ? rows : rows.filter((r) => (r.groupName ?? "") === groupTab);
    return Array.from(
      new Set(relevant.map((r) => r.subgroupNumber).filter((n): n is number => n != null))
    ).sort((a, b) => a - b);
  }, [rows, groupTab]);

  function selectGroupTab(value: string) {
    setGroupTab(value);
    setSubgroupFilter("all");
  }

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const nameQ = nameQuery.trim().toLowerCase();
    const phoneQ = phoneQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (groupTab !== "all" && (r.groupName ?? "") !== groupTab) return false;
      if (subgroupFilter !== "all" && String(r.subgroupNumber ?? "") !== subgroupFilter) return false;
      if (nameQ && !r.fullName.toLowerCase().includes(nameQ)) return false;
      if (phoneQ && !(r.phone ?? "").toLowerCase().includes(phoneQ)) return false;
      return true;
    });
  }, [rows, groupTab, subgroupFilter, nameQuery, phoneQuery]);

  const sections = useMemo(() => buildSections(filteredRows), [filteredRows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-bold text-card-foreground">אנשי קשר</h2>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => selectGroupTab("all")}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                groupTab === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              כל הקבוצות
            </button>
            {groups.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => selectGroupTab(g)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                  groupTab === g
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                קבוצה {g}
              </button>
            ))}
          </div>
          {subgroupOptions.length > 0 && (
            <select
              value={subgroupFilter}
              onChange={(e) => setSubgroupFilter(e.target.value)}
              className="rounded-xl border border-border px-3 py-2.5 text-base"
            >
              <option value="all">כל תתי-הקבוצות</option>
              {subgroupOptions.map((n) => (
                <option key={n} value={String(n)}>
                  תת-קבוצה {n}
                </option>
              ))}
            </select>
          )}
          <input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="חיפוש לפי שם תלמיד/ה..."
            className="rounded-xl border border-border px-3 py-2.5 text-base"
          />
          <input
            value={phoneQuery}
            onChange={(e) => setPhoneQuery(e.target.value)}
            placeholder="חיפוש לפי טלפון..."
            className="rounded-xl border border-border px-3 py-2.5 text-base"
          />
        </div>
      </div>

      {rows === null ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : sections.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          אין תלמידים התואמים את הסינון
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {sections.map((section) => {
            const colors = groupColorClasses(section.groupName);
            const groupLabel = section.groupName ? `קבוצה ${section.groupName}` : NO_GROUP_LABEL;
            return (
              <div
                key={section.groupName ?? "__none__"}
                className={`rounded-2xl border-2 p-4 ${colors.section}`}
              >
                <h3 className={`mb-3 text-base font-bold ${colors.header}`}>{groupLabel}</h3>
                <div className="flex flex-col gap-3">
                  {section.subgroups.map((sub) => {
                    const subLabel =
                      sub.subgroupNumber != null ? `תת-קבוצה ${sub.subgroupNumber}` : NO_SUBGROUP_LABEL;
                    return (
                      <div
                        key={sub.subgroupNumber ?? "__none__"}
                        className={`rounded-xl border p-3 ${colors.subBox}`}
                      >
                        <p className={`mb-2 text-sm font-semibold ${colors.header}`}>
                          {groupLabel} · {subLabel}
                        </p>
                        <div className="flex flex-col gap-2">
                          {sub.students.map((row) => {
                            const phoneHref = getPhoneHref(row.phone);
                            const whatsAppHref = getWhatsAppHref(row.phone);
                            return (
                              <div
                                key={row.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card px-3 py-2"
                              >
                                <p className="text-base font-bold text-card-foreground">{row.fullName}</p>
                                <div className="flex flex-wrap items-center gap-2">
                                  {phoneHref ? (
                                    <a
                                      href={phoneHref}
                                      className="text-sm font-semibold text-accent underline"
                                    >
                                      {formatPhoneDisplay(row.phone)}
                                    </a>
                                  ) : (
                                    <span className="text-sm italic text-muted-foreground">
                                      {formatPhoneDisplay(row.phone)}
                                    </span>
                                  )}
                                  {whatsAppHref && (
                                    <a
                                      href={whatsAppHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="rounded-full bg-success-muted px-2.5 py-1 text-xs font-medium text-success"
                                    >
                                      WhatsApp
                                    </a>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
