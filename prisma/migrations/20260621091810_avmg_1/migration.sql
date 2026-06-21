-- AlterTable
ALTER TABLE "MediaJob" ADD COLUMN     "jobType" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "quality" TEXT,
ADD COLUMN     "targetFormat" TEXT,
ADD COLUMN     "transcriptPath" TEXT,
ADD COLUMN     "url" TEXT,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "originalName" DROP NOT NULL,
ALTER COLUMN "fileName" DROP NOT NULL,
ALTER COLUMN "path" DROP NOT NULL,
ALTER COLUMN "size" DROP NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "MediaJob" ADD CONSTRAINT "MediaJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
