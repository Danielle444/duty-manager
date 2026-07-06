-- CreateEnum
CREATE TYPE "WeeklyFeedbackStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FeedbackQuestionType" AS ENUM ('RATING_5', 'COMPARISON_3', 'FREE_TEXT');

-- CreateEnum
CREATE TYPE "FeedbackQuestionSource" AS ENUM ('FIXED', 'DYNAMIC');

-- CreateTable
CREATE TABLE "weekly_feedback_forms" (
    "id" TEXT NOT NULL,
    "weeklyScheduleId" TEXT NOT NULL,
    "status" "WeeklyFeedbackStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_feedback_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_feedback_questions" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "FeedbackQuestionType" NOT NULL,
    "source" "FeedbackQuestionSource" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_feedback_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_feedback_responses" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_feedback_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_feedback_answers" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "ratingValue" INTEGER,
    "textValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_feedback_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_feedback_forms_weeklyScheduleId_key" ON "weekly_feedback_forms"("weeklyScheduleId");

-- CreateIndex
CREATE INDEX "weekly_feedback_questions_formId_idx" ON "weekly_feedback_questions"("formId");

-- CreateIndex
CREATE INDEX "weekly_feedback_responses_studentId_idx" ON "weekly_feedback_responses"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_feedback_responses_formId_studentId_key" ON "weekly_feedback_responses"("formId", "studentId");

-- CreateIndex
CREATE INDEX "weekly_feedback_answers_questionId_idx" ON "weekly_feedback_answers"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_feedback_answers_responseId_questionId_key" ON "weekly_feedback_answers"("responseId", "questionId");

-- AddForeignKey
ALTER TABLE "weekly_feedback_forms" ADD CONSTRAINT "weekly_feedback_forms_weeklyScheduleId_fkey" FOREIGN KEY ("weeklyScheduleId") REFERENCES "weekly_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_feedback_questions" ADD CONSTRAINT "weekly_feedback_questions_formId_fkey" FOREIGN KEY ("formId") REFERENCES "weekly_feedback_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_feedback_responses" ADD CONSTRAINT "weekly_feedback_responses_formId_fkey" FOREIGN KEY ("formId") REFERENCES "weekly_feedback_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_feedback_responses" ADD CONSTRAINT "weekly_feedback_responses_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_feedback_answers" ADD CONSTRAINT "weekly_feedback_answers_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "weekly_feedback_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_feedback_answers" ADD CONSTRAINT "weekly_feedback_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "weekly_feedback_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
