-- AlterTable
ALTER TABLE "weekly_feedback_questions" ADD COLUMN     "isRequired" BOOLEAN NOT NULL DEFAULT true;

-- Preserve existing submit-validation behavior: FREE_TEXT questions were
-- always optional regardless of the new default, so backfill existing rows
-- to isRequired=false. RATING_5/COMPARISON_3 keep the column default (true).
UPDATE "weekly_feedback_questions" SET "isRequired" = false WHERE "type" = 'FREE_TEXT';
