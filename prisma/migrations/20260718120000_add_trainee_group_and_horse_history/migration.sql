-- CreateTable
CREATE TABLE "trainee_group_memberships" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "groupName" TEXT,
    "subgroupNumber" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainee_group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainee_horse_assignments" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assignedHorseName" TEXT,
    "hasPrivateHorse" BOOLEAN NOT NULL DEFAULT false,
    "privateHorseName" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainee_horse_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trainee_group_memberships_studentId_effectiveFrom_key" ON "trainee_group_memberships"("studentId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "trainee_horse_assignments_studentId_effectiveFrom_key" ON "trainee_horse_assignments"("studentId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "trainee_group_memberships" ADD CONSTRAINT "trainee_group_memberships_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_horse_assignments" ADD CONSTRAINT "trainee_horse_assignments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
