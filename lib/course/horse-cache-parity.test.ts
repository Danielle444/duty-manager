/**
 * MULTI-COURSE W8A-4 - pure unit tests for the three-way horse-cache PARITY
 * comparator. No DB, no framework: node:test + node:assert/strict, run with
 *
 *   npx tsx --test lib/course/horse-cache-parity.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHorseCacheParity,
  formatHorseCacheParityAnomalies,
  formatHorseCacheParitySummary,
  type BuildHorseCacheParityInput,
  type ParityEnrollmentInput,
  type ParityHistoryInput,
  type ParityStudentInput,
} from "./horse-cache-parity";

const OFFERING = "off_current";
const ASOF = "2026-07-19";

function enrollment(
  over: Partial<ParityEnrollmentInput> & { id: string; studentId: string },
): ParityEnrollmentInput {
  return {
    status: "ACTIVE",
    hasPrivateHorse: false,
    privateHorseName: null,
    assignedHorseName: null,
    ...over,
  };
}

function history(
  over: Partial<ParityHistoryInput> & { id: string; studentId: string },
): ParityHistoryInput {
  return {
    courseEnrollmentId: null,
    hasPrivateHorse: false,
    privateHorseName: null,
    assignedHorseName: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    ...over,
  };
}

function student(
  over: Partial<ParityStudentInput> & { id: string },
): ParityStudentInput {
  return {
    hasPrivateHorse: false,
    privateHorseName: null,
    assignedHorseName: null,
    ...over,
  };
}

function build(
  over: Partial<BuildHorseCacheParityInput> & {
    enrollments: readonly ParityEnrollmentInput[];
    horseAssignments: readonly ParityHistoryInput[];
    students: readonly ParityStudentInput[];
  },
) {
  return buildHorseCacheParity({ currentOfferingId: OFFERING, asOf: ASOF, ...over });
}

/** A single clean subject where all three sources agree on the same ranch horse. */
function cleanSubject(
  sid: string,
  eid: string,
  hid: string,
  horse: { assignedHorseName?: string | null; hasPrivateHorse?: boolean; privateHorseName?: string | null },
) {
  const triple = {
    hasPrivateHorse: horse.hasPrivateHorse ?? false,
    privateHorseName: horse.privateHorseName ?? null,
    assignedHorseName: horse.assignedHorseName ?? null,
  };
  return {
    enrollment: enrollment({ id: eid, studentId: sid, ...triple }),
    history: history({ id: hid, studentId: sid, courseEnrollmentId: eid, ...triple }),
    student: student({ id: sid, ...triple }),
  };
}

test("all three sources equal -> ok, zero anomalies", () => {
  const a = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  const b = cleanSubject("stu_2", "enr_2", "tha_2", { hasPrivateHorse: true, privateHorseName: "Shadow" });
  const result = build({
    enrollments: [a.enrollment, b.enrollment],
    horseAssignments: [a.history, b.history],
    students: [a.student, b.student],
  });
  assert.equal(result.ok, true);
  assert.equal(result.summary.anomalyTotal, 0);
  assert.equal(result.summary.subjectsChecked, 2);
  assert.equal(result.summary.subjectsOk, 2);
});

test("history vs enrollment mismatch", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  // Enrollment cache drifts to a different horse than history/student.
  const result = build({
    enrollments: [{ ...s.enrollment, assignedHorseName: "Storm" }],
    horseAssignments: [s.history],
    students: [s.student],
  });
  const codes = result.anomalies.map((a) => a.code);
  assert.ok(codes.includes("HISTORY_ENROLLMENT_MISMATCH"));
  assert.ok(codes.includes("ENROLLMENT_STUDENT_MISMATCH"));
  assert.ok(!codes.includes("HISTORY_STUDENT_MISMATCH"));
  assert.equal(result.ok, false);
});

test("enrollment vs Student mismatch (history-independent)", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  // Student mirror drifts; history and enrollment still agree.
  const result = build({
    enrollments: [s.enrollment],
    horseAssignments: [s.history],
    students: [{ ...s.student, assignedHorseName: "Old" }],
  });
  const codes = result.anomalies.map((a) => a.code);
  assert.deepEqual(codes.sort(), ["ENROLLMENT_STUDENT_MISMATCH", "HISTORY_STUDENT_MISMATCH"]);
});

test("history vs Student mismatch only (enrollment agrees with history)", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  const result = build({
    enrollments: [s.enrollment],
    horseAssignments: [s.history],
    students: [{ ...s.student, hasPrivateHorse: true, privateHorseName: "Bella", assignedHorseName: null }],
  });
  const codes = result.anomalies.map((a) => a.code).sort();
  assert.deepEqual(codes, ["ENROLLMENT_STUDENT_MISMATCH", "HISTORY_STUDENT_MISMATCH"]);
});

test("no current history", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  // History interval ended before asOf -> not current.
  const result = build({
    enrollments: [s.enrollment],
    horseAssignments: [{ ...s.history, effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01" }],
    students: [s.student],
  });
  const codes = result.anomalies.map((a) => a.code);
  assert.ok(codes.includes("NO_CURRENT_HISTORY"));
});

test("multiple current history", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  const result = build({
    enrollments: [s.enrollment],
    horseAssignments: [
      history({ id: "tha_a", studentId: "stu_1", courseEnrollmentId: "enr_1", effectiveFrom: "2026-01-01" }),
      history({ id: "tha_b", studentId: "stu_1", courseEnrollmentId: "enr_1", effectiveFrom: "2026-02-01" }),
    ],
    students: [s.student],
  });
  const anomaly = result.anomalies.find((a) => a.code === "MULTIPLE_CURRENT_HISTORY");
  assert.ok(anomaly);
  assert.equal(anomaly.code, "MULTIPLE_CURRENT_HISTORY");
  if (anomaly.code === "MULTIPLE_CURRENT_HISTORY") {
    assert.deepEqual(anomaly.traineeHorseAssignmentIds, ["tha_a", "tha_b"]);
  }
});

test("invalid horse state (noncanonical current interval)", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  // Contradictory: private horse AND an assigned ranch name.
  const result = build({
    enrollments: [s.enrollment],
    horseAssignments: [
      { ...s.history, hasPrivateHorse: true, privateHorseName: "P", assignedHorseName: "R" },
    ],
    students: [s.student],
  });
  const codes = result.anomalies.map((a) => a.code);
  assert.ok(codes.includes("INVALID_HORSE_STATE"));
  // No HISTORY_* value comparison is emitted when the authority is not canonical.
  assert.ok(!codes.includes("HISTORY_ENROLLMENT_MISMATCH"));
  assert.ok(!codes.includes("HISTORY_STUDENT_MISMATCH"));
});

test("wrong enrollment link (current interval links elsewhere)", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  const result = build({
    enrollments: [s.enrollment],
    horseAssignments: [{ ...s.history, courseEnrollmentId: "enr_OTHER" }],
    students: [s.student],
  });
  const anomaly = result.anomalies.find((a) => a.code === "WRONG_LINKED_ENROLLMENT");
  assert.ok(anomaly);
  if (anomaly && anomaly.code === "WRONG_LINKED_ENROLLMENT") {
    assert.equal(anomaly.linkedCourseEnrollmentId, "enr_OTHER");
    assert.equal(anomaly.courseEnrollmentId, "enr_1");
  }
  // Value parity still holds (link and value are orthogonal concerns).
  const codes = result.anomalies.map((a) => a.code);
  assert.ok(!codes.includes("HISTORY_ENROLLMENT_MISMATCH"));
});

test("null link counts as a wrong (unlinked) enrollment link", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  const result = build({
    enrollments: [s.enrollment],
    horseAssignments: [{ ...s.history, courseEnrollmentId: null }],
    students: [s.student],
  });
  const anomaly = result.anomalies.find((a) => a.code === "WRONG_LINKED_ENROLLMENT");
  assert.ok(anomaly);
  if (anomaly && anomaly.code === "WRONG_LINKED_ENROLLMENT") {
    assert.equal(anomaly.linkedCourseEnrollmentId, null);
  }
});

test("zero enrollment (history orphan, no enrollment)", () => {
  const result = build({
    enrollments: [],
    horseAssignments: [history({ id: "tha_1", studentId: "stu_1", assignedHorseName: "Bella" })],
    students: [student({ id: "stu_1", assignedHorseName: "Bella" })],
  });
  const codes = result.anomalies.map((a) => a.code);
  assert.deepEqual(codes, ["ZERO_ENROLLMENT"]);
});

test("multiple enrollment candidates for one student", () => {
  const result = build({
    enrollments: [
      enrollment({ id: "enr_b", studentId: "stu_1" }),
      enrollment({ id: "enr_a", studentId: "stu_1" }),
    ],
    horseAssignments: [],
    students: [student({ id: "stu_1" })],
  });
  const anomaly = result.anomalies.find((a) => a.code === "MULTIPLE_ENROLLMENT");
  assert.ok(anomaly);
  if (anomaly && anomaly.code === "MULTIPLE_ENROLLMENT") {
    assert.deepEqual(anomaly.courseEnrollmentIds, ["enr_a", "enr_b"]);
  }
});

test("inactive enrollment fails closed and stops further checks", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  const result = build({
    enrollments: [{ ...s.enrollment, status: "INACTIVE" }],
    // Even with a value drift, only the inactive anomaly is reported (stopped).
    horseAssignments: [{ ...s.history, assignedHorseName: "Drift" }],
    students: [s.student],
  });
  const codes = result.anomalies.map((a) => a.code);
  assert.deepEqual(codes, ["INACTIVE_ENROLLMENT"]);
});

test("deterministic ordering: input order does not change the result", () => {
  const a = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "A" });
  const b = cleanSubject("stu_2", "enr_2", "tha_2", { assignedHorseName: "B" });
  // Introduce anomalies on both subjects so ordering is observable.
  const aBad = { ...a.enrollment, assignedHorseName: "X" };
  const bBad = { ...b.enrollment, assignedHorseName: "Y" };

  const forward = build({
    enrollments: [aBad, bBad],
    horseAssignments: [a.history, b.history],
    students: [a.student, b.student],
  });
  const reverse = build({
    enrollments: [bBad, aBad],
    horseAssignments: [b.history, a.history],
    students: [b.student, a.student],
  });
  assert.deepEqual(forward.anomalies, reverse.anomalies);
  // Subjects come out in sorted studentId order.
  assert.deepEqual(
    forward.anomalies.map((x) => x.studentId),
    ["stu_1", "stu_1", "stu_2", "stu_2"],
  );
});

test("diagnostics are PII-free: only safe ids and codes, no names/phones", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "SecretHorseName" });
  const result = build({
    enrollments: [{ ...s.enrollment, assignedHorseName: "OtherSecret" }],
    horseAssignments: [s.history],
    students: [{ ...s.student, privateHorseName: "PrivateSecret", phone: "0500000000" } as ParityStudentInput],
  });
  const blob = [
    formatHorseCacheParitySummary(result),
    ...formatHorseCacheParityAnomalies(result),
    JSON.stringify(result.anomalies),
  ].join("\n");
  for (const secret of ["SecretHorseName", "OtherSecret", "PrivateSecret", "0500000000"]) {
    assert.ok(!blob.includes(secret), `diagnostic output must not contain ${secret}`);
  }
});

test("summary counts match the emitted anomalies", () => {
  const s = cleanSubject("stu_1", "enr_1", "tha_1", { assignedHorseName: "Bella" });
  const result = build({
    enrollments: [{ ...s.enrollment, assignedHorseName: "Drift" }],
    horseAssignments: [{ ...s.history, courseEnrollmentId: "enr_OTHER" }],
    students: [s.student],
  });
  assert.equal(result.summary.anomalyTotal, result.anomalies.length);
  assert.equal(
    result.summary.historyEnrollmentMismatch,
    result.anomalies.filter((a) => a.code === "HISTORY_ENROLLMENT_MISMATCH").length,
  );
  assert.equal(result.summary.subjectsOk, 0);
});
