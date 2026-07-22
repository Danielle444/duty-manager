/**
 * ATT-3W — server-only current-offering ATTENDANCE capability composition.
 *
 * The SINGLE parameterless, server-owned path that turns "the current course
 * offering" into an attendance {@link AttendanceCapabilityAccess} decision. It
 * exists so every wired attendance consumer derives CourseOffering attendance
 * access from the exact same server-resolved offering identity: no consumer
 * composes resolveCurrentCourseOffering() + resolveAttendanceCapabilityAccess()
 * itself, and no client-supplied offering identity can ever become
 * authorization (this accepts NO parameters at all).
 *
 * Server-side only: `import "server-only"` (the repository's existing
 * server-only convention, used by attendance-capability-resolver.ts /
 * offering-capabilities.ts / current-offering.ts) makes an accidental client
 * import a build error. It is deliberately NOT a Server Action (no "use server"
 * directive), so it is never registered as a public, unauthenticated entry
 * point, and it is not re-exported through any client-compatible barrel.
 *
 * It is the smallest possible IO composition of two already-built server pieces
 * and adds NO decision of its own:
 *   1. resolveCurrentCourseOffering()  — the canonical singleton current-offering
 *      resolver (throws NoCurrent / Ambiguous / IncompleteCourseOfferingError; it
 *      never uses findFirst and never silently selects one of several);
 *   2. resolveAttendanceCapabilityAccess(offering) — the ATT-2 resolver, which
 *      loads that trusted offering's effective ATTENDANCE status and delegates
 *      the ENABLED / READ_ONLY / DISABLED mapping to the ATT-1 policy.
 * The ATT-2 result is returned UNCHANGED — no ENABLED / READ_ONLY / DISABLED
 * mapping is duplicated here.
 *
 * FAIL CLOSED. Any current-offering resolver error (zero, ambiguous, or
 * incomplete offering) and any capability-loader / infrastructure failure
 * PROPAGATES unchanged; none is caught and converted into allowed access. There
 * is no fallback offering selection. This module never inspects or queries
 * StudentAttendance — StudentAttendance stays one shared Student + calendar-date
 * fact and this governs ACCESS THROUGH the offering surface, never ownership.
 *
 * SINGLETON LIMITATION: resolveCurrentCourseOffering() supports exactly one
 * CourseOffering globally, so this composition (and every write wired to it)
 * fails closed if zero or multiple CourseOfferings exist. That is safe but
 * singleton-bound; an actor-aware current-offering selector must replace the
 * global resolver before simultaneous multi-offering operation goes live. That
 * replacement is out of scope here.
 */
import "server-only";

import { resolveCurrentCourseOffering } from "@/lib/course/current-offering";
import { resolveAttendanceCapabilityAccess } from "./attendance-capability-resolver";
import type { AttendanceCapabilityAccess } from "./attendance-capability-policy-core";

/**
 * Resolve the ATTENDANCE capability access for the CURRENT CourseOffering.
 *
 * Accepts NO parameters — no courseOfferingId, actor id, instructor id, student
 * id, date, request/cookie/URL/client value. The offering identity is resolved
 * solely by the server-owned singleton resolver, and its server-resolved result
 * is passed directly to the ATT-2 resolver whose {@link AttendanceCapabilityAccess}
 * is returned unchanged. Resolver / loader errors propagate (never permissive).
 */
export async function resolveCurrentAttendanceCapabilityAccess(): Promise<AttendanceCapabilityAccess> {
  const offering = await resolveCurrentCourseOffering();
  return resolveAttendanceCapabilityAccess(offering);
}
