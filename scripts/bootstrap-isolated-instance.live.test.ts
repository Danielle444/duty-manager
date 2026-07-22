/**
 * MC-BOOTSTRAP-S2B2A — executable tests for the DB-FREE live adapter primitives
 * (bootstrap-isolated-instance.live.ts).
 *
 * Run with: npx tsx --test scripts/bootstrap-isolated-instance.live.test.ts
 *
 * DB-FREE: no real database, no Prisma, no Supabase, no env, no network, no
 * clock. Every effect is a SYNTHETIC injected fake shaped like the narrow
 * structural interfaces. All fixtures are synthetic (no real course names,
 * people, keys, dates, or project refs). These fakes prove structural call
 * shapes, dependency lifecycle, single-client reuse, requested transaction
 * options, transaction wiring, write sequence, error propagation, and cleanup
 * counts — NOT real generated-Prisma compatibility, real PostgreSQL Serializable
 * semantics, real commit/rollback, real P2002/P2034 wrapping, or connectivity.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readObservedStructuralState,
  detectTarget,
  writeBootstrap,
  withBootstrapTransaction,
  createClientHolder,
  createLiveDeps,
  BOOTSTRAP_TRANSACTION_OPTIONS,
  ADAPTER_INTERNAL_ERROR_MESSAGE,
  type StructuralReader,
  type StructuralClient,
  type LiveClient,
  type TransactionOptions,
} from "./bootstrap-isolated-instance.live";
import {
  parseBootstrapConfig,
  buildBootstrapPlan,
  type BootstrapCreationPlan,
} from "./bootstrap-isolated-instance.plan";
import {
  dateKeyToDbDate,
  mapObservedStructuralState,
  type StructuralRows,
} from "./bootstrap-isolated-instance.adapter";

// --- recording harness -------------------------------------------------------

interface ReadRec {
  model: string;
  args: { select: unknown };
}
interface WriteRec {
  model: string;
  data: unknown;
  returnedId: string | null;
}

/** Read a recorded (typed-as-unknown) field without leaking casts everywhere. */
function field(data: unknown, key: string): unknown {
  return (data as Record<string, unknown>)[key];
}

/** A pure-fake StructuralReader that records each findMany call + returns rows. */
function makeReader(rows: Partial<StructuralRows>, reads: ReadRec[]): StructuralReader {
  return {
    activityYear: {
      async findMany(args) {
        reads.push({ model: "activityYear", args });
        return [...(rows.activityYears ?? [])];
      },
    },
    courseOffering: {
      async findMany(args) {
        reads.push({ model: "courseOffering", args });
        return [...(rows.courseOfferings ?? [])];
      },
    },
    courseGroup: {
      async findMany(args) {
        reads.push({ model: "courseGroup", args });
        return [...(rows.courseGroups ?? [])];
      },
    },
    capabilityCatalog: {
      async findMany(args) {
        reads.push({ model: "capabilityCatalog", args });
        return [...(rows.capabilityCatalog ?? [])];
      },
    },
    courseOfferingCapability: {
      async findMany(args) {
        reads.push({ model: "courseOfferingCapability", args });
        return [...(rows.offeringCapabilities ?? [])];
      },
    },
  };
}

/** A pure-fake transaction-scoped client (reads + creates recorded in order). */
function makeTxClient(
  rows: Partial<StructuralRows>,
  reads: ReadRec[],
  writes: WriteRec[],
  createError?: Error,
): StructuralClient {
  let n = 0;
  const nextId = (label: string): string => `ID#${++n}:${label}`;
  return {
    activityYear: {
      async findMany(args) {
        reads.push({ model: "activityYear", args });
        return [...(rows.activityYears ?? [])];
      },
      async create(args) {
        if (createError) throw createError;
        const id = nextId("year");
        writes.push({ model: "activityYear", data: args.data, returnedId: id });
        return { id };
      },
    },
    courseOffering: {
      async findMany(args) {
        reads.push({ model: "courseOffering", args });
        return [...(rows.courseOfferings ?? [])];
      },
      async create(args) {
        const id = nextId("offering");
        writes.push({ model: "courseOffering", data: args.data, returnedId: id });
        return { id };
      },
    },
    courseGroup: {
      async findMany(args) {
        reads.push({ model: "courseGroup", args });
        return [...(rows.courseGroups ?? [])];
      },
      async create(args) {
        const id = nextId("group");
        writes.push({ model: "courseGroup", data: args.data, returnedId: id });
        return { id };
      },
    },
    capabilityCatalog: {
      async findMany(args) {
        reads.push({ model: "capabilityCatalog", args });
        return [...(rows.capabilityCatalog ?? [])];
      },
      async create(args) {
        writes.push({ model: "capabilityCatalog", data: args.data, returnedId: null });
        return undefined;
      },
    },
    courseOfferingCapability: {
      async findMany(args) {
        reads.push({ model: "courseOfferingCapability", args });
        return [...(rows.offeringCapabilities ?? [])];
      },
      async create(args) {
        writes.push({ model: "courseOfferingCapability", data: args.data, returnedId: null });
        return undefined;
      },
    },
  };
}

interface FakeLive {
  client: LiveClient;
  outerReads: ReadRec[];
  txReads: ReadRec[];
  writes: WriteRec[];
  txOptions: TransactionOptions[];
  state: { txCount: number; disconnectCount: number };
}
interface FakeLiveOptions {
  outerRows?: Partial<StructuralRows>;
  freshRows?: Partial<StructuralRows>;
  txOpenError?: Error;
  createError?: Error;
  disconnectRejects?: boolean;
}

/** A pure-fake LiveClient: outer reads + interactive transaction + disconnect. */
function makeFakeLive(opts: FakeLiveOptions = {}): FakeLive {
  const outerReads: ReadRec[] = [];
  const txReads: ReadRec[] = [];
  const writes: WriteRec[] = [];
  const txOptions: TransactionOptions[] = [];
  const state = { txCount: 0, disconnectCount: 0 };
  const outer = makeReader(opts.outerRows ?? {}, outerReads);

  const client: LiveClient = {
    ...outer,
    async $transaction(fn, options) {
      state.txCount++;
      txOptions.push(options);
      if (opts.txOpenError) throw opts.txOpenError;
      const tx = makeTxClient(opts.freshRows ?? opts.outerRows ?? {}, txReads, writes, opts.createError);
      return fn(tx);
    },
    async $disconnect() {
      state.disconnectCount++;
      if (opts.disconnectRejects) throw new Error("disconnect failed");
    },
  };
  return { client, outerReads, txReads, writes, txOptions, state };
}

// --- synthetic plan fixture --------------------------------------------------

function makePlan(): BootstrapCreationPlan {
  const parsed = parseBootstrapConfig({
    activityYear: { name: "YEAR-SYNTH", startDate: "2000-01-01", endDate: "2000-06-01" },
    offering: {
      name: "OFFERING-SYNTH",
      level: 1,
      startDate: "2000-01-01",
      endDate: "2000-02-01",
      status: "PLANNED",
    },
    groups: [
      { name: "TOP-A", subgroups: [{ name: "A1" }, { name: "A2" }] },
      { name: "TOP-B", subgroups: [{ name: "B1" }] },
    ],
    capabilities: [
      { key: "CAP_A", label: "LABEL_A", isActive: true, offeringStatus: "ENABLED" },
      { key: "CAP_B", label: "LABEL_B", isActive: false, offeringStatus: "READ_ONLY" },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("unreachable");
  return buildBootstrapPlan(parsed.config);
}

const EXPECTED_SELECTS: Record<string, { select: unknown }> = {
  activityYear: { select: { name: true, startDate: true, endDate: true } },
  courseOffering: {
    select: {
      name: true,
      level: true,
      startDate: true,
      endDate: true,
      status: true,
      activityYear: { select: { name: true } },
    },
  },
  courseGroup: { select: { name: true, parentGroup: { select: { name: true } } } },
  capabilityCatalog: { select: { key: true, label: true, isActive: true } },
  courseOfferingCapability: { select: { capabilityKey: true, status: true } },
};

const READ_MODELS = [
  "activityYear",
  "courseOffering",
  "courseGroup",
  "capabilityCatalog",
  "courseOfferingCapability",
];

// ===========================================================================
// Import / lifecycle (1–3, 38)
// ===========================================================================

test("1. importing the module performs no operation and exposes only pure primitives", async () => {
  const before = process.exitCode;
  const mod1 = await import("./bootstrap-isolated-instance.live");
  const mod2 = await import("./bootstrap-isolated-instance.live");
  assert.equal(mod1, mod2); // cached; import had no re-runnable side effect
  assert.equal(typeof mod1.readObservedStructuralState, "function");
  assert.equal(typeof mod1.detectTarget, "function");
  assert.equal(typeof mod1.writeBootstrap, "function");
  assert.equal(typeof mod1.withBootstrapTransaction, "function");
  assert.equal(typeof mod1.createClientHolder, "function");
  assert.equal(typeof mod1.createLiveDeps, "function");
  // no Prisma client is constructed or exported here
  assert.equal((mod1 as Record<string, unknown>).PrismaClient, undefined);
  // importing did not set an exit code (no gated CLI, no direct entry)
  assert.equal(process.exitCode, before);
});

test("2+3. building deps/holder calls neither the target getter nor the client factory", () => {
  let getterCalls = 0;
  let factoryCalls = 0;
  const fake = makeFakeLive();
  createLiveDeps({
    readConfigFile: () => "unused",
    getConnectionString: () => {
      getterCalls++;
      return "postgresql://postgres:pw@db.abcdefghij0123456789.supabase.co/x";
    },
    createClient: () => {
      factoryCalls++;
      return fake.client;
    },
    log: () => {},
  });
  createClientHolder(() => {
    factoryCalls++;
    return fake.client;
  });
  assert.equal(getterCalls, 0);
  assert.equal(factoryCalls, 0);
});

test("38. the module introduces no env/fs/console/Prisma/network/direct-entry import (source boundary)", () => {
  const src = readFileSync(new URL("./bootstrap-isolated-instance.live.ts", import.meta.url), "utf8");
  // strip block comments + line comments so prose negatives do not trip the scan
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of [
    "PrismaClient",
    "PrismaPg",
    "@prisma",
    "generated/prisma",
    "prisma/client",
    "adapter-pg",
    "process.env",
    "DATABASE_URL",
    "dotenv",
    "node:fs",
    'from "fs"',
    "console.",
    "import.meta",
    "process.argv",
    "process.exit",
    ".run.ts",
  ]) {
    assert.equal(code.includes(forbidden), false, `live code must not contain "${forbidden}"`);
  }
});

// ===========================================================================
// Target detection (4–7)
// ===========================================================================

test("4. target detection calls the injected getter exactly once", () => {
  let calls = 0;
  const getter = (): string | undefined => {
    calls++;
    return "postgresql://postgres:pw@db.abcdefghij0123456789.supabase.co/x";
  };
  detectTarget(getter);
  assert.equal(calls, 1);
});

test("5. target detection uses the strict committed parser (component-based only)", () => {
  const ref = "abcdefghij0123456789";
  const direct = detectTarget(() => `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`);
  assert.deepEqual(direct, { detectedProjectRef: ref });
  // ref present ONLY in a non-approved component (password) -> strict parser rejects
  const laundered = detectTarget(() => `postgresql://postgres:${ref}@my-db.example.com/x`);
  assert.deepEqual(laundered, { detectedProjectRef: null });
});

test("6. missing/malformed target data fails closed to a null detected ref", () => {
  assert.deepEqual(detectTarget(() => undefined), { detectedProjectRef: null });
  assert.deepEqual(detectTarget(() => ""), { detectedProjectRef: null });
  assert.deepEqual(detectTarget(() => "not a url"), { detectedProjectRef: null });
});

test("7. target detection adds no production classification (returns the parsed ref unchanged)", () => {
  // a genuine direct URL yields the strict ref; this module never denies/compares.
  const ref = "klmnopqrst4567890123";
  assert.deepEqual(
    detectTarget(() => `postgresql://postgres:pw@db.${ref}.supabase.co/x`),
    { detectedProjectRef: ref },
  );
});

// ===========================================================================
// Structural reads (8–11)
// ===========================================================================

test("8. structural read calls each of the five delegates exactly once, in order", async () => {
  const reads: ReadRec[] = [];
  await readObservedStructuralState(makeReader({}, reads));
  assert.equal(reads.length, 5);
  assert.deepEqual(reads.map((r) => r.model), READ_MODELS);
});

test("9. each structural read is unfiltered and carries only the approved select", async () => {
  const reads: ReadRec[] = [];
  await readObservedStructuralState(makeReader({}, reads));
  for (const r of reads) {
    // exactly { select: <approved> } — no where/scope/pagination key exists
    assert.deepEqual(Object.keys(r.args), ["select"]);
    assert.deepEqual(r.args, EXPECTED_SELECTS[r.model]);
  }
});

test("10+11. rows map through the committed shape; empty and multi-row collections are preserved", async () => {
  const rows: StructuralRows = {
    activityYears: [
      { name: "Y1", startDate: new Date("2000-01-01T00:00:00.000Z"), endDate: null },
      { name: "Y2", startDate: null, endDate: null },
    ],
    courseOfferings: [
      { name: "O1", level: 1, startDate: null, endDate: null, status: "PLANNED", activityYear: { name: "Y1" } },
      { name: "O2", level: 2, startDate: null, endDate: null, status: "ACTIVE", activityYear: { name: "Y1" } },
    ],
    courseGroups: [{ name: "T", parentGroup: null }, { name: "1", parentGroup: { name: "T" } }],
    capabilityCatalog: [], // empty preserved
    offeringCapabilities: [{ capabilityKey: "K", status: "ENABLED" }],
  };
  const out = await readObservedStructuralState(makeReader(rows, []));
  assert.deepEqual(out, mapObservedStructuralState(rows));
  assert.equal(out.activityYears.length, 2);
  assert.equal(out.courseOfferings.length, 2);
  assert.equal(out.capabilityCatalog.length, 0);
});

// ===========================================================================
// Client holder + single-client reuse (12–13)
// ===========================================================================

test("12+13. preflight constructs the client once; preflight and apply share the same held client", async () => {
  let factoryCalls = 0;
  const fake = makeFakeLive();
  const deps = createLiveDeps({
    readConfigFile: () => "unused",
    getConnectionString: () => undefined,
    createClient: () => {
      factoryCalls++;
      return fake.client;
    },
    log: () => {},
  });
  await deps.readStructuralState(); // first client-requiring op
  assert.equal(factoryCalls, 1);
  assert.equal(fake.outerReads.length, 5); // used the held client for preflight
  await deps.withTransaction(async () => "ok"); // apply
  assert.equal(factoryCalls, 1); // same held client reused, not reconstructed
  assert.equal(fake.state.txCount, 1); // the transaction ran on the held client
});

// ===========================================================================
// Transaction wiring (14–17)
// ===========================================================================

test("14+15. exactly one interactive transaction is requested with Serializable/5000/30000", async () => {
  const fake = makeFakeLive();
  await withBootstrapTransaction(fake.client)(async () => "x");
  assert.equal(fake.state.txCount, 1);
  assert.equal(fake.txOptions.length, 1);
  assert.deepEqual(fake.txOptions[0], { isolationLevel: "Serializable", maxWait: 5000, timeout: 30000 });
  assert.deepEqual(fake.txOptions[0], BOOTSTRAP_TRANSACTION_OPTIONS);
});

test("16. readFresh reads through the transaction-scoped client, not the outer client", async () => {
  const fake = makeFakeLive({ outerRows: {}, freshRows: {} });
  await withBootstrapTransaction(fake.client)(async (tx) => {
    await tx.readFresh();
    return "x";
  });
  assert.equal(fake.outerReads.length, 0); // outer client untouched
  assert.equal(fake.txReads.length, 5); // five reads on the tx-scoped client
  assert.deepEqual(fake.txReads.map((r) => r.model), READ_MODELS);
});

test("17. writeBootstrap writes through the transaction-scoped client, not the outer client", async () => {
  const plan = makePlan();
  const fake = makeFakeLive();
  await withBootstrapTransaction(fake.client)(async (tx) => {
    await tx.writeBootstrap({ plan, missingCatalogKeys: ["CAP_A", "CAP_B"] });
    return "x";
  });
  assert.equal(fake.outerReads.length, 0);
  assert.ok(fake.writes.length > 0); // all creates recorded on the tx-scoped client
  assert.equal(fake.writes.filter((w) => w.model === "activityYear").length, 1);
});

// ===========================================================================
// Writer ordering + FK/id wiring (18–26)
// ===========================================================================

function indicesByModel(writes: WriteRec[], model: string): number[] {
  const out: number[] = [];
  writes.forEach((w, i) => {
    if (w.model === model) out.push(i);
  });
  return out;
}

test("18. ActivityYear is written before CourseOffering", async () => {
  const writes: WriteRec[] = [];
  await writeBootstrap(makeTxClient({}, [], writes), { plan: makePlan(), missingCatalogKeys: [] });
  assert.ok(indicesByModel(writes, "activityYear")[0] < indicesByModel(writes, "courseOffering")[0]);
});

test("19. CourseOffering is written before every CourseGroup", async () => {
  const writes: WriteRec[] = [];
  await writeBootstrap(makeTxClient({}, [], writes), { plan: makePlan(), missingCatalogKeys: [] });
  const offeringIdx = indicesByModel(writes, "courseOffering")[0];
  for (const gi of indicesByModel(writes, "courseGroup")) assert.ok(offeringIdx < gi);
});

test("20. top-level groups precede subgroups even when the plan collection is reordered", async () => {
  const plan = makePlan();
  // reverse the groups so subgroups appear BEFORE their top-level parents
  const reordered: BootstrapCreationPlan = { ...plan, courseGroups: [...plan.courseGroups].reverse() };
  const writes: WriteRec[] = [];
  await writeBootstrap(makeTxClient({}, [], writes), { plan: reordered, missingCatalogKeys: [] });
  const groupWrites = writes.filter((w) => w.model === "courseGroup");
  const lastTop = groupWrites.reduce((acc, w, i) => (field(w.data, "parentGroupId") === null ? i : acc), -1);
  const firstSub = groupWrites.findIndex((w) => field(w.data, "parentGroupId") !== null);
  assert.ok(lastTop >= 0 && firstSub >= 0);
  assert.ok(lastTop < firstSub, "every top-level group must be created before any subgroup");
});

test("21. missing catalog rows are written before offering-capability rows", async () => {
  const writes: WriteRec[] = [];
  await writeBootstrap(makeTxClient({}, [], writes), {
    plan: makePlan(),
    missingCatalogKeys: ["CAP_A", "CAP_B"],
  });
  const lastCatalog = indicesByModel(writes, "capabilityCatalog").at(-1);
  const firstOc = indicesByModel(writes, "courseOfferingCapability")[0];
  assert.ok(lastCatalog !== undefined && firstOc !== undefined);
  assert.ok((lastCatalog as number) < firstOc);
});

test("22+23. only keys in missingCatalogKeys are created; reusable keys are not", async () => {
  const writes: WriteRec[] = [];
  await writeBootstrap(makeTxClient({}, [], writes), {
    plan: makePlan(),
    missingCatalogKeys: ["CAP_B"], // CAP_A is reusable
  });
  const catalogKeys = writes
    .filter((w) => w.model === "capabilityCatalog")
    .map((w) => field(w.data, "key"));
  assert.deepEqual(catalogKeys, ["CAP_B"]);
  assert.equal(catalogKeys.includes("CAP_A"), false);
});

test("24. all planned offering-capability rows are created (unfiltered)", async () => {
  const plan = makePlan();
  const writes: WriteRec[] = [];
  await writeBootstrap(makeTxClient({}, [], writes), { plan, missingCatalogKeys: ["CAP_A", "CAP_B"] });
  const ocKeys = writes
    .filter((w) => w.model === "courseOfferingCapability")
    .map((w) => field(w.data, "capabilityKey"));
  assert.deepEqual(ocKeys, plan.offeringCapabilities.map((o) => o.capabilityKey));
  assert.equal(ocKeys.length, 2);
});

test("25. generated IDs flow into the offering and subgroup foreign keys", async () => {
  const plan = makePlan();
  const writes: WriteRec[] = [];
  await writeBootstrap(makeTxClient({}, [], writes), { plan, missingCatalogKeys: [] });

  const yearWrite = writes.find((w) => w.model === "activityYear");
  const offeringWrite = writes.find((w) => w.model === "courseOffering");
  assert.ok(yearWrite && offeringWrite);
  assert.equal(field(offeringWrite.data, "activityYearId"), yearWrite.returnedId);

  const groupWrites = writes.filter((w) => w.model === "courseGroup");
  const topByName = new Map<unknown, string | null>();
  for (const w of groupWrites) {
    if (field(w.data, "parentGroupId") === null) topByName.set(field(w.data, "name"), w.returnedId);
  }
  // each planned subgroup's parentGroupId must equal the id returned for its top-level parent
  const nameByRef = new Map(plan.courseGroups.map((g) => [g.ref, g.name] as const));
  for (const g of plan.courseGroups) {
    if (g.parentGroupRef === null) continue;
    const parentName = nameByRef.get(g.parentGroupRef);
    const subWrite = groupWrites.find((w) => field(w.data, "name") === g.name);
    assert.ok(subWrite);
    assert.equal(field(subWrite.data, "parentGroupId"), topByName.get(parentName));
  }
});

test("26. date conversion uses the committed UTC DateKey helper", async () => {
  const plan = makePlan();
  const writes: WriteRec[] = [];
  await writeBootstrap(makeTxClient({}, [], writes), { plan, missingCatalogKeys: [] });
  const yearWrite = writes.find((w) => w.model === "activityYear");
  const offeringWrite = writes.find((w) => w.model === "courseOffering");
  assert.ok(yearWrite && offeringWrite);

  const ys = field(yearWrite.data, "startDate");
  const os = field(offeringWrite.data, "startDate");
  if (!(ys instanceof Date) || !(os instanceof Date)) throw new Error("expected Date values");
  assert.equal(ys.getTime(), dateKeyToDbDate("2000-01-01").getTime());
  assert.equal(os.getTime(), dateKeyToDbDate("2000-01-01").getTime());
  const oe = field(offeringWrite.data, "endDate");
  if (!(oe instanceof Date)) throw new Error("expected Date");
  assert.equal(oe.getTime(), dateKeyToDbDate("2000-02-01").getTime());
});

// ===========================================================================
// No hidden write semantics (27)
// ===========================================================================

test("27. the write trace contains only explicit creates (no upsert/skip/merge shapes)", async () => {
  const writes: WriteRec[] = [];
  await writeBootstrap(makeTxClient({}, [], writes), {
    plan: makePlan(),
    missingCatalogKeys: ["CAP_A", "CAP_B"],
  });
  for (const w of writes) {
    for (const forbidden of ["skipDuplicates", "connectOrCreate", "update", "upsert", "where"]) {
      assert.equal(field(w.data, forbidden), undefined, `create data must not carry "${forbidden}"`);
    }
  }
});

// ===========================================================================
// Fail-closed logical references (28–29)
// ===========================================================================

test("28. an unresolvable logical reference fails closed before the dependent create", async () => {
  const plan = makePlan();
  // corrupt the offering's activity-year ref so it cannot resolve
  const broken: BootstrapCreationPlan = {
    ...plan,
    courseOffering: { ...plan.courseOffering, activityYearRef: "does-not-exist" },
  };
  const writes: WriteRec[] = [];
  await assert.rejects(
    writeBootstrap(makeTxClient({}, [], writes), { plan: broken, missingCatalogKeys: [] }),
    (err: unknown) => err instanceof Error && err.message === ADAPTER_INTERNAL_ERROR_MESSAGE,
  );
  // the year was created, but the offering create was never reached
  assert.equal(writes.filter((w) => w.model === "activityYear").length, 1);
  assert.equal(writes.filter((w) => w.model === "courseOffering").length, 0);
});

test("29. the logical-reference error discloses no ref, name, key, date, or input data", async () => {
  const plan = makePlan();
  const broken: BootstrapCreationPlan = {
    ...plan,
    courseOffering: { ...plan.courseOffering, activityYearRef: "SECRET-REF" },
  };
  let caught: Error | null = null;
  try {
    await writeBootstrap(makeTxClient({}, [], []), { plan: broken, missingCatalogKeys: [] });
  } catch (e) {
    caught = e instanceof Error ? e : new Error("non-error");
  }
  assert.ok(caught);
  assert.equal(caught.message, ADAPTER_INTERNAL_ERROR_MESSAGE);
  for (const secret of ["SECRET-REF", "does-not-exist", "OFFERING-SYNTH", "YEAR-SYNTH", "CAP_A", "2000-01-01"]) {
    assert.equal(caught.message.includes(secret), false);
  }
});

// ===========================================================================
// Error propagation — no retry, no interpretation (30–32)
// ===========================================================================

test("30. a fake transaction failure propagates and is not retried", async () => {
  const plan = makePlan();
  const boom = new Error("write failed");
  const fake = makeFakeLive({ createError: boom });
  await assert.rejects(
    withBootstrapTransaction(fake.client)(async (tx) => {
      await tx.writeBootstrap({ plan, missingCatalogKeys: ["CAP_A", "CAP_B"] });
      return "x";
    }),
    (err: unknown) => err === boom,
  );
  assert.equal(fake.state.txCount, 1); // exactly one transaction opened; no retry
});

test("31. a P2002-shaped error is neither interpreted nor logged by this module", async () => {
  const plan = makePlan();
  const p2002 = Object.assign(new Error("unique violation"), { code: "P2002" });
  const fake = makeFakeLive({ createError: p2002 });
  await assert.rejects(
    withBootstrapTransaction(fake.client)(async (tx) => {
      await tx.writeBootstrap({ plan, missingCatalogKeys: ["CAP_A"] });
      return "x";
    }),
    (err: unknown) => err === p2002 && (err as { code?: unknown }).code === "P2002",
  );
});

test("32. a P2034-shaped error is neither interpreted nor logged by this module", async () => {
  const plan = makePlan();
  const p2034 = Object.assign(new Error("write conflict"), { code: "P2034" });
  const fake = makeFakeLive({ createError: p2034 });
  await assert.rejects(
    withBootstrapTransaction(fake.client)(async (tx) => {
      await tx.writeBootstrap({ plan, missingCatalogKeys: ["CAP_A"] });
      return "x";
    }),
    (err: unknown) => err === p2034 && (err as { code?: unknown }).code === "P2034",
  );
});

// ===========================================================================
// Client-holder cleanup semantics (33–37)
// ===========================================================================

test("33. cleanup before construction is a no-op (factory + disconnect never called)", async () => {
  let factoryCalls = 0;
  const fake = makeFakeLive();
  const holder = createClientHolder(() => {
    factoryCalls++;
    return fake.client;
  });
  await holder.cleanup();
  assert.equal(factoryCalls, 0);
  assert.equal(fake.state.disconnectCount, 0);
});

test("34. cleanup after construction disconnects exactly once", async () => {
  const fake = makeFakeLive();
  const holder = createClientHolder(() => fake.client);
  holder.get();
  await holder.cleanup();
  assert.equal(fake.state.disconnectCount, 1);
});

test("35. repeated cleanup remains a no-op after the first disconnect", async () => {
  const fake = makeFakeLive();
  const holder = createClientHolder(() => fake.client);
  holder.get();
  await holder.cleanup();
  await holder.cleanup();
  await holder.cleanup();
  assert.equal(fake.state.disconnectCount, 1);
});

test("36. a rejecting disconnect is still invoked at most once", async () => {
  const fake = makeFakeLive({ disconnectRejects: true });
  const holder = createClientHolder(() => fake.client);
  holder.get();
  await assert.rejects(holder.cleanup()); // first call rejects
  await holder.cleanup(); // second call is a no-op (resolves)
  assert.equal(fake.state.disconnectCount, 1);
});

test("37. factory-construction failure leaves cleanup safe", async () => {
  const holder = createClientHolder(() => {
    throw new Error("factory boom");
  });
  assert.throws(() => holder.get());
  await holder.cleanup(); // no client was constructed -> safe no-op
});

// ===========================================================================
// Same-held-client reuse via the transaction path (single-client contract)
// ===========================================================================

test("13b. the single held client backs both preflight reads and the transaction writes", async () => {
  const plan = makePlan();
  let factoryCalls = 0;
  const fake = makeFakeLive();
  const deps = createLiveDeps({
    readConfigFile: () => "unused",
    getConnectionString: () => undefined,
    createClient: () => {
      factoryCalls++;
      return fake.client;
    },
    log: () => {},
  });
  await deps.readStructuralState();
  await deps.withTransaction(async (tx) => {
    await tx.writeBootstrap({ plan, missingCatalogKeys: ["CAP_A", "CAP_B"] });
    return "ok";
  });
  await deps.cleanup();
  assert.equal(factoryCalls, 1);
  assert.equal(fake.outerReads.length, 5);
  assert.equal(fake.state.txCount, 1);
  assert.ok(fake.writes.length > 0);
  assert.equal(fake.state.disconnectCount, 1);
});
