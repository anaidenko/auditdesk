-- CreateEnum
CREATE TYPE "RecheckStatus" AS ENUM ('unchanged', 'open', 'fixed', 'changed', 'regressed');

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "recheck" "RecheckStatus",
ADD COLUMN     "recheckDigest" TEXT,
ADD COLUMN     "recheckGone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recheckRunId" TEXT,
ADD COLUMN     "recheckedAt" TIMESTAMP(3),
ADD COLUMN     "recheckedSha" TEXT;

