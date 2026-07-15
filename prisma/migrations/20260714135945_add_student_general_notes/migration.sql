-- CreateTable
CREATE TABLE "student_general_notes" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdByName" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByInstructorId" TEXT,
    "updatedByInstructorId" TEXT,

    CONSTRAINT "student_general_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_general_notes_studentId_idx" ON "student_general_notes"("studentId");

-- CreateIndex
CREATE INDEX "student_general_notes_createdByInstructorId_idx" ON "student_general_notes"("createdByInstructorId");

-- CreateIndex
CREATE INDEX "student_general_notes_updatedByInstructorId_idx" ON "student_general_notes"("updatedByInstructorId");

-- AddForeignKey
ALTER TABLE "student_general_notes" ADD CONSTRAINT "student_general_notes_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_general_notes" ADD CONSTRAINT "student_general_notes_createdByInstructorId_fkey" FOREIGN KEY ("createdByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_general_notes" ADD CONSTRAINT "student_general_notes_updatedByInstructorId_fkey" FOREIGN KEY ("updatedByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
