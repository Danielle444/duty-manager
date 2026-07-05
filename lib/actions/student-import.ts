"use server";

import { Workbook, type Row, type Worksheet } from "exceljs";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { parseDateKey } from "@/lib/dates";
import { applyDateRangeAvailability } from "@/lib/availability-helpers";

const MAX_HEADER_SCAN_ROWS = 20;

export interface StudentImportCandidate {
  key: string;
  firstName: string;
  lastName: string;
  groupName: string;
  subgroupNumber: number | null;
  identityNumber: string;
  phone: string;
  matchedStudentId: string | null;
}

export interface ParseStudentsExcelResult {
  success: boolean;
  error?: string;
  candidates?: StudentImportCandidate[];
  debugInfo?: string;
}

const HEADER_SYNONYMS: Record<string, string[]> = {
  firstName: ["שם פרטי", "פרטי"],
  lastName: ["שם משפחה", "משפחה"],
  groupName: ["קבוצה"],
  subgroupNumber: ["מס קבוצה", "מספר קבוצה", "תת קבוצה", "תת־קבוצה"],
  identityNumber: ["תז", "ת.ז", "תעודת זהות", "מספר זהות"],
  phone: ["טלפון", "מספר טלפון", "פלאפון", "נייד", "phone", "mobile"],
};

// Strips zero-width/bidi-control characters (common in Hebrew Excel exports),
// trims, drops punctuation, collapses whitespace, and lowercases (safe no-op
// on Hebrew) so header matching is resilient to invisible characters,
// inconsistent spacing, and English header casing (e.g. "Phone"/"Mobile").
function normalizeHeader(h: string): string {
  return h
    .replace(/[​-‏‪-‮﻿]/g, "") // zero-width & bidi control chars
    .trim()
    .replace(/[."'׳״]/g, "") // periods/quotes/geresh/gershayim
    .replace(/\s+/g, "")
    .toLowerCase();
}

function columnLetter(col: number): string {
  let n = col;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function cellText(row: Row, colNumber: number | undefined): string {
  if (!colNumber) return "";
  const value = row.getCell(colNumber).value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return "";
  if (typeof value === "object" && "richText" in (value as object)) {
    return (value as { richText: { text: string }[] }).richText
      .map((t) => t.text)
      .join("")
      .trim();
  }
  if (typeof value === "object" && "text" in (value as object)) {
    return String((value as { text: unknown }).text ?? "").trim();
  }
  return String(value).trim();
}

function parseIntCell(row: Row, colNumber: number | undefined): number | null {
  const text = cellText(row, colNumber);
  if (!text) return null;
  const n = parseInt(text, 10);
  return Number.isNaN(n) ? null : n;
}

function normalizeIdentityNumber(row: Row, colNumber: number | undefined): string {
  if (!colNumber) return "";
  const raw = row.getCell(colNumber).value;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number") {
    // Excel drops leading zeros on numeric cells; Israeli teudat-zehut is
    // always 9 digits, so pad back if the value looks truncated this way.
    // Always returned as a string - never treated as a numeric type.
    return String(raw).padStart(9, "0");
  }
  return cellText(row, colNumber);
}

interface HeaderDetection {
  headerRow: number;
  columnIndex: Record<string, number>;
}

// Scans the first MAX_HEADER_SCAN_ROWS rows (not assuming row 1, or that
// column 1 has any content) for a row containing at least first name, last
// name, and identity number headers - that row is accepted as the header row.
function detectHeaderRow(worksheet: Worksheet): HeaderDetection | null {
  const lastRow = Math.min(worksheet.rowCount, MAX_HEADER_SCAN_ROWS);

  for (let r = 1; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    const columnIndex: Record<string, number> = {};

    for (let c = 1; c <= worksheet.columnCount; c++) {
      const text = cellText(row, c);
      if (!text) continue;
      const normalized = normalizeHeader(text);
      for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
        if (columnIndex[field]) continue;
        if (synonyms.some((s) => normalizeHeader(s) === normalized)) {
          columnIndex[field] = c;
        }
      }
    }

    if (columnIndex.firstName && columnIndex.lastName && columnIndex.identityNumber) {
      return { headerRow: r, columnIndex };
    }
  }

  return null;
}

function scannedRowsDebugText(worksheet: Worksheet): string {
  const lastRow = Math.min(worksheet.rowCount, MAX_HEADER_SCAN_ROWS);
  const lines: string[] = [];
  for (let r = 1; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    const found: string[] = [];
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const t = cellText(row, c);
      if (t) found.push(t);
    }
    if (found.length > 0) lines.push(`שורה ${r}: ${found.join(", ")}`);
  }
  return lines.length > 0 ? lines.join("\n") : "לא נמצא תוכן כלשהו בשורות שנסרקו";
}

export async function parseStudentsExcel(
  formData: FormData
): Promise<ParseStudentsExcelResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { success: false, error: "לא נבחר קובץ" };
  }

  let workbook: Workbook;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    workbook = new Workbook();
    // exceljs's bundled .d.ts declares its own local `Buffer` (extends ArrayBuffer)
    // that shadows Node's real Buffer type within that file, so a real Buffer
    // can never structurally satisfy it - `any` is the pragmatic escape hatch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch {
    return { success: false, error: "לא ניתן היה לקרוא את הקובץ" };
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { success: false, error: "לא נמצא גיליון בקובץ" };
  }

  const detection = detectHeaderRow(worksheet);
  if (!detection) {
    return {
      success: false,
      error: `לא זוהו עמודות חובה. נמצאו הכותרות הבאות בשורות שנסרקו:\n${scannedRowsDebugText(worksheet)}`,
    };
  }

  const { headerRow, columnIndex } = detection;
  const mappedCols = Object.entries(columnIndex)
    .map(([field, col]) => `${field}=${columnLetter(col)}`)
    .join(", ");
  const debugInfo = `זוהתה שורת כותרות מספר ${headerRow}. עמודות שזוהו: ${mappedCols}`;

  const existingStudents = await prisma.student.findMany({
    select: { id: true, identityNumber: true },
  });
  const existingByIdNumber = new Map(existingStudents.map((s) => [s.identityNumber, s]));

  const candidates: StudentImportCandidate[] = [];
  let index = 0;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;

    const firstName = cellText(row, columnIndex.firstName);
    const lastName = cellText(row, columnIndex.lastName);
    const identityNumber = normalizeIdentityNumber(row, columnIndex.identityNumber);
    const groupName = cellText(row, columnIndex.groupName);
    const subgroupNumber = parseIntCell(row, columnIndex.subgroupNumber);
    // cellText() already stringifies numeric cells (e.g. a phone typed as a
    // number becomes "541234567") without further coercion - phone-format.ts
    // reconstructs the leading 0 for display from that string.
    const phone = cellText(row, columnIndex.phone);

    if (!firstName && !lastName && !identityNumber) return;

    const matched = existingByIdNumber.get(identityNumber);

    candidates.push({
      key: `s${index++}`,
      firstName,
      lastName,
      groupName,
      subgroupNumber,
      identityNumber,
      phone,
      matchedStudentId: matched?.id ?? null,
    });
  });

  if (candidates.length === 0) {
    return {
      success: false,
      error: `לא נמצאו שורות תלמידים בקובץ אחרי שורת הכותרות (שורה ${headerRow}).`,
      debugInfo,
    };
  }

  return { success: true, candidates, debugInfo };
}

export type StudentImportRowAction = "create" | "update" | "skip";

export interface StudentImportSelection {
  firstName: string;
  lastName: string;
  groupName: string;
  subgroupNumber: number | null;
  identityNumber: string;
  phone: string;
  action: StudentImportRowAction;
  matchedStudentId: string | null;
}

export type AvailabilityChoice =
  | { mode: "whole-course" }
  | { mode: "range"; startDate: string; endDate: string }
  | { mode: "preset"; presetId: string };

export interface CommitStudentImportResult {
  success: boolean;
  error?: string;
  createdCount: number;
  updatedCount: number;
}

export async function commitStudentImport(
  selections: StudentImportSelection[],
  availabilityChoice: AvailabilityChoice
): Promise<CommitStudentImportResult> {
  let createdCount = 0;
  let updatedCount = 0;
  const affectedStudentIds: string[] = [];

  for (const sel of selections) {
    if (sel.action === "skip") continue;
    const fullName = `${sel.firstName} ${sel.lastName}`.trim();

    if (sel.action === "update" && sel.matchedStudentId) {
      // Phone is the one field an empty Excel cell must NOT clear - an
      // admin-entered phone number is often more reliable than a
      // re-imported roster that simply lacks a phone column value for that
      // row. Every other field keeps the existing "overwrite from Excel"
      // behavior.
      const phoneUpdate = sel.phone.trim() ? { phone: sel.phone.trim() } : {};
      await prisma.student.update({
        where: { id: sel.matchedStudentId },
        data: {
          firstName: sel.firstName,
          lastName: sel.lastName,
          fullName,
          groupName: sel.groupName || null,
          subgroupNumber: sel.subgroupNumber,
          identityNumber: sel.identityNumber,
          ...phoneUpdate,
        },
      });
      affectedStudentIds.push(sel.matchedStudentId);
      updatedCount++;
    } else if (sel.action === "create") {
      const created = await prisma.student.create({
        data: {
          firstName: sel.firstName,
          lastName: sel.lastName,
          fullName,
          groupName: sel.groupName || null,
          subgroupNumber: sel.subgroupNumber,
          identityNumber: sel.identityNumber,
          phone: sel.phone || null,
        },
      });
      affectedStudentIds.push(created.id);
      createdCount++;
    }
  }

  if (availabilityChoice.mode !== "whole-course" && affectedStudentIds.length > 0) {
    const settings = await prisma.courseSettings.findUnique({ where: { id: 1 } });
    if (settings) {
      let rangeStart: Date;
      let rangeEnd: Date;

      if (availabilityChoice.mode === "range") {
        rangeStart = parseDateKey(availabilityChoice.startDate);
        rangeEnd = parseDateKey(availabilityChoice.endDate);
      } else {
        const preset = await prisma.availabilityRangePreset.findUnique({
          where: { id: availabilityChoice.presetId },
        });
        if (!preset) {
          return { success: true, createdCount, updatedCount };
        }
        rangeStart = preset.startDate;
        rangeEnd = preset.endDate;
      }

      await applyDateRangeAvailability(
        affectedStudentIds,
        settings.startDate,
        settings.endDate,
        rangeStart,
        rangeEnd
      );
    }
  }

  revalidatePath("/admin/students");
  revalidatePath("/admin/availability");
  revalidatePath("/admin");
  return { success: true, createdCount, updatedCount };
}
