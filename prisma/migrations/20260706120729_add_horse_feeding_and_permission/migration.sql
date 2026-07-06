-- CreateEnum
CREATE TYPE "HorseMealType" AS ENUM ('MORNING', 'LUNCH', 'EVENING');

-- AlterTable
ALTER TABLE "instructors" ADD COLUMN     "canEditHorseFeeding" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "horse_feeding_meals" (
    "id" TEXT NOT NULL,
    "horseName" TEXT NOT NULL,
    "mealType" "HorseMealType" NOT NULL,
    "hayType" TEXT,
    "concentrateType" TEXT,
    "concentrateAmount" TEXT,
    "notes" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "horse_feeding_meals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "horse_feeding_meals_horseName_mealType_key" ON "horse_feeding_meals"("horseName", "mealType");
