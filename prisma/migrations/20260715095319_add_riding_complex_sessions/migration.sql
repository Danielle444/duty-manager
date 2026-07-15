-- CreateTable
CREATE TABLE "riding_slot_complex_plans" (
    "id" TEXT NOT NULL,
    "ridingSlotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByInstructorId" TEXT,
    "updatedByAdminEmail" TEXT,
    "updatedByAdminName" TEXT,
    "updatedByName" TEXT NOT NULL,

    CONSTRAINT "riding_slot_complex_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_slot_complex_blocks" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "arena" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riding_slot_complex_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_slot_complex_block_instructors" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riding_slot_complex_block_instructors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_slot_complex_pairs" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "trainee1Id" TEXT,
    "trainee2Id" TEXT,
    "horseName" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riding_slot_complex_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "riding_slot_complex_plans_ridingSlotId_key" ON "riding_slot_complex_plans"("ridingSlotId");

-- CreateIndex
CREATE INDEX "riding_slot_complex_blocks_planId_sortOrder_idx" ON "riding_slot_complex_blocks"("planId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "riding_slot_complex_block_instructors_blockId_instructorId_key" ON "riding_slot_complex_block_instructors"("blockId", "instructorId");

-- CreateIndex
CREATE INDEX "riding_slot_complex_pairs_blockId_sortOrder_idx" ON "riding_slot_complex_pairs"("blockId", "sortOrder");

-- AddForeignKey
ALTER TABLE "riding_slot_complex_plans" ADD CONSTRAINT "riding_slot_complex_plans_ridingSlotId_fkey" FOREIGN KEY ("ridingSlotId") REFERENCES "riding_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_plans" ADD CONSTRAINT "riding_slot_complex_plans_updatedByInstructorId_fkey" FOREIGN KEY ("updatedByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_blocks" ADD CONSTRAINT "riding_slot_complex_blocks_planId_fkey" FOREIGN KEY ("planId") REFERENCES "riding_slot_complex_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_block_instructors" ADD CONSTRAINT "riding_slot_complex_block_instructors_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "riding_slot_complex_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_block_instructors" ADD CONSTRAINT "riding_slot_complex_block_instructors_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "instructors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_pairs" ADD CONSTRAINT "riding_slot_complex_pairs_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "riding_slot_complex_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_pairs" ADD CONSTRAINT "riding_slot_complex_pairs_trainee1Id_fkey" FOREIGN KEY ("trainee1Id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_pairs" ADD CONSTRAINT "riding_slot_complex_pairs_trainee2Id_fkey" FOREIGN KEY ("trainee2Id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
