-- AlterTable
ALTER TABLE "instructors" ADD COLUMN     "canEditRidingNotes" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "riding_slots" (
    "id" TEXT NOT NULL,
    "scheduleItemId" TEXT NOT NULL,
    "showInstructorToStudents" BOOLEAN NOT NULL DEFAULT false,
    "showArenaToStudents" BOOLEAN NOT NULL DEFAULT false,
    "showSubgroupToStudents" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riding_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_slot_assignments" (
    "id" TEXT NOT NULL,
    "ridingSlotId" TEXT NOT NULL,
    "groupName" TEXT,
    "subgroupNumber" INTEGER,
    "instructorId" TEXT,
    "arena" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riding_slot_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_lesson_notes" (
    "id" TEXT NOT NULL,
    "ridingSlotId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "note" TEXT,
    "ratingHalfPoints" INTEGER,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riding_lesson_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "riding_slots_scheduleItemId_key" ON "riding_slots"("scheduleItemId");

-- CreateIndex
CREATE UNIQUE INDEX "riding_slot_assignments_ridingSlotId_groupName_subgroupNumb_key" ON "riding_slot_assignments"("ridingSlotId", "groupName", "subgroupNumber");

-- CreateIndex
CREATE UNIQUE INDEX "riding_lesson_notes_ridingSlotId_studentId_key" ON "riding_lesson_notes"("ridingSlotId", "studentId");

-- AddForeignKey
ALTER TABLE "riding_slots" ADD CONSTRAINT "riding_slots_scheduleItemId_fkey" FOREIGN KEY ("scheduleItemId") REFERENCES "schedule_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_assignments" ADD CONSTRAINT "riding_slot_assignments_ridingSlotId_fkey" FOREIGN KEY ("ridingSlotId") REFERENCES "riding_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_assignments" ADD CONSTRAINT "riding_slot_assignments_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_lesson_notes" ADD CONSTRAINT "riding_lesson_notes_ridingSlotId_fkey" FOREIGN KEY ("ridingSlotId") REFERENCES "riding_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_lesson_notes" ADD CONSTRAINT "riding_lesson_notes_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
