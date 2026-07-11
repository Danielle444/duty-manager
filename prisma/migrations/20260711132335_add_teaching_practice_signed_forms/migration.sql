-- CreateEnum
CREATE TYPE "TeachingPracticeSignedFormType" AS ENUM ('SAFETY_INSTRUCTIONS', 'LUNGE_CONSENT', 'BEGINNER_LESSON_CONSENT');

-- CreateEnum
CREATE TYPE "TeachingPracticeSignedFormStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- AlterTable
ALTER TABLE "instructors" ADD COLUMN     "canManageChildSignatures" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "teaching_practice_signed_forms" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "formType" "TeachingPracticeSignedFormType" NOT NULL,
    "courseCycle" TEXT NOT NULL,
    "childNameSnapshot" TEXT NOT NULL,
    "childAgeSnapshot" INTEGER,
    "parentNameSnapshot" TEXT,
    "parentPhoneSnapshot" TEXT,
    "parentEmail" TEXT,
    "address" TEXT,
    "medicalNotes" TEXT,
    "photoConsent" BOOLEAN,
    "signerName" TEXT NOT NULL,
    "signerRole" TEXT,
    "signatureDataPath" TEXT,
    "signedPdfPath" TEXT,
    "formVersion" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedByInstructorId" TEXT,
    "collectedByAdminEmail" TEXT,
    "collectedByAdminName" TEXT,
    "status" "TeachingPracticeSignedFormStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_practice_signed_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teaching_practice_signed_forms_childId_formType_courseCycle_idx" ON "teaching_practice_signed_forms"("childId", "formType", "courseCycle");

-- AddForeignKey
ALTER TABLE "teaching_practice_signed_forms" ADD CONSTRAINT "teaching_practice_signed_forms_childId_fkey" FOREIGN KEY ("childId") REFERENCES "teaching_practice_children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_signed_forms" ADD CONSTRAINT "teaching_practice_signed_forms_collectedByInstructorId_fkey" FOREIGN KEY ("collectedByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
-- Intentional partial unique index, hand-written (Prisma's schema.prisma has
-- no syntax for a WHERE-qualified/partial unique index, so this cannot be
-- generated from the schema and must be preserved by hand in any future
-- migration touching this table - see the model comment in schema.prisma).
--
-- Enforces "at most one ACTIVE signed form per child + formType +
-- courseCycle" while leaving REVOKED rows completely unconstrained, so
-- re-sign/replacement history can accumulate freely (supersede by inserting
-- a new ACTIVE row and flipping the old row to REVOKED, never by deleting
-- or updating a row in place).
CREATE UNIQUE INDEX "teaching_practice_signed_forms_child_form_cycle_active_key"
  ON "teaching_practice_signed_forms" ("childId", "formType", "courseCycle")
  WHERE "status" = 'ACTIVE';
