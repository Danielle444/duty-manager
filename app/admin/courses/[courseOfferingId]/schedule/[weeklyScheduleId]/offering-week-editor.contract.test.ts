/**
 * MULTI-COURSE Schedule Slice W-S3B - DB-free CONTRACT/source tests for the
 * offering-scoped weekly-schedule VIEW/EDIT route (page, actions, editor client),
 * plus the week-card link/chip on the parent list client.
 *
 * Runs no Prisma and opens no DB. It statically inspects module source to lock the
 * approved safety invariants: the week read is COMPOUND-scoped (id AND offering),
 * every mutation is admin-gated-first and ownership-proven through the committed
 * W-S3A writer, only course-scoped paths are revalidated by THIS route, instructor
 * names are shown and editable, and none of the excluded legacy surfaces
 * (riding / duty / no-duty / export / publication toggle / ScheduleTimeGrid) are
 * importable here.
 *
 * Run: npx tsx --test "app/admin/courses/[courseOfferingId]/schedule/[weeklyScheduleId]/offering-week-editor.contract.test.ts"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
function readRaw(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}
function read(relative: string): string {
  return stripComments(readRaw(relative));
}

const pageSrc = read("./page.tsx");
const actionSrc = read("./actions.ts");
const clientSrc = read("./OfferingWeekEditorClient.tsx");
const listClientSrc = read("../OfferingScheduleClient.tsx");
const writerSrc = read("../../../../../../lib/course/offering-schedule-item-writer.ts");

// ---------------------------------------------------------------------------
// Page: compound-scoped read
// ---------------------------------------------------------------------------

test("the page validates the exact offering first and fails closed to notFound()", () => {
  assert.ok(pageSrc.includes("requireAdminCourseOffering(courseOfferingId)"));
  assert.ok(pageSrc.includes("CourseOfferingNotFoundError"));
  assert.ok(pageSrc.includes("notFound()"));
});

test("the page gates the READ with the pure HISTORICAL_READ policy", () => {
  assert.ok(pageSrc.includes('assertCourseOperationAllowed(context.status, "HISTORICAL_READ")'));
});

test("the week is fetched COMPOUND-scoped (id AND validated offering), never globally", () => {
  assert.ok(
    pageSrc.includes("where: { id: weeklyScheduleId, courseOfferingId: context.id }"),
    "the fetch must require both the week id and the validated offering id",
  );
  assert.ok(pageSrc.includes("findFirst"), "a compound scope uses findFirst");
  // Never a trust-the-client-later pattern: no bare by-id findUnique, no findMany.
  assert.ok(
    !pageSrc.includes("findUnique({ where: { id: weeklyScheduleId }"),
    "must not fetch the week by id alone",
  );
  assert.ok(!pageSrc.includes(".findMany"), "must not list weeks on the detail page");
  // Exactly one weeklySchedule query on this page.
  assert.equal(pageSrc.split("prisma.weeklySchedule").length - 1, 1);
});

test("the page selects the free-text instructorName so it can be shown/edited", () => {
  assert.ok(pageSrc.includes("instructorName: true"), "instructorName must be read from the item");
  assert.ok(pageSrc.includes("instructorName: item.instructorName"), "and passed through to the view");
});

test("the page reads no duty / day-plan / student model", () => {
  for (const forbidden of ["prisma.dutyAssignment", "prisma.courseDayPlan", "prisma.student"]) {
    assert.ok(!pageSrc.includes(forbidden), `page must not query ${forbidden}`);
  }
});

test("the page binds the validated offering id (and week id) into the actions", () => {
  assert.ok(pageSrc.includes("updateOfferingWeekMetadataAction.bind(null, context.id, week.id)"));
  assert.ok(pageSrc.includes("createOfferingScheduleItemAction.bind(null, context.id, week.id)"));
  assert.ok(pageSrc.includes("updateOfferingScheduleItemAction.bind(null, context.id)"));
  assert.ok(pageSrc.includes("deleteOfferingScheduleItemAction.bind(null, context.id)"));
});

// ---------------------------------------------------------------------------
// Actions: admin-first, ownership-proven, course-only revalidation
// ---------------------------------------------------------------------------

const ACTION_NAMES = [
  "updateOfferingWeekMetadataAction",
  "createOfferingScheduleItemAction",
  "updateOfferingScheduleItemAction",
  "deleteOfferingScheduleItemAction",
] as const;

function actionBody(name: string): string {
  const start = actionSrc.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `action ${name} not found`);
  const next = ACTION_NAMES.map((n) => actionSrc.indexOf(`export async function ${n}`))
    .filter((i) => i > start)
    .sort((a, b) => a - b)[0];
  return actionSrc.slice(start, next === undefined ? actionSrc.length : next);
}

test("each action's leading argument is the SERVER-BOUND courseOfferingId", () => {
  for (const name of ACTION_NAMES) {
    assert.ok(
      new RegExp(`${name}\\(\\s*courseOfferingId: string`).test(actionSrc),
      `${name} must take courseOfferingId as its bound leading parameter`,
    );
  }
});

test("requireAdmin() is the FIRST awaited operation in EVERY action", () => {
  for (const name of ACTION_NAMES) {
    const body = actionBody(name);
    const gate = body.indexOf("await requireAdmin()");
    assert.notEqual(gate, -1, `${name} must call await requireAdmin()`);
    assert.equal(body.indexOf("await "), gate, `${name}: nothing may be awaited before the admin gate`);
  }
});

test("item actions prove ownership through the W-S3A writer BEFORE the delegated write", () => {
  const create = actionBody("createOfferingScheduleItemAction");
  assert.ok(create.indexOf("authorizeOfferingWeekTarget(") < create.indexOf("createScheduleItem("));
  const update = actionBody("updateOfferingScheduleItemAction");
  assert.ok(update.indexOf("authorizeOfferingItemTarget(") < update.indexOf("updateScheduleItem("));
  const del = actionBody("deleteOfferingScheduleItemAction");
  assert.ok(del.indexOf("authorizeOfferingItemTarget(") < del.indexOf("deleteScheduleItem("));
});

test("the metadata action delegates to the atomic ownership-scoped writer", () => {
  const meta = actionBody("updateOfferingWeekMetadataAction");
  assert.ok(meta.includes("updateOfferingWeekMetadata("));
  // Metadata must never touch items or publication from the action layer.
  assert.ok(!meta.includes("ScheduleItem"), "metadata action must not reference schedule items");
  assert.ok(!meta.includes("isPublished"));
});

test("the actions import no Prisma client (writes go through proven helpers only)", () => {
  assert.ok(!actionSrc.includes("@/lib/prisma"), "the action module must not import prisma");
  assert.ok(!actionSrc.includes("prisma."), "the action module must not access prisma directly");
});

test("this route revalidates ONLY course-scoped schedule paths", () => {
  assert.ok(actionSrc.includes("/admin/courses/"), "must revalidate a course-scoped path");
  assert.ok(actionSrc.includes("/schedule`"), "the base course schedule path");
  for (const forbidden of [
    'revalidatePath("/admin/weekly-schedule")',
    'revalidatePath("/student")',
    'revalidatePath("/instructor")',
    'revalidatePath("/")',
  ]) {
    assert.ok(!actionSrc.includes(forbidden), `this route must not itself perform ${forbidden}`);
  }
});

test("the offering is never taken from FormData, a query string, or a cookie", () => {
  for (const [label, src] of [
    ["actions.ts", actionSrc],
    ["page.tsx", pageSrc],
    ["OfferingWeekEditorClient.tsx", clientSrc],
  ] as const) {
    assert.ok(!src.includes('formData.get("courseOfferingId")'), `${label}`);
    assert.ok(!src.includes('name="courseOfferingId"'), `${label}`);
    for (const forbidden of [
      "resolveCurrentCourseOffering",
      "resolveTraineeCourseOffering",
      "cookies(",
      "next/headers",
    ]) {
      assert.ok(!src.includes(forbidden), `${label} must not reference ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Editor client: instructor visible/editable, excluded surfaces absent
// ---------------------------------------------------------------------------

test("the editor renders the stored instructor name and makes it editable", () => {
  assert.ok(clientSrc.includes("item.instructorName"), "instructor name must be rendered");
  assert.ok(clientSrc.includes("instructorName: e.target.value"), "instructor name must be an editable field");
  assert.ok(clientSrc.includes("מדריך"), "the instructor field must be labelled");
});

test("the editor imports no riding / duty / no-duty / export / publication-toggle surface", () => {
  for (const forbidden of [
    "RidingSlotModal",
    "riding",
    "no-duty-dates",
    "markNoDutyDate",
    "runGenerateSchedule",
    "dutyAssignment",
    "schedule/export",
    "ScheduleTimeGrid",
    "updateMergedScheduleItems",
    "setWeeklySchedulePublished",
    "SCHEDULE_PUBLICATION",
  ]) {
    assert.ok(!clientSrc.includes(forbidden), `editor must not reference ${forbidden}`);
  }
});

test("the editor displays publication state but offers no toggle", () => {
  assert.ok(clientSrc.includes("week.isPublished"), "the publication chip reads the state");
  // A read of the flag is fine; a call that CHANGES it is not (covered above).
});

test("the editor has no offering field and no offering selector", () => {
  for (const forbidden of ["courseOfferingId", "offeringId", "CourseOfferingSelector"]) {
    assert.ok(!clientSrc.includes(forbidden), `editor must not reference ${forbidden}`);
  }
});

test("the editor reuses the committed schedule-item input type (no competing schema)", () => {
  assert.ok(
    clientSrc.includes('from "@/lib/actions/schedule-items"'),
    "the editor must reuse the committed ScheduleItemInput / ScheduleItemRow types",
  );
  assert.ok(!clientSrc.includes("z.object"), "the editor must not declare its own validation schema");
});

// ---------------------------------------------------------------------------
// Writer wiring
// ---------------------------------------------------------------------------

test("the W-S3A writer contains no publication or item-content write", () => {
  assert.ok(!writerSrc.includes("isPublished"), "the writer must never touch publication");
  assert.ok(!writerSrc.includes("scheduleItem.create"), "item writes are delegated, not done here");
  assert.ok(!writerSrc.includes("scheduleItem.delete"));
  // The only week write is the metadata updateMany, scoped by id AND offering.
  assert.ok(writerSrc.includes("prisma.weeklySchedule.updateMany"));
  assert.ok(writerSrc.includes("where: { id: weeklyScheduleId, courseOfferingId }"));
});

// ---------------------------------------------------------------------------
// Parent list card: view/edit link + status chip
// ---------------------------------------------------------------------------

test("the week card exposes a view/edit link and a status chip", () => {
  assert.ok(listClientSrc.includes("צפייה ועריכה"), "the card must show a view/edit link");
  assert.ok(listClientSrc.includes("${scheduleBasePath}/${week.id}"), "the link targets the nested route");
  assert.ok(listClientSrc.includes("week.isPublished"), "the card must show a publication status chip");
});

test("the list client still names no offering id (scope stays server-owned)", () => {
  for (const forbidden of ["courseOfferingId", "offeringId", "CourseOfferingSelector"]) {
    assert.ok(!listClientSrc.includes(forbidden), `list client must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Combined Participation Slice 1: tri-state field wired through page + editor
// ---------------------------------------------------------------------------

test("the page reads combinedParticipation and forwards it into the view", () => {
  assert.ok(
    pageSrc.includes("combinedParticipation: true"),
    "the item select projection must read combinedParticipation",
  );
  assert.ok(
    pageSrc.includes("combinedParticipation: item.combinedParticipation"),
    "the view mapping must pass combinedParticipation through",
  );
});

test("the editor exposes a tri-state משולב control (כן / לא / default)", () => {
  // Present in the empty form default (null) and hydrated on edit.
  assert.ok(clientSrc.includes("combinedParticipation: null"), "empty form defaults to null");
  assert.ok(
    clientSrc.includes("combinedParticipation: item.combinedParticipation ?? null"),
    "editing hydrates from the existing row value",
  );
  // A real <select> with the three tri-state options.
  assert.ok(clientSrc.includes("ברירת מחדל (ללא הגבלה)"), "default option label");
  assert.ok(clientSrc.includes("selectValueToCombined"), "onChange maps the select value back to the tri-state");
});

test("the editor forwards the item form (incl. combinedParticipation) unchanged to the bound actions", () => {
  // The submit handler passes itemForm straight to the create/update actions, and
  // every field edit spreads the current form, so combinedParticipation is
  // preserved when other fields change.
  assert.ok(clientSrc.includes("updateItemAction(itemModal.id, itemForm)"));
  assert.ok(clientSrc.includes("createItemAction(itemForm)"));
  assert.ok(clientSrc.includes("setItemForm((f) => ({"), "field edits preserve the rest of the form");
});
