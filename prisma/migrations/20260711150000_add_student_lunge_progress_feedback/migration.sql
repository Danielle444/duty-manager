-- CreateTable
CREATE TABLE "student_lunge_progress_feedback" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "ratingHalfPoints" INTEGER,
    "feedback" TEXT,
    "horseName" TEXT,
    "topic" TEXT,
    "instructorName" TEXT,
    "createdByName" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_lunge_progress_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_lunge_progress_feedback_studentId_idx" ON "student_lunge_progress_feedback"("studentId");

-- AddForeignKey
ALTER TABLE "student_lunge_progress_feedback" ADD CONSTRAINT "student_lunge_progress_feedback_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
