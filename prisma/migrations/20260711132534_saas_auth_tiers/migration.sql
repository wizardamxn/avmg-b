/*
  Warnings:

  - Added the required column `passwordHash` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MediaJob" ADD COLUMN     "error" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "notesMarkdown" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "passwordHash" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "MediaJob_userId_createdAt_idx" ON "MediaJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaJob_ip_createdAt_idx" ON "MediaJob"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "MediaJob_status_expiresAt_idx" ON "MediaJob"("status", "expiresAt");
