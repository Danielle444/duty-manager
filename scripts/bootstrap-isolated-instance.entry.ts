/**
 * MC-BOOTSTRAP-S2B2B — IMPORT-SAFE direct CLI entry for the isolated-instance
 * bootstrap runner. It assembles the approved live effects and invokes the
 * committed S2A orchestration ONCE, but ONLY when this file is executed directly.
 *
 * IMPORT-SAFE: importing this module runs nothing that connects, applies, reads a
 * bootstrap config file, constructs a Prisma client, logs, or mutates
 * `process.exitCode`. All of that is gated behind `isDirectRun`, which is false
 * during import and tests. `import "dotenv/config"` (the established one-shot
 * convention) only populates `process.env`; it does not read `DATABASE_URL` or
 * connect.
 *
 * POLICY BOUNDARY: this entry owns NO CLI parsing, target parsing, expected/
 * detected comparison, production denial, structural classification, apply
 * policy, retry, reporting, exit-code derivation, or cleanup — all of that is
 * S1/S2A/S2B1/S2B2A. The entry only: reads the config file as UTF-8, exposes the
 * raw `DATABASE_URL` getter (never inspecting its value), lazily constructs the
 * real client via the S2B2B factory, forwards already-redacted S2A report lines,
 * calls `runBootstrapOrchestration` once, and applies its numeric exit code.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  createLiveDeps,
  type LiveDepsConfig,
} from "./bootstrap-isolated-instance.live";
import {
  runBootstrapOrchestration,
  EXIT,
  type OrchestrationDeps,
} from "./bootstrap-isolated-instance";
import { createLiveClient } from "./bootstrap-isolated-instance.live-client";

/**
 * The exact `LiveDepsConfig` S2B2A's `createLiveDeps` consumes. Building it
 * performs no effect: `createClient` is a lazy thunk (the real client is
 * constructed only when S2B2A first needs it), and `getConnectionString` returns
 * the raw `DATABASE_URL` untouched — parsing stays in S2B1, target-safety in S2A.
 */
export function buildLiveDepsConfig(): LiveDepsConfig {
  return {
    readConfigFile: (configPath) => readFileSync(configPath, "utf8"),
    getConnectionString: () => process.env.DATABASE_URL,
    createClient: () => createLiveClient(),
    // Forward ONLY S2A's already-structured, redacted report lines. Never a raw
    // error, connection string, or secret — the entry adds no logging of its own.
    log: (line) => console.log(line),
  };
}

/** The injectable runner seam (defaults to the committed S2A orchestration). */
export type BootstrapRunner = (
  argv: readonly string[],
  deps: OrchestrationDeps,
) => Promise<number>;

/**
 * Testable entry core: forward the ALREADY-sliced argv and the assembled deps to
 * the runner exactly once and return its numeric exit code. It re-slices nothing,
 * re-parses nothing, duplicates no S2A policy, and adds no cleanup/disconnect —
 * S2A (through S2B2A) owns cleanup on every path.
 */
export function runEntry(
  argv: readonly string[],
  deps: OrchestrationDeps,
  runner: BootstrapRunner = runBootstrapOrchestration,
): Promise<number> {
  return runner(argv, deps);
}

/** Apply an orchestration exit code the same way S2A does: never overwrite an
 * existing `process.exitCode` with a success (0); assign any non-zero code. */
export function applyExitCode(code: number): void {
  if (code !== 0) process.exitCode = code;
}

/**
 * True only when this module is the process entry point. Windows-safe via
 * `pathToFileURL`, and fail-closed to "not direct" on a missing/empty
 * `process.argv[1]` or any URL-construction error.
 */
export function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  if (typeof entryPath !== "string" || entryPath.length === 0) return false;
  try {
    return moduleUrl === pathToFileURL(entryPath).href;
  } catch {
    return false;
  }
}

// ===========================================================================
// Import-safe direct-entry gate. Runs ONLY when this file is the invoked module.
// It slices argv exactly once, assembles the live deps, invokes S2A once, and
// applies the returned code through `process.exitCode` (never `process.exit()`).
// The rejection branch mirrors the committed S2A convention (bootstrap-isolated-
// instance.ts): a fixed non-zero code, no raw-error logging. S2A never rejects in
// practice (it catches internally and returns a code); this branch is purely
// defensive and discloses nothing.
// ===========================================================================

if (isDirectRun(import.meta.url, process.argv[1])) {
  const deps = createLiveDeps(buildLiveDepsConfig());
  void runEntry(process.argv.slice(2), deps).then(
    (code) => applyExitCode(code),
    () => {
      process.exitCode = EXIT.STOP;
    },
  );
}
