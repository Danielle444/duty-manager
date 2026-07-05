"use client";

import { useEffect, useMemo, useState } from "react";
import { getInstructorContacts, type InstructorContactRow } from "@/lib/actions/contacts";
import { formatPhoneDisplay, getPhoneHref, getWhatsAppHref } from "@/lib/phone-format";

// View-only - students have no way to edit instructor contact info. Only
// active instructors are returned by getInstructorContacts() in the first
// place, so there is no active/inactive status to show or filter here.
export function StudentInstructorContactsSection() {
  const [rows, setRows] = useState<InstructorContactRow[] | null>(null);
  const [nameQuery, setNameQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    getInstructorContacts().then((result) => {
      if (!cancelled) setRows(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = nameQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [rows, nameQuery]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-bold text-card-foreground">אנשי קשר</h2>
        <input
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="חיפוש לפי שם מדריך/ה..."
          className="w-full rounded-xl border border-border px-3 py-2.5 text-base"
        />
      </div>

      {rows === null ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : filteredRows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          אין מדריכים התואמים את החיפוש
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredRows.map((row) => {
            const phoneHref = getPhoneHref(row.phone);
            const whatsAppHref = getWhatsAppHref(row.phone);
            return (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-border p-4"
              >
                <p className="text-lg font-bold text-card-foreground">{row.fullName}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {phoneHref ? (
                    <a href={phoneHref} className="text-base font-semibold text-accent underline">
                      {formatPhoneDisplay(row.phone)}
                    </a>
                  ) : (
                    <span className="text-base italic text-muted-foreground">
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
      )}
    </div>
  );
}
