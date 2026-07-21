/**
 * MULTI-COURSE (dormant foundation) — W0-CAP-1: code-owned capability catalog.
 *
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env,
 * no network, no logging, no runtime side effects. Declares static metadata for
 * every canonical capability key, including the documented dependency graph.
 *
 * This is CODE-ONLY metadata. It is NOT the database `CapabilityCatalog`, does
 * NOT synchronize with any database, performs NO code<->database drift
 * detection, and provides NO capability resolution / enabled-disabled
 * evaluation / enforcement / offering-specific state. Those are later layers.
 *
 * Sources (COURSE-ARCHITECTURE-HANDOFF.md): CAP-1, CAP-3, CAP-4, CAP-5, §13.
 */
import { type CapabilityKey } from "./capability-keys";

/**
 * CORE = always-available, cannot be disabled (SCHEDULE, CONTACTS, MESSAGES).
 * OPTIONAL = per-offering (CAP-4). Classification is the code-owned preset only;
 * effective per-offering state lives in a later database layer.
 */
export type CapabilityClassification = "CORE" | "OPTIONAL";

export interface CapabilityMetadata {
  readonly key: CapabilityKey;
  readonly classification: CapabilityClassification;
  /**
   * Documented seed preset (CAP-4): CORE always on; ATTENDANCE optional
   * default-on; every other optional capability default-off. This is a static
   * preset hint only — never a runtime enabled/disabled evaluation.
   */
  readonly defaultEnabled: boolean;
  /** Parent capabilities that must be enabled for this one to be enabled (CAP-5). */
  readonly dependsOn: readonly CapabilityKey[];
}

/**
 * Exactly one entry per capability key. The mapped-type annotation forces the
 * catalog to cover every `CapabilityKey` and to reject unknown keys at compile
 * time; the test suite proves the same invariants (and the entry.key <-> key
 * consistency) at runtime, so the key set and its metadata cannot silently
 * drift apart.
 *
 * Dependency graph (CAP-5, §13, verified against the handoff):
 *   PROGRESS_RIDING          -> RIDING
 *   RIDING_HORSE_ASSIGNMENTS -> RIDING
 *   ADVANCED_INSTRUCTION     -> RIDING
 * All other capabilities are independent.
 */
export const CAPABILITY_CATALOG: {
  readonly [K in CapabilityKey]: CapabilityMetadata;
} = {
  SCHEDULE: {
    key: "SCHEDULE",
    classification: "CORE",
    defaultEnabled: true,
    dependsOn: [],
  },
  CONTACTS: {
    key: "CONTACTS",
    classification: "CORE",
    defaultEnabled: true,
    dependsOn: [],
  },
  MESSAGES: {
    key: "MESSAGES",
    classification: "CORE",
    defaultEnabled: true,
    dependsOn: [],
  },
  ATTENDANCE: {
    key: "ATTENDANCE",
    classification: "OPTIONAL",
    defaultEnabled: true,
    dependsOn: [],
  },
  DUTIES: {
    key: "DUTIES",
    classification: "OPTIONAL",
    defaultEnabled: false,
    dependsOn: [],
  },
  RIDING: {
    key: "RIDING",
    classification: "OPTIONAL",
    defaultEnabled: false,
    dependsOn: [],
  },
  PROGRESS_RIDING: {
    key: "PROGRESS_RIDING",
    classification: "OPTIONAL",
    defaultEnabled: false,
    dependsOn: ["RIDING"],
  },
  RIDING_HORSE_ASSIGNMENTS: {
    key: "RIDING_HORSE_ASSIGNMENTS",
    classification: "OPTIONAL",
    defaultEnabled: false,
    dependsOn: ["RIDING"],
  },
  ADVANCED_INSTRUCTION: {
    key: "ADVANCED_INSTRUCTION",
    classification: "OPTIONAL",
    defaultEnabled: false,
    dependsOn: ["RIDING"],
  },
  TEACHING_PRACTICE: {
    key: "TEACHING_PRACTICE",
    classification: "OPTIONAL",
    defaultEnabled: false,
    dependsOn: [],
  },
};
