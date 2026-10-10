-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "aiExclusions" TEXT,
ADD COLUMN     "aiPolicy" JSONB,
ADD COLUMN     "aiPolicyDetected" JSONB,
ADD COLUMN     "aiPolicyDetectedAt" TIMESTAMP(3);
