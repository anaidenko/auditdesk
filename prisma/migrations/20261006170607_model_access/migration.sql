CREATE TYPE "ModelAccess" AS ENUM ('claude_plan', 'api_key');

ALTER TABLE "Project" ADD COLUMN "modelAccess" "ModelAccess" NOT NULL DEFAULT 'claude_plan';

-- Every run before this migration ran on the Messages API engine.
ALTER TABLE "Run" ADD COLUMN "modelAccess" "ModelAccess" NOT NULL DEFAULT 'api_key';
ALTER TABLE "Run" ALTER COLUMN "modelAccess" SET DEFAULT 'claude_plan';
