"use server";

import { Workbook, type Row, type Worksheet } from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";

const MAX_HEADER_SCAN_ROWS = 20;

export type ChildImportRowAction = "create" | "update" | "skip";
export type ChildImportMatchConfidence = "high" | "low" | "sibling" | null;

// Preview-only structured view of the Excel form's constraint/request
// columns - never persisted as-is (composeNotes below is what actually gets
// stored into TeachingPracticeChild.notes). Exists purely so the review UI
// can show each answer as its own labeled line instead of forcing the admin
// to parse it back out of the composed notes text before saving.
export interface TeachingPracticeChildImportConstraints {
  parentEmail: string;
  grade: string;
  city: string;
  preferredTimesGroupA: string;
  preferredTimesGroupB: string;
  previousCourseParticipation: string;
  priorRidingExperience: string;
  canAttendAllLessons: string;
  unavailableDetails: string;
  specialRequests: string;
}

export interface TeachingPracticeChildImportCandidate {
  key: string;
  rowNumber: number;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number | null;
  gender: string;
  parentName: string;
  parentPhone: string;
  notes: string;
  constraints: TeachingPracticeChildImportConstraints;
  action: ChildImportRowAction;
  matchedChildId: string | null;
  matchConfidence: ChildImportMatchConfidence;
  warnings: string[];
}

export interface ParseTeachingPracticeChildrenExcelResult {
  success: boolean;
  error?: string;
  candidates?: TeachingPracticeChildImportCandidate[];
  debugInfo?: string;
}

// Header synonyms for the real-world Excel export column names, plus a few
// shorter fallbacks - same "resilient to header drift" convention as
// student-import.ts's HEADER_SYNONYMS.
const HEADER_SYNONYMS: Record<string, string[]> = {
  firstName: ["שם פרטי של הילד/ה", "שם פרטי"],
  lastName: ["שם משפחה של הילד/ה", "שם משפחה"],
  age: ["גיל הילד/ה (במספר)", "גיל הילד/ה", "גיל"],
  gender: ["מין הילד", "מגדר"],
  parentName: ["שם ההורה", "שם הורה"],
  parentPhone: ["טלפון זמין של ההורה", "טלפון הורה", "טלפון"],
  email: ["כתובת אימייל", "אימייל", "מייל"],
  grade: ["כיתה"],
  city: ["כתובת מגורים (שם הישוב בלבד)", "כתובת מגורים", "ישוב", "יישוב"],
  groupAHours: ["שעות מועדפות קבוצה א"],
  groupBHours: ["שעות מועדפות קבוצה ב"],
  priorInstructorsCourse: [
    "האם ילדך השתתף בעבר בשעורי רכיבה במסגרת קורס המדריכים של דאבל קיי?",
    "האם ילדך השתתף בעבר בשעורי רכיבה במסגרת קורס המדריכים של דאבל קיי",
  ],
  priorRidingExperience: [
    "האם לילדך ניסיון קודם ברכיבה? במידה וכן - פרט",
    "האם לילדך ניסיון קודם ברכיבה",
  ],
  attendanceCommitment: [
    "ביכולתי להגיע לכל ששת שעורי הרכיבה בתאריכים אליהם נרשמתי",
    "יכול להגיע לכל ששת השיעורים",
  ],
  attendanceExceptionDetails: [
    'במידה וענית "לא" - אנא פרט מתי לא תוכל להגיע',
    "פירוט מתי לא יוכל להגיע",
  ],
  specialNotes: ["הערות/ בקשות מיוחדות", "הערות/בקשות מיוחדות", "הערות"],
};

// The real Google Forms export headers for these three fields are long,
// free-form sentences (form instructions baked into the header itself) that
// will never match HEADER_SYNONYMS by exact equality, and are liable to be
// reworded slightly (punctuation, line breaks) between exports. Detected
// instead by requiring a set of normalized substrings all be present in the
// (whitespace/punctuation-stripped) header - each inner array is an AND-group,
// multiple groups are OR'd together. Only used as a fallback: exact
// HEADER_SYNONYMS matches above still win first.
//
// Group A vs Group B is disambiguated by "קבוצהא" vs "קבוצהב" specifically
// (not just "קבוצה") since the two real headers are otherwise near-identical
// ("קבוצה א׳ יתקיימו בימים א+ג..." vs "קבוצה ב יתקיימו בימים ב+ד...").
const CONTAINS_RULES: Record<string, string[][]> = {
  groupAHours: [["קבוצהא", "שעות"]],
  groupBHours: [["קבוצהב", "שעות"]],
  specialNotes: [["הערות", "בקשותמיוחדות"], ["מגבלתשעות"], ["חברים"], ["אחים"]],
};

// Strips zero-width/bidi-control characters (common in Hebrew Excel exports),
// trims, drops punctuation, collapses whitespace, and lowercases - same
// normalization as student-import.ts's normalizeHeader.
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

interface HeaderDetection {
  headerRow: number;
  columnIndex: Record<string, number>;
}

// Scans the first MAX_HEADER_SCAN_ROWS rows for a row containing at least
// first name and last name headers - that row is accepted as the header row.
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
      for (const [field, andGroups] of Object.entries(CONTAINS_RULES)) {
        if (columnIndex[field]) continue;
        if (andGroups.some((group) => group.every((substr) => normalized.includes(substr)))) {
          columnIndex[field] = c;
        }
      }
    }

    if (columnIndex.firstName && columnIndex.lastName) {
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

function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]+/g, "");
}

function normalizeFullName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

interface ParsedAge {
  age: number | null;
  warning: string | null;
  rawNote: string | null;
}

// Decimal ages (e.g. "6.5") are floored for storage but the raw value is
// surfaced both as a non-blocking warning and as a notes line - never
// silently dropped. Unparseable text sets age to null with a warning instead
// of blocking the row (age is optional per the import spec).
function parseAgeCell(text: string): ParsedAge {
  if (!text) return { age: null, warning: null, rawNote: null };
  const n = parseFloat(text.replace(",", "."));
  if (Number.isNaN(n)) {
    return { age: null, warning: `גיל לא ניתן לפענוח: "${text}"`, rawNote: null };
  }
  const floored = Math.floor(n);
  if (!Number.isInteger(n)) {
    return {
      age: floored,
      warning: `גיל עשרוני עוגל מ-${text} ל-${floored}`,
      rawNote: `גיל מקורי שצוין: ${text}`,
    };
  }
  return { age: floored, warning: null, rawNote: null };
}

function composeNotes(fields: {
  grade: string;
  city: string;
  email: string;
  groupAHours: string;
  groupBHours: string;
  priorInstructorsCourse: string;
  priorRidingExperience: string;
  attendanceCommitment: string;
  attendanceExceptionDetails: string;
  specialNotes: string;
  ageRawNote: string | null;
}): string {
  const lines: string[] = [];

  // Scheduling constraints and free-text requests are the fields most likely
  // to affect whether this child can actually be placed in a track/lesson -
  // surfaced first, under their own heading, rather than mixed in with the
  // rest of the child's general info below.
  const constraintLines: string[] = [];
  if (fields.groupAHours) constraintLines.push(`שעות מועדפות קבוצה א: ${fields.groupAHours}`);
  if (fields.groupBHours) constraintLines.push(`שעות מועדפות קבוצה ב: ${fields.groupBHours}`);
  if (fields.specialNotes) {
    constraintLines.push(`הערות / בקשות מיוחדות: ${fields.specialNotes}`);
  }
  if (constraintLines.length > 0) {
    lines.push("אילוצי זמנים ובקשות:", ...constraintLines);
  }

  if (fields.grade) lines.push(`כיתה: ${fields.grade}`);
  if (fields.city) lines.push(`יישוב: ${fields.city}`);
  if (fields.email) lines.push(`אימייל הורה: ${fields.email}`);
  if (fields.priorInstructorsCourse) {
    lines.push(`השתתפות קודמת בקורס מדריכים: ${fields.priorInstructorsCourse}`);
  }
  if (fields.priorRidingExperience) {
    lines.push(`ניסיון קודם ברכיבה: ${fields.priorRidingExperience}`);
  }
  // Only surfaced as an attendance-constraint warning when the commitment
  // answer isn't a plain "כן" - matches the source form's own follow-up
  // question ("במידה וענית 'לא'...").
  if (fields.attendanceCommitment && !fields.attendanceCommitment.trim().startsWith("כן")) {
    lines.push(
      `⚠ אילוץ נוכחות: ${fields.attendanceExceptionDetails || fields.attendanceCommitment}`
    );
  }
  if (fields.ageRawNote) lines.push(fields.ageRawNote);
  return lines.join("\n");
}

async function parseTeachingPracticeChildrenExcelInternal(
  formData: FormData
): Promise<ParseTeachingPracticeChildrenExcelResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { success: false, error: "לא נבחר קובץ" };
  }

  let workbook: Workbook;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    workbook = new Workbook();
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
      error: `לא זוהו עמודות חובה (שם פרטי/שם משפחה). נמצאו הכותרות הבאות בשורות שנסרקו:\n${scannedRowsDebugText(worksheet)}`,
    };
  }

  const { headerRow, columnIndex } = detection;
  const mappedCols = Object.entries(columnIndex)
    .map(([field, col]) => `${field}=${columnLetter(col)}`)
    .join(", ");
  const debugInfo = `זוהתה שורת כותרות מספר ${headerRow}. עמודות שזוהו: ${mappedCols}`;

  const existingChildren = await prisma.teachingPracticeChild.findMany({
    select: { id: true, fullName: true, parentPhone: true },
  });
  const byName = new Map<string, typeof existingChildren>();
  const byPhone = new Map<string, typeof existingChildren>();
  for (const child of existingChildren) {
    const nameKey = normalizeFullName(child.fullName);
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), child]);
    if (child.parentPhone) {
      const phoneKey = normalizePhone(child.parentPhone);
      if (phoneKey) byPhone.set(phoneKey, [...(byPhone.get(phoneKey) ?? []), child]);
    }
  }

  const candidates: TeachingPracticeChildImportCandidate[] = [];
  let index = 0;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;

    const firstName = cellText(row, columnIndex.firstName);
    const lastName = cellText(row, columnIndex.lastName);
    if (!firstName && !lastName) return;

    const warnings: string[] = [];
    if (!firstName) warnings.push("חסר שם פרטי");
    if (!lastName) warnings.push("חסר שם משפחה");

    const ageText = cellText(row, columnIndex.age);
    const parsedAge = parseAgeCell(ageText);
    if (parsedAge.warning) warnings.push(parsedAge.warning);

    const gender = cellText(row, columnIndex.gender);
    const parentName = cellText(row, columnIndex.parentName);
    const parentPhoneRaw = cellText(row, columnIndex.parentPhone);
    const parentPhone = parentPhoneRaw ? normalizePhone(parentPhoneRaw) : "";

    const grade = cellText(row, columnIndex.grade);
    const city = cellText(row, columnIndex.city);
    const email = cellText(row, columnIndex.email);
    const groupAHours = cellText(row, columnIndex.groupAHours);
    const groupBHours = cellText(row, columnIndex.groupBHours);
    const priorInstructorsCourse = cellText(row, columnIndex.priorInstructorsCourse);
    const priorRidingExperience = cellText(row, columnIndex.priorRidingExperience);
    const attendanceCommitment = cellText(row, columnIndex.attendanceCommitment);
    const attendanceExceptionDetails = cellText(row, columnIndex.attendanceExceptionDetails);
    const specialNotes = cellText(row, columnIndex.specialNotes);

    const notes = composeNotes({
      grade,
      city,
      email,
      groupAHours,
      groupBHours,
      priorInstructorsCourse,
      priorRidingExperience,
      attendanceCommitment,
      attendanceExceptionDetails,
      specialNotes,
      ageRawNote: parsedAge.rawNote,
    });

    const constraints: TeachingPracticeChildImportConstraints = {
      parentEmail: email,
      grade,
      city,
      preferredTimesGroupA: groupAHours,
      preferredTimesGroupB: groupBHours,
      previousCourseParticipation: priorInstructorsCourse,
      priorRidingExperience,
      canAttendAllLessons: attendanceCommitment,
      unavailableDetails: attendanceExceptionDetails,
      specialRequests: specialNotes,
    };

    const fullName = normalizeFullName(`${firstName} ${lastName}`.trim());

    let action: ChildImportRowAction = firstName && lastName ? "create" : "skip";
    let matchedChildId: string | null = null;
    let matchConfidence: ChildImportMatchConfidence = null;

    const nameMatches = byName.get(fullName) ?? [];
    if (nameMatches.length > 0) {
      const phoneMatch = parentPhone
        ? nameMatches.find((c) => c.parentPhone && normalizePhone(c.parentPhone) === parentPhone)
        : undefined;
      if (phoneMatch) {
        matchedChildId = phoneMatch.id;
        matchConfidence = "high";
        if (action !== "skip") action = "update";
      } else {
        matchedChildId = nameMatches[0].id;
        matchConfidence = "low";
        warnings.push(
          `שם זהה לילד/ה קיים/ת (${nameMatches[0].fullName}) אך פרטי הקשר שונים - יש לבדוק לפני מיזוג`
        );
      }
    } else if (parentPhone) {
      const siblingMatches = (byPhone.get(parentPhone) ?? []).filter(
        (c) => normalizeFullName(c.fullName) !== fullName
      );
      if (siblingMatches.length > 0) {
        matchConfidence = "sibling";
        warnings.push(
          `טלפון הורה זהה לילד/ה קיים/ת בשם ${siblingMatches[0].fullName} - ייתכן אח/אחות ולא כפילות`
        );
      }
    }

    candidates.push({
      key: `c${index++}`,
      rowNumber,
      firstName,
      lastName,
      fullName,
      age: parsedAge.age,
      gender,
      parentName,
      parentPhone,
      notes,
      constraints,
      action,
      matchedChildId,
      matchConfidence,
      warnings,
    });
  });

  if (candidates.length === 0) {
    return {
      success: false,
      error: `לא נמצאו שורות ילדים בקובץ אחרי שורת הכותרות (שורה ${headerRow}).`,
      debugInfo,
    };
  }

  return { success: true, candidates, debugInfo };
}

export async function parseTeachingPracticeChildrenExcelAsAdmin(
  formData: FormData
): Promise<ParseTeachingPracticeChildrenExcelResult> {
  await requireAdmin();
  return parseTeachingPracticeChildrenExcelInternal(formData);
}

export async function parseTeachingPracticeChildrenExcelAsInstructor(
  instructorId: string,
  formData: FormData
): Promise<ParseTeachingPracticeChildrenExcelResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageTeachingPracticeAssignments) {
    return { success: false, error: "אין הרשאה לניהול שיבוצי התנסויות מתחילים" };
  }
  return parseTeachingPracticeChildrenExcelInternal(formData);
}

// One row as the client wants it committed - the reviewed/edited version of
// TeachingPracticeChildImportCandidate (action may have been changed by the
// admin/instructor after previewing; every other field may have been
// hand-edited too). matchedChildId is only ever honored for action="update" -
// carried through from the preview's own duplicate detection, never
// re-resolved here, so a row can't silently retarget a different existing
// child than the one shown in the preview.
export interface TeachingPracticeChildImportCommitRow {
  action: ChildImportRowAction;
  firstName: string;
  lastName: string;
  age: number | null;
  gender: string;
  parentName: string;
  parentPhone: string;
  notes: string;
  matchedChildId: string | null;
}

export interface CommitTeachingPracticeChildrenImportResult {
  success: boolean;
  error?: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
}

const EMPTY_COMMIT_COUNTS = { createdCount: 0, updatedCount: 0, skippedCount: 0 };

// Validates every row before writing anything - the whole commit fails (and
// nothing is saved) if any row is invalid, rather than silently skipping bad
// rows, so the admin/instructor always knows exactly what did or didn't get
// saved. Never upserts blindly: "update" is only ever applied to the specific
// matchedChildId carried over from the preview's duplicate detection - a
// row can't be saved as an update without one, and ambiguous/low-confidence
// preview matches (which the preview never auto-selects as "update") are
// never silently merged here.
async function commitTeachingPracticeChildrenImportInternal(
  rows: TeachingPracticeChildImportCommitRow[]
): Promise<CommitTeachingPracticeChildrenImportResult> {
  for (const row of rows) {
    if (row.action === "skip") continue;
    const firstName = row.firstName?.trim();
    const lastName = row.lastName?.trim();
    if (!firstName || !lastName) {
      return {
        success: false,
        error: `שורה חסרה שם פרטי/שם משפחה (${row.firstName || "?"} ${row.lastName || "?"})`,
        ...EMPTY_COMMIT_COUNTS,
      };
    }
    if (row.age != null && (!Number.isInteger(row.age) || row.age < 0 || row.age > 120)) {
      return {
        success: false,
        error: `גיל לא תקין עבור ${firstName} ${lastName}`,
        ...EMPTY_COMMIT_COUNTS,
      };
    }
    if (row.action === "update" && !row.matchedChildId) {
      return {
        success: false,
        error: `השורה של ${firstName} ${lastName} מסומנת לעדכון אך לא נמצא/ה ילד/ה קיים/ת תואם/ת`,
        ...EMPTY_COMMIT_COUNTS,
      };
    }
  }

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      if (row.action === "skip") {
        skippedCount++;
        continue;
      }

      const firstName = row.firstName.trim();
      const lastName = row.lastName.trim();
      const fullName = normalizeFullName(`${firstName} ${lastName}`);
      const data = {
        firstName,
        lastName,
        fullName,
        age: row.age,
        gender: row.gender?.trim() || null,
        parentName: row.parentName?.trim() || null,
        parentPhone: row.parentPhone ? normalizePhone(row.parentPhone) : null,
        notes: row.notes?.trim() || null,
      };

      if (row.action === "update" && row.matchedChildId) {
        await tx.teachingPracticeChild.update({ where: { id: row.matchedChildId }, data });
        updatedCount++;
      } else if (row.action === "create") {
        await tx.teachingPracticeChild.create({ data: { ...data, isActive: true } });
        createdCount++;
      }
    }
  });

  return { success: true, createdCount, updatedCount, skippedCount };
}

export async function commitTeachingPracticeChildrenImportAsAdmin(
  rows: TeachingPracticeChildImportCommitRow[]
): Promise<CommitTeachingPracticeChildrenImportResult> {
  await requireAdmin();
  return commitTeachingPracticeChildrenImportInternal(rows);
}

export async function commitTeachingPracticeChildrenImportAsInstructor(
  instructorId: string,
  rows: TeachingPracticeChildImportCommitRow[]
): Promise<CommitTeachingPracticeChildrenImportResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageTeachingPracticeAssignments) {
    return {
      success: false,
      error: "אין הרשאה לניהול שיבוצי התנסויות מתחילים",
      ...EMPTY_COMMIT_COUNTS,
    };
  }
  return commitTeachingPracticeChildrenImportInternal(rows);
}
