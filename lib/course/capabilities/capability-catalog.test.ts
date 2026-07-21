/**
 * W0-CAP-1 — executable invariant tests for the PURE capability key set and the
 * code-owned capability catalog.
 *
 * Run with: npx tsx --test lib/course/capabilities/capability-catalog.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 *
 * SCOPE OF PROOF: these tests prove INTERNAL consistency of the code-defined
 * structures only — key uniqueness, key<->metadata coverage, dependency
 * validity, acyclicity, and the documented RIDING edges. They do NOT prove any
 * code<->database drift property: no database catalog exists at this layer.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_KEYS,
  isCapabilityKey,
  type CapabilityKey,
} from "./capability-keys";
import {
  CAPABILITY_CATALOG,
  type CapabilityMetadata,
} from "./capability-catalog";

const KEY_SET = new Set<string>(CAPABILITY_KEYS);
const catalogKeys: string[] = Object.keys(CAPABILITY_CATALOG);
const entries: CapabilityMetadata[] = Object.values(CAPABILITY_CATALOG);

// 1. capability keys are unique
test("capability keys are unique", () => {
  assert.equal(KEY_SET.size, CAPABILITY_KEYS.length);
});

// 2. every key has exactly one catalog entry
test("every capability key has exactly one catalog entry", () => {
  assert.equal(catalogKeys.length, CAPABILITY_KEYS.length);
  for (const key of CAPABILITY_KEYS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(CAPABILITY_CATALOG, key),
      `missing catalog entry for ${key}`,
    );
  }
});

// 3. the catalog contains no unknown entries
test("catalog contains no unknown keys", () => {
  for (const key of catalogKeys) {
    assert.ok(isCapabilityKey(key), `unknown catalog key: ${key}`);
    assert.ok(KEY_SET.has(key));
  }
});

// 4. required metadata is present and internally valid
test("each entry has valid, internally consistent metadata", () => {
  for (const key of CAPABILITY_KEYS) {
    const meta = CAPABILITY_CATALOG[key];
    assert.equal(meta.key, key, `entry.key mismatch for ${key}`);
    assert.ok(
      meta.classification === "CORE" || meta.classification === "OPTIONAL",
      `invalid classification for ${key}`,
    );
    assert.equal(typeof meta.defaultEnabled, "boolean");
    assert.ok(Array.isArray(meta.dependsOn));
    // CORE is always-available: default-enabled and dependency-free (CAP-4).
    if (meta.classification === "CORE") {
      assert.equal(
        meta.defaultEnabled,
        true,
        `CORE ${key} must be default-enabled`,
      );
      assert.equal(
        meta.dependsOn.length,
        0,
        `CORE ${key} must have no dependencies`,
      );
    }
  }
});

// 5. every dependency references a known capability
test("every dependency references a known capability", () => {
  for (const meta of entries) {
    for (const dep of meta.dependsOn) {
      assert.ok(isCapabilityKey(dep), `${meta.key} depends on unknown ${dep}`);
      assert.ok(
        Object.prototype.hasOwnProperty.call(CAPABILITY_CATALOG, dep),
        `${meta.key} depends on uncatalogued ${dep}`,
      );
    }
  }
});

// 6. a capability cannot depend on itself
test("no capability depends on itself", () => {
  for (const meta of entries) {
    assert.ok(
      !meta.dependsOn.includes(meta.key),
      `${meta.key} depends on itself`,
    );
  }
});

// 7. the dependency graph contains no cycles
test("dependency graph is acyclic", () => {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<CapabilityKey, number>();
  for (const key of CAPABILITY_KEYS) color.set(key, WHITE);

  const visit = (key: CapabilityKey, path: CapabilityKey[]): void => {
    color.set(key, GRAY);
    for (const dep of CAPABILITY_CATALOG[key].dependsOn) {
      const depColor = color.get(dep);
      if (depColor === GRAY) {
        assert.fail(`cycle detected: ${[...path, key, dep].join(" -> ")}`);
      }
      if (depColor === WHITE) visit(dep, [...path, key]);
    }
    color.set(key, BLACK);
  };

  for (const key of CAPABILITY_KEYS) {
    if (color.get(key) === WHITE) visit(key, []);
  }
});

// 8. the documented RIDING dependency relationships are represented exactly
test("documented RIDING dependency graph is represented exactly", () => {
  assert.deepEqual([...CAPABILITY_CATALOG.PROGRESS_RIDING.dependsOn], ["RIDING"]);
  assert.deepEqual(
    [...CAPABILITY_CATALOG.RIDING_HORSE_ASSIGNMENTS.dependsOn],
    ["RIDING"],
  );
  assert.deepEqual(
    [...CAPABILITY_CATALOG.ADVANCED_INSTRUCTION.dependsOn],
    ["RIDING"],
  );
  assert.deepEqual([...CAPABILITY_CATALOG.RIDING.dependsOn], []);

  // Exactly these three capabilities depend on RIDING, and the whole graph has
  // exactly three edges — nothing else declares a dependency.
  const ridingDependants = entries
    .filter((m) => m.dependsOn.includes("RIDING"))
    .map((m) => m.key)
    .sort();
  assert.deepEqual(ridingDependants, [
    "ADVANCED_INSTRUCTION",
    "PROGRESS_RIDING",
    "RIDING_HORSE_ASSIGNMENTS",
  ]);
  const totalEdges = entries.reduce((n, m) => n + m.dependsOn.length, 0);
  assert.equal(totalEdges, 3, "graph must contain exactly the three documented edges");
});

// (supporting) documented presets: the CORE set and ATTENDANCE default-on
test("core set and ATTENDANCE default-on preset match the handoff", () => {
  const core = entries
    .filter((m) => m.classification === "CORE")
    .map((m) => m.key)
    .sort();
  assert.deepEqual(core, ["CONTACTS", "MESSAGES", "SCHEDULE"]);
  assert.equal(CAPABILITY_CATALOG.ATTENDANCE.defaultEnabled, true);
});

// 9. the key and metadata structures cannot silently drift apart
test("key set and catalog cannot silently drift apart", () => {
  assert.deepEqual([...catalogKeys].sort(), [...CAPABILITY_KEYS].sort());
  for (const key of CAPABILITY_KEYS) {
    assert.equal(
      CAPABILITY_CATALOG[key].key,
      key,
      `property key and entry.key disagree for ${key}`,
    );
  }
});
