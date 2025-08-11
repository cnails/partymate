-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('PLAN', 'BOOST');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('PENDING', 'ACTIVATED', 'REJECTED', 'CANCELED');

-- CreateTable
CREATE TABLE "BillingOrder" (
    "id" SERIAL NOT NULL,
    "performerId" INTEGER NOT NULL,
    "type" "BillingType" NOT NULL,
    "plan" "Plan",
    "days" INTEGER NOT NULL,
    "amountRub" INTEGER NOT NULL,
    "proofUrls" TEXT[],
    "status" "BillingStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "activatedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingOrder_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_performerId_fkey" FOREIGN KEY ("performerId") REFERENCES "PerformerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
