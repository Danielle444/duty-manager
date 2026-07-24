/**
 * L2-FANOUT-AUTH - PURE, dependency-injected orchestration that binds the two
 * instructor MESSAGE surfaces to the server-derived actor identity.
 *
 * Like ./attendance-write-auth and ./attendance-read-auth, this is deliberately
 * NOT a "use server" module: it is a plain server-side library, so nothing here
 * is registered as a Server Action. It carries the testable orchestration
 * (server-actor gate + canSendMessages check for the write, actor-presence gate
 * for the read) that the public server actions in ./messages import and wire to
 * real dependencies (the canonical actor DAL getCurrentInstructor + the existing
 * Prisma create/read paths). Same split-of-concerns convention as the attendance
 * auth modules.
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies /
 * next-cache import: every impure capability (the session actor resolver, the
 * creator, the reader) is passed in via the *Deps interfaces. The only edges
 * back to ./messages and ./students are erased `import type`s (their single
 * source of truth is those modules), so the type-only edge creates no runtime
 * circular import and pulls in neither next/headers nor Prisma.
 *
 * SECURITY CONTRACT (why this exists):
 *  - createMessageTaskAsInstructor previously trusted a CLIENT-SUPPLIED
 *    instructorId: it re-read the Instructor row by that id and evaluated
 *    isActive/canSendMessages on it. That validates the ROW, not the CALLER.
 *    searchInstructors() is unauthenticated by design (it powers the instructor
 *    login screen) and returns real instructor ids, so ANY caller - including an
 *    anonymous one - could borrow an active sending instructor's id, broadcast a
 *    message or task to every active trainee, have it persisted under that
 *    instructor's real name, and trigger the push fanout.
 *  - getMessageTasksForInstructorView previously had NO authentication at all.
 *    It takes no arguments, so an anonymous caller needed to guess nothing: it
 *    returned every non-archived message's full title/body/audience/sender plus
 *    the real full names of the trainees each was sent to.
 *
 * Both now derive identity ONLY from the injected server-side actor resolver
 * (getCurrentInstructor), never from a client-supplied id. A missing / invalid /
 * expired / wrong-audience / inactive / subject-mismatched session yields a null
 * actor (the resolver returns null in every such case) and the operation is
 * denied WITHOUT invoking the delegate - so on the write path no recipient is
 * resolved, no MessageTask row is created and no push is fanned out, and on the
 * read path no message or recipient row is read. Authorship is taken from the
 * server-derived actor's fullName, never from client input.
 *
 * PERMISSION SPLIT: canSendMessages gates SENDING only. Reading the instructor
 * message view stays identity-only (every authenticated ACTIVE instructor sees
 * it, exactly as before), the same boundary the attendance tracking read uses
 * for canEditAttendance - see ./attendance-read-auth.
 *
 * SCOPE: this module closes AUTHORIZATION holes only. It performs no course
 * scoping, consults no CourseOffering capability, and does not touch recipient
 * fan-out - those remain separate, separately-approved concerns.
 */
import type { CreateMessageTaskInput, InstructorMessageTaskView } from "./messages";
import type { ActionResult } from "./students";

// Shared rejection contract - identical wording to the pre-existing instructor
// send action so the UI-visible error is unchanged.
const NO_SEND_PERMISSION_ERROR = "אין הרשאה לשליחת הודעות ומשימות";

// --- instructor message/task send -------------------------------------------

/**
 * The minimal server-derived actor shape the send path consumes: the send
 * permission + the authorship name. It is a structural subset of InstructorActor
 * (from lib/auth/actor-types), so the canonical getCurrentInstructor resolver
 * satisfies it directly - kept inline here so this pure module needs no import
 * from the actor DAL layer.
 */
export interface InstructorMessageSendActor {
  canSendMessages: boolean;
  fullName: string;
}

/**
 * Injectable dependencies for {@link sendInstructorMessageTaskWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver (null for
 * any unauthenticated / invalid / expired / wrong-audience / inactive session);
 * `createMessageTask` is the existing validate-resolve-persist-push creator,
 * which receives the server-derived authorship name and returns the unchanged
 * action result.
 */
export interface InstructorMessageSendDeps {
  getCurrentInstructor: () => Promise<InstructorMessageSendActor | null>;
  createMessageTask: (
    input: CreateMessageTaskInput,
    createdByName: string,
  ) => Promise<ActionResult>;
}

/**
 * Gate an instructor message/task send on a trustworthy server-derived actor
 * that holds canSendMessages, THEN delegate to the unchanged creator.
 *
 * Identity comes solely from deps.getCurrentInstructor(); this function takes no
 * instructor id, so no client value can select or impersonate an instructor. A
 * null actor (unauthenticated / invalid / expired / wrong-audience / inactive)
 * OR an actor whose canSendMessages is not true is rejected with the unchanged
 * Hebrew permission error and the creator is NEVER invoked - which is precisely
 * why no audience is resolved, no recipient row is read, no MessageTask is
 * written and no push notification is fanned out on a denial (the creator is
 * what performs all four).
 *
 * For an authorized actor the creator runs exactly as before - it performs the
 * existing payload validation, audience resolution, persistence and best-effort
 * push - and authorship (createdByName) is the actor's own fullName, never a
 * client value. Its result is returned unchanged. An infrastructure failure from
 * either dependency propagates unchanged and is never converted into a denial.
 */
export async function sendInstructorMessageTaskWithDeps(
  deps: InstructorMessageSendDeps,
  input: CreateMessageTaskInput,
): Promise<ActionResult> {
  const instructor = await deps.getCurrentInstructor();
  if (!instructor || instructor.canSendMessages !== true) {
    return { success: false, error: NO_SEND_PERMISSION_ERROR };
  }
  return deps.createMessageTask(input, instructor.fullName);
}

// --- instructor message/task view read --------------------------------------

/**
 * Injectable dependencies for {@link loadInstructorMessageTaskViewWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver (null for
 * any unauthenticated / invalid / expired / wrong-audience / inactive session);
 * `readItems` is the existing parameterless reader that produces the view DTO.
 */
export interface InstructorMessageViewDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  readItems: () => Promise<InstructorMessageTaskView[]>;
}

/**
 * Gate the instructor message/task view on a trustworthy server-derived
 * instructor actor, THEN delegate to the unchanged reader.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no parameter
 * at all, so nothing client-supplied participates. A null actor fails closed to
 * a fresh [] and the reader is NEVER invoked, so no MessageTask and no recipient
 * name is read for an anonymous / invalid / expired / wrong-audience / inactive
 * caller. That empty array is exactly what the existing clients already render
 * as "no messages yet", which is why this gate needs no UI change - and it is
 * the same fail-closed read convention as loadInstructorAttendanceTrackingWithDeps
 * and the contact directories.
 *
 * The boundary is intentionally IDENTITY-ONLY: viewing does NOT require
 * canSendMessages (that flag gates sending only), so an authenticated active
 * instructor without send permission reads exactly the same list as before. For
 * any authenticated instructor the reader's rows are returned unchanged. An
 * infrastructure failure from either dependency propagates unchanged and is
 * never converted into an empty result.
 */
export async function loadInstructorMessageTaskViewWithDeps(
  deps: InstructorMessageViewDeps,
): Promise<InstructorMessageTaskView[]> {
  const instructor = await deps.getCurrentInstructor();
  if (!instructor) {
    return [];
  }
  return deps.readItems();
}
