-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "aiBuilt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "briefConcerns" TEXT,
ADD COLUMN     "briefOutOfScope" TEXT,
ADD COLUMN     "briefProduct" TEXT;

-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "stack" JSONB,
ADD COLUMN     "stackConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "stackText" TEXT;
