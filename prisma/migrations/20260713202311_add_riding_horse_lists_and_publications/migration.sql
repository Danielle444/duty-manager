-- CreateEnum
CREATE TYPE "RidingHorsePublicationAudience" AS ENUM ('INSTRUCTORS', 'GROUP_A_TRAINEES', 'GROUP_B_TRAINEES');

-- CreateTable
CREATE TABLE "riding_slot_horse_lists" (
    "id" TEXT NOT NULL,
    "ridingSlotId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByInstructorId" TEXT,
    "updatedByAdminEmail" TEXT,
    "updatedByAdminName" TEXT,
    "updatedByName" TEXT NOT NULL,

    CONSTRAINT "riding_slot_horse_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_slot_horse_list_items" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "groupName" TEXT,
    "subgroupNumber" INTEGER,
    "studentId" TEXT,
    "horseName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riding_slot_horse_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_slot_horse_publications" (
    "id" TEXT NOT NULL,
    "horseListId" TEXT NOT NULL,
    "audience" "RidingHorsePublicationAudience" NOT NULL,
    "title" TEXT NOT NULL,
    "generalNote" TEXT,
    "sourceVersion" INTEGER NOT NULL,
    "firstPublishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByInstructorId" TEXT,
    "updatedByAdminEmail" TEXT,
    "updatedByAdminName" TEXT,
    "updatedByName" TEXT NOT NULL,

    CONSTRAINT "riding_slot_horse_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_slot_horse_publication_items" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "groupName" TEXT,
    "subgroupNumber" INTEGER,
    "responsibleInstructorNames" TEXT,
    "studentId" TEXT,
    "studentName" TEXT,
    "horseName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riding_slot_horse_publication_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "riding_slot_horse_lists_ridingSlotId_key" ON "riding_slot_horse_lists"("ridingSlotId");

-- CreateIndex
CREATE INDEX "riding_slot_horse_list_items_listId_groupName_subgroupNumbe_idx" ON "riding_slot_horse_list_items"("listId", "groupName", "subgroupNumber");

-- CreateIndex
CREATE UNIQUE INDEX "riding_slot_horse_list_items_listId_studentId_key" ON "riding_slot_horse_list_items"("listId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "riding_slot_horse_publications_horseListId_audience_key" ON "riding_slot_horse_publications"("horseListId", "audience");

-- CreateIndex
CREATE INDEX "riding_slot_horse_publication_items_publicationId_idx" ON "riding_slot_horse_publication_items"("publicationId");

-- RenameForeignKey
ALTER TABLE "student_presentation_progress_feedback" RENAME CONSTRAINT "student_presentation_progress_feedback_createdByInstructorId_fk" TO "student_presentation_progress_feedback_createdByInstructor_fkey";

-- RenameForeignKey
ALTER TABLE "student_presentation_progress_feedback" RENAME CONSTRAINT "student_presentation_progress_feedback_updatedByInstructorId_fk" TO "student_presentation_progress_feedback_updatedByInstructor_fkey";

-- AddForeignKey
ALTER TABLE "riding_slot_horse_lists" ADD CONSTRAINT "riding_slot_horse_lists_ridingSlotId_fkey" FOREIGN KEY ("ridingSlotId") REFERENCES "riding_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_horse_lists" ADD CONSTRAINT "riding_slot_horse_lists_updatedByInstructorId_fkey" FOREIGN KEY ("updatedByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_horse_list_items" ADD CONSTRAINT "riding_slot_horse_list_items_listId_fkey" FOREIGN KEY ("listId") REFERENCES "riding_slot_horse_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_horse_list_items" ADD CONSTRAINT "riding_slot_horse_list_items_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_horse_publications" ADD CONSTRAINT "riding_slot_horse_publications_horseListId_fkey" FOREIGN KEY ("horseListId") REFERENCES "riding_slot_horse_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_horse_publications" ADD CONSTRAINT "riding_slot_horse_publications_updatedByInstructorId_fkey" FOREIGN KEY ("updatedByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_horse_publication_items" ADD CONSTRAINT "riding_slot_horse_publication_items_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "riding_slot_horse_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_horse_publication_items" ADD CONSTRAINT "riding_slot_horse_publication_items_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "student_presentation_progress_feedback_createdByInstructorId_id" RENAME TO "student_presentation_progress_feedback_createdByInstructorI_idx";
