-- AlterTable
ALTER TABLE "weekly_schedules" ADD COLUMN "courseOfferingId" TEXT;

-- CreateIndex
CREATE INDEX "weekly_schedules_courseOfferingId_idx" ON "weekly_schedules"("courseOfferingId");

-- AddForeignKey
ALTER TABLE "weekly_schedules" ADD CONSTRAINT "weekly_schedules_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
