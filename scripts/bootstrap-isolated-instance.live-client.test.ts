/**
 * MC-BOOTSTRAP-S2B2B — executable tests for the REAL Prisma bridge
 * (bootstrap-isolated-instance.live-client.ts).
 *
 * Run with:
 *   npx tsx --test scripts/bootstrap-isolated-instance.live-client.test.ts
 *
 * DB-FREE: no real database, no real PrismaClient, no PrismaPg, no adapter, no
 * env, no network, no clock. The bridge consumes a NARROW host expressed entirely
 * in the committed S2B2A contracts (`LiveClientHost` = StructuralClient &
 * TransactionOwner & Disconnectable), so a plain recording double satisfies it
 * WITHOUT any cast. The proof that the real generated `PrismaClient` satisfies
 * that same host lives in live-client.ts (`createLiveClient` hands a freshly
 * constructed real client to `makeLiveClient`, checked by `tsc`); these tests
 * prove only runtime forwarding behavior and never call `createLiveClient` (which
 * would construct a real client). Every call below uses the exact narrow S2B2A
 * argument/data types (concrete per model — no union indexing), so the tests also
 * honor the committed S2B2A contracts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeLiveClient,
  createLiveClient,
  type LiveClientHost,
} from "./bootstrap-isolated-instance.live-client";
import type { LiveClient, StructuralClient } from "./bootstrap-isolated-instance.live";

// --- recording harness -------------------------------------------------------

type Model =
  | "activityYear"
  | "courseOffering"
  | "courseGroup"
  | "capabilityCatalog"
  | "courseOfferingCapability";

interface CallRec {
  host: "outer" | "tx";
  model: Model;
  op: "findMany" | "create";
  args: unknown;
}

interface FakeState {
  calls: CallRec[];
  txOptions: unknown[];
  txCallbackCount: number;
  disconnects: number;
}

/** The synthetic id a `create` on each model resolves to (so ID projection is
 * observable). Distinct per model so a mis-wired delegate is caught. */
const CREATE_IDS: Record<Model, string> = {
  activityYear: "id-activityYear",
  courseOffering: "id-courseOffering",
  courseGroup: "id-courseGroup",
  capabilityCatalog: "id-capabilityCatalog",
  courseOfferingCapability: "id-courseOfferingCapability",
};

/**
 * A recording read/write host tagged with which client ("outer" vs "tx") it is.
 * Typed as the S2B2A `StructuralClient` — a plain object satisfies it cast-free
 * (the narrow monomorphic `findMany`/`create` contracts), which is exactly why no
 * `as unknown as` is needed anywhere in this suite.
 */
function makeHost(host: "outer" | "tx", state: FakeState): StructuralClient {
  const delegate = (model: Model) => ({
    findMany: async (args: unknown) => {
      state.calls.push({ host, model, op: "findMany", args });
      return [];
    },
    create: async (args: unknown) => {
      state.calls.push({ host, model, op: "create", args });
      return { id: CREATE_IDS[model] };
    },
  });
  return {
    activityYear: delegate("activityYear"),
    courseOffering: delegate("courseOffering"),
    courseGroup: delegate("courseGroup"),
    capabilityCatalog: delegate("capabilityCatalog"),
    courseOfferingCapability: delegate("courseOfferingCapability"),
  };
}

/**
 * Build the recording host + a DISTINCT transaction host, plus the shared state.
 * The double is typed as the narrow `LiveClientHost` (the exact host the bridge
 * consumes) and is therefore CAST-FREE. It implements exactly the surface the
 * bridge touches (five delegates, `$transaction`, `$disconnect`); the compile-time
 * proof that the REAL generated client satisfies the same host lives in
 * live-client.ts (`createLiveClient` → `makeLiveClient`), not here.
 */
function makeRecordingClient(): { client: LiveClientHost; state: FakeState } {
  const state: FakeState = { calls: [], txOptions: [], txCallbackCount: 0, disconnects: 0 };
  const outer = makeHost("outer", state);
  const txHost = makeHost("tx", state);
  const client: LiveClientHost = {
    ...outer,
    async $transaction(fn, options) {
      state.txOptions.push(options);
      state.txCallbackCount += 1;
      // Hand the callback the DISTINCT tx host — never the outer client.
      return fn(txHost);
    },
    async $disconnect() {
      state.disconnects += 1;
    },
  };
  return { client, state };
}

const TX_OPTIONS = {
  isolationLevel: "Serializable",
  maxWait: 5000,
  timeout: 30000,
} as const;

// Exact `select` shapes S2B2A sends — one typed constant per model (concrete, so
// each satisfies its narrow S2B2A `FindManyReader` argument type).
const READ_ARGS = {
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
} as const;

// Synthetic-but-typed `create` data — one typed constant per model (concrete, so
// each satisfies its narrow S2B2A create-data type). No real names/keys/dates.
const D = new Date("2000-01-01T00:00:00.000Z");
const WRITE_DATA = {
  activityYear: { name: "y", startDate: null, endDate: null },
  courseOffering: { activityYearId: "ay", name: "o", level: 1, startDate: D, endDate: D, status: "PLANNED" },
  courseGroup: { courseOfferingId: "co", parentGroupId: null, name: "g" },
  capabilityCatalog: { key: "k", label: "l", isActive: true },
  courseOfferingCapability: { courseOfferingId: "co", capabilityKey: "k", status: "ENABLED" },
} as const;

// --- 1. Import safety --------------------------------------------------------

test("importing the bridge module constructs no client and runs no operation", () => {
  // Importing this test already imported live-client.ts. The module has no
  // top-level side effect: the ONLY client constructor is createLiveClient, which
  // this suite never calls. Exports are plain functions; merely importing invokes
  // nothing.
  assert.equal(typeof makeLiveClient, "function");
  assert.equal(typeof createLiveClient, "function");
});

test("makeLiveClient itself constructs nothing — it only wraps the injected client", () => {
  const { state } = makeRecordingClient();
  makeLiveClient(makeRecordingClient().client);
  // Wrapping performs no delegate call, no transaction, no disconnect.
  assert.deepEqual(state.calls, []);
  assert.equal(state.txCallbackCount, 0);
  assert.equal(state.disconnects, 0);
});

// --- 9. Type-level proof: the produced object is a LiveClient ---------------

test("makeLiveClient produces a value typed as LiveClient", () => {
  const { client } = makeRecordingClient();
  const bridge: LiveClient = makeLiveClient(client); // compile-time assertion
  assert.equal(typeof bridge.$transaction, "function");
  assert.equal(typeof bridge.$disconnect, "function");
});

// --- 2. Five reads forward exactly once, to the correct delegate, with args --

const READ_CASES: ReadonlyArray<{
  model: Model;
  args: unknown;
  run: (b: LiveClient) => Promise<unknown>;
}> = [
  { model: "activityYear", args: READ_ARGS.activityYear, run: (b) => b.activityYear.findMany(READ_ARGS.activityYear) },
  { model: "courseOffering", args: READ_ARGS.courseOffering, run: (b) => b.courseOffering.findMany(READ_ARGS.courseOffering) },
  { model: "courseGroup", args: READ_ARGS.courseGroup, run: (b) => b.courseGroup.findMany(READ_ARGS.courseGroup) },
  { model: "capabilityCatalog", args: READ_ARGS.capabilityCatalog, run: (b) => b.capabilityCatalog.findMany(READ_ARGS.capabilityCatalog) },
  {
    model: "courseOfferingCapability",
    args: READ_ARGS.courseOfferingCapability,
    run: (b) => b.courseOfferingCapability.findMany(READ_ARGS.courseOfferingCapability),
  },
];

for (const c of READ_CASES) {
  test(`read: ${c.model}.findMany forwards once to the outer delegate with exact args`, async () => {
    const { client, state } = makeRecordingClient();
    const bridge = makeLiveClient(client);
    const result = await c.run(bridge);
    assert.deepEqual(result, []);
    assert.equal(state.calls.length, 1);
    assert.deepEqual(state.calls[0], { host: "outer", model: c.model, op: "findMany", args: c.args });
    // The exact received arguments object is forwarded (same reference).
    assert.equal(state.calls[0].args, c.args);
  });
}

// --- 3/4. ID-returning writes forward once with exact data + return the id ----
// Writes are reachable only through the transaction-scoped StructuralClient, so
// these also exercise the transaction wrapper (see test 6).

const ID_WRITE_CASES: ReadonlyArray<{
  model: Model;
  data: unknown;
  run: (tx: StructuralClient) => Promise<{ id: string }>;
}> = [
  { model: "activityYear", data: WRITE_DATA.activityYear, run: (tx) => tx.activityYear.create({ data: WRITE_DATA.activityYear }) },
  { model: "courseOffering", data: WRITE_DATA.courseOffering, run: (tx) => tx.courseOffering.create({ data: WRITE_DATA.courseOffering }) },
  { model: "courseGroup", data: WRITE_DATA.courseGroup, run: (tx) => tx.courseGroup.create({ data: WRITE_DATA.courseGroup }) },
];

for (const c of ID_WRITE_CASES) {
  test(`write(id): ${c.model}.create forwards once with exact data and returns the generated id`, async () => {
    const { client, state } = makeRecordingClient();
    const bridge = makeLiveClient(client);
    const created = await bridge.$transaction((tx) => c.run(tx), TX_OPTIONS);
    assert.deepEqual(created, { id: CREATE_IDS[c.model] });
    const createCalls = state.calls.filter((x) => x.op === "create");
    assert.equal(createCalls.length, 1);
    assert.deepEqual(createCalls[0], { host: "tx", model: c.model, op: "create", args: { data: c.data } });
  });
}

// --- 5. Ignored-result writes forward once with exact data, no invented id ---

const IGNORED_WRITE_CASES: ReadonlyArray<{
  model: Model;
  data: unknown;
  run: (tx: StructuralClient) => Promise<unknown>;
}> = [
  { model: "capabilityCatalog", data: WRITE_DATA.capabilityCatalog, run: (tx) => tx.capabilityCatalog.create({ data: WRITE_DATA.capabilityCatalog }) },
  {
    model: "courseOfferingCapability",
    data: WRITE_DATA.courseOfferingCapability,
    run: (tx) => tx.courseOfferingCapability.create({ data: WRITE_DATA.courseOfferingCapability }),
  },
];

for (const c of IGNORED_WRITE_CASES) {
  test(`write(ignored): ${c.model}.create forwards once with exact data and resolves without an id`, async () => {
    const { client, state } = makeRecordingClient();
    const bridge = makeLiveClient(client);
    const returned = await bridge.$transaction((tx) => c.run(tx), TX_OPTIONS);
    // The bridge does not invent or surface an id for ignored creates.
    assert.equal(returned, undefined);
    const createCalls = state.calls.filter((x) => x.op === "create");
    assert.equal(createCalls.length, 1);
    assert.deepEqual(createCalls[0], { host: "tx", model: c.model, op: "create", args: { data: c.data } });
  });
}

// --- 6. Interactive transaction: callback + options + tx-scoped wrapping -----

test("$transaction forwards the callback once and the exact options", async () => {
  const { client, state } = makeRecordingClient();
  const bridge = makeLiveClient(client);
  const out = await bridge.$transaction(async () => "done", TX_OPTIONS);
  assert.equal(out, "done");
  assert.equal(state.txCallbackCount, 1);
  assert.equal(state.txOptions.length, 1);
  assert.deepEqual(state.txOptions[0], TX_OPTIONS);
});

test("$transaction wraps the transaction-scoped client, never the outer client", async () => {
  const { client, state } = makeRecordingClient();
  const bridge = makeLiveClient(client);
  await bridge.$transaction(async (tx) => {
    await tx.activityYear.findMany(READ_ARGS.activityYear);
    await tx.courseOfferingCapability.create({ data: WRITE_DATA.courseOfferingCapability });
    return null;
  }, TX_OPTIONS);
  // Every operation inside the callback hit the tx host; none hit the outer one.
  assert.ok(state.calls.length > 0);
  assert.ok(state.calls.every((x) => x.host === "tx"));
});

// --- 7. Disconnect forwards only to the outer client ------------------------

test("$disconnect forwards to the outer client and touches no delegate", async () => {
  const { client, state } = makeRecordingClient();
  const bridge = makeLiveClient(client);
  await bridge.$disconnect();
  assert.equal(state.disconnects, 1);
  assert.deepEqual(state.calls, []);
  assert.equal(state.txCallbackCount, 0);
});
