-- AlterTable
ALTER TABLE "teaching_practice_signed_forms" ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedByAdminEmail" TEXT,
ADD COLUMN     "revokedByAdminName" TEXT,
ADD COLUMN     "revokedReason" TEXT;
