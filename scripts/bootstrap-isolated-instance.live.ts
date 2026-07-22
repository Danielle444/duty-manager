/**
 * MC-BOOTSTRAP-S2B2A — DB-FREE live adapter primitives for the FUTURE isolated-
 * instance bootstrap runner. See the MC-BOOTSTRAP-S2B2-DESIGN audit and the
 * S2B2A implementation brief.
 *
 * DB-FREE + IMPORT-SAFE BY CONSTRUCTION. This module has: no Prisma runtime
 * import, no Prisma TYPE import, no generated-client import, no `@prisma/
 * adapter-pg` import, no PrismaClient/PrismaPg construction, no filesystem
 * import, no dotenv, no process.env / DATABASE_URL access, no console, no
 * network, no direct CLI entry, no automatic execution, and no top-level side
 * effect. Importing it runs nothing.
 *
 * SCOPE (S2B2A only): the narrow structural reader/writer/transaction/client
 * interfaces that the FUTURE real Prisma client will satisfy structurally; one
 * reusable whole-database structural read that returns through the committed
 * S2B1 mapper; a dependency-injected target detector over the committed S2B1
 * strict parser; the exact bootstrap writer (explicit sequential creates); the
 * Serializable interactive-transaction wrapper wiring the committed S2A
 * `ApplyTransaction`; a lazy client holder over an injected factory; and an
 * `OrchestrationDeps` assembly factory over injected effects. It performs NO
 * real read/write, constructs NO client, reads NO environment, and owns NO
 * classification, target-safety, reporting, retry, or cleanup policy — those
 * live in S1 / S2A / S2B1 and are reused, never duplicated here.
 */
import type {
  ObservedStructuralState,
  OfferingStatus,
  OfferingCapabilityStatus,
} from "./bootstrap-isolated-instance.plan";
import type {
  OrchestrationDeps,
  ApplyTransaction,
  BootstrapWriteInput,
  DetectedTarget,
} from "./bootstrap-isolated-instance";
import {
  mapObservedStructuralState,
  dateKeyToDbDate,
  parseSupabaseProjectRef,
  type StructuralRows,
  type ActivityYearRow,
  type CourseOfferingRow,
  type CourseGroupRow,
  type CapabilityCatalogRow,
  type CourseOfferingCapabilityRow,
} from "./bootstrap-isolated-instance.adapter";

// ===========================================================================
// A — Narrow structural interfaces.
//
// These model ONLY the exact operations this module uses: five unfiltered
// `findMany` reads (each pinned to exactly the committed S2B1 `select` shape),
// five model `create`s, one interactive-transaction boundary, and one
// disconnect. They deliberately do NOT reproduce Prisma's full generic delegate
// signatures; the future real Prisma client satisfies them structurally, and
// this stage never imports Prisma to prove it.
// ===========================================================================

/** A single unfiltered `findMany` over exactly `TSelect`, returning `TRow[]`. */
export interface FindManyReader<TSelect, TRow> {
  findMany(args: { readonly select: TSelect }): Promise<TRow[]>;
}

// The pinned `select` shapes — exactly the fields the S2B1 row types carry. The
// arg type has ONLY `select`, so no `where`/pagination/scoping is expressible.
type ActivityYearSelect = {
  readonly name: true;
  readonly startDate: true;
  readonly endDate: true;
};
type CourseOfferingSelect = {
  readonly name: true;
  readonly level: true;
  readonly startDate: true;
  readonly endDate: true;
  readonly status: true;
  readonly activityYear: { readonly select: { readonly name: true } };
};
type CourseGroupSelect = {
  readonly name: true;
  readonly parentGroup: { readonly select: { readonly name: true } };
};
type CapabilityCatalogSelect = {
  readonly key: true;
  readonly label: true;
  readonly isActive: true;
};
type CourseOfferingCapabilitySelect = {
  readonly capabilityKey: true;
  readonly status: true;
};

/** A `create` that returns the generated id (consumed as a foreign key later). */
export interface CreateReturningId<TData> {
  create(args: { readonly data: TData }): Promise<{ readonly id: string }>;
}

/** A `create` whose result is never consumed (smallest correct return contract). */
export interface CreateIgnored<TData> {
  create(args: { readonly data: TData }): Promise<unknown>;
}

// Create-input shapes carry ONLY the exact fields the writer sends — no Prisma
// defaults, no unused columns.
interface ActivityYearCreateData {
  readonly name: string;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
}
interface CourseOfferingCreateData {
  readonly activityYearId: string;
  readonly name: string;
  readonly level: number;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly status: OfferingStatus;
}
interface CourseGroupCreateData {
  readonly courseOfferingId: string;
  readonly parentGroupId: string | null;
  readonly name: string;
}
interface CapabilityCatalogCreateData {
  readonly key: string;
  readonly label: string;
  readonly isActive: boolean;
}
interface CourseOfferingCapabilityCreateData {
  readonly courseOfferingId: string;
  readonly capabilityKey: string;
  readonly status: OfferingCapabilityStatus;
}

/** The five whole-database reads (preflight and in-transaction `readFresh`). */
export interface StructuralReader {
  readonly activityYear: FindManyReader<ActivityYearSelect, ActivityYearRow>;
  readonly courseOffering: FindManyReader<CourseOfferingSelect, CourseOfferingRow>;
  readonly courseGroup: FindManyReader<CourseGroupSelect, CourseGroupRow>;
  readonly capabilityCatalog: FindManyReader<CapabilityCatalogSelect, CapabilityCatalogRow>;
  readonly courseOfferingCapability: FindManyReader<
    CourseOfferingCapabilitySelect,
    CourseOfferingCapabilityRow
  >;
}

/** The five model creates (only ever used inside the apply transaction). */
export interface StructuralWriter {
  readonly activityYear: CreateReturningId<ActivityYearCreateData>;
  readonly courseOffering: CreateReturningId<CourseOfferingCreateData>;
  readonly courseGroup: CreateReturningId<CourseGroupCreateData>;
  readonly capabilityCatalog: CreateIgnored<CapabilityCatalogCreateData>;
  readonly courseOfferingCapability: CreateIgnored<CourseOfferingCapabilityCreateData>;
}

/**
 * The transaction-scoped client: each delegate can BOTH read and write. Declared
 * as per-delegate intersections (not `extends StructuralReader, StructuralWriter`)
 * because those bases declare the same property names with different types.
 * `StructuralClient` is assignable to both `StructuralReader` and
 * `StructuralWriter`, so the same value drives `readFresh` and `writeBootstrap`.
 */
export interface StructuralClient {
  readonly activityYear: FindManyReader<ActivityYearSelect, ActivityYearRow> &
    CreateReturningId<ActivityYearCreateData>;
  readonly courseOffering: FindManyReader<CourseOfferingSelect, CourseOfferingRow> &
    CreateReturningId<CourseOfferingCreateData>;
  readonly courseGroup: FindManyReader<CourseGroupSelect, CourseGroupRow> &
    CreateReturningId<CourseGroupCreateData>;
  readonly capabilityCatalog: FindManyReader<CapabilityCatalogSelect, CapabilityCatalogRow> &
    CreateIgnored<CapabilityCatalogCreateData>;
  readonly courseOfferingCapability: FindManyReader<
    CourseOfferingCapabilitySelect,
    CourseOfferingCapabilityRow
  > &
    CreateIgnored<CourseOfferingCapabilityCreateData>;
}

/** The exact interactive-transaction options for the first live stage. */
export interface TransactionOptions {
  readonly isolationLevel: "Serializable";
  readonly maxWait: number;
  readonly timeout: number;
}

/** The interactive-transaction owner (the future real client's `$transaction`). */
export interface TransactionOwner {
  $transaction<T>(
    fn: (tx: StructuralClient) => Promise<T>,
    options: TransactionOptions,
  ): Promise<T>;
}

/** A disconnect boundary (the future real client's `$disconnect`). */
export interface Disconnectable {
  $disconnect(): Promise<void>;
}

/**
 * The held outer client: preflight reads + interactive transactions + disconnect.
 * It never needs `StructuralWriter` at the top level — writes happen only through
 * the transaction-scoped `StructuralClient`.
 */
export interface LiveClient extends StructuralReader, TransactionOwner, Disconnectable {}

/** A caller-supplied factory that constructs the real client (S2B2B injects it). */
export type LiveClientFactory = () => LiveClient;

// ===========================================================================
// B — Structural reads (whole-database; mapped through the committed S2B1 mapper).
//
// Exactly five reads, each pinned to the committed S2B1 `select`, each with NO
// `where`/filter/scope/pagination/dedup/sort/classification. The rows are handed
// UNCHANGED to `mapObservedStructuralState`; the mapper (not this module) shapes
// them into `ObservedStructuralState`.
// ===========================================================================

async function readStructuralRows(reader: StructuralReader): Promise<StructuralRows> {
  const activityYears = await reader.activityYear.findMany({
    select: { name: true, startDate: true, endDate: true },
  });
  const courseOfferings = await reader.courseOffering.findMany({
    select: {
      name: true,
      level: true,
      startDate: true,
      endDate: true,
      status: true,
      activityYear: { select: { name: true } },
    },
  });
  const courseGroups = await reader.courseGroup.findMany({
    select: { name: true, parentGroup: { select: { name: true } } },
  });
  const capabilityCatalog = await reader.capabilityCatalog.findMany({
    select: { key: true, label: true, isActive: true },
  });
  const offeringCapabilities = await reader.courseOfferingCapability.findMany({
    select: { capabilityKey: true, status: true },
  });
  return { activityYears, courseOfferings, courseGroups, capabilityCatalog, offeringCapabilities };
}

/**
 * Read the complete structural state through the narrow reader and return the
 * committed `ObservedStructuralState`. Usable with BOTH the outer client
 * (advisory preflight) and the transaction-scoped client (`readFresh`), because
 * each satisfies `StructuralReader`. Sequential reads; no preflight transaction
 * is invented in this stage. Reuses the committed mapper verbatim.
 */
export async function readObservedStructuralState(
  reader: StructuralReader,
): Promise<ObservedStructuralState> {
  return mapObservedStructuralState(await readStructuralRows(reader));
}

// ===========================================================================
// C — Target detection primitive (dependency-injected).
//
// It only obtains a connection-string-like value from an injected synchronous
// getter and hands it to the committed S2B1 strict parser. It holds NO
// production ref, NO expected/detected comparison, NEVER reads process.env,
// NEVER loads dotenv, and NEVER logs or echoes the supplied value. Fail-closed
// (unavailable/malformed -> null) is entirely the committed parser's behavior.
// ===========================================================================

/** A synchronous zero-argument getter for connection metadata (S2B2B supplies it). */
export type ConnectionStringGetter = () => string | undefined;

/**
 * Detect the connected target ref via the committed strict S2B1 parser. Returns
 * the S2A-compatible `DetectedTarget` shape. The supplied value is passed only to
 * the parser and never inspected, compared, or logged here.
 */
export function detectTarget(getConnectionString: ConnectionStringGetter): DetectedTarget {
  const raw = getConnectionString();
  const parsed = parseSupabaseProjectRef(raw ?? "");
  return { detectedProjectRef: parsed.detectedProjectRef };
}

// ===========================================================================
// D — The bootstrap writer (explicit sequential creates over the narrow writer).
//
// WRITE-ORDER APPROACH (Section H, approach 2): execute the TYPED committed plan
// collections in an order mechanically equivalent to the committed dependency
// graph. Parent/child group ordering is derived from the DATA (`parentGroupRef
// === null` marks a top-level group), NOT from the supplied array order, so no
// input ordering can create a subgroup before its parent. No second planning
// policy is introduced; S1 remains the sole planner.
// ===========================================================================

/**
 * The single fixed, fully-redacted adapter error. Thrown when a committed logical
 * reference cannot be resolved to a generated id (an internal invariant breach).
 * It intentionally discloses NOTHING — no ref, name, key, date, or input data.
 */
export const ADAPTER_INTERNAL_ERROR_MESSAGE =
  "bootstrap-live-adapter: internal invariant violation";

function resolveRef(refToId: ReadonlyMap<string, string>, ref: string): string {
  const id = refToId.get(ref);
  if (id === undefined) {
    // Fail closed BEFORE any dependent create; redacted, value-free.
    throw new Error(ADAPTER_INTERNAL_ERROR_MESSAGE);
  }
  return id;
}

function optionalDbDate(key: string | null): Date | null {
  return key === null ? null : dateKeyToDbDate(key);
}

/**
 * Execute the exact approved write plan through the narrow writer, atomically
 * when driven inside the Serializable transaction (Section E). PURE control flow
 * over injected creates:
 *   1. ActivityYear                         -> store id by its logical ref
 *   2. CourseOffering (needs the year id)   -> store id by its logical ref
 *   3. top-level CourseGroups (parentRef=null) BEFORE subgroups -> store ids
 *   4. subgroup CourseGroups (parent id via its committed parent logical ref)
 *   5. CapabilityCatalog rows ONLY for keys in `missingCatalogKeys`
 *   6. CourseOfferingCapability rows (offering exists; all catalog keys exist)
 * Dates convert only through S2B1 `dateKeyToDbDate`; statuses are preserved
 * verbatim. No upsert/connectOrCreate/skipDuplicates/merge/repair/retry, no
 * default injection, no filtering of any planned row, no nested writes.
 */
export async function writeBootstrap(
  writer: StructuralWriter,
  input: BootstrapWriteInput,
): Promise<void> {
  const { plan, missingCatalogKeys } = input;
  const refToId = new Map<string, string>();

  // 1. ActivityYear.
  const year = await writer.activityYear.create({
    data: {
      name: plan.activityYear.name,
      startDate: optionalDbDate(plan.activityYear.startDate),
      endDate: optionalDbDate(plan.activityYear.endDate),
    },
  });
  refToId.set(plan.activityYear.ref, year.id);

  // 2. CourseOffering (depends on the ActivityYear id).
  const offering = await writer.courseOffering.create({
    data: {
      activityYearId: resolveRef(refToId, plan.courseOffering.activityYearRef),
      name: plan.courseOffering.name,
      level: plan.courseOffering.level,
      startDate: dateKeyToDbDate(plan.courseOffering.startDate),
      endDate: dateKeyToDbDate(plan.courseOffering.endDate),
      status: plan.courseOffering.status,
    },
  });
  refToId.set(plan.courseOffering.ref, offering.id);

  // 3. Top-level groups FIRST (data-driven: parentGroupRef === null), any array order.
  for (const group of plan.courseGroups) {
    if (group.parentGroupRef !== null) continue;
    const created = await writer.courseGroup.create({
      data: {
        courseOfferingId: resolveRef(refToId, group.courseOfferingRef),
        parentGroupId: null,
        name: group.name,
      },
    });
    refToId.set(group.ref, created.id);
  }

  // 4. Subgroups (parent resolved exclusively via its committed parent logical ref).
  for (const group of plan.courseGroups) {
    if (group.parentGroupRef === null) continue;
    const created = await writer.courseGroup.create({
      data: {
        courseOfferingId: resolveRef(refToId, group.courseOfferingRef),
        parentGroupId: resolveRef(refToId, group.parentGroupRef),
        name: group.name,
      },
    });
    refToId.set(group.ref, created.id);
  }

  // 5. Missing global catalog keys ONLY (reusable keys are never recreated).
  const missing = new Set(missingCatalogKeys);
  for (const entry of plan.capabilityCatalog) {
    if (!missing.has(entry.key)) continue;
    await writer.capabilityCatalog.create({
      data: { key: entry.key, label: entry.label, isActive: entry.isActive },
    });
  }

  // 6. Offering-capability rows (offering exists; every referenced key now exists).
  for (const oc of plan.offeringCapabilities) {
    await writer.courseOfferingCapability.create({
      data: {
        courseOfferingId: resolveRef(refToId, oc.courseOfferingRef),
        capabilityKey: oc.capabilityKey,
        status: oc.status,
      },
    });
  }
}

// ===========================================================================
// E — Serializable interactive-transaction wrapper.
//
// Requests EXACTLY ONE interactive transaction with the fixed options, builds the
// committed S2A `ApplyTransaction` over the SAME transaction-scoped client (so
// `readFresh` and `writeBootstrap` share it), then invokes S2A's callback once
// and returns its result. It performs NO classification, opens NO write before
// S2A calls `writeBootstrap`, calls `readFresh` only when S2A does, NEVER retries,
// and NEVER catches/reinterprets serialization or unique-violation errors — any
// thrown transaction error propagates unchanged to the S2A boundary.
// ===========================================================================

/** The exact first-live-stage interactive-transaction options. */
export const BOOTSTRAP_TRANSACTION_OPTIONS: TransactionOptions = {
  isolationLevel: "Serializable",
  maxWait: 5000,
  timeout: 30000,
};

/**
 * Build the S2A `OrchestrationDeps["withTransaction"]` over an injected owner.
 * The `ApplyTransaction` handed to S2A reads and writes through the identical
 * transaction-scoped client `tx`.
 */
export function withBootstrapTransaction(
  owner: TransactionOwner,
): OrchestrationDeps["withTransaction"] {
  return <T>(work: (tx: ApplyTransaction) => Promise<T>): Promise<T> =>
    owner.$transaction<T>(async (tx) => {
      const applyTx: ApplyTransaction = {
        readFresh: () => readObservedStructuralState(tx),
        writeBootstrap: (input) => writeBootstrap(tx, input),
      };
      return work(applyTx);
    }, BOOTSTRAP_TRANSACTION_OPTIONS);
}

// ===========================================================================
// F — Lazy client holder (over an injected factory).
//
// Begins empty; constructs the client on the FIRST client-requiring operation
// and memoizes it; never constructs at build/import time; stays empty if the
// factory throws; cleanup is a no-op when no client exists and disconnects at
// MOST once when it does (idempotent even if disconnect rejects). Sequential by
// design — S2A invokes dependencies sequentially — so no concurrency machinery,
// no global singleton, no process hooks, no process.exit.
// ===========================================================================

/** A reusable lazy client holder plus its cleanup. */
export interface ClientHolder {
  get(): LiveClient;
  cleanup(): Promise<void>;
}

export function createClientHolder(factory: LiveClientFactory): ClientHolder {
  let client: LiveClient | null = null;
  // Set BEFORE awaiting `$disconnect` so a rejecting disconnect can never be
  // retried — the at-most-once contract holds regardless of the promise outcome.
  let disconnectStarted = false;

  return {
    get(): LiveClient {
      if (client === null) {
        client = factory();
      }
      return client;
    },
    async cleanup(): Promise<void> {
      if (client === null || disconnectStarted) return;
      disconnectStarted = true;
      await client.$disconnect();
    },
  };
}

// ===========================================================================
// G — OrchestrationDeps assembly (over injected effects only).
//
// All effectful capabilities are INJECTED (readConfigFile, getConnectionString,
// createClient, log). This module imports no fs, env, dotenv, console, Prisma, or
// PrismaPg. Lifecycle contract proved by the tests: building the deps calls
// neither the getter nor the factory; target detection uses only the getter +
// the S2B1 parser (no client); the structural preflight is the first client-
// requiring operation; preflight and apply share the one held client; cleanup
// goes through the holder. No classification happens here.
// ===========================================================================

/** The injected effects `createLiveDeps` needs (S2B2B supplies the real ones). */
export interface LiveDepsConfig {
  readConfigFile: (configPath: string) => string;
  getConnectionString: ConnectionStringGetter;
  createClient: LiveClientFactory;
  log: (line: string) => void;
}

/**
 * Assemble the S2A `OrchestrationDeps` from injected effects. Constructing the
 * returned object performs no effect: it neither reads connection metadata nor
 * constructs a client. This proves the injectable lifecycle contract S2B2B will
 * consume — it does NOT prove behavior of the future real entry.
 */
export function createLiveDeps(config: LiveDepsConfig): OrchestrationDeps {
  const holder = createClientHolder(config.createClient);
  return {
    readConfigFile: config.readConfigFile,
    detectTarget: () => detectTarget(config.getConnectionString),
    readStructuralState: () => readObservedStructuralState(holder.get()),
    withTransaction: <T>(work: (tx: ApplyTransaction) => Promise<T>): Promise<T> =>
      withBootstrapTransaction(holder.get())(work),
    cleanup: () => holder.cleanup(),
    log: config.log,
  };
}
