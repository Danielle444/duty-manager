/**
 * MC-BOOTSTRAP-S2B2B — executable tests for the import-safe CLI entry
 * (bootstrap-isolated-instance.entry.ts).
 *
 * Run with:
 *   npx tsx --test scripts/bootstrap-isolated-instance.entry.test.ts
 *
 * DB-FREE: no real database, no real PrismaClient, no Supabase, no network. The
 * entry is exercised through injected fakes (a fake runner + a no-op deps), never
 * by launching it as a subprocess (which could reach the real client path) and
 * never by manipulating a real DATABASE_URL. All mutated global state
 * (process.exitCode) is restored.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  runEntry,
  applyExitCode,
  isDirectRun,
  buildLiveDepsConfig,
  type BootstrapRunner,
} from "./bootstrap-isolated-instance.entry";
import type { OrchestrationDeps } from "./bootstrap-isolated-instance";
import type { ObservedStructuralState } from "./bootstrap-isolated-instance.plan";

// Captured at module load (after the entry module was imported) — importing the
// entry must not have set an exit code.
const INITIAL_EXIT_CODE = process.exitCode;

const EMPTY_OBSERVED: ObservedStructuralState = {
  activityYears: [],
  courseOfferings: [],
  courseGroups: [],
  capabilityCatalog: [],
  offeringCapabilities: [],
};

/** A complete no-op OrchestrationDeps with a spied cleanup. The entry must never
 * invoke any of these itself — S2A (through S2B2A) owns them. */
function makeSpyDeps(): { deps: OrchestrationDeps; cleanupCount: () => number; logLines: string[] } {
  let cleanups = 0;
  const logLines: string[] = [];
  const deps: OrchestrationDeps = {
    readConfigFile: () => "",
    detectTarget: () => ({ detectedProjectRef: null }),
    readStructuralState: async () => EMPTY_OBSERVED,
    withTransaction: async (work) =>
      work({ readFresh: async () => EMPTY_OBSERVED, writeBootstrap: async () => {} }),
    cleanup: async () => {
      cleanups += 1;
    },
    log: (line) => logLines.push(line),
  };
  return { deps, cleanupCount: () => cleanups, logLines };
}

function withExitCode(run: () => void): void {
  const saved = process.exitCode;
  try {
    run();
  } finally {
    process.exitCode = saved;
  }
}

// --- 1. Import safety --------------------------------------------------------

test("importing the entry module sets no exit code", () => {
  assert.equal(INITIAL_EXIT_CODE, undefined);
});

test("building the deps config is lazy: no client is constructed, effects are thunks", () => {
  const config = buildLiveDepsConfig();
  // createClient is a thunk that is NOT invoked by building the config (calling it
  // would construct a real PrismaClient — this suite never does).
  assert.equal(typeof config.createClient, "function");
  assert.equal(typeof config.getConnectionString, "function");
  assert.equal(typeof config.readConfigFile, "function");
  assert.equal(typeof config.log, "function");
});

// --- 2. CLI-argument forwarding ---------------------------------------------

test("runEntry forwards the exact argv once, without re-slicing or re-parsing", async () => {
  const argv = Object.freeze(["--config", "cfg", "--expected-target-ref", "ref", "--apply"]);
  const { deps } = makeSpyDeps();
  let received: readonly string[] | null = null;
  let calls = 0;
  const runner: BootstrapRunner = async (a) => {
    received = a;
    calls += 1;
    return 0;
  };
  await runEntry(argv, deps, runner);
  assert.equal(calls, 1);
  // Same reference: the helper neither slices nor copies the argv.
  assert.equal(received, argv);
});

test("runEntry returns the runner's numeric exit code unchanged", async () => {
  const { deps } = makeSpyDeps();
  const runner: BootstrapRunner = async () => 2;
  const code = await runEntry([], deps, runner);
  assert.equal(code, 2);
});

// --- 3. Exit-code application ------------------------------------------------

test("applyExitCode assigns a non-zero code", () => {
  withExitCode(() => {
    process.exitCode = undefined;
    applyExitCode(1);
    assert.equal(process.exitCode, 1);
    applyExitCode(2);
    assert.equal(process.exitCode, 2);
  });
});

test("applyExitCode(0) does not overwrite an existing non-zero exit code", () => {
  withExitCode(() => {
    process.exitCode = 7;
    applyExitCode(0);
    assert.equal(process.exitCode, 7);
  });
});

// --- 4. Dependency ownership -------------------------------------------------

test("runEntry invokes orchestration exactly once and adds no cleanup", async () => {
  const { deps, cleanupCount, logLines } = makeSpyDeps();
  let calls = 0;
  const runner: BootstrapRunner = async () => {
    calls += 1;
    return 0;
  };
  await runEntry(["--config", "x"], deps, runner);
  assert.equal(calls, 1);
  // The entry does not call cleanup/$disconnect or log on its own — S2A owns them.
  assert.equal(cleanupCount(), 0);
  assert.deepEqual(logLines, []);
});

test("entry source duplicates no target-safety policy and no cleanup/disconnect", () => {
  const src = readFileSync(new URL("./bootstrap-isolated-instance.entry.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "decideTargetSafety",
    "parseSupabaseProjectRef",
    "identifyDbTarget",
    "isProduction",
    "$disconnect",
    "confirm-production",
  ]) {
    assert.ok(!src.includes(forbidden), `entry must not reference ${forbidden}`);
  }
});

// --- 5. Secret safety --------------------------------------------------------

test("entry source logs no raw error and no stack/serialized error", () => {
  const src = readFileSync(new URL("./bootstrap-isolated-instance.entry.ts", import.meta.url), "utf8");
  for (const forbidden of ["console.error", ".stack", "JSON.stringify", "console.log(error"]) {
    assert.ok(!src.includes(forbidden), `entry must not contain ${forbidden}`);
  }
});

// --- 6. Direct-run detection -------------------------------------------------

test("isDirectRun is true only when the module URL matches the entry path", () => {
  const p = "/some/dir/bootstrap-isolated-instance.entry.ts";
  const href = pathToFileURL(p).href;
  assert.equal(isDirectRun(href, p), true);
  assert.equal(isDirectRun("file:///some/other/module.ts", p), false);
});

test("isDirectRun uses pathToFileURL (Windows-style path round-trips)", () => {
  const winPath = "C:\\proj\\scripts\\bootstrap-isolated-instance.entry.ts";
  assert.equal(isDirectRun(pathToFileURL(winPath).href, winPath), true);
});

test("isDirectRun fails closed on a missing or empty entry path", () => {
  assert.equal(isDirectRun("file:///anything", undefined), false);
  assert.equal(isDirectRun("file:///anything", ""), false);
});
