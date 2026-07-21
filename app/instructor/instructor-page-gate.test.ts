/**
 * E0 - regression test for the /instructor server-side gate.
 *
 * SOURCE-TEXT CONTRACT TEST, following this repo's committed precedent
 * (lib/course/historical-readers.contract.test.ts,
 * lib/trainee-history/group-change-service.contract.test.ts). It asserts the
 * ORDERING property that makes the gate a gate: the Actor DAL is consulted
 * before any `prisma.` call exists in the module, and the four sensitive
 * loaders are unreachable without a verified actor.
 *
 * Why source-text and not a rendered/behavioral test: this repo's runner is
 * node:test via `npx tsx --test`, with no React/DOM test framework, and
 * AGENTS.md forbids introducing one for a small scoped task. Importing
 * app/instructor/page.tsx directly would pull in @/lib/prisma (and next/headers
 * via the Actor DAL), which this stage must not do. The properties below are
 * exactly the ones a reviewer would check by eye, pinned so a future edit
 * cannot silently undo them.
 *
 * Run: npx tsx --test app/instructor/instructor-page-gate.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE_PATH = join(process.cwd(), "app", "instructor", "page.tsx");
const CLIENT_PATH = join(process.cwd(), "app", "instructor", "InstructorClient.tsx");

const pageSource = readFileSync(PAGE_PATH, "utf8");
const clientSource = readFileSync(CLIENT_PATH, "utf8");

test("page imports the canonical Actor DAL", () => {
  assert.match(
    pageSource,
    /import\s*\{\s*getCurrentInstructor\s*\}\s*from\s*"@\/lib\/auth\/actor"/,
    "page.tsx must obtain its actor from the committed lib/auth/actor DAL",
  );
});

test("the actor gate precedes every prisma call in source order", () => {
  const gateIndex = pageSource.indexOf("await getCurrentInstructor(");
  const firstPrismaIndex = pageSource.indexOf("prisma.");
  assert.notEqual(gateIndex, -1, "page.tsx must await getCurrentInstructor()");
  assert.notEqual(firstPrismaIndex, -1, "page.tsx is expected to still query prisma");
  assert.ok(
    gateIndex < firstPrismaIndex,
    "no prisma query may appear before the getCurrentInstructor() gate",
  );
});

test("the four sensitive loaders live behind the authenticated branch", () => {
  // All prisma access is confined to loadInstructorPageData(), which is only
  // reached when the actor is non-null.
  const loaderIndex = pageSource.indexOf("async function loadInstructorPageData");
  const firstPrismaIndex = pageSource.indexOf("prisma.");
  assert.notEqual(loaderIndex, -1, "loadInstructorPageData must exist");
  assert.ok(
    loaderIndex < firstPrismaIndex,
    "every prisma query must sit inside loadInstructorPageData",
  );
  assert.match(
    pageSource,
    /actor === null\s*\?\s*EMPTY_INSTRUCTOR_PAGE_DATA\s*:\s*await loadInstructorPageData\(\)/,
    "the loader must be called only when the actor is non-null",
  );
  for (const query of [
    "prisma.student.findMany",
    "prisma.dutyType.findMany",
    "prisma.instructor.findMany",
  ]) {
    assert.ok(pageSource.includes(query), `${query} should still be present`);
    assert.ok(
      pageSource.indexOf(query) > loaderIndex,
      `${query} must be inside loadInstructorPageData`,
    );
  }
});

test("an unauthenticated request receives an empty sensitive payload", () => {
  assert.match(
    pageSource,
    /const EMPTY_INSTRUCTOR_PAGE_DATA: InstructorPageData = \{\s*students: \[\],\s*dutyTypes: \[\],\s*instructors: \[\],\s*studentHorseInfo: \[\],\s*\}/,
    "the unauthenticated payload must be empty for all four sensitive props",
  );
});

test("the page trusts no client-supplied identity", () => {
  assert.ok(
    !pageSource.includes("searchParams"),
    "the gate must not read a query parameter",
  );
  assert.ok(
    !pageSource.includes("instructorId"),
    "the gate must not accept a caller-supplied instructor id",
  );
  assert.ok(
    !pageSource.includes("localStorage"),
    "the server gate must not depend on client storage",
  );
});

test("the page does not redirect (login form is rendered by this route)", () => {
  // Pinned deliberately: /instructor renders the instructor login form itself,
  // so redirecting unauthenticated callers away would make obtaining a session
  // impossible and lock every instructor out.
  assert.ok(
    !pageSource.includes("redirect("),
    "the gate must withhold the payload, not redirect away from the login form",
  );
});

test("the server-owned authenticated flag is passed to the client", () => {
  assert.match(
    pageSource,
    /authenticated=\{actor !== null\}/,
    "the client must receive the server's authentication verdict",
  );
});

test("a false verdict tears down stale client identity before hydration", () => {
  assert.match(
    clientSource,
    /authenticated: boolean;/,
    "InstructorClient must declare the authenticated prop",
  );
  const guardIndex = clientSource.indexOf("if (!authenticated) {");
  const restoreIndex = clientSource.indexOf("const raw = window.localStorage.getItem(STORAGE_KEY);");
  assert.notEqual(guardIndex, -1, "the hydration effect must branch on authenticated");
  assert.notEqual(restoreIndex, -1, "the stored-session restore must still exist");
  assert.ok(
    guardIndex < restoreIndex,
    "the unauthenticated branch must run before any stored session is restored",
  );
  const guardBlock = clientSource.slice(guardIndex, restoreIndex);
  assert.ok(
    guardBlock.includes("window.localStorage.removeItem(STORAGE_KEY)"),
    "a false verdict must clear the stale stored session",
  );
  assert.ok(
    guardBlock.includes("setSession(null)"),
    "a false verdict must clear in-memory session state",
  );
});
