/**
 * MC-BOOTSTRAP-S2B1 — executable tests for the PURE adapter primitives
 * (bootstrap-isolated-instance.adapter.ts).
 *
 * Run with: npx tsx --test scripts/bootstrap-isolated-instance.adapter.test.ts
 *
 * PURE: no database, no Prisma, no Supabase, no env, no network, no clock. All
 * fixtures are synthetic. The only production-like literal that could appear is
 * the deny-only production ref — and it deliberately does NOT appear here: the
 * parser holds no production policy, so no production ref is needed. Every
 * synthetic project ref below is an obviously-fake 20-char value.
 *
 * Timezone stability: assertions use only UTC-based helpers and ISO strings, so
 * they are invariant to the runner's timezone; the suite NEVER mutates
 * process.env.TZ (in-process TZ mutation is unreliable and is not used).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mapObservedStructuralState,
  dbDateToKey,
  dateKeyToDbDate,
  parseSupabaseProjectRef,
  type StructuralRows,
  type CourseOfferingRow,
} from "./bootstrap-isolated-instance.adapter";
import type { ObservedStructuralState } from "./bootstrap-isolated-instance.plan";

// --- synthetic fixtures ------------------------------------------------------

// Obviously-fake 20-char lowercase-alphanumeric refs (never the production ref).
const REF_DIRECT = "abcdefghij0123456789";
const REF_POOLED = "klmnopqrst4567890123";

const EMPTY_ROWS: StructuralRows = {
  activityYears: [],
  courseOfferings: [],
  courseGroups: [],
  capabilityCatalog: [],
  offeringCapabilities: [],
};

function utc(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** Recursively freeze so any attempted mutation of the input throws. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

// ===========================================================================
// Observed-state mapping
// ===========================================================================

test("map: zero rows -> the complete empty observed state", () => {
  const out = mapObservedStructuralState(EMPTY_ROWS);
  const expected: ObservedStructuralState = {
    activityYears: [],
    courseOfferings: [],
    courseGroups: [],
    capabilityCatalog: [],
    offeringCapabilities: [],
  };
  assert.deepEqual(out, expected);
  // exactly the five structural keys — nothing extra, no decision field
  assert.deepEqual(Object.keys(out).sort(), [
    "activityYears",
    "capabilityCatalog",
    "courseGroups",
    "courseOfferings",
    "offeringCapabilities",
  ]);
});

test("map: multiple ActivityYear rows are all preserved, in order, with dates", () => {
  const rows: StructuralRows = {
    ...EMPTY_ROWS,
    activityYears: [
      { name: "Y-A", startDate: utc("2000-01-01"), endDate: utc("2000-06-01") },
      { name: "Y-B", startDate: null, endDate: null },
      { name: "Y-C", startDate: utc("2019-12-31"), endDate: utc("2020-01-01") },
    ],
  };
  const out = mapObservedStructuralState(rows);
  assert.deepEqual(out.activityYears, [
    { name: "Y-A", startDate: "2000-01-01", endDate: "2000-06-01" },
    { name: "Y-B", startDate: null, endDate: null },
    { name: "Y-C", startDate: "2019-12-31", endDate: "2020-01-01" },
  ]);
});

test("map: multiple CourseOffering rows are all preserved (never deduped/filtered)", () => {
  const base: CourseOfferingRow = {
    name: "OFF-1",
    level: 1,
    startDate: utc("2000-01-01"),
    endDate: utc("2000-02-01"),
    status: "PLANNED",
    activityYear: { name: "Y-A" },
  };
  const rows: StructuralRows = {
    ...EMPTY_ROWS,
    courseOfferings: [base, { ...base, name: "OFF-2", status: "ACTIVE" }],
  };
  const out = mapObservedStructuralState(rows);
  assert.equal(out.courseOfferings.length, 2);
  assert.deepEqual(out.courseOfferings[0], {
    name: "OFF-1",
    level: 1,
    startDate: "2000-01-01",
    endDate: "2000-02-01",
    status: "PLANNED",
    activityYearName: "Y-A",
  });
  assert.equal(out.courseOfferings[1].status, "ACTIVE");
  assert.equal(out.courseOfferings[1].activityYearName, "Y-A");
});

test("map: unrelated/global CapabilityCatalog rows are all preserved (unfiltered)", () => {
  const rows: StructuralRows = {
    ...EMPTY_ROWS,
    capabilityCatalog: [
      { key: "CAP_A", label: "LA", isActive: true },
      { key: "UNRELATED_GLOBAL", label: "u", isActive: false },
    ],
  };
  const out = mapObservedStructuralState(rows);
  assert.deepEqual(out.capabilityCatalog, [
    { key: "CAP_A", label: "LA", isActive: true },
    { key: "UNRELATED_GLOBAL", label: "u", isActive: false },
  ]);
});

test("map: CourseGroup rows are never offering-filtered; nullable parent maps correctly", () => {
  const rows: StructuralRows = {
    ...EMPTY_ROWS,
    courseGroups: [
      { name: "TOP-1", parentGroup: null },
      { name: "1", parentGroup: { name: "TOP-1" } },
      // a group that (in a real DB) would belong to another offering — still kept
      { name: "OTHER-TOP", parentGroup: null },
    ],
  };
  const out = mapObservedStructuralState(rows);
  assert.deepEqual(out.courseGroups, [
    { name: "TOP-1", parentName: null },
    { name: "1", parentName: "TOP-1" },
    { name: "OTHER-TOP", parentName: null },
  ]);
});

test("map: CourseOfferingCapability rows are never offering-filtered; capabilityKey -> key; status exact", () => {
  const rows: StructuralRows = {
    ...EMPTY_ROWS,
    offeringCapabilities: [
      { capabilityKey: "CAP_A", status: "ENABLED" },
      { capabilityKey: "CAP_B", status: "READ_ONLY" },
    ],
  };
  const out = mapObservedStructuralState(rows);
  assert.deepEqual(out.offeringCapabilities, [
    { key: "CAP_A", status: "ENABLED" },
    { key: "CAP_B", status: "READ_ONLY" },
  ]);
});

test("map: input order is preserved (no sort applied)", () => {
  const rows: StructuralRows = {
    ...EMPTY_ROWS,
    capabilityCatalog: [
      { key: "Z", label: "z", isActive: true },
      { key: "A", label: "a", isActive: true },
      { key: "M", label: "m", isActive: true },
    ],
  };
  const out = mapObservedStructuralState(rows);
  assert.deepEqual(out.capabilityCatalog.map((c) => c.key), ["Z", "A", "M"]);
});

test("map: equivalent inputs produce deeply-equal output", () => {
  const rows: StructuralRows = {
    activityYears: [{ name: "Y", startDate: utc("2000-01-01"), endDate: utc("2000-02-01") }],
    courseOfferings: [
      { name: "O", level: 2, startDate: utc("2000-01-01"), endDate: utc("2000-02-01"), status: "ARCHIVED", activityYear: { name: "Y" } },
    ],
    courseGroups: [{ name: "T", parentGroup: null }],
    capabilityCatalog: [{ key: "K", label: "L", isActive: true }],
    offeringCapabilities: [{ capabilityKey: "K", status: "ENABLED" }],
  };
  assert.deepEqual(mapObservedStructuralState(rows), mapObservedStructuralState(rows));
});

test("map: does not mutate input arrays or row objects (frozen input is safe)", () => {
  const rows: StructuralRows = {
    activityYears: [{ name: "Y", startDate: utc("2000-01-01"), endDate: null }],
    courseOfferings: [
      { name: "O", level: 1, startDate: utc("2000-01-01"), endDate: utc("2000-02-01"), status: "PLANNED", activityYear: { name: "Y" } },
    ],
    courseGroups: [{ name: "1", parentGroup: { name: "TOP" } }],
    capabilityCatalog: [{ key: "K", label: "L", isActive: true }],
    offeringCapabilities: [{ capabilityKey: "K", status: "READ_ONLY" }],
  };
  const snapshot = JSON.parse(JSON.stringify(rows));
  deepFreeze(rows);
  // must not throw (no mutation attempt on the frozen input)
  const out = mapObservedStructuralState(rows);
  assert.equal(out.activityYears.length, 1);
  // the returned arrays are NOT the same references as the inputs
  assert.notEqual(out.capabilityCatalog, rows.capabilityCatalog);
  // input is byte-identical afterward (compare the non-Date structure via JSON)
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), snapshot);
});

test("map: performs no classification / missing-reusable decision (shape only, no filtering)", () => {
  // A shape S1 would classify as a conflict (2 offerings + extra group). The
  // mapper must NOT collapse, filter, or annotate it — it returns the rows as-is.
  const base: CourseOfferingRow = {
    name: "OFF-1", level: 1, startDate: null, endDate: null, status: "PLANNED", activityYear: { name: "Y" },
  };
  const rows: StructuralRows = {
    activityYears: [
      { name: "Y", startDate: null, endDate: null },
      { name: "Y2", startDate: null, endDate: null },
    ],
    courseOfferings: [base, { ...base, name: "OFF-2" }],
    courseGroups: [{ name: "TOP", parentGroup: null }, { name: "GHOST", parentGroup: null }],
    capabilityCatalog: [{ key: "K", label: "L", isActive: true }],
    offeringCapabilities: [{ capabilityKey: "K", status: "ENABLED" }],
  };
  const out = mapObservedStructuralState(rows);
  assert.equal(out.activityYears.length, 2);
  assert.equal(out.courseOfferings.length, 2);
  assert.equal(out.courseGroups.length, 2);
  // no decision/kind field leaked onto the observed state
  assert.equal(Object.keys(out).includes("kind"), false);
  assert.equal(Object.keys(out).includes("decision"), false);
});

// ===========================================================================
// Date handling
// ===========================================================================

test("date: dbDateToKey maps UTC Date to the identical calendar key", () => {
  assert.equal(dbDateToKey(utc("2000-01-01")), "2000-01-01");
  assert.equal(dbDateToKey(utc("2000-02-29")), "2000-02-29"); // 2000 is a leap year (÷400)
  assert.equal(dbDateToKey(utc("2024-02-29")), "2024-02-29"); // 2024 is a leap year (÷4)
  assert.equal(dbDateToKey(utc("2019-12-31")), "2019-12-31");
});

test("date: dateKeyToDbDate builds exactly UTC midnight", () => {
  assert.equal(dateKeyToDbDate("2000-01-01").toISOString(), "2000-01-01T00:00:00.000Z");
  assert.equal(dateKeyToDbDate("2024-02-29").toISOString(), "2024-02-29T00:00:00.000Z");
});

test("date: round trips in both directions", () => {
  for (const key of ["2000-01-01", "2000-02-29", "2024-02-29", "2019-12-31"]) {
    assert.equal(dbDateToKey(dateKeyToDbDate(key)), key);
  }
  for (const iso of ["2000-01-01", "2019-12-31"]) {
    const d = utc(iso);
    assert.equal(dateKeyToDbDate(dbDateToKey(d)).toISOString(), d.toISOString());
  }
});

test("date: invalid calendar keys are rejected predictably", () => {
  for (const bad of ["2023-02-29", "2000-13-01", "2001-02-29"]) {
    assert.throws(() => dateKeyToDbDate(bad), /valid YYYY-MM-DD/);
  }
});

test("date: a non-midnight Date is projected to its UTC calendar day (documented contract)", () => {
  assert.equal(dbDateToKey(new Date("2000-01-01T13:45:59.999Z")), "2000-01-01");
  assert.equal(dbDateToKey(new Date("2019-12-31T23:59:59.999Z")), "2019-12-31");
});

test("date: an Invalid Date fails predictably (no silent normalization)", () => {
  assert.throws(() => dbDateToKey(new Date("not-a-date")), /valid YYYY-MM-DD/);
});

// ===========================================================================
// Target parsing — accepted (strict, component-based)
// ===========================================================================

test("target: accepts a realistic direct Supabase URL", () => {
  const url = `postgresql://postgres:secretpw@db.${REF_DIRECT}.supabase.co:5432/postgres`;
  assert.deepEqual(parseSupabaseProjectRef(url), { detectedProjectRef: REF_DIRECT });
});

test("target: accepts realistic pooled Supabase URL forms (transaction + session ports)", () => {
  const tx = `postgresql://postgres.${REF_POOLED}:secretpw@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
  const session = `postgres://postgres.${REF_POOLED}:secretpw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
  assert.deepEqual(parseSupabaseProjectRef(tx), { detectedProjectRef: REF_POOLED });
  assert.deepEqual(parseSupabaseProjectRef(session), { detectedProjectRef: REF_POOLED });
});

test("target: password/query encoding does not affect extraction from approved components", () => {
  const direct = `postgresql://postgres:p%40ss.w%2Frd@db.${REF_DIRECT}.supabase.co:5432/postgres?sslmode=require`;
  const pooled = `postgresql://postgres.${REF_POOLED}:p%40ss.w%2Frd@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true`;
  assert.deepEqual(parseSupabaseProjectRef(direct), { detectedProjectRef: REF_DIRECT });
  assert.deepEqual(parseSupabaseProjectRef(pooled), { detectedProjectRef: REF_POOLED });
});

// ===========================================================================
// Target parsing — rejected (fail-closed -> null)
// ===========================================================================

test("target: fail-closed rejection returns { detectedProjectRef: null }", () => {
  const reject = (u: string): void =>
    assert.deepEqual(parseSupabaseProjectRef(u), { detectedProjectRef: null }, `should reject: ${u}`);

  // malformed / unsupported scheme
  reject("not a url");
  reject("");
  reject(`mysql://postgres@db.${REF_DIRECT}.supabase.co/x`);
  reject(`https://db.${REF_DIRECT}.supabase.co/x`);

  // ip / localhost / custom hosts
  reject("postgresql://postgres:pw@127.0.0.1:5432/db");
  reject("postgresql://postgres:pw@[::1]:5432/db");
  reject("postgresql://postgres:pw@localhost:5432/db");
  reject("postgresql://postgres:pw@my-db.example.com:5432/db");

  // custom hostname whose FIRST label is a valid-looking 20-char ref
  reject(`postgresql://postgres:pw@${REF_DIRECT}.internal.example/x`);

  // lookalike direct suffixes and wrong label counts
  reject(`postgresql://postgres:pw@db.${REF_DIRECT}.supabase.co.evil.example/x`);
  reject(`postgresql://postgres:pw@${REF_DIRECT}.supabase.co/x`); // missing "db"
  reject(`postgresql://postgres:pw@db.${REF_DIRECT}.supabase.io/x`); // wrong TLD
  reject(`postgresql://postgres:pw@db.${REF_DIRECT}.supabase.com/x`); // wrong domain

  // pooled lookalikes
  reject(`postgresql://postgres.${REF_POOLED}@xpooler.supabase.com/x`);
  reject(`postgresql://postgres.${REF_POOLED}@aws.pooler.supabase.com.evil.example/x`);
  reject(`postgresql://postgres.${REF_POOLED}@pooler.supabase.com/x`); // no subdomain

  // pooled username problems
  reject(`postgresql://admin.${REF_POOLED}@aws-0-us-east-1.pooler.supabase.com/x`); // not "postgres."
  reject(`postgresql://postgres.${REF_POOLED}.extra@aws-0-us-east-1.pooler.supabase.com/x`); // extra segment
  reject(`postgresql://aws-0-us-east-1.pooler.supabase.com/x`); // missing username

  // invalid ref length / casing
  reject("postgresql://postgres:pw@db.abcdefghij012345678.supabase.co/x"); // 19 chars
  reject("postgresql://postgres:pw@db.abcdefghij01234567890.supabase.co/x"); // 21 chars
  reject("postgresql://postgres:pw@db.ABCDEFGHIJ0123456789.supabase.co/x"); // uppercase ref
  reject(`postgresql://postgres.${REF_POOLED.toUpperCase()}@aws-0-us-east-1.pooler.supabase.com/x`);

  // ref present ONLY in password / query / path / fragment (never approved components)
  reject(`postgresql://postgres:${REF_DIRECT}@my-db.example.com/x`);
  reject(`postgresql://postgres:pw@my-db.example.com/x?ref=${REF_DIRECT}`);
  reject(`postgresql://postgres:pw@my-db.example.com/${REF_DIRECT}`);
  reject(`postgresql://postgres:pw@my-db.example.com/x#${REF_DIRECT}`);

  // arbitrary text that merely contains a ref
  reject(`connect to ${REF_DIRECT} now`);
});

test("target: never returns the deny-only production ref by inference (parser holds no production policy)", () => {
  // Even if the production ref appears only in a non-approved component, it is not extracted.
  const prod = "yjnjfnesxhmzhzpwrmqy";
  assert.deepEqual(
    parseSupabaseProjectRef(`postgresql://postgres:pw@my-db.example.com/x?p=${prod}`),
    { detectedProjectRef: null },
  );
  // A genuine direct URL DOES yield the strict ref (production denial is S1's job, not the parser's).
  assert.deepEqual(
    parseSupabaseProjectRef(`postgresql://postgres:pw@db.${prod}.supabase.co/x`),
    { detectedProjectRef: prod },
  );
});

// ===========================================================================
// Import / purity safety
// ===========================================================================

test("purity: re-import is stable and exposes only the pure primitives", async () => {
  const mod1 = await import("./bootstrap-isolated-instance.adapter");
  const mod2 = await import("./bootstrap-isolated-instance.adapter");
  assert.equal(mod1, mod2); // cached; import had no re-runnable side effect
  assert.equal(typeof mod1.mapObservedStructuralState, "function");
  assert.equal(typeof mod1.dbDateToKey, "function");
  assert.equal(typeof mod1.dateKeyToDbDate, "function");
  assert.equal(typeof mod1.parseSupabaseProjectRef, "function");
  // no Prisma client is constructed or exported here
  assert.equal((mod1 as Record<string, unknown>).PrismaClient, undefined);
});

test("purity: the adapter source contains no Prisma / env / fs / dotenv / logging / CLI boundary", () => {
  const src = readFileSync(new URL("./bootstrap-isolated-instance.adapter.ts", import.meta.url), "utf8");
  // strip the block comment header/JSDoc so prose mentions do not trip the checks
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of [
    "PrismaClient",
    "@prisma",
    "generated/prisma",
    "prisma/client",
    "process.env",
    "DATABASE_URL",
    "dotenv",
    "node:fs",
    'from "fs"',
    "console.",
    "import.meta",
    "process.argv",
  ]) {
    assert.equal(code.includes(forbidden), false, `adapter code must not contain "${forbidden}"`);
  }
});
