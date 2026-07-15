-- CreateTable
CREATE TABLE "teaching_practice_instructor_day_notes" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "practiceType" "TeachingPracticeType" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_practice_instructor_day_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teaching_practice_instructor_day_notes_instructorId_date_idx" ON "teaching_practice_instructor_day_notes"("instructorId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_practice_instructor_day_notes_instructorId_date_pr_key" ON "teaching_practice_instructor_day_notes"("instructorId", "date", "practiceType");

-- AddForeignKey
ALTER TABLE "teaching_practice_instructor_day_notes" ADD CONSTRAINT "teaching_practice_instructor_day_notes_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "instructors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
