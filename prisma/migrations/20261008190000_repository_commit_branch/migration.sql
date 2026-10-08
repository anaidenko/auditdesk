-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "commitBranch" TEXT;


-- Before this column a repository's branch could not change, so every clone so far was of it.
UPDATE "Repository" SET "commitBranch" = "branch" WHERE "commitSha" IS NOT NULL;
