-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "aiBuilt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "briefConcerns" TEXT,
ADD COLUMN     "briefOutOfScope" TEXT,
ADD COLUMN     "briefProduct" TEXT,
ADD COLUMN     "briefSavedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "stack" JSONB,
ADD COLUMN     "stackConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "stackDetectedAt" TIMESTAMP(3),
ADD COLUMN     "stackText" TEXT;
