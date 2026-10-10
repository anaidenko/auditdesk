-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "aiExclusions" TEXT,
ADD COLUMN     "aiPolicy" JSONB,
ADD COLUMN     "aiPolicyAt" TIMESTAMP(3),
ADD COLUMN     "aiPolicyDetected" JSONB,
ADD COLUMN     "aiPolicyDetectedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "aiPolicies" JSONB;
