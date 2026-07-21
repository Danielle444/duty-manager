/**
 * MULTI-COURSE W0-CAP-3 — capability catalog / offering-initialization OPERATOR
 * CLI (DRY-RUN default).
 *
 * ############################################################################
 * # DO NOT RUN ANY COMMAND IN THIS FILE — NOT EVEN A DRY-RUN — UNTIL THE      #
 * # SEPARATE MC-CAP-3-EXEC STAGE IS EXPLICITLY APPROVED.                      #
 * #                                                                           #
 * # Every subcommand constructs a PrismaClient and READS the database, so     #
 * # even `catalog-validate` is a live database connection. The W0-CAP-2       #
 * # migration (prisma/migrations/20260721120000_add_course_capability_layer)  #
 * # has NOT been applied at the time this file was authored; running anything #
 * # here before that migration is applied will simply fail on missing tables. #
 * ############################################################################
 *
 * This is a THIN adapter. It contains no capability business rules: every
 * decision comes from the PURE, unit-tested modules
 *   - lib/course/capabilities/capability-labels.ts   (explicit labels + preset)
 *   - lib/course/capabilities/catalog-sync-core.ts   (catalog planning)
 *   - lib/course/capabilities/offering-init-core.ts  (offering planning)
 * and this file only prints those plans and, with --apply, executes exactly the
 * writes a plan lists.
 *
 * SAFETY MODEL (mirrors scripts/backfill-*.ts precedent):
 *   - DRY-RUN is the default; every write requires --apply.
 *   - Validation subcommands are READ-ONLY and REJECT --apply.
 *   - Writing to the PRODUCTION project ref additionally requires
 *     --confirm-production=<ref> matching both the locked production ref and
 *     the ref detected from DATABASE_URL (identifyDbTarget).
 *   - Arguments are fully parsed and validated BEFORE a PrismaClient exists.
 *   - Only the redacted `identifyDbTarget().display` is printed. No connection
 *     string, password, username, token or secret is ever printed.
 *   - Any blocker refuses BEFORE a transaction opens.
 *   - Catalog writes and offering initialization NEVER share a command or a
 *     transaction.
 *   - Nothing here runs migration logic, and nothing here ever DELETEs a row or
 *     UPDATEs a label. There is deliberately no --set-label: labels are
 *     editable operational state owned by the database, and label management is
 *     future functionality outside W0-CAP-3.
 *   - `defaultEnabled` is never consulted: the legacy preset is explicit and a
 *     missing course_offering_capabilities row always means DISABLED.
 *
 * CONCURRENCY: no advisory locks and no schema changes. Each transaction
 * re-reads the state it planned against and aborts if it changed; the primary
 * key / unique index is the final backstop. A unique conflict is reported as a
 * concurrent modification and exits non-zero — it is never retried and never
 * converted into success. Re-run the dry-run and re-review the plan.
 *
 * Usage (DO NOT RUN until MC-CAP-3-EXEC is approved):
 *   npx tsx scripts/capability-admin.ts catalog-validate
 *   npx tsx scripts/capability-admin.ts catalog-sync
 *   npx tsx scripts/capability-admin.ts catalog-sync --apply
 *   npx tsx scripts/capability-admin.ts catalog-sync --reactivate=RIDING --apply
 *   npx tsx scripts/capability-admin.ts offering-validate --offering-id=<id>
 *   npx tsx scripts/capability-admin.ts offering-init \
 *     --offering-id=<id> \
 *     --expect-year-name=<ActivityYear.name> \
 *     --expect-offering-name=<CourseOffering.name> \
 *     --expect-level=<level> \
 *     [--allow-archived] [--apply] [--confirm-production=<ref>]
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  identifyDbTarget,
  PRODUCTION_PROJECT_REF,
} from "./backfill-course-offering.plan";
import {
  formatCatalogFindings,
  formatCatalogWrites,
  planCatalogSync,
  validateCatalogState,
  type CatalogRowInput,
  type CatalogSyncPlan,
} from "../lib/course/capabilities/catalog-sync-core";
import {
  checkPresetAgainstCatalog,
  disabledCapabilityKeys,
  formatOfferingFindings,
  normalizeOfferingRows,
  planLegacyOfferingInit,
  validateDependencyGraph,
  validateLegacyPreset,
  validateOfferingCapabilityState,
  type OfferingCapabilityRowInput,
} from "../lib/course/capabilities/offering-init-core";

const COMMANDS = [
  "catalog-validate",
  "catalog-sync",
  "offering-validate",
  "offering-init",
] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

interface ParsedArgs {
  command: Command | null;
  apply: boolean;
  reactivate: string[];
  offeringId: string | null;
  expectYearName: string | null;
  expectOfferingName: string | null;
  expectLevel: number | null;
  allowArchived: boolean;
  confirmProductionRef: string | null;
  errors: string[];
}

/**
 * Parse AND validate every argument. This runs before any PrismaClient is
 * constructed, so a malformed invocation can never reach a database.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    apply: false,
    reactivate: [],
    offeringId: null,
    expectYearName: null,
    expectOfferingName: null,
    expectLevel: null,
    allowArchived: false,
    confirmProductionRef: null,
    errors: [],
  };

  const [rawCommand, ...rest] = argv;
  if (rawCommand === undefined) {
    parsed.errors.push(`Missing subcommand. Expected one of: ${COMMANDS.join(", ")}`);
  } else if (!isCommand(rawCommand)) {
    parsed.errors.push(
      `Unknown subcommand ${JSON.stringify(rawCommand)}. Expected one of: ${COMMANDS.join(", ")}`,
    );
  } else {
    parsed.command = rawCommand;
  }

  const takeValue = (arg: string, prefix: string): string | null => {
    const value = arg.slice(prefix.length).trim();
    if (value.length === 0) {
      parsed.errors.push(`${prefix.slice(0, -1)} requires a non-empty value`);
      return null;
    }
    return value;
  };

  for (const arg of rest) {
    if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg === "--allow-archived") {
      parsed.allowArchived = true;
    } else if (arg.startsWith("--reactivate=")) {
      const value = takeValue(arg, "--reactivate=");
      if (value !== null) parsed.reactivate.push(value);
    } else if (arg.startsWith("--offering-id=")) {
      parsed.offeringId = takeValue(arg, "--offering-id=");
    } else if (arg.startsWith("--expect-year-name=")) {
      parsed.expectYearName = takeValue(arg, "--expect-year-name=");
    } else if (arg.startsWith("--expect-offering-name=")) {
      parsed.expectOfferingName = takeValue(arg, "--expect-offering-name=");
    } else if (arg.startsWith("--expect-level=")) {
      const raw = takeValue(arg, "--expect-level=");
      if (raw !== null) {
        const n = Number(raw);
        if (!Number.isInteger(n)) {
          parsed.errors.push(`--expect-level must be an integer, got ${JSON.stringify(raw)}`);
        } else {
          parsed.expectLevel = n;
        }
      }
    } else if (arg.startsWith("--confirm-production=")) {
      parsed.confirmProductionRef = takeValue(arg, "--confirm-production=");
    } else {
      parsed.errors.push(`Unrecognized argument: ${arg}`);
    }
  }

  // Per-command option rules.
  const command = parsed.command;
  if (command === "catalog-validate" || command === "offering-validate") {
    if (parsed.apply) {
      parsed.errors.push(`${command} is READ-ONLY and rejects --apply`);
    }
  }
  if (command !== "catalog-sync" && parsed.reactivate.length > 0) {
    parsed.errors.push("--reactivate is only valid for catalog-sync");
  }
  if (command === "catalog-validate" || command === "catalog-sync") {
    if (parsed.offeringId !== null) parsed.errors.push(`--offering-id is not valid for ${command}`);
    if (parsed.expectYearName !== null) parsed.errors.push(`--expect-year-name is not valid for ${command}`);
    if (parsed.expectOfferingName !== null) parsed.errors.push(`--expect-offering-name is not valid for ${command}`);
    if (parsed.expectLevel !== null) parsed.errors.push(`--expect-level is not valid for ${command}`);
    if (parsed.allowArchived) parsed.errors.push(`--allow-archived is not valid for ${command}`);
  }
  if (command === "offering-validate" || command === "offering-init") {
    if (parsed.offeringId === null) {
      parsed.errors.push(`${command} requires an exact --offering-id=<id>`);
    }
  }
  if (command === "offering-validate") {
    if (parsed.expectYearName !== null || parsed.expectOfferingName !== null || parsed.expectLevel !== null) {
      parsed.errors.push("offering-validate takes no --expect-* assertions (it is read-only)");
    }
    if (parsed.allowArchived) {
      parsed.errors.push("--allow-archived is not valid for the read-only offering-validate");
    }
  }
  if (command === "offering-init") {
    if (parsed.expectYearName === null) parsed.errors.push("offering-init requires --expect-year-name=<name>");
    if (parsed.expectOfferingName === null) parsed.errors.push("offering-init requires --expect-offering-name=<name>");
    if (parsed.expectLevel === null) parsed.errors.push("offering-init requires --expect-level=<level>");
  }
  if (parsed.confirmProductionRef !== null && !parsed.apply) {
    parsed.errors.push("--confirm-production is only meaningful together with --apply");
  }

  return parsed;
}

/**
 * Production write gate: writing to the locked production ref requires an
 * explicit --confirm-production=<ref> that agrees with the ref detected from
 * DATABASE_URL. Read-only commands and non-production targets skip it.
 */
function checkProductionGate(
  apply: boolean,
  detectedIsProduction: boolean,
  detectedRef: string | null,
  confirmProductionRef: string | null,
): string[] {
  if (!apply || !detectedIsProduction) return [];
  const reasons: string[] = [];
  if (confirmProductionRef === null) {
    reasons.push(
      "--apply targets the PRODUCTION project ref; --confirm-production=<ref> is required",
    );
    return reasons;
  }
  if (confirmProductionRef !== PRODUCTION_PROJECT_REF) {
    reasons.push("--confirm-production does not match the locked production project ref");
  }
  if (detectedRef !== null && confirmProductionRef !== detectedRef) {
    reasons.push("--confirm-production does not match the ref detected from DATABASE_URL");
  }
  return reasons;
}

/** Prisma unique-constraint violation (concurrent modification). */
function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Thrown when a transaction's re-read shows the state changed under us. */
class ConcurrentModificationError extends Error {}

function reportConcurrentModification(detail: string): void {
  console.error("FAILED: the capability state changed concurrently — transaction rolled back.");
  console.error(`  ${detail}`);
  console.error("  Nothing was written. Re-run the DRY-RUN, re-review the plan, then retry.");
}

// ---------------------------------------------------------------------------
// catalog-validate / catalog-sync
// ---------------------------------------------------------------------------

function printCatalogPlan(plan: CatalogSyncPlan): void {
  console.log("\n--- Catalog findings ---");
  if (plan.findings.length === 0) {
    console.log("  (none — catalog is exactly synchronized)");
  } else {
    for (const line of formatCatalogFindings(plan.findings)) console.log(`  ${line}`);
  }

  console.log("\n--- Planned catalog writes ---");
  if (plan.blocked) {
    console.log("  (none — plan is BLOCKED; zero executable writes)");
  } else if (plan.writes.length === 0) {
    console.log("  (none — no-op)");
  } else {
    for (const line of formatCatalogWrites(plan.writes)) console.log(`  ${line}`);
  }
  console.log(
    `Counts: inserts=${plan.counts.inserts} retirements=${plan.counts.retirements} ` +
      `reactivations=${plan.counts.reactivations}`,
  );
}

async function readCatalog(prisma: PrismaClient): Promise<CatalogRowInput[]> {
  const rows = await prisma.capabilityCatalog.findMany({
    select: { key: true, label: true, isActive: true },
    orderBy: { key: "asc" },
  });
  return rows.map((r) => ({ key: r.key, label: r.label, isActive: r.isActive }));
}

async function runCatalogValidate(prisma: PrismaClient): Promise<number> {
  const graphFindings = validateDependencyGraph();
  const presetFindings = validateLegacyPreset();

  console.log("\n--- Code-owned dependency graph ---");
  if (graphFindings.length === 0) {
    console.log("  OK (valid and acyclic)");
  } else {
    for (const line of formatOfferingFindings(graphFindings)) console.error(`  ${line}`);
  }

  console.log("\n--- Explicit legacy preset ---");
  if (presetFindings.length === 0) {
    console.log("  OK (complete, all ENABLED, dependency-safe)");
  } else {
    for (const line of formatOfferingFindings(presetFindings)) console.error(`  ${line}`);
  }

  const rows = await readCatalog(prisma);
  console.log(`\nCapabilityCatalog rows read: ${rows.length}`);
  const validation = validateCatalogState(rows);
  printCatalogPlan(planCatalogSync(rows));

  const ok =
    validation.ok && graphFindings.length === 0 && presetFindings.length === 0;
  console.log(
    ok
      ? "\ncatalog-validate: OK — code and CapabilityCatalog are synchronized."
      : "\ncatalog-validate: DRIFT DETECTED (fail-closed). See findings above.",
  );
  return ok ? 0 : 1;
}

async function runCatalogSync(
  prisma: PrismaClient,
  args: ParsedArgs,
): Promise<number> {
  const rows = await readCatalog(prisma);
  console.log(`\nCapabilityCatalog rows read: ${rows.length}`);
  if (args.reactivate.length > 0) {
    console.log(`Requested reactivations: ${args.reactivate.join(", ")}`);
  }

  const plan = planCatalogSync(rows, { reactivate: args.reactivate });
  printCatalogPlan(plan);

  if (plan.blocked) {
    console.error("\nREFUSED: the plan is BLOCKED — no transaction was opened.");
    for (const b of formatCatalogFindings(plan.blockers)) console.error(`  ${b}`);
    return 1;
  }

  if (!args.apply) {
    console.log("\nDRY-RUN complete — nothing was written. Re-run with --apply to execute.");
    return 0;
  }

  if (plan.isNoOp) {
    console.log("\nAPPLY: nothing to do (catalog already synchronized).");
    return 0;
  }

  try {
    const applied = await prisma.$transaction(async (tx) => {
      // Re-read INSIDE the transaction and require an identical plan: if the
      // catalog changed since the plan was printed, abort rather than write
      // something the operator never reviewed.
      const fresh = await tx.capabilityCatalog.findMany({
        select: { key: true, label: true, isActive: true },
        orderBy: { key: "asc" },
      });
      const rechecked = planCatalogSync(fresh, { reactivate: args.reactivate });
      if (
        rechecked.blocked ||
        JSON.stringify(rechecked.writes) !== JSON.stringify(plan.writes)
      ) {
        throw new ConcurrentModificationError(
          "the catalog changed between the printed plan and the transaction",
        );
      }

      let inserts = 0;
      let retirements = 0;
      let reactivations = 0;
      for (const write of plan.writes) {
        if (write.kind === "insert") {
          await tx.capabilityCatalog.create({
            data: { key: write.key, label: write.label, isActive: true },
          });
          inserts += 1;
        } else if (write.kind === "retire") {
          // isActive only. The label is never touched and the row is never deleted.
          await tx.capabilityCatalog.update({
            where: { key: write.key },
            data: { isActive: false },
          });
          retirements += 1;
        } else {
          await tx.capabilityCatalog.update({
            where: { key: write.key },
            data: { isActive: true },
          });
          reactivations += 1;
        }
      }
      return { inserts, retirements, reactivations };
    });

    console.log(
      `\nAPPLIED: inserts=${applied.inserts} retirements=${applied.retirements} ` +
        `reactivations=${applied.reactivations} (one atomic transaction).`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ConcurrentModificationError) {
      reportConcurrentModification(error.message);
      return 1;
    }
    if (isUniqueConflict(error)) {
      reportConcurrentModification(
        "a unique constraint rejected an insert (another process created the row)",
      );
      return 1;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// offering-validate / offering-init
// ---------------------------------------------------------------------------

interface OfferingIdentity {
  id: string;
  name: string;
  level: number;
  status: string;
  activityYear: { name: string };
}

async function loadOffering(
  prisma: PrismaClient,
  offeringId: string,
): Promise<OfferingIdentity | null> {
  return prisma.courseOffering.findUnique({
    where: { id: offeringId },
    select: {
      id: true,
      name: true,
      level: true,
      status: true,
      activityYear: { select: { name: true } },
    },
  });
}

/** Print the selected offering identity BEFORE any possible write. */
function printOfferingIdentity(offering: OfferingIdentity): void {
  console.log("\n--- Selected CourseOffering ---");
  console.log(`  id:             ${offering.id}`);
  console.log(`  ActivityYear:   ${offering.activityYear.name}`);
  console.log(`  Offering name:  ${offering.name}`);
  console.log(`  level:          ${offering.level}`);
  console.log(`  status:         ${offering.status}`);
}

async function readOfferingCapabilities(
  prisma: PrismaClient,
  offeringId: string,
): Promise<OfferingCapabilityRowInput[]> {
  const rows = await prisma.courseOfferingCapability.findMany({
    where: { courseOfferingId: offeringId },
    select: { capabilityKey: true, status: true },
    orderBy: { capabilityKey: "asc" },
  });
  return rows.map((r) => ({ capabilityKey: r.capabilityKey, status: r.status }));
}

async function runOfferingValidate(
  prisma: PrismaClient,
  args: ParsedArgs,
): Promise<number> {
  const offeringId = args.offeringId as string;
  const offering = await loadOffering(prisma, offeringId);
  if (!offering) {
    console.error(`REFUSED: no CourseOffering with id ${JSON.stringify(offeringId)}.`);
    return 1;
  }
  printOfferingIdentity(offering);

  const [catalog, rows] = await Promise.all([
    readCatalog(prisma),
    readOfferingCapabilities(prisma, offeringId),
  ]);

  const result = validateOfferingCapabilityState(rows, catalog);
  const { statusByKey } = normalizeOfferingRows(rows);

  console.log("\n--- Saved capability state ---");
  if (result.effective.length === 0) {
    console.log("  (no rows — EVERY capability is DISABLED by absence)");
  } else {
    for (const row of result.effective) console.log(`  ${row.key}: ${row.status}`);
  }
  const disabled = disabledCapabilityKeys(statusByKey);
  console.log(
    `  DISABLED by absence (${disabled.length}): ${disabled.length > 0 ? disabled.join(", ") : "(none)"}`,
  );

  console.log("\n--- Validation findings ---");
  if (result.findings.length === 0) {
    console.log("  (none)");
  } else {
    for (const line of formatOfferingFindings(result.findings)) console.log(`  ${line}`);
  }

  // Informational: how this offering compares to the approved legacy preset.
  const initPlan = planLegacyOfferingInit(rows);
  console.log(`\nLegacy-preset initialization state: ${initPlan.state}`);

  console.log(
    result.ok
      ? "\noffering-validate: OK — saved state is consistent and dependency-safe."
      : "\noffering-validate: PROBLEMS DETECTED. See findings above.",
  );
  return result.ok ? 0 : 1;
}

async function runOfferingInit(
  prisma: PrismaClient,
  args: ParsedArgs,
): Promise<number> {
  const offeringId = args.offeringId as string;
  const offering = await loadOffering(prisma, offeringId);
  if (!offering) {
    console.error(`REFUSED: no CourseOffering with id ${JSON.stringify(offeringId)}.`);
    return 1;
  }
  printOfferingIdentity(offering);

  // GATE 1: exact identity assertions. Never "the first"/"the only" offering.
  const identityMismatches: string[] = [];
  if (offering.activityYear.name !== args.expectYearName) {
    identityMismatches.push(
      `ActivityYear name is ${JSON.stringify(offering.activityYear.name)}, expected ${JSON.stringify(args.expectYearName)}`,
    );
  }
  if (offering.name !== args.expectOfferingName) {
    identityMismatches.push(
      `offering name is ${JSON.stringify(offering.name)}, expected ${JSON.stringify(args.expectOfferingName)}`,
    );
  }
  if (offering.level !== args.expectLevel) {
    identityMismatches.push(`level is ${offering.level}, expected ${args.expectLevel}`);
  }
  if (identityMismatches.length > 0) {
    console.error("REFUSED: selected offering does not match the expected identity:");
    for (const m of identityMismatches) console.error(`  - ${m}`);
    return 1;
  }
  console.log("Identity assertions: PASSED.");

  // GATE 2: archived offerings are frozen (CAP-7) unless explicitly allowed.
  if (offering.status === "ARCHIVED" && !args.allowArchived) {
    console.error(
      "REFUSED: the offering is ARCHIVED (frozen configuration). Pass --allow-archived " +
        "only if this is deliberate; it does not weaken any identity check.",
    );
    return 1;
  }
  if (offering.status === "ARCHIVED") {
    console.log("WARNING: proceeding against an ARCHIVED offering (--allow-archived given).");
  }

  // GATE 3: the explicit preset itself must be complete and dependency-safe.
  const presetFindings = validateLegacyPreset();
  const graphFindings = validateDependencyGraph();
  if (presetFindings.length > 0 || graphFindings.length > 0) {
    console.error("REFUSED: the code-owned preset/dependency graph is invalid:");
    for (const line of formatOfferingFindings([...presetFindings, ...graphFindings])) {
      console.error(`  ${line}`);
    }
    return 1;
  }

  // GATE 4: every preset key must exist in CapabilityCatalog and be ACTIVE.
  const catalog = await readCatalog(prisma);
  const catalogFindings = checkPresetAgainstCatalog(catalog);
  if (catalogFindings.length > 0) {
    console.error("REFUSED: CapabilityCatalog is not ready for initialization:");
    for (const line of formatOfferingFindings(catalogFindings)) console.error(`  ${line}`);
    console.error("  Run `capability-admin catalog-sync` first (a SEPARATE command).");
    return 1;
  }
  console.log("Catalog gate: PASSED (all ten preset capabilities exist and are active).");

  // GATE 5: the State A–E plan.
  const rows = await readOfferingCapabilities(prisma, offeringId);
  const plan = planLegacyOfferingInit(rows);

  console.log(`\n--- Initialization plan (state ${plan.state}) ---`);
  if (plan.findings.length === 0) {
    console.log("  findings: (none)");
  } else {
    for (const line of formatOfferingFindings(plan.findings)) console.log(`  ${line}`);
  }
  console.log(`  existing rows:  ${plan.detected.existing.length}`);
  console.log(`  missing rows:   ${plan.detected.missing.length}`);
  console.log(`  status mismatch:${plan.detected.mismatched.length}`);
  console.log(`  unexpected rows:${plan.detected.unexpected.length}`);
  console.log(`  planned inserts:${plan.writes.length}`);

  if (plan.blocked) {
    console.error(
      "\nREFUSED: initialization is BLOCKED — zero writes planned. This command never " +
        "repairs a partial state, never overwrites a status, and never deletes a row.",
    );
    return 1;
  }

  if (plan.state === "B") {
    console.log("\nAlready initialized to the exact approved preset — successful no-op.");
    return 0;
  }

  for (const write of plan.writes) {
    console.log(`  INSERT ${write.capabilityKey} status=${write.status}`);
  }

  if (!args.apply) {
    console.log("\nDRY-RUN complete — nothing was written. Re-run with --apply to execute.");
    return 0;
  }

  try {
    const inserted = await prisma.$transaction(async (tx) => {
      // Re-read INSIDE the transaction: State A must still hold.
      const existing = await tx.courseOfferingCapability.count({
        where: { courseOfferingId: offeringId },
      });
      if (existing !== 0) {
        throw new ConcurrentModificationError(
          `the offering now has ${existing} capability row(s); it is no longer State A`,
        );
      }
      const result = await tx.courseOfferingCapability.createMany({
        data: plan.writes.map((w) => ({
          courseOfferingId: offeringId,
          capabilityKey: w.capabilityKey,
          status: w.status,
        })),
      });
      return result.count;
    });

    console.log(
      `\nAPPLIED: ${inserted} course_offering_capabilities row(s) inserted in one ` +
        "atomic transaction (no catalog write was part of this transaction).",
    );
    return inserted === plan.writes.length ? 0 : 1;
  } catch (error) {
    if (error instanceof ConcurrentModificationError) {
      reportConcurrentModification(error.message);
      return 1;
    }
    if (isUniqueConflict(error)) {
      reportConcurrentModification(
        "a unique constraint rejected an insert (another process initialized this offering)",
      );
      return 1;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log("=== MULTI-COURSE W0-CAP-3 capability admin ===");
  if (args.errors.length > 0) {
    for (const e of args.errors) console.error(`REFUSED: ${e}`);
    process.exitCode = 1;
    return;
  }
  const command = args.command as Command;

  const target = identifyDbTarget(process.env.DATABASE_URL);
  const writes = args.apply;
  console.log(`Subcommand:      ${command}`);
  console.log(`Execution mode:  ${writes ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}`);
  // Redacted target only — never the connection string or any credential.
  console.log(`Database target: ${target.display}`);

  const productionReasons = checkProductionGate(
    args.apply,
    target.isProduction,
    target.projectRef,
    args.confirmProductionRef,
  );
  if (productionReasons.length > 0) {
    console.error("REFUSED: production write confirmation failed:");
    for (const r of productionReasons) console.error(`  - ${r}`);
    process.exitCode = 1;
    return;
  }
  if (args.apply && target.isProduction) {
    console.log("Production confirmation: PASSED.");
  }

  // Arguments are fully validated above — only now is a client constructed.
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    let code: number;
    if (command === "catalog-validate") {
      code = await runCatalogValidate(prisma);
    } else if (command === "catalog-sync") {
      code = await runCatalogSync(prisma, args);
    } else if (command === "offering-validate") {
      code = await runOfferingValidate(prisma, args);
    } else {
      code = await runOfferingInit(prisma, args);
    }
    if (code !== 0) process.exitCode = code;
  } catch (error) {
    // Never surface a connection string or credential from an unexpected error.
    console.error(`${command} failed unexpectedly.`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
