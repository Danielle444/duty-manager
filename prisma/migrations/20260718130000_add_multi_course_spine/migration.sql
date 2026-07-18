-- CreateEnum
CREATE TYPE "CourseOfferingStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CourseEnrollmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "activity_years" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_offerings" (
    "id" TEXT NOT NULL,
    "activityYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "status" "CourseOfferingStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_enrollments" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "status" "CourseEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE,
    "endDate" DATE,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_groups" (
    "id" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "parentGroupId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_memberships" (
    "id" TEXT NOT NULL,
    "courseEnrollmentId" TEXT NOT NULL,
    "courseGroupId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_years_name_key" ON "activity_years"("name");

-- CreateIndex
CREATE INDEX "course_offerings_activityYearId_idx" ON "course_offerings"("activityYearId");

-- CreateIndex
CREATE INDEX "course_enrollments_courseOfferingId_idx" ON "course_enrollments"("courseOfferingId");

-- CreateIndex
CREATE UNIQUE INDEX "course_enrollments_studentId_courseOfferingId_key" ON "course_enrollments"("studentId", "courseOfferingId");

-- CreateIndex
CREATE INDEX "course_groups_courseOfferingId_idx" ON "course_groups"("courseOfferingId");

-- CreateIndex
CREATE INDEX "course_groups_parentGroupId_idx" ON "course_groups"("parentGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "course_groups_courseOfferingId_parentGroupId_name_key" ON "course_groups"("courseOfferingId", "parentGroupId", "name");

-- CreateIndex
-- Hand-written partial unique index (MULTI-COURSE W0). Prisma's schema.prisma
-- has no syntax for a WHERE-qualified/partial index, so this is authored
-- directly in SQL, same pattern as teaching_practice_signed_forms /
-- teaching_practice_track_children elsewhere in this repo. The composite
-- unique above enforces subgroup identity (parentGroupId NOT NULL), but
-- PostgreSQL treats each NULL parentGroupId as distinct, so it does NOT
-- prevent duplicate TOP-LEVEL group names. This partial index closes that
-- gap: within one CourseOffering, a top-level group (parentGroupId IS NULL)
-- has a unique name.
CREATE UNIQUE INDEX "course_groups_offering_top_level_name_unique" ON "course_groups"("courseOfferingId", "name") WHERE "parentGroupId" IS NULL;

-- CreateIndex
CREATE INDEX "group_memberships_courseGroupId_idx" ON "group_memberships"("courseGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_courseEnrollmentId_effectiveFrom_key" ON "group_memberships"("courseEnrollmentId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_activityYearId_fkey" FOREIGN KEY ("activityYearId") REFERENCES "activity_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_groups" ADD CONSTRAINT "course_groups_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_groups" ADD CONSTRAINT "course_groups_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "course_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_courseEnrollmentId_fkey" FOREIGN KEY ("courseEnrollmentId") REFERENCES "course_enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_courseGroupId_fkey" FOREIGN KEY ("courseGroupId") REFERENCES "course_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

