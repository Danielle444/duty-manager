-- MULTI-COURSE W2A: make (activityYearId, name) the stable identity of a
-- CourseOffering. Additive-only; separate from the W0 spine migration
-- (20260718130000_add_multi_course_spine), which is left untouched. This adds
-- ONLY a unique index and drops/rewrites nothing. No unique key is added on
-- (activityYearId, level) by design: an ActivityYear may hold more than one
-- offering at the same level, so level is never the offering's identity.
--
-- Safe to apply: at the time this runs the course_offerings table is created by
-- the W0 migration and holds no rows (no backfill has run), so no existing data
-- can violate the new constraint.

-- CreateIndex
CREATE UNIQUE INDEX "course_offerings_activityYearId_name_key" ON "course_offerings"("activityYearId", "name");
