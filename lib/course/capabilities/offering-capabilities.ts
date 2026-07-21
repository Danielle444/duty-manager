/**
 * MULTI-COURSE (dormant foundation) — Stage 1: minimal server-side reader for
 * effective per-offering capabilities.
 *
 * Server-side only: it reads through the shared Prisma client and delegates the
 * ENTIRE decision to the PURE core (effective-capability-core.ts), so this file
 * stays a thin, un-tested-by-design IO shell (same convention as
 * current-offering.ts).
 *
 * DORMANT: this module has ZERO runtime consumers in this stage. Nothing under
 * app/ or lib/actions imports it. The first consumer (the CONTACTS gate) is a
 * SEPARATE, later, separately-approved stage and is not wired here.
 *
 * PUBLIC CONTRACT (drift visibility): getEffectiveCapabilities returns ONLY the
 * exhaustive Record<CapabilityKey, EffectiveCapabilityStatus>. The pure core's
 * internal diagnostic ("drift") half is deliberately DISCARDED here — it is not
 * returned, not logged, and not exposed through any additional accessor. Drift
 * never reaches a runtime or user-facing path in Stage 1.
 *
 * CACHING — deliberately OMITTED (hard evidence gate, AGENTS.md). The repo-local
 * Next.js 16.2.10 docs scope React `cache()` deduplication to a single RENDER
 * PASS / "across different parts of a request"
 * (02-guides/caching-without-cache-components.md "Deduplicating requests";
 * 02-guides/data-security.md), and the same guide notes a Server Action is a
 * "separate entry point". They do NOT affirmatively establish per-request
 * deduplication DURING SERVER ACTION EXECUTION, which is the planned first
 * caller's context. Per the gate, caching is omitted rather than assumed: this
 * reader issues two direct findMany reads per call. A future stage may add
 * request-scoped caching only once its scope is proven for every real caller.
 */
import { prisma } from "@/lib/prisma";
import { type CapabilityKey } from "./capability-keys";
import {
  resolveEffectiveCapabilitiesFromRows,
  type EffectiveCapabilityStatus,
} from "./effective-capability-core";

/**
 * Resolve the effective status of every canonical capability for one offering.
 * The `courseOfferingId` must originate from a server-owned resolver
 * (resolveCurrentCourseOffering / requireAdminCourseOffering) — never from a
 * client-supplied value. A database failure propagates unchanged (no default
 * map, no cached-last-known, no preset fallback).
 */
export async function getEffectiveCapabilities(
  courseOfferingId: string,
): Promise<Record<CapabilityKey, EffectiveCapabilityStatus>> {
  const [offeringRows, catalogRows] = await Promise.all([
    prisma.courseOfferingCapability.findMany({
      where: { courseOfferingId },
      select: { capabilityKey: true, status: true },
    }),
    prisma.capabilityCatalog.findMany({
      select: { key: true, isActive: true },
    }),
  ]);
  const { effective } = resolveEffectiveCapabilitiesFromRows(offeringRows, catalogRows);
  return effective;
}
