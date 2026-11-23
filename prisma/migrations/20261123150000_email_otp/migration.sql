-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "otpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otpExpires" TIMESTAMP(3),
ADD COLUMN     "otpHash" TEXT,
ADD COLUMN     "otpSentAt" TIMESTAMP(3);

