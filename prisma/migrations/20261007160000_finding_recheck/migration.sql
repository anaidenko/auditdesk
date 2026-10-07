-- CreateEnum
CREATE TYPE "RecheckStatus" AS ENUM ('open', 'fixed', 'changed', 'regressed');

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "recheck" "RecheckStatus",
ADD COLUMN     "recheckRunId" TEXT,
ADD COLUMN     "recheckedAt" TIMESTAMP(3),
ADD COLUMN     "recheckedSha" TEXT;

