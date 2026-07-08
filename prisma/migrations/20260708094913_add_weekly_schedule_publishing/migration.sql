-- AlterTable
ALTER TABLE "weekly_schedules" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: weeks that already existed before this migration are already
-- live to חניכים today - default false must not retroactively hide them.
-- Only newly created rows going forward keep the column default of false.
UPDATE "weekly_schedules" SET "isPublished" = true;
