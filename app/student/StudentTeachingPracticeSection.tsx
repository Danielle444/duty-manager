"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  listMyTeachingPracticeLessonsForTrainee,
  listPublishedTeachingPracticeLessonsForTrainee,
  listPublishedTeachingPracticeTracksForTrainee,
  type TeachingPracticeTraineeChildRow,
  type TeachingPracticeTraineeLessonRow,
  type TeachingPracticeTraineeParticipantRow,
  type TeachingPracticeTraineeTrackChildRow,
  type TeachingPracticeTraineeTrackRow,
} from "@/lib/actions/teaching-practice-student";
import type {
  TeachingPracticeRoleValue,
  TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey, todayDateKey } from "@/lib/dates";
import { Modal } from "@/lib/components/Modal";
import { buildTelLink, buildWhatsAppLink } from "@/lib/phone-contact-links";
// Shared with the admin/instructor screen (see that file's own import of
// the same module) - one palette/rotation rule, so the same actual lesson
// time is always the same color everywhere, never two independently-
// maintained palettes drifting apart.
import { timeBlockColorClasses } from "@/lib/teaching-practice-time-colors";
// Shared, DB-free, JSX-free detection rule only - reused so this trainee
// surface never disagrees with the admin/instructor one about what counts
// as "same parent." Nothing else is imported from
// lib/components/TeachingPracticeManager.tsx (see that file's own header
// for why this surface deliberately shares no other code with it) - the
// badge itself is a tiny local component below, not imported, for the same
// reason ROLE_LABELS/PRACTICE_TYPE_LABELS are duplicated locally instead.
// The linked-private/group grouping logic further below is likewise
// duplicated locally (small, pure) rather than imported from the admin
// component, per product direction.
import {
  buildParentKey,
  buildSameParentOtherNamesByChildId,
  type SameParentChildInput,
} from "@/lib/teaching-practice-same-parent";

// Read-only trainee surface - deliberately not sharing anything with
// lib/components/TeachingPracticeManager.tsx (the admin/instructor CRUD
// component), since that component's edit/publish affordances must never
// reach a trainee. Labels are duplicated locally rather than imported from
// there for the same reason.
const PRACTICE_TYPE_LABELS: Record<TeachingPracticeTypeValue, string> = {
  LUNGE: "לונג׳",
  BEGINNER_PRIVATE: "שיעור פרטי מתחילים",
  BEGINNER_GROUP: "שיעור קבוצתי מתחילים",
};

const ROLE_LABELS: Record<TeachingPracticeRoleValue, string> = {
  LEAD_INSTRUCTOR: "מדריך ראשון",
  SECOND_INSTRUCTOR: "מדריך שני",
  ASSISTANT_INSTRUCTOR: "עוזר מדריך",
  EVALUATOR: "ממשב",
};

type TraineeTab = "mine" | "all";
type AllModeTab = "generatedLessons" | "fixedStructure";

// Same "אותו הורה" wording/styling as the admin/instructor surface - never
// states siblinghood as fact, and never shows a phone number (names only,
// same as the rest of this card). stopPropagation keeps a badge tap from
// also triggering any future click behavior on the enclosing card/row.
function SameParentBadge({ otherNames, onClick }: { otherNames: string[]; onClick: () => void }) {
  if (otherNames.length === 0) return null;
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="mr-1 cursor-pointer rounded-full bg-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-warning hover:opacity-80"
      title={`אותו הורה/איש קשר כמו: ${otherNames.join(", ")}`}
    >
      אותו הורה
    </span>
  );
}

// Shared cell renderers - used by both the generated-lessons tables and the
// fixed-structure tables below, so "current trainee" highlighting, the
// same-parent badge, and the phone actions all look and behave identically
// in both modes.

// Compact group label/color - a display-only distinguishing aid, never a
// visibility rule (that's entirely driven by the server action's own
// published/active filter). "א"/"ב" get their own tint; any other group
// name (or a track with no group at all) falls back to a neutral tint, so
// this never breaks for a group name this map doesn't happen to know about.
const GROUP_BADGE_CLASSES: Record<string, string> = {
  א: "bg-indigo-100 text-indigo-800",
  ב: "bg-fuchsia-100 text-fuchsia-800",
};

function GroupBadge({ groupName }: { groupName: string | null }) {
  if (!groupName) return <>—</>;
  const cls = GROUP_BADGE_CLASSES[groupName] ?? "bg-slate-100 text-slate-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {`קבוצה ${groupName}`}
    </span>
  );
}

function TraineeNamesCell({
  people,
}: {
  people: { traineeId: string; traineeName: string; isSelf: boolean }[];
}) {
  if (people.length === 0) return <>—</>;
  return (
    <>
      {people.map((p, i) => (
        <span key={p.traineeId}>
          {i > 0 && ", "}
          <span className={p.isSelf ? "font-bold text-card-foreground" : ""}>
            {p.traineeName}
            {p.isSelf && (
              <span className="mr-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                אני
              </span>
            )}
          </span>
        </span>
      ))}
    </>
  );
}

function ChildNameCell({
  child,
  sameParentOtherNamesByChildId,
  onOpenSameParentPopup,
}: {
  child: { childId: string; firstName: string; lastName: string | null } | null;
  sameParentOtherNamesByChildId: Map<string, string[]>;
  onOpenSameParentPopup: (childId: string) => void;
}) {
  if (!child) return <>—</>;
  return (
    <>
      {child.firstName}
      {child.lastName ? ` ${child.lastName}` : ""}
      <SameParentBadge
        otherNames={sameParentOtherNamesByChildId.get(child.childId) ?? []}
        onClick={() => onOpenSameParentPopup(child.childId)}
      />
    </>
  );
}

// Display-time derivation only (lib/phone-contact-links.ts never modifies
// stored data) - null simply means "don't render this action," never a
// broken tel:/wa.me link. The raw phone text always still shows.
function PhoneCell({ phone }: { phone: string | null }) {
  if (!phone) return <>—</>;
  const telLink = buildTelLink(phone);
  const waLink = buildWhatsAppLink(phone);
  return (
    <div className="flex flex-col items-start gap-1">
      <span>{phone}</span>
      {(telLink || waLink) && (
        <div className="flex flex-wrap gap-1">
          {telLink && (
            <a
              href={telLink}
              className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground hover:opacity-80"
            >
              התקשר
            </a>
          )}
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-success-muted px-1.5 py-0.5 text-[10px] font-medium text-success hover:opacity-80"
            >
              WhatsApp
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// "ההתנסויות שלי" - unchanged Stage S2 card view.
function LessonCard({
  lesson,
  sameParentOtherNamesByChildId,
  onOpenSameParentPopup,
}: {
  lesson: TeachingPracticeTraineeLessonRow;
  sameParentOtherNamesByChildId: Map<string, string[]>;
  onOpenSameParentPopup: (childId: string) => void;
}) {
  return (
    <div className="rounded-xl border-2 border-border p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-base font-semibold text-card-foreground">
          {formatHebrewWeekday(parseDateKey(lesson.date))} · {formatHebrewDate(parseDateKey(lesson.date))}
        </span>
        <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
          {lesson.startTime}-{lesson.endTime}
        </span>
      </div>

      <p className="text-lg font-bold text-card-foreground">
        {PRACTICE_TYPE_LABELS[lesson.practiceType]}
      </p>

      {/* responsibleInstructorName is intentionally not rendered here (Stage
          S2 product decision, display-only) - the field itself is still
          returned by the server action untouched, so this can be
          re-enabled later with no data change. */}
      {lesson.location && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          <span>מיקום: {lesson.location}</span>
        </div>
      )}

      {lesson.participants.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1 text-sm font-semibold text-muted-foreground">צוות</p>
          <ul className="flex flex-col gap-1">
            {lesson.participants.map((p) => (
              <li
                key={p.traineeId}
                className={`text-sm ${
                  p.isSelf
                    ? "rounded-lg bg-secondary px-2 py-1 font-bold text-secondary-foreground"
                    : "text-card-foreground"
                }`}
              >
                {p.traineeName} - {ROLE_LABELS[p.role]}
                {p.isSelf && " (את/ה)"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lesson.children.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1 text-sm font-semibold text-muted-foreground">ילדים</p>
          <ul className="flex flex-col gap-2">
            {lesson.children.map((c) => {
              const telLink = c.parentPhone ? buildTelLink(c.parentPhone) : null;
              const waLink = c.parentPhone ? buildWhatsAppLink(c.parentPhone) : null;
              return (
                <li key={c.childId} className="rounded-lg bg-muted p-2 text-sm text-card-foreground">
                  <p className="font-semibold">
                    {c.firstName}
                    {c.lastName ? ` ${c.lastName}` : ""}
                    {c.age != null || c.gender ? " · " : ""}
                    {c.age != null ? `גיל ${c.age}` : ""}
                    {c.age != null && c.gender ? " · " : ""}
                    {c.gender ?? ""}
                    <SameParentBadge
                      otherNames={sameParentOtherNamesByChildId.get(c.childId) ?? []}
                      onClick={() => onOpenSameParentPopup(c.childId)}
                    />
                  </p>
                  {(c.horseName || c.equipmentNotes) && (
                    <p className="text-muted-foreground">
                      {c.horseName ? `סוס: ${c.horseName}` : ""}
                      {c.horseName && c.equipmentNotes ? " · " : ""}
                      {c.equipmentNotes ? `ציוד: ${c.equipmentNotes}` : ""}
                    </p>
                  )}
                  {(c.parentName || c.parentPhone) && (
                    <p className="text-muted-foreground">
                      {c.parentName ? `הורה: ${c.parentName}` : ""}
                      {c.parentName && c.parentPhone ? " · " : ""}
                      {c.parentPhone ? `טלפון: ${c.parentPhone}` : ""}
                    </p>
                  )}
                  {(telLink || waLink) && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {telLink && (
                        <a
                          href={telLink}
                          className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground hover:opacity-80"
                        >
                          התקשר
                        </a>
                      )}
                      {waLink && (
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full bg-success-muted px-2 py-0.5 text-xs font-medium text-success hover:opacity-80"
                        >
                          WhatsApp
                        </a>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "שיעורים שנוצרו" mode - generated lessons, split into one table per
// practiceType (never mixed), each independently time-colored.
// ---------------------------------------------------------------------------

// One row per (lesson, child) pair - a lesson with no children at all still
// gets exactly one row (child: null). This data shape has no per-
// participant-per-child pairing (unlike the richer admin/instructor shape),
// so every row of a given lesson repeats that lesson's full participant
// list rather than guessing which participant goes with which child -
// simplest, always correct, never invents an attribution. LUNGE/
// BEGINNER_PRIVATE normally have 0-1 children -> 1 row; BEGINNER_GROUP
// normally has 3 -> 3 rows, each with the same 3 participants shown.
interface GeneratedLessonTableRow {
  key: string;
  date: string;
  startTime: string;
  endTime: string;
  groupName: string | null;
  participants: TeachingPracticeTraineeParticipantRow[];
  child: TeachingPracticeTraineeChildRow | null;
  isSelfRow: boolean;
}

function buildGeneratedLessonTableRows(lessons: TeachingPracticeTraineeLessonRow[]): GeneratedLessonTableRow[] {
  const rows: GeneratedLessonTableRow[] = [];
  for (const lesson of lessons) {
    const base = {
      date: lesson.date,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      groupName: lesson.groupName,
      participants: lesson.participants,
      isSelfRow: lesson.participants.some((p) => p.isSelf),
    };
    if (lesson.children.length === 0) {
      rows.push({ ...base, key: `${lesson.id}-none`, child: null });
    } else {
      for (const child of lesson.children) {
        rows.push({ ...base, key: `${lesson.id}-${child.childId}`, child });
      }
    }
  }
  return rows;
}

// Renders one practiceType's worth of generated lessons as its own table -
// renders nothing at all when there are no matching lessons, so a caller
// can always mount all three (LUNGE/private/group) unconditionally and only
// the relevant ones actually show.
function GeneratedLessonsTable({
  title,
  lessons,
  sameParentOtherNamesByChildId,
  onOpenSameParentPopup,
}: {
  title: string;
  lessons: TeachingPracticeTraineeLessonRow[];
  sameParentOtherNamesByChildId: Map<string, string[]>;
  onOpenSameParentPopup: (childId: string) => void;
}) {
  const rows = useMemo(() => buildGeneratedLessonTableRows(lessons), [lessons]);
  // Time-block coloring, keyed by each row's own lesson's actual startTime -
  // computed independently per practiceType table (never mixed with the
  // other two), so "adjacent" always reflects what's actually shown in THIS
  // table.
  const rowColors = useMemo(() => timeBlockColorClasses(rows.map((r) => r.startTime)), [rows]);

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-card-foreground">{title}</h4>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[860px] border-collapse text-xs">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-2 py-2 text-right font-bold">תאריך</th>
              <th className="px-2 py-2 text-right font-bold">שעה</th>
              <th className="px-2 py-2 text-right font-bold">קבוצה</th>
              <th className="px-2 py-2 text-right font-bold">חניכים / משתתפים</th>
              <th className="px-2 py-2 text-right font-bold">ילד/ה</th>
              <th className="px-2 py-2 text-right font-bold">הורה</th>
              <th className="px-2 py-2 text-right font-bold">טלפון</th>
              <th className="px-2 py-2 text-right font-bold">סוס</th>
              <th className="px-2 py-2 text-right font-bold">ציוד / הערות</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.key}
                className={`border-t border-border ${rowColors[i]} ${
                  row.isSelfRow ? "border-r-4 border-r-primary" : ""
                }`}
              >
                <td className="whitespace-nowrap px-2 py-2">
                  {formatHebrewWeekday(parseDateKey(row.date))} · {formatHebrewDate(parseDateKey(row.date))}
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  {row.startTime}-{row.endTime}
                </td>
                <td className="px-2 py-2">{row.groupName ? `קבוצה ${row.groupName}` : "—"}</td>
                <td className="px-2 py-2">
                  <TraineeNamesCell people={row.participants} />
                </td>
                <td className="px-2 py-2">
                  <ChildNameCell
                    child={row.child}
                    sameParentOtherNamesByChildId={sameParentOtherNamesByChildId}
                    onOpenSameParentPopup={onOpenSameParentPopup}
                  />
                </td>
                <td className="px-2 py-2">{row.child?.parentName ?? "—"}</td>
                <td className="px-2 py-2">
                  <PhoneCell phone={row.child?.parentPhone ?? null} />
                </td>
                <td className="px-2 py-2">{row.child?.horseName ?? "—"}</td>
                <td className="px-2 py-2">{row.child?.equipmentNotes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "מבנה קבוע" mode - fixed-structure tracks, split into LUNGE / linked
// BEGINNER_PRIVATE+BEGINNER_GROUP blocks / unlinked BEGINNER_PRIVATE, never
// mixed. Grouping logic is a small, local, pure duplicate of the
// admin/instructor component's own convention (see that file's
// compareLinkedPrivateTracks/buildBeginnerBlocks) - intentionally not
// imported from there, per product direction, and adapted to this file's
// narrower trainee-safe row shape (no createdAt here, so the tie-break
// drops straight to id).
// ---------------------------------------------------------------------------

function compareFixedStructureTracksForTrainee(
  a: TeachingPracticeTraineeTrackRow,
  b: TeachingPracticeTraineeTrackRow
): number {
  return a.defaultStartTime.localeCompare(b.defaultStartTime) || a.id.localeCompare(b.id);
}

interface FixedStructureBeginnerBlock {
  groupTrack: TeachingPracticeTraineeTrackRow;
  privateTracks: TeachingPracticeTraineeTrackRow[];
}

interface FixedStructureGroups {
  lungeTracks: TeachingPracticeTraineeTrackRow[];
  beginnerBlocks: FixedStructureBeginnerBlock[];
  unlinkedPrivateTracks: TeachingPracticeTraineeTrackRow[];
}

function buildFixedStructureGroups(tracks: TeachingPracticeTraineeTrackRow[]): FixedStructureGroups {
  const lungeTracks = tracks
    .filter((t) => t.practiceType === "LUNGE")
    .sort(compareFixedStructureTracksForTrainee);

  const groupTracks = tracks.filter((t) => t.practiceType === "BEGINNER_GROUP");
  const groupTrackIds = new Set(groupTracks.map((t) => t.id));
  const privateTracks = tracks.filter((t) => t.practiceType === "BEGINNER_PRIVATE");

  // A private track whose linked group isn't itself in the visible
  // (published) set - e.g. the group has no published lesson of its own
  // yet - is shown as unlinked here rather than silently dropped or
  // attached to a group row that can't actually be displayed.
  const privatesByGroupId = new Map<string, TeachingPracticeTraineeTrackRow[]>();
  const unlinkedPrivateTracks: TeachingPracticeTraineeTrackRow[] = [];
  for (const p of privateTracks) {
    if (p.groupTrackId && groupTrackIds.has(p.groupTrackId)) {
      const list = privatesByGroupId.get(p.groupTrackId) ?? [];
      list.push(p);
      privatesByGroupId.set(p.groupTrackId, list);
    } else {
      unlinkedPrivateTracks.push(p);
    }
  }

  const beginnerBlocks = groupTracks
    .map((groupTrack) => ({
      groupTrack,
      privateTracks: (privatesByGroupId.get(groupTrack.id) ?? []).sort(compareFixedStructureTracksForTrainee),
    }))
    .sort((a, b) => compareFixedStructureTracksForTrainee(a.groupTrack, b.groupTrack));

  unlinkedPrivateTracks.sort(compareFixedStructureTracksForTrainee);

  return { lungeTracks, beginnerBlocks, unlinkedPrivateTracks };
}

// One row per BEGINNER_PRIVATE track (or, for a group with no linked private
// track yet, one placeholder row for the group itself) - mirrors the
// export's own model (see build-teaching-practice-fixed-structure-workbook.ts
// header comment) and the admin/instructor block table: a linked
// BEGINNER_GROUP is never shown as its own separate row alongside its
// private rows, since conceptually it IS those private rows, just carrying
// a second (group) time. Trainees shown on a merged row are the union of
// the private track's own trainees and the linked group's trainees
// (deduped by id) - so a trainee running only the group portion, or only
// the private portion, is still highlighted as "isSelf" on every row of
// that block.
interface BeginnerMergedTableRow {
  key: string;
  groupName: string | null;
  privateStartTime: string | null;
  privateEndTime: string | null;
  groupStartTime: string;
  groupEndTime: string;
  trainees: { traineeId: string; traineeName: string; isSelf: boolean }[];
  child: TeachingPracticeTraineeTrackChildRow | null;
  isSelfRow: boolean;
  isPlaceholder: boolean;
}

function buildBeginnerMergedRows(blocks: FixedStructureBeginnerBlock[]): BeginnerMergedTableRow[] {
  const rows: BeginnerMergedTableRow[] = [];
  for (const block of blocks) {
    const { groupTrack, privateTracks } = block;

    if (privateTracks.length === 0) {
      // Exception case only - a published group track with no linked
      // private track at all yet. Shown as one placeholder row (group time
      // only, no private time, no child) rather than silently dropped.
      rows.push({
        key: `${groupTrack.id}-placeholder`,
        groupName: groupTrack.groupName,
        privateStartTime: null,
        privateEndTime: null,
        groupStartTime: groupTrack.defaultStartTime,
        groupEndTime: groupTrack.defaultEndTime,
        trainees: groupTrack.trainees.map((t) => ({
          traineeId: t.traineeId,
          traineeName: t.traineeName,
          isSelf: t.isSelf,
        })),
        child: null,
        isSelfRow: groupTrack.trainees.some((t) => t.isSelf),
        isPlaceholder: true,
      });
      continue;
    }

    for (const privateTrack of privateTracks) {
      const traineesById = new Map<string, { traineeId: string; traineeName: string; isSelf: boolean }>();
      for (const t of privateTrack.trainees) {
        traineesById.set(t.traineeId, { traineeId: t.traineeId, traineeName: t.traineeName, isSelf: t.isSelf });
      }
      for (const t of groupTrack.trainees) {
        if (!traineesById.has(t.traineeId)) {
          traineesById.set(t.traineeId, { traineeId: t.traineeId, traineeName: t.traineeName, isSelf: t.isSelf });
        }
      }
      const trainees = [...traineesById.values()];
      const isSelfRow = trainees.some((t) => t.isSelf);
      const base = {
        groupName: privateTrack.groupName,
        privateStartTime: privateTrack.defaultStartTime,
        privateEndTime: privateTrack.defaultEndTime,
        groupStartTime: groupTrack.defaultStartTime,
        groupEndTime: groupTrack.defaultEndTime,
        trainees,
        isSelfRow,
        isPlaceholder: false,
      };
      if (privateTrack.children.length === 0) {
        rows.push({ ...base, key: `${privateTrack.id}-none`, child: null });
      } else {
        for (const child of privateTrack.children) {
          rows.push({ ...base, key: `${privateTrack.id}-${child.childId}`, child });
        }
      }
    }
  }
  return rows;
}

function BeginnerStructureTable({
  title,
  rows,
  sameParentOtherNamesByChildId,
  onOpenSameParentPopup,
}: {
  title: string;
  rows: BeginnerMergedTableRow[];
  sameParentOtherNamesByChildId: Map<string, string[]>;
  onOpenSameParentPopup: (childId: string) => void;
}) {
  // Time-block coloring keyed by each row's own private time - falling back
  // to the group's own time only for a placeholder row (no private time to
  // key on), same convention the admin/instructor block table already uses.
  const rowColors = useMemo(
    () => timeBlockColorClasses(rows.map((r) => r.privateStartTime ?? r.groupStartTime)),
    [rows]
  );

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-card-foreground">{title}</h4>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[860px] border-collapse text-xs">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-2 py-2 text-right font-bold">קבוצה</th>
              <th className="px-2 py-2 text-right font-bold">שעה פרטני</th>
              <th className="px-2 py-2 text-right font-bold">שעה קבוצתי</th>
              <th className="px-2 py-2 text-right font-bold">חניך</th>
              <th className="px-2 py-2 text-right font-bold">ילד/ה</th>
              <th className="px-2 py-2 text-right font-bold">הורה</th>
              <th className="px-2 py-2 text-right font-bold">טלפון</th>
              <th className="px-2 py-2 text-right font-bold">סוס</th>
              <th className="px-2 py-2 text-right font-bold">ציוד / הערות</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.key}
                className={`border-t border-border ${rowColors[i]} ${
                  row.isSelfRow ? "border-r-4 border-r-primary" : ""
                }`}
              >
                <td className="px-2 py-2">
                  <GroupBadge groupName={row.groupName} />
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  {row.privateStartTime ? `${row.privateStartTime}-${row.privateEndTime}` : "—"}
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  {row.groupStartTime}-{row.groupEndTime}
                </td>
                <td className="px-2 py-2">
                  <TraineeNamesCell people={row.trainees} />
                </td>
                <td className="px-2 py-2">
                  <ChildNameCell
                    child={row.child}
                    sameParentOtherNamesByChildId={sameParentOtherNamesByChildId}
                    onOpenSameParentPopup={onOpenSameParentPopup}
                  />
                </td>
                <td className="px-2 py-2">{row.child?.parentName ?? "—"}</td>
                <td className="px-2 py-2">
                  <PhoneCell phone={row.child?.parentPhone ?? null} />
                </td>
                <td className="px-2 py-2">{row.child?.horseName ?? "—"}</td>
                <td className="px-2 py-2">{row.child?.equipmentNotes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface FixedStructureTableRow {
  key: string;
  roleLabel: string;
  startTime: string;
  endTime: string;
  groupName: string | null;
  defaultLocation: string | null;
  trainees: TeachingPracticeTraineeTrackRow["trainees"];
  child: TeachingPracticeTraineeTrackChildRow | null;
  isSelfRow: boolean;
}

// Same (entity, child) flattening convention as buildGeneratedLessonTableRows
// above, applied to fixed-structure tracks instead of generated lessons -
// roleLabel ("לונג׳"/"קבוצתי"/"פרטני") is supplied by the caller so one
// block's table can mix a group row with its private rows while still
// tagging which is which.
function buildFixedStructureRows(
  tracks: TeachingPracticeTraineeTrackRow[],
  roleLabel: string
): FixedStructureTableRow[] {
  const rows: FixedStructureTableRow[] = [];
  for (const track of tracks) {
    const base = {
      roleLabel,
      startTime: track.defaultStartTime,
      endTime: track.defaultEndTime,
      groupName: track.groupName,
      defaultLocation: track.defaultLocation,
      trainees: track.trainees,
      isSelfRow: track.trainees.some((t) => t.isSelf),
    };
    if (track.children.length === 0) {
      rows.push({ ...base, key: `${track.id}-none`, child: null });
    } else {
      for (const child of track.children) {
        rows.push({ ...base, key: `${track.id}-${child.childId}`, child });
      }
    }
  }
  return rows;
}

function FixedStructureTable({
  title,
  rows,
  sameParentOtherNamesByChildId,
  onOpenSameParentPopup,
}: {
  title: string;
  rows: FixedStructureTableRow[];
  sameParentOtherNamesByChildId: Map<string, string[]>;
  onOpenSameParentPopup: (childId: string) => void;
}) {
  // Time-block coloring keyed by defaultStartTime (the fixed-structure
  // template time, not any generated lesson's actual date/time) - computed
  // independently per table/block, same convention as GeneratedLessonsTable.
  const rowColors = useMemo(() => timeBlockColorClasses(rows.map((r) => r.startTime)), [rows]);

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-card-foreground">{title}</h4>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[860px] border-collapse text-xs">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-2 py-2 text-right font-bold">סוג</th>
              <th className="px-2 py-2 text-right font-bold">שעה</th>
              <th className="px-2 py-2 text-right font-bold">קבוצה</th>
              <th className="px-2 py-2 text-right font-bold">מיקום</th>
              <th className="px-2 py-2 text-right font-bold">חניכים</th>
              <th className="px-2 py-2 text-right font-bold">ילד/ה</th>
              <th className="px-2 py-2 text-right font-bold">הורה</th>
              <th className="px-2 py-2 text-right font-bold">טלפון</th>
              <th className="px-2 py-2 text-right font-bold">סוס</th>
              <th className="px-2 py-2 text-right font-bold">ציוד / הערות</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.key}
                className={`border-t border-border ${rowColors[i]} ${
                  row.isSelfRow ? "border-r-4 border-r-primary" : ""
                }`}
              >
                <td className="px-2 py-2">{row.roleLabel}</td>
                <td className="whitespace-nowrap px-2 py-2">
                  {row.startTime}-{row.endTime}
                </td>
                <td className="px-2 py-2">
                  <GroupBadge groupName={row.groupName} />
                </td>
                <td className="px-2 py-2">{row.defaultLocation ?? "—"}</td>
                <td className="px-2 py-2">
                  <TraineeNamesCell people={row.trainees} />
                </td>
                <td className="px-2 py-2">
                  <ChildNameCell
                    child={row.child}
                    sameParentOtherNamesByChildId={sameParentOtherNamesByChildId}
                    onOpenSameParentPopup={onOpenSameParentPopup}
                  />
                </td>
                <td className="px-2 py-2">{row.child?.parentName ?? "—"}</td>
                <td className="px-2 py-2">
                  <PhoneCell phone={row.child?.parentPhone ?? null} />
                </td>
                <td className="px-2 py-2">{row.child?.horseName ?? "—"}</td>
                <td className="px-2 py-2">{row.child?.equipmentNotes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StudentTeachingPracticeSection({ studentId }: { studentId: string }) {
  const [tab, setTab] = useState<TraineeTab>("mine");
  const [myLessons, setMyLessons] = useState<TeachingPracticeTraineeLessonRow[] | null>(null);
  const [allLessons, setAllLessons] = useState<TeachingPracticeTraineeLessonRow[] | null>(null);
  const [tracks, setTracks] = useState<TeachingPracticeTraineeTrackRow[] | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await listMyTeachingPracticeLessonsForTrainee(studentId);
      setMyLessons(result);
    });
  }, [studentId]);

  // allLessons and tracks are both fetched together as soon as "כל
  // ההתנסויות" is opened (regardless of which internal mode - מבנה קבוע /
  // שיעורים שנוצרו - is shown first), so switching between the two modes
  // never needs its own extra fetch, and the same-parent badge (which
  // spans both datasets - see allSameParentOtherNamesByChildId below) is
  // consistent immediately.
  useEffect(() => {
    if (tab !== "all" || allLessons !== null) return;
    startTransition(async () => {
      const result = await listPublishedTeachingPracticeLessonsForTrainee(studentId);
      setAllLessons(result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, studentId]);

  useEffect(() => {
    if (tab !== "all" || tracks !== null) return;
    startTransition(async () => {
      const result = await listPublishedTeachingPracticeTracksForTrainee(studentId);
      setTracks(result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, studentId]);

  const [allModeTab, setAllModeTab] = useState<AllModeTab>("generatedLessons");

  // "ההתנסויות שלי" date tabs - Stage S2. Based only on myLessons (never
  // allLessons) - one tab per distinct date that actually has a lesson for
  // this trainee, plus "הכל". mineDateTab is null until the trainee
  // actually clicks a tab - the default (nearest upcoming date, or "all")
  // is derived purely at render time below (effectiveMineDateTab), never
  // written back via an effect/setState, so it can never fight with a
  // manual tab choice or trigger an extra render.
  const [mineDateTab, setMineDateTab] = useState<string | "all" | null>(null);

  const mineDateKeys = useMemo(() => {
    if (!myLessons) return [];
    return Array.from(new Set(myLessons.map((l) => l.date))).sort();
  }, [myLessons]);

  const defaultMineDateTab = useMemo(() => {
    const todayKey = todayDateKey();
    return mineDateKeys.find((d) => d >= todayKey) ?? "all";
  }, [mineDateKeys]);

  const effectiveMineDateTab = mineDateTab ?? defaultMineDateTab;

  const displayedMineLessons = useMemo(() => {
    if (!myLessons) return [];
    if (effectiveMineDateTab === "all") return myLessons;
    return myLessons.filter((l) => l.date === effectiveMineDateTab);
  }, [myLessons, effectiveMineDateTab]);

  // "שיעורים שנוצרו" date tabs - same nearest-upcoming-else-"all" pattern as
  // "ההתנסויות שלי" above, applied to allLessons' own dates instead of
  // myLessons'.
  const [generatedDateTab, setGeneratedDateTab] = useState<string | "all" | null>(null);

  const generatedDateKeys = useMemo(() => {
    if (!allLessons) return [];
    return Array.from(new Set(allLessons.map((l) => l.date))).sort();
  }, [allLessons]);

  const defaultGeneratedDateTab = useMemo(() => {
    const todayKey = todayDateKey();
    return generatedDateKeys.find((d) => d >= todayKey) ?? "all";
  }, [generatedDateKeys]);

  const effectiveGeneratedDateTab = generatedDateTab ?? defaultGeneratedDateTab;

  const filteredGeneratedLessons = useMemo(() => {
    if (!allLessons) return [];
    if (effectiveGeneratedDateTab === "all") return allLessons;
    return allLessons.filter((l) => l.date === effectiveGeneratedDateTab);
  }, [allLessons, effectiveGeneratedDateTab]);

  // "מבנה קבוע" group filter - a single fixed-structure view (same table
  // structure/sections always), with a compact "הכל / קבוצה א / קבוצה ב"
  // filter to optionally narrow it to one group. Group א/ב are never shown
  // as separate blocks/screens - within a table both groups can appear
  // together (distinguished by GroupBadge's label/color), the filter is
  // just an optional narrowing.
  const fixedStructureGroupNames = useMemo(() => {
    const set = new Set<string>();
    for (const t of tracks ?? []) set.add(t.groupName ?? "");
    return Array.from(set).sort();
  }, [tracks]);

  // Default filter for the logged-in trainee, in order of preference: (1) a
  // fixed-structure track where the trainee is actually assigned
  // (trainee.isSelf), (2) failing that, a generated lesson the trainee
  // participates in whose group is one of the ones actually visible in the
  // fixed structure, (3) failing that, simply the first visible group.
  // Purely inferred client-side from already-loaded data - this component
  // has no separate notion of "the trainee's own group" to read from. Never
  // defaults to "all" - always a specific group unless none can be inferred
  // and there are no groups at all.
  const defaultFixedStructureGroupFilter = useMemo(() => {
    const selfTrack = (tracks ?? []).find((t) => t.trainees.some((tr) => tr.isSelf));
    if (selfTrack) return selfTrack.groupName ?? "";
    const selfLesson = (allLessons ?? []).find((l) => l.participants.some((p) => p.isSelf));
    if (selfLesson && fixedStructureGroupNames.includes(selfLesson.groupName ?? "")) {
      return selfLesson.groupName ?? "";
    }
    return fixedStructureGroupNames[0] ?? "";
  }, [tracks, allLessons, fixedStructureGroupNames]);

  const [fixedStructureGroupFilter, setFixedStructureGroupFilter] = useState<string | "all" | null>(null);
  const effectiveFixedStructureGroupFilter = fixedStructureGroupFilter ?? defaultFixedStructureGroupFilter;

  const tracksForFixedStructureView = useMemo(
    () =>
      effectiveFixedStructureGroupFilter === "all"
        ? tracks ?? []
        : (tracks ?? []).filter((t) => (t.groupName ?? "") === effectiveFixedStructureGroupFilter),
    [tracks, effectiveFixedStructureGroupFilter]
  );

  const fixedStructureGroups = useMemo(
    () => buildFixedStructureGroups(tracksForFixedStructureView),
    [tracksForFixedStructureView]
  );

  const beginnerMergedRows = useMemo(
    () => buildBeginnerMergedRows(fixedStructureGroups.beginnerBlocks),
    [fixedStructureGroups]
  );

  // "אותו הורה" badge for "ההתנסויות שלי" - deliberately scoped to only the
  // children already visible in myLessons, never the full child registry.
  // A child appearing in more than one lesson is deduped by childId first,
  // so its own repeat appearances are never mistaken for a second same-
  // parent child in the tooltip.
  const mineSameParentOtherNamesByChildId = useMemo(() => {
    const uniqueChildren = new Map<string, SameParentChildInput>();
    for (const lesson of myLessons ?? []) {
      for (const c of lesson.children) {
        if (!uniqueChildren.has(c.childId)) {
          uniqueChildren.set(c.childId, {
            id: c.childId,
            displayName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
            parentName: c.parentName,
            parentPhone: c.parentPhone,
          });
        }
      }
    }
    return buildSameParentOtherNamesByChildId([...uniqueChildren.values()]);
  }, [myLessons]);

  // "אותו הורה" badge for "כל ההתנסויות" - deliberately built from BOTH
  // allLessons' children AND tracks' children (the published fixed-
  // structure dataset), so a same-parent match is caught whether the two
  // children's only common appearance is a generated lesson, the fixed
  // structure, or one of each - regardless of which internal mode
  // (מבנה קבוע / שיעורים שנוצרו) or which date/practiceType table happens
  // to be showing right now. Never narrowed to the currently-selected date
  // tab or practiceType section.
  const allSameParentOtherNamesByChildId = useMemo(() => {
    const uniqueChildren = new Map<string, SameParentChildInput>();
    for (const lesson of allLessons ?? []) {
      for (const c of lesson.children) {
        if (!uniqueChildren.has(c.childId)) {
          uniqueChildren.set(c.childId, {
            id: c.childId,
            displayName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
            parentName: c.parentName,
            parentPhone: c.parentPhone,
          });
        }
      }
    }
    for (const track of tracks ?? []) {
      for (const c of track.children) {
        if (!uniqueChildren.has(c.childId)) {
          uniqueChildren.set(c.childId, {
            id: c.childId,
            displayName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
            parentName: c.parentName,
            parentPhone: c.parentPhone,
          });
        }
      }
    }
    return buildSameParentOtherNamesByChildId([...uniqueChildren.values()]);
  }, [allLessons, tracks]);

  // "אותו הורה" row-details popup - FIXED: now built from the SAME combined
  // scope the badge itself uses (allLessons + tracks), not allLessons alone.
  // A badge clicked from "מבנה קבוע" for a child whose only OTHER matching
  // child appears solely in the fixed structure (no generated lesson yet)
  // used to open a popup that could show nothing relevant - this unifies
  // both sources into one row shape so the popup always reflects whichever
  // rows actually caused the badge to show, regardless of which mode/table
  // it was clicked from. Both allLessons and tracks are lazily fetched on
  // first badge click if either hasn't loaded yet (a badge in "ההתנסויות
  // שלי" can open this popup too, before "כל ההתנסויות" has ever been
  // opened) - reuses the exact same two actions already used elsewhere; no
  // new server action, no expanded data exposure.
  const [samePopupChildId, setSamePopupChildId] = useState<string | null>(null);

  function handleOpenSameParentPopup(childId: string) {
    setSamePopupChildId(childId);
    if (allLessons === null) {
      startTransition(async () => {
        const result = await listPublishedTeachingPracticeLessonsForTrainee(studentId);
        setAllLessons(result);
      });
    }
    if (tracks === null) {
      startTransition(async () => {
        const result = await listPublishedTeachingPracticeTracksForTrainee(studentId);
        setTracks(result);
      });
    }
  }

  function handleCloseSameParentPopup() {
    setSamePopupChildId(null);
  }

  const samePopupRows = useMemo(() => {
    if (!samePopupChildId) return null;
    // Wait for BOTH sources to have loaded before computing final rows -
    // otherwise a fixed-structure-only match could briefly (or permanently,
    // if this popup is never reopened) show as "no rows found" just
    // because allLessons happened to resolve first. This is exactly the
    // "empty/incomplete popup" bug being fixed here.
    if (allLessons === null || tracks === null) return null;

    let targetKey: string | null = null;
    for (const lesson of allLessons) {
      const match = lesson.children.find((c) => c.childId === samePopupChildId);
      if (match) {
        targetKey = buildParentKey(match.parentName, match.parentPhone);
        break;
      }
    }
    if (!targetKey) {
      for (const track of tracks) {
        const match = track.children.find((c) => c.childId === samePopupChildId);
        if (match) {
          targetKey = buildParentKey(match.parentName, match.parentPhone);
          break;
        }
      }
    }
    if (!targetKey) return [];

    // Unified row shape - date is null for fixed-structure rows (they have
    // no concrete date, only a template defaultStartTime), which also
    // drives the sort (dated rows first, chronological; fixed-structure
    // rows after).
    const rows: {
      key: string;
      sourceLabel: string;
      childFullName: string;
      parentName: string | null;
      parentPhone: string | null;
      practiceType: TeachingPracticeTypeValue;
      groupName: string | null;
      date: string | null;
      startTime: string;
      traineeNames: string[];
      horseName: string | null;
      equipmentNotes: string | null;
    }[] = [];
    for (const lesson of allLessons) {
      for (const c of lesson.children) {
        if (buildParentKey(c.parentName, c.parentPhone) !== targetKey) continue;
        rows.push({
          key: `lesson-${lesson.id}-${c.childId}`,
          sourceLabel: "שיעור בתאריך",
          childFullName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
          parentName: c.parentName,
          parentPhone: c.parentPhone,
          practiceType: lesson.practiceType,
          groupName: lesson.groupName,
          date: lesson.date,
          startTime: lesson.startTime,
          traineeNames: lesson.participants.map((p) => p.traineeName),
          horseName: c.horseName,
          equipmentNotes: c.equipmentNotes,
        });
      }
    }
    for (const track of tracks) {
      for (const c of track.children) {
        if (buildParentKey(c.parentName, c.parentPhone) !== targetKey) continue;
        rows.push({
          key: `track-${track.id}-${c.childId}`,
          sourceLabel: "מבנה קבוע",
          childFullName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
          parentName: c.parentName,
          parentPhone: c.parentPhone,
          practiceType: track.practiceType,
          groupName: track.groupName,
          date: null,
          startTime: track.defaultStartTime,
          traineeNames: track.trainees.map((t) => t.traineeName),
          horseName: c.horseName,
          equipmentNotes: c.equipmentNotes,
        });
      }
    }

    return rows.sort(
      (a, b) => (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99") || a.startTime.localeCompare(b.startTime)
    );
  }, [samePopupChildId, allLessons, tracks]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-card-foreground">התנסויות מתחילים</h2>

      <div className="flex gap-2 rounded-xl border border-border bg-muted p-1">
        <button
          type="button"
          onClick={() => setTab("mine")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
            tab === "mine" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          ההתנסויות שלי
        </button>
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
            tab === "all" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          כל ההתנסויות
        </button>
      </div>

      {tab === "mine" && (
        <>
          {myLessons !== null && myLessons.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {mineDateKeys.map((date) => (
                <button
                  key={date}
                  type="button"
                  onClick={() => setMineDateTab(date)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    effectiveMineDateTab === date
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {formatHebrewWeekday(parseDateKey(date))} · {formatHebrewDate(parseDateKey(date))}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMineDateTab("all")}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  effectiveMineDateTab === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                הכל
              </button>
            </div>
          )}

          {myLessons === null ? (
            <p className="text-base text-muted-foreground">טוען...</p>
          ) : myLessons.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
              אין לך התנסויות מתחילים שפורסמו כרגע
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {displayedMineLessons.map((lesson) => (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  sameParentOtherNamesByChildId={mineSameParentOtherNamesByChildId}
                  onOpenSameParentPopup={handleOpenSameParentPopup}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "all" && (
        <>
          <div className="flex gap-2 rounded-xl border border-border bg-muted p-1">
            <button
              type="button"
              onClick={() => setAllModeTab("generatedLessons")}
              className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${
                allModeTab === "generatedLessons" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              שיעורים שנוצרו
            </button>
            <button
              type="button"
              onClick={() => setAllModeTab("fixedStructure")}
              className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${
                allModeTab === "fixedStructure" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              מבנה קבוע
            </button>
          </div>

          {allModeTab === "generatedLessons" ? (
            allLessons === null ? (
              <p className="text-base text-muted-foreground">טוען...</p>
            ) : allLessons.length === 0 ? (
              <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
                אין התנסויות מתחילים שפורסמו כרגע
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {generatedDateKeys.map((date) => (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setGeneratedDateTab(date)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        effectiveGeneratedDateTab === date
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                    >
                      {formatHebrewWeekday(parseDateKey(date))} · {formatHebrewDate(parseDateKey(date))}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setGeneratedDateTab("all")}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      effectiveGeneratedDateTab === "all"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    הכל
                  </button>
                </div>

                <div className="flex flex-col gap-5">
                  <GeneratedLessonsTable
                    title="לונג׳"
                    lessons={filteredGeneratedLessons.filter((l) => l.practiceType === "LUNGE")}
                    sameParentOtherNamesByChildId={allSameParentOtherNamesByChildId}
                    onOpenSameParentPopup={handleOpenSameParentPopup}
                  />
                  <GeneratedLessonsTable
                    title="שיעורים פרטניים"
                    lessons={filteredGeneratedLessons.filter((l) => l.practiceType === "BEGINNER_PRIVATE")}
                    sameParentOtherNamesByChildId={allSameParentOtherNamesByChildId}
                    onOpenSameParentPopup={handleOpenSameParentPopup}
                  />
                  <GeneratedLessonsTable
                    title="שיעורים קבוצתיים"
                    lessons={filteredGeneratedLessons.filter((l) => l.practiceType === "BEGINNER_GROUP")}
                    sameParentOtherNamesByChildId={allSameParentOtherNamesByChildId}
                    onOpenSameParentPopup={handleOpenSameParentPopup}
                  />
                </div>
              </>
            )
          ) : tracks === null ? (
            <p className="text-base text-muted-foreground">טוען...</p>
          ) : tracks.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
              אין מבנה קבוע מפורסם כרגע
            </p>
          ) : (
            <>
              {/* Compact group filter - optional narrowing only, defaulting
                  to the logged-in trainee's own group (see
                  defaultFixedStructureGroupFilter). The table structure
                  itself (לונג׳ / beginners / unlinked-private sections)
                  never changes based on this filter - group א and group ב
                  can appear together within each table, distinguished only
                  by the GroupBadge label/color on each row. */}
              {fixedStructureGroupNames.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFixedStructureGroupFilter("all")}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      effectiveFixedStructureGroupFilter === "all"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    הכל
                  </button>
                  {fixedStructureGroupNames.map((g) => (
                    <button
                      key={g || "none"}
                      type="button"
                      onClick={() => setFixedStructureGroupFilter(g)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        effectiveFixedStructureGroupFilter === g
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                    >
                      {g ? `קבוצה ${g}` : "ללא קבוצה"}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-5">
                <FixedStructureTable
                  title="לונג׳"
                  rows={buildFixedStructureRows(fixedStructureGroups.lungeTracks, "לונג׳")}
                  sameParentOtherNamesByChildId={allSameParentOtherNamesByChildId}
                  onOpenSameParentPopup={handleOpenSameParentPopup}
                />

                <BeginnerStructureTable
                  title="שיעורי מתחילים / פרטני-קבוצתי"
                  rows={beginnerMergedRows}
                  sameParentOtherNamesByChildId={allSameParentOtherNamesByChildId}
                  onOpenSameParentPopup={handleOpenSameParentPopup}
                />

                <FixedStructureTable
                  title="פרטניים ללא שיוך"
                  rows={buildFixedStructureRows(fixedStructureGroups.unlinkedPrivateTracks, "פרטני")}
                  sameParentOtherNamesByChildId={allSameParentOtherNamesByChildId}
                  onOpenSameParentPopup={handleOpenSameParentPopup}
                />
              </div>
            </>
          )}
        </>
      )}

      <Modal
        open={samePopupChildId !== null}
        onClose={handleCloseSameParentPopup}
        title="אותו הורה / איש קשר"
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            כדאי לתאם מי יוצר קשר כדי לא לפנות לאותו הורה כמה פעמים.
          </p>
          {samePopupRows === null ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : samePopupRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">לא נמצאו שיעורים משויכים.</p>
          ) : (
            <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
              {samePopupRows.map((row) => (
                <div key={row.key} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {row.sourceLabel}
                    </span>
                    <GroupBadge groupName={row.groupName} />
                  </div>
                  <p className="mt-1 font-semibold text-card-foreground">{row.childFullName}</p>
                  <p className="mt-1 text-muted-foreground">
                    {row.parentName ?? "—"}
                    {row.parentPhone ? ` · ${row.parentPhone}` : ""}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {row.date ? (
                      <>
                        {formatHebrewDate(parseDateKey(row.date))} · {row.startTime} ·{" "}
                      </>
                    ) : (
                      <>{row.startTime} · </>
                    )}
                    {PRACTICE_TYPE_LABELS[row.practiceType]}
                  </p>
                  {row.traineeNames.length > 0 && (
                    <p className="mt-1 text-muted-foreground">חניכים: {row.traineeNames.join(", ")}</p>
                  )}
                  {(row.horseName || row.equipmentNotes) && (
                    <p className="mt-1 text-muted-foreground">
                      {row.horseName ? `סוס: ${row.horseName}` : ""}
                      {row.horseName && row.equipmentNotes ? " · " : ""}
                      {row.equipmentNotes ? `ציוד: ${row.equipmentNotes}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
