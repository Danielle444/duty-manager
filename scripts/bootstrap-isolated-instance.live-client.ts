/**
 * MC-BOOTSTRAP-S2B2B — REAL Prisma construction boundary + narrow, cast-free
 * forwarding bridge for the isolated-instance bootstrap runner. This is the ONLY
 * bootstrap module that imports the generated Prisma client, and it satisfies the
 * committed S2B2A `LiveClient` contract without any `any`, `as unknown as`, broad
 * cast, or suppression — the file type-checking against the real generated types
 * (and `createLiveClient` constructing a real `PrismaClient` and handing it to
 * `makeLiveClient`) is exactly the compatibility proof the S2B2B audit deferred to
 * implementation-time `tsc`.
 *
 * IMPORT-SAFE: importing this module constructs NO Prisma client and performs no
 * I/O, env read, or network. A real client is created ONLY when `createLiveClient`
 * runs, and that happens ONLY through S2B2A's injected, lazy `createClient`
 * callback (the `ClientHolder`), never at import time.
 *
 * SCOPE (S2B2B only): construct a fresh `PrismaClient` over `@prisma/adapter-pg`
 * using the repository's established one-shot pattern (never the `lib/prisma.ts`
 * application singleton), and forward EXACTLY the five structural reads, five
 * structural writes, one interactive transaction, and one disconnect that S2B2A
 * requires. It owns NO CLI parsing, target-safety, classification, apply policy,
 * reporting, retry, error-code interpretation, or cleanup policy — those live in
 * S1 / S2A / S2B1 / S2B2A and are reused, never duplicated. No upsert/update/
 * delete/nested-write/default-injection/extra-read is introduced.
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type {
  LiveClient,
  StructuralClient,
  TransactionOwner,
  Disconnectable,
} from "./bootstrap-isolated-instance.live";

// ===========================================================================
// The narrow read/write + transaction + disconnect host the bridge consumes.
//
// Expressed ENTIRELY in the committed S2B2A contracts (`StructuralClient` for the
// five reads/writes, `TransactionOwner` for the interactive transaction,
// `Disconnectable` for disconnect) — never the broad generated `PrismaClient`.
// The generated `PrismaClient` provably satisfies this host: that proof lives at
// the single spot where `createLiveClient` hands a freshly-constructed real client
// to `makeLiveClient` (checked by `tsc`). Because the host is this narrow, a plain
// DB-free test double can satisfy it WITHOUT any cast, which is why the bridge is
// honestly testable. This is the only place real Prisma types meet the S2B2A
// contract, and it is a structural (cast-free) meeting.
// ===========================================================================

export type LiveClientHost = StructuralClient & TransactionOwner & Disconnectable;

// ===========================================================================
// A — The shared narrow structural forwarder (read + write surface).
//
// Builds the committed S2B2A `StructuralClient` from a narrow read/write host.
// The parameter is the S2B2A `StructuralClient` contract itself, which the outer
// `PrismaClient` and the transaction-scoped client both structurally satisfy, so
// this ONE helper serves BOTH the outer preflight read surface (via
// `makeLiveClient`) and the transaction-scoped read/write surface (via the
// wrapped `$transaction`), exactly as the audit's minimal-scope design intended.
//
// Each closure forwards a single delegate call with the exact received arguments.
// Reads return the delegate's result directly (the S2B1 row type). ID-returning
// writes await and project to `{ id }` (the only value S2B2A consumes) — this
// projection still extracts `.id` from whatever the real generated `create`
// resolves to at runtime. Ignored writes await and return nothing. No extra
// operation, no default injection, no error interpretation.
// ===========================================================================

function makeStructuralClient(db: StructuralClient): StructuralClient {
  return {
    activityYear: {
      findMany: (args) => db.activityYear.findMany(args),
      create: async (args) => {
        const created = await db.activityYear.create({ data: args.data });
        return { id: created.id };
      },
    },
    courseOffering: {
      findMany: (args) => db.courseOffering.findMany(args),
      create: async (args) => {
        const created = await db.courseOffering.create({ data: args.data });
        return { id: created.id };
      },
    },
    courseGroup: {
      findMany: (args) => db.courseGroup.findMany(args),
      create: async (args) => {
        const created = await db.courseGroup.create({ data: args.data });
        return { id: created.id };
      },
    },
    capabilityCatalog: {
      findMany: (args) => db.capabilityCatalog.findMany(args),
      // Ignored result: S2B2A never consumes an id here (the catalog key is the
      // primary key). Await only for atomic ordering inside the transaction.
      create: async (args) => {
        await db.capabilityCatalog.create({ data: args.data });
      },
    },
    courseOfferingCapability: {
      findMany: (args) => db.courseOfferingCapability.findMany(args),
      create: async (args) => {
        await db.courseOfferingCapability.create({ data: args.data });
      },
    },
  };
}

// ===========================================================================
// B — The outer `LiveClient` bridge (reads + interactive transaction + disconnect).
//
// Reads reuse `makeStructuralClient(client)` (a `StructuralClient` is a superset
// of the read-only `StructuralReader` the outer client needs). `$transaction`
// requests the real interactive transaction and wraps the transaction-scoped
// client `tx` in a FRESH narrow `StructuralClient` — so S2B2A's callback reads
// and writes through the transaction client, NEVER the outer one. `$disconnect`
// forwards to the outer client only (the transaction client is never disconnected
// here, matching S2B2A's at-most-once outer-disconnect contract).
// ===========================================================================

export function makeLiveClient(client: LiveClientHost): LiveClient {
  const structural = makeStructuralClient(client);
  return {
    activityYear: structural.activityYear,
    courseOffering: structural.courseOffering,
    courseGroup: structural.courseGroup,
    capabilityCatalog: structural.capabilityCatalog,
    courseOfferingCapability: structural.courseOfferingCapability,
    $transaction(fn, options) {
      return client.$transaction((tx) => fn(makeStructuralClient(tx)), options);
    },
    $disconnect() {
      return client.$disconnect();
    },
  };
}

// ===========================================================================
// C — The real-client factory (S2B2A `LiveClientFactory`).
//
// Constructs a FRESH `PrismaClient` over `@prisma/adapter-pg` using the
// established one-shot script pattern and the canonical `DATABASE_URL` variable
// NAME (its value is never read, logged, or transformed here). Deliberately does
// NOT import or reuse `lib/prisma.ts`: that application singleton memoizes on
// `globalThis` in non-production and never disconnects, which is wrong for a
// one-shot CLI that must own a disposable, explicitly-`$disconnect`ed client.
//
// This function is invoked ONLY through S2B2A's lazy `createClient` callback, so
// no client is constructed at import time. Its body is where `tsc` proves the
// real generated `PrismaClient` satisfies the S2B2A `LiveClient` contract.
// ===========================================================================

export function createLiveClient(): LiveClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const client = new PrismaClient({ adapter });
  return makeLiveClient(client);
}
