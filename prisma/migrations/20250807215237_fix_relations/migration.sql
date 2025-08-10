-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'PERFORMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'MODERATION', 'ACTIVE', 'BANNED');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('BASIC', 'STANDARD', 'PRO');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('NEW', 'NEGOTIATION', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('P2P');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "tgId" TEXT NOT NULL,
    "username" TEXT,
    "role" "Role" NOT NULL,
    "ageConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "searchPrefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformerProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "games" TEXT[],
    "ranks" JSONB,
    "pricePerHour" INTEGER NOT NULL,
    "about" TEXT,
    "voiceSampleUrl" TEXT,
    "photos" TEXT[],
    "availability" JSONB,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isBoosted" BOOLEAN NOT NULL DEFAULT false,
    "boostUntil" TIMESTAMP(3),
    "plan" "Plan" NOT NULL DEFAULT 'BASIC',
    "planUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycCheck" (
    "id" SERIAL NOT NULL,
    "performerId" INTEGER NOT NULL,
    "docType" TEXT NOT NULL,
    "docImages" TEXT[],
    "selfieUrl" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "performerId" INTEGER NOT NULL,
    "game" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "preferredAt" TIMESTAMP(3),
    "status" "RequestStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMeta" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'P2P',
    "clientMarkPaid" BOOLEAN NOT NULL DEFAULT false,
    "performerReceived" BOOLEAN NOT NULL DEFAULT false,
    "proofUrls" TEXT[],
    "instructions" TEXT,

    CONSTRAINT "PaymentMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "targetId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" SERIAL NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "targetUserId" INTEGER,
    "category" TEXT NOT NULL,
    "text" TEXT,
    "attachments" TEXT[],
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tgId_key" ON "User"("tgId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformerProfile_userId_key" ON "PerformerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMeta_requestId_key" ON "PaymentMeta"("requestId");

-- AddForeignKey
ALTER TABLE "PerformerProfile" ADD CONSTRAINT "PerformerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycCheck" ADD CONSTRAINT "KycCheck_performerId_fkey" FOREIGN KEY ("performerId") REFERENCES "PerformerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_performerId_fkey" FOREIGN KEY ("performerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMeta" ADD CONSTRAINT "PaymentMeta_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
