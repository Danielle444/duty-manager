"use server";

import { Workbook, type Row, type Worksheet } from "exceljs";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey, parseDateKey, todayDateKey } from "@/lib/dates";
import { setCourseDayPlan } from "@/lib/actions/course-day-plan";
import type { ActionResult } from "@/lib/actions/students";
import { cleanScheduleTitle } from "@/lib/schedule-title";

// The real-world weekly schedule Excel files this needs to tolerate don't
// necessarily have a single clean header row in row 1 - see the three-phase
// strategy in parseWeeklyScheduleExcel below.
const MAX_HEADER_SCAN_ROWS = 15;

const DATE_SYNONYMS = ["תאריך", "יום", "date"];
const START_SYNONYMS = ["שעת התחלה", "משעה", "התחלה", "start"];
const END_SYNONYMS = ["שעת סיום", "עד שעה", "סיום", "end"];
const TITLE_SYNONYMS = ["נושא", "פעילות", "כותרת", "title"];
const INSTRUCTOR_SYNONYMS = ["מדריך", "מדריכה", "מדריך/ה", "מאמנים", "מאמן", "instructor"];
const LOCATION_SYNONYMS = ["מיקום", "location"];
const DESCRIPTION_SYNONYMS = ["הערות", "תיאור"];

const DATE_PATTERN = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/;
const TIME_PATTERN = /(\d{1,2}):(\d{2})/g;

// An admin can type one of these directly into an activity/title cell to
// explicitly mark "this group has nothing in this time slot" - distinct from
// leaving the cell truly blank, which is ambiguous (see isSkipTitle's call
// sites for why that distinction matters).
const SKIP_TITLE_VALUES = new Set(["ריק", "אין פעילות", "-"]);

function isSkipTitle(text: string): boolean {
  return SKIP_TITLE_VALUES.has(text.trim());
}

function normalizeHeader(h: string): string {
  return h.trim().replace(/[."'\s]/g, "");
}

// exceljs cell values can be a plain value, a Date, or a rich-text/formula
// object depending on how the cell was authored - this normalizes all of
// them to plain text (dates are handled separately by the date/time helpers).
function rawCellValue(row: Row, col: number): unknown {
  return row.getCell(col).value;
}

function cellText(row: Row, col: number | undefined): string {
  if (!col) return "";
  const value = rawCellValue(row, col);
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

function extractDateKeyFromText(text: string): string | null {
  const match = text.match(DATE_PATTERN);
  if (!match) return null;
  const [, d, mo, y] = match;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  try {
    return dateKey(new Date(Date.UTC(year, month - 1, day)));
  } catch {
    return null;
  }
}

function extractDateKey(row: Row, col: number | undefined): string | null {
  if (!col) return null;
  const value = rawCellValue(row, col);
  if (value instanceof Date) {
    // Excel stores time-only cells as a Date anchored to its epoch day
    // (1899-12-30) - that's a time-of-day, never a real calendar date.
    if (value.getFullYear() <= 1900) return null;
    return dateKey(new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())));
  }
  return extractDateKeyFromText(cellText(row, col));
}

function extractTime(row: Row, col: number | undefined): string {
  if (!col) return "";
  const value = rawCellValue(row, col);
  if (value instanceof Date) {
    const hh = String(value.getUTCHours()).padStart(2, "0");
    const mm = String(value.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const text = cellText(row, col);
  const match = text.match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function rowRawText(row: Row, colCount: number): string {
  const parts: string[] = [];
  for (let c = 1; c <= colCount; c++) {
    const t = cellText(row, c);
    if (t) parts.push(t);
    else if (rawCellValue(row, c) instanceof Date) {
      const time = extractTime(row, c);
      if (time) parts.push(time);
    }
  }
  return parts.join(" | ");
}

type ColumnKind =
  | "date"
  | "startTime"
  | "endTime"
  | "title"
  | "groupTitle"
  | "groupValue"
  | "instructor"
  | "location"
  | "description";

interface ColumnClassification {
  col: number;
  kind: ColumnKind;
  group?: string | null;
}

function classifyHeaderCell(rawText: string): ColumnClassification | null {
  const normalized = normalizeHeader(rawText);
  if (!normalized) return null;
  if (DATE_SYNONYMS.some((s) => normalizeHeader(s) === normalized)) return { col: 0, kind: "date" };
  if (START_SYNONYMS.some((s) => normalizeHeader(s) === normalized))
    return { col: 0, kind: "startTime" };
  if (END_SYNONYMS.some((s) => normalizeHeader(s) === normalized)) return { col: 0, kind: "endTime" };
  if (INSTRUCTOR_SYNONYMS.some((s) => normalizeHeader(s) === normalized))
    return { col: 0, kind: "instructor" };
  if (LOCATION_SYNONYMS.some((s) => normalizeHeader(s) === normalized))
    return { col: 0, kind: "location" };
  if (DESCRIPTION_SYNONYMS.some((s) => normalizeHeader(s) === normalized))
    return { col: 0, kind: "description" };
  if (TITLE_SYNONYMS.some((s) => normalizeHeader(s) === normalized)) return { col: 0, kind: "title" };
  // "קבוצה" alone = a column whose cell VALUES are group labels (e.g. "א"/"ב").
  // "קבוצה א" / "קבוצה ב" = the group is baked into the header itself, and
  // this column's cell values are the activity/title text for that group.
  if (normalized.startsWith(normalizeHeader("קבוצה"))) {
    const remainder = rawText.trim().replace(/^קבוצה/, "").trim();
    return remainder ? { col: 0, kind: "groupTitle", group: remainder } : { col: 0, kind: "groupValue" };
  }
  return null;
}

interface HeaderScanResult {
  headerRow: number;
  classifications: ColumnClassification[];
}

function scanForHeaderRow(worksheet: Worksheet): HeaderScanResult | null {
  const lastRow = Math.min(worksheet.rowCount, MAX_HEADER_SCAN_ROWS);
  let best: HeaderScanResult | null = null;

  for (let r = 1; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    const classifications: ColumnClassification[] = [];
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const text = cellText(row, c);
      if (!text) continue;
      const classification = classifyHeaderCell(text);
      if (classification) classifications.push({ ...classification, col: c });
    }
    const hasAnchor = classifications.some((c) => c.kind === "startTime" || c.kind === "date");
    if (classifications.length >= 2 && hasAnchor) {
      if (!best || classifications.length > best.classifications.length) {
        best = { headerRow: r, classifications };
      }
    }
  }

  return best;
}

interface ScheduleBlock {
  startCol: number;
  endCol: number | null;
  titleCols: ColumnClassification[];
  instructorCol: number | null;
  locationCol: number | null;
  descriptionCol: number | null;
}

function buildBlocks(classifications: ColumnClassification[]): ScheduleBlock[] {
  const startCols = classifications
    .filter((c) => c.kind === "startTime")
    .map((c) => c.col)
    .sort((a, b) => a - b);
  if (startCols.length === 0) return [];

  return startCols.map((startCol, i) => {
    const nextStart = startCols[i + 1] ?? Infinity;
    const inBlock = classifications.filter((c) => c.col >= startCol && c.col < nextStart);
    return {
      startCol,
      endCol: inBlock.find((c) => c.kind === "endTime")?.col ?? null,
      titleCols: inBlock.filter(
        (c) => c.kind === "groupTitle" || c.kind === "title" || c.kind === "groupValue"
      ),
      instructorCol: inBlock.find((c) => c.kind === "instructor")?.col ?? null,
      locationCol: inBlock.find((c) => c.kind === "location")?.col ?? null,
      descriptionCol: inBlock.find((c) => c.kind === "description")?.col ?? null,
    };
  });
}

// Many real schedules don't label the date column at all (it's visually
// obvious to a human but has no header text) - if header matching didn't
// find one, sniff the columns to the left of the first block for whichever
// one most often contains date-like text in the data rows.
function sniffDateColumn(
  worksheet: Worksheet,
  headerRow: number,
  firstBlockStart: number
): number | null {
  const sampleEnd = Math.min(worksheet.rowCount, headerRow + 60);
  let bestCol: number | null = null;
  let bestScore = 0;
  for (let c = 1; c < firstBlockStart; c++) {
    let score = 0;
    for (let r = headerRow + 1; r <= sampleEnd; r++) {
      if (extractDateKey(worksheet.getRow(r), c)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  return bestScore > 0 ? bestCol : null;
}

function parseStructuredTable(
  worksheet: Worksheet,
  headerRow: number,
  classifications: ColumnClassification[]
): ScheduleImportItem[] {
  const blocks = buildBlocks(classifications);
  if (blocks.length === 0) return [];

  // Real weekly schedules only ever have one table to import (B-G: date,
  // start, end, group א, group ב, instructor); additional side-by-side
  // blocks further right in the same sheet have shown up as a *different*,
  // more granular breakdown of the same time slots, not additional data to
  // import - so only the leftmost (primary) block is used.
  const block = blocks.reduce((a, b) => (a.startCol <= b.startCol ? a : b));

  const headerDateCol = classifications.find((c) => c.kind === "date")?.col ?? null;
  const dateCol = headerDateCol ?? sniffDateColumn(worksheet, headerRow, block.startCol);

  const items: ScheduleImportItem[] = [];
  let index = 0;
  let lastDateKey: string | null = null;

  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const rawText = rowRawText(row, worksheet.columnCount);
    if (!rawText) continue; // blank separator row - doesn't reset carry-forward

    const rowDateKey = dateCol ? extractDateKey(row, dateCol) : null;
    if (rowDateKey) lastDateKey = rowDateKey;
    const effectiveDateKey = rowDateKey ?? lastDateKey;

    const startTime = extractTime(row, block.startCol);
    const endTime = block.endCol ? extractTime(row, block.endCol) : "";
    const instructorName = block.instructorCol ? cellText(row, block.instructorCol) : "";
    const location = block.locationCol ? cellText(row, block.locationCol) : "";
    const description = block.descriptionCol ? cellText(row, block.descriptionCol) : "";

    const groupTitleCols = block.titleCols.filter((c) => c.kind === "groupTitle");
    const groupTitleEntries = groupTitleCols.map((c) => {
      const raw = cellText(row, c.col);
      const text = raw ? cleanScheduleTitle(raw) : "";
      return { group: c.group ?? null, text, isSkip: text !== "" && isSkipTitle(text) };
    });
    // "Real" excludes both truly-blank cells and explicit skip markers -
    // neither should ever become a ScheduleItem of its own.
    const realGroupEntries = groupTitleEntries.filter((e) => e.text && !e.isSkip);
    const hasExplicitSkip = groupTitleEntries.some((e) => e.isSkip);
    const plainTitleCol = block.titleCols.find((c) => c.kind === "title");
    const groupValueCol = block.titleCols.find((c) => c.kind === "groupValue");

    let produced: { group: string | null; title: string }[] = [];

    if (groupTitleCols.length > 0) {
      if (realGroupEntries.length === 0) {
        // Nothing real in any group column this row - either truly blank,
        // or every filled cell was an explicit "ריק"/"אין פעילות"/"-" marker.
        produced = [];
      } else if (hasExplicitSkip) {
        // At least one side explicitly says "nothing here" - that's a
        // deliberate per-group signal, so never collapse this into "both
        // groups" the way an ambiguous blank cell would.
        produced = realGroupEntries.map((e) => ({ group: e.group, title: e.text }));
      } else {
        const distinctTexts = new Set(realGroupEntries.map((e) => e.text));
        if (groupTitleCols.length >= 2 && distinctTexts.size === 1) {
          // Either only one side had text (the other genuinely blank -
          // typically a merged cell spanning both group columns) or both
          // sides repeat the same text verbatim - either way, this applies
          // to both groups. Unchanged from before - only genuinely blank
          // cells reach this branch now that explicit skip markers are
          // handled above.
          produced = [{ group: null, title: realGroupEntries[0].text }];
        } else {
          produced = realGroupEntries.map((e) => ({ group: e.group, title: e.text }));
        }
      }
    } else if (plainTitleCol) {
      const rawTitle = cellText(row, plainTitleCol.col);
      if (rawTitle && !isSkipTitle(cleanScheduleTitle(rawTitle))) {
        produced = [
          {
            group: groupValueCol ? cellText(row, groupValueCol.col) || null : null,
            title: cleanScheduleTitle(rawTitle),
          },
        ];
      }
    }

    if (produced.length === 0) continue;

    for (const p of produced) {
      items.push({
        key: `i${index++}`,
        dateKey: effectiveDateKey,
        startTime,
        endTime,
        title: p.title,
        description,
        groupName: p.group ?? "",
        instructorName,
        location,
        rawText,
        needsReview: !effectiveDateKey,
      });
    }
  }

  return items;
}

// Handles the transposed layout where each date is a column header (rather
// than a single "תאריך" column) and rows are time slots.
function parseTransposedTable(worksheet: Worksheet): ScheduleImportItem[] {
  const lastHeaderScanRow = Math.min(worksheet.rowCount, MAX_HEADER_SCAN_ROWS);
  let dateHeaderRow: number | null = null;
  let dateColumns: { col: number; dateKey: string }[] = [];

  for (let r = 1; r <= lastHeaderScanRow; r++) {
    const row = worksheet.getRow(r);
    const found: { col: number; dateKey: string }[] = [];
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const dk = extractDateKey(row, c);
      if (dk) found.push({ col: c, dateKey: dk });
    }
    if (found.length >= 3) {
      dateHeaderRow = r;
      dateColumns = found;
      break;
    }
  }

  if (!dateHeaderRow || dateColumns.length === 0) return [];

  const labelCol = Math.min(...dateColumns.map((d) => d.col)) - 1 || 1;
  const items: ScheduleImportItem[] = [];
  let index = 0;

  for (let r = dateHeaderRow + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const rawText = rowRawText(row, worksheet.columnCount);
    if (!rawText) continue;

    const labelText = cellText(row, labelCol);
    const timeMatches = Array.from(labelText.matchAll(TIME_PATTERN));
    const startTime = timeMatches[0] ? `${timeMatches[0][1].padStart(2, "0")}:${timeMatches[0][2]}` : "";
    const endTime = timeMatches[1] ? `${timeMatches[1][1].padStart(2, "0")}:${timeMatches[1][2]}` : "";

    for (const { col, dateKey: dk } of dateColumns) {
      const title = cellText(row, col);
      if (!title || isSkipTitle(title)) continue;
      items.push({
        key: `i${index++}`,
        dateKey: dk,
        startTime,
        endTime,
        title,
        description: "",
        groupName: "",
        instructorName: "",
        location: "",
        rawText,
        needsReview: false,
      });
    }
  }

  return items;
}

// Last-resort fallback when no recognizable table structure was found at
// all: walk every row, pull out anything that looks like a date or a time,
// and hand the rest to the manager as an editable, flagged-for-review row.
function parseFreeform(worksheet: Worksheet): ScheduleImportItem[] {
  const items: ScheduleImportItem[] = [];
  let index = 0;
  let lastDateKey: string | null = null;

  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const rawText = rowRawText(row, worksheet.columnCount);
    if (!rawText) continue;

    let rowDateKey: string | null = null;
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const dk = extractDateKey(row, c);
      if (dk) {
        rowDateKey = dk;
        break;
      }
    }
    if (rowDateKey) lastDateKey = rowDateKey;

    const timeMatches = Array.from(rawText.matchAll(TIME_PATTERN));
    const startTime = timeMatches[0] ? `${timeMatches[0][1].padStart(2, "0")}:${timeMatches[0][2]}` : "";
    const endTime = timeMatches[1] ? `${timeMatches[1][1].padStart(2, "0")}:${timeMatches[1][2]}` : "";

    // Best-guess title: the longest cell text that isn't the date/time itself.
    let title = "";
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const t = cellText(row, c);
      if (t && t.length > title.length && !DATE_PATTERN.test(t) && !/^\d{1,2}:\d{2}/.test(t)) {
        title = t;
      }
    }

    if (title && isSkipTitle(title)) continue;

    items.push({
      key: `i${index++}`,
      dateKey: rowDateKey ?? lastDateKey,
      startTime,
      endTime,
      title: title || rawText,
      description: "",
      groupName: "",
      instructorName: "",
      location: "",
      rawText,
      needsReview: true,
    });
  }

  return items;
}

export interface ScheduleImportItem {
  key: string;
  dateKey: string | null;
  startTime: string;
  endTime: string;
  title: string;
  description: string;
  groupName: string;
  instructorName: string;
  location: string;
  rawText: string;
  needsReview: boolean;
}

export interface ParseWeeklyScheduleResult {
  success: boolean;
  error?: string;
  items?: ScheduleImportItem[];
  warning?: string;
}

const UNCERTAIN_WARNING =
  "המערכת לא זיהתה את מבנה הלוז בוודאות. נא לבדוק ולתקן את הטבלה לפני שמירה.";

export async function parseWeeklyScheduleExcel(
  formData: FormData
): Promise<ParseWeeklyScheduleResult> {
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

  // Phase 1: transposed layout (dates as column headers).
  let items = parseTransposedTable(worksheet);
  let uncertain = false;

  // Phase 2: a recognizable header row with one or more start-time-anchored blocks.
  let headerScan: HeaderScanResult | null = null;
  if (items.length === 0) {
    headerScan = scanForHeaderRow(worksheet);
    if (headerScan) {
      items = parseStructuredTable(worksheet, headerScan.headerRow, headerScan.classifications);
      uncertain = items.some((i) => i.needsReview);
    }
  }

  // Phase 3: no recognizable structure at all - freeform best-effort dump.
  if (items.length === 0) {
    items = parseFreeform(worksheet);
    uncertain = items.length > 0;
  }

  if (items.length === 0) {
    const scanned = Math.min(worksheet.rowCount, MAX_HEADER_SCAN_ROWS);
    const headerHints: string[] = [];
    for (let r = 1; r <= scanned; r++) {
      const row = worksheet.getRow(r);
      const texts: string[] = [];
      for (let c = 1; c <= worksheet.columnCount; c++) {
        const t = cellText(row, c);
        if (t) texts.push(`[${c}]"${t}"`);
      }
      if (texts.length > 0) headerHints.push(`שורה ${r}: ${texts.join(", ")}`);
    }

    const debugInfo = [
      `גיליון שנקרא: "${worksheet.name}"`,
      `שורות שנסרקו: 1-${scanned}`,
      headerHints.length > 0
        ? `תוכן שזוהה בשורות אלו:\n${headerHints.join("\n")}`
        : "לא זוהה תוכן כלשהו בשורות שנסרקו",
    ].join("\n");

    return {
      success: false,
      error: `לא נמצאו שורות שניתן לייבא בקובץ.\n\nמידע לאבחון:\n${debugInfo}`,
    };
  }

  return { success: true, items, warning: uncertain ? UNCERTAIN_WARNING : undefined };
}

export interface CommitWeeklyScheduleInput {
  weeklyScheduleId?: string;
  name: string;
  startDate: string;
  endDate: string;
  uploadedFileName: string;
  items: ScheduleImportItem[];
}

export interface CommitWeeklyScheduleResult {
  success: boolean;
  error?: string;
  weeklyScheduleId?: string;
  savedCount: number;
  skippedCount: number;
}

export async function commitWeeklySchedule(
  input: CommitWeeklyScheduleInput
): Promise<CommitWeeklyScheduleResult> {
  // Fail-closed admin gate before any validation, Prisma read/write, or
  // revalidation: this action can create a week and destructively replace all
  // ScheduleItem rows for a client-supplied weeklyScheduleId.
  await requireAdmin();
  if (!input.name.trim() || !input.startDate || !input.endDate) {
    return {
      success: false,
      error: "יש למלא שם וטווח תאריכים",
      savedCount: 0,
      skippedCount: 0,
    };
  }

  const validItems = input.items.filter((i) => i.dateKey);
  const skippedCount = input.items.length - validItems.length;

  let weeklyScheduleId = input.weeklyScheduleId;

  if (weeklyScheduleId) {
    await prisma.weeklySchedule.update({
      where: { id: weeklyScheduleId },
      data: {
        name: input.name,
        startDate: parseDateKey(input.startDate),
        endDate: parseDateKey(input.endDate),
        uploadedFileName: input.uploadedFileName,
      },
    });
    await prisma.scheduleItem.deleteMany({ where: { weeklyScheduleId } });
  } else {
    const created = await prisma.weeklySchedule.create({
      data: {
        name: input.name,
        startDate: parseDateKey(input.startDate),
        endDate: parseDateKey(input.endDate),
        uploadedFileName: input.uploadedFileName,
      },
    });
    weeklyScheduleId = created.id;
  }

  if (validItems.length > 0) {
    await prisma.scheduleItem.createMany({
      data: validItems.map((i) => ({
        weeklyScheduleId: weeklyScheduleId!,
        date: parseDateKey(i.dateKey!),
        startTime: i.startTime,
        endTime: i.endTime,
        title: i.title,
        description: i.description || null,
        groupName: i.groupName || null,
        instructorName: i.instructorName || null,
        location: i.location || null,
        rawText: i.rawText || null,
      })),
    });
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true, weeklyScheduleId, savedCount: validItems.length, skippedCount };
}

export async function deleteWeeklySchedule(weeklyScheduleId: string): Promise<ActionResult> {
  // Fail-closed admin gate before the delete: this cascades to the week's
  // ScheduleItem rows and their riding/weekly-feedback descendants.
  await requireAdmin();
  await prisma.weeklySchedule.delete({ where: { id: weeklyScheduleId } });
  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true };
}

// Admin-only toggle for whether חניכים can see this week at all (see
// getWeeklyScheduleSelectionForStudent / getScheduleForStudent) - does not
// touch schedule items, duty assignments, or their own separate publish
// status.
export async function setWeeklySchedulePublished(
  weeklyScheduleId: string,
  isPublished: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.weeklySchedule.update({
    where: { id: weeklyScheduleId },
    data: { isPublished },
  });
  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true };
}

function timeToMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface DayPlanSuggestion {
  dateKey: string;
  firstMorningGroup: string | null;
  secondMorningGroup: string | null;
  firstAfterLunchGroup: string | null;
  secondAfterLunchGroup: string | null;
}

export interface SuggestDayPlanResult {
  success: boolean;
  error?: string;
  suggestions?: DayPlanSuggestion[];
}

// A single continuous riding activity for one group is often stored as
// several consecutive rows (same reason lib/schedule-grouping.ts coalesces
// them for display), so naively taking the first two rows by start time can
// pick two rows from the *same* group. Instead, this looks at distinct group
// names only, ordered by each group's earliest riding row in this daypart -
// so two rows for the same group only ever produce one distinct entry, and
// the "first"/"second" order reflects which group's riding started earliest.
function firstTwoRidingGroups(
  ridingItems: { groupName: string | null; startTime: string }[]
): [string | null, string | null] {
  const earliestStartByGroup = new Map<string, number>();
  for (const item of ridingItems) {
    if (!item.groupName) continue;
    const start = timeToMinutes(item.startTime);
    const existing = earliestStartByGroup.get(item.groupName);
    if (existing === undefined || start < existing) {
      earliestStartByGroup.set(item.groupName, start);
    }
  }
  const orderedGroups = Array.from(earliestStartByGroup.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([group]) => group);
  return [orderedGroups[0] ?? null, orderedGroups[1] ?? null];
}

// Best-effort only: looks for riding-related items ("רכיבה") that have a
// group, split into before/after 13:00, ordered by start time. The manager
// reviews and edits every suggestion before it's written anywhere.
export async function suggestDayPlanFromSchedule(
  weeklyScheduleId: string
): Promise<SuggestDayPlanResult> {
  const items = await prisma.scheduleItem.findMany({
    where: { weeklyScheduleId },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  if (items.length === 0) {
    return { success: false, error: 'אין פריטי לו"ז לשבוע זה' };
  }

  const byDate = new Map<string, typeof items>();
  for (const item of items) {
    const dk = dateKey(item.date);
    if (!byDate.has(dk)) byDate.set(dk, []);
    byDate.get(dk)!.push(item);
  }

  const suggestions: DayPlanSuggestion[] = [];
  for (const [dk, dayItems] of byDate) {
    const ridingItems = dayItems.filter(
      (i) =>
        i.groupName && (i.title.includes("רכיבה") || (i.description ?? "").includes("רכיבה"))
    );
    const morning = ridingItems.filter((i) => timeToMinutes(i.startTime) < 13 * 60);
    const afternoon = ridingItems.filter((i) => timeToMinutes(i.startTime) >= 13 * 60);
    const [firstMorningGroup, secondMorningGroup] = firstTwoRidingGroups(morning);
    const [firstAfterLunchGroup, secondAfterLunchGroup] = firstTwoRidingGroups(afternoon);

    suggestions.push({
      dateKey: dk,
      firstMorningGroup,
      secondMorningGroup,
      firstAfterLunchGroup,
      secondAfterLunchGroup,
    });
  }

  suggestions.sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
  return { success: true, suggestions };
}

export async function confirmDayPlanSuggestions(
  selections: DayPlanSuggestion[]
): Promise<ActionResult> {
  // Defense in depth: gate here before delegating to setCourseDayPlan (which
  // enforces its own gate too). Both are independently invocable Server Actions,
  // so neither may rely on the other having checked.
  await requireAdmin();
  for (const s of selections) {
    await setCourseDayPlan(s.dateKey, {
      firstMorningGroup: s.firstMorningGroup,
      secondMorningGroup: s.secondMorningGroup,
      firstAfterLunchGroup: s.firstAfterLunchGroup,
      secondAfterLunchGroup: s.secondAfterLunchGroup,
    });
  }
  return { success: true };
}

export interface WeeklyScheduleOption {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

// Read-only week list used by the admin/instructor week pickers (in
// addition to the admin pages) - just metadata, no PII, so no auth gate.
// Includes unpublished weeks so admins/instructors can prepare/check them
// before publishing - never use this for חניכים, use
// listPublishedWeeklyScheduleOptions / getWeeklyScheduleSelectionForStudent
// instead.
export async function listWeeklyScheduleOptions(): Promise<WeeklyScheduleOption[]> {
  const weeks = await prisma.weeklySchedule.findMany({
    orderBy: { startDate: "asc" },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
  return weeks.map((w) => ({
    id: w.id,
    name: w.name,
    startDate: dateKey(w.startDate),
    endDate: dateKey(w.endDate),
  }));
}

// Same as listWeeklyScheduleOptions but restricted to published weeks - the
// only variant a חניך/ה should ever see.
export async function listPublishedWeeklyScheduleOptions(): Promise<WeeklyScheduleOption[]> {
  const weeks = await prisma.weeklySchedule.findMany({
    where: { isPublished: true },
    orderBy: { startDate: "asc" },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
  return weeks.map((w) => ({
    id: w.id,
    name: w.name,
    startDate: dateKey(w.startDate),
    endDate: dateKey(w.endDate),
  }));
}

function daysBetweenKeys(a: string, b: string): number {
  return Math.abs(parseDateKey(a).getTime() - parseDateKey(b).getTime()) / 86_400_000;
}

// Picks the week containing today, or - if none uploaded covers today - the
// uploaded week whose range is closest to today (so students/instructors
// land somewhere useful instead of an empty "no week selected" state).
function pickDefaultWeekId(weeks: WeeklyScheduleOption[], todayKey: string): string | null {
  if (weeks.length === 0) return null;
  const current = weeks.find((w) => w.startDate <= todayKey && todayKey <= w.endDate);
  if (current) return current.id;

  let best = weeks[0];
  let bestDist = Infinity;
  for (const w of weeks) {
    const dist =
      todayKey < w.startDate
        ? daysBetweenKeys(todayKey, w.startDate)
        : daysBetweenKeys(w.endDate, todayKey);
    if (dist < bestDist) {
      bestDist = dist;
      best = w;
    }
  }
  return best.id;
}

export interface WeeklyScheduleSelection {
  weeks: WeeklyScheduleOption[];
  defaultWeekId: string | null;
}

export async function getWeeklyScheduleSelection(): Promise<WeeklyScheduleSelection> {
  const weeks = await listWeeklyScheduleOptions();
  const defaultWeekId = pickDefaultWeekId(weeks, todayDateKey());
  return { weeks, defaultWeekId };
}

// Student-facing equivalent of getWeeklyScheduleSelection - only ever
// offers published weeks, so a חניך/ה can't select/land on one that isn't.
export async function getWeeklyScheduleSelectionForStudent(): Promise<WeeklyScheduleSelection> {
  const weeks = await listPublishedWeeklyScheduleOptions();
  const defaultWeekId = pickDefaultWeekId(weeks, todayDateKey());
  return { weeks, defaultWeekId };
}
