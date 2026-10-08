-- CreateTable
CREATE TABLE "PlanReading" (
    "id" BIGSERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "utilization" DOUBLE PRECISION NOT NULL,
    "resetsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanReading_runId_id_idx" ON "PlanReading"("runId", "id");

-- AddForeignKey
ALTER TABLE "PlanReading" ADD CONSTRAINT "PlanReading_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The readings runs logged before this table, in the activity log's own words (run-aspect-sdk.ts):
-- whole per cent, and no reset time, which the log gave as a clock time only.
INSERT INTO "PlanReading" ("runId", "utilization", "createdAt")
SELECT "runId", (regexp_match("message", '^Claude plan: 5-hour usage ([0-9]+)%'))[1]::DOUBLE PRECISION / 100, "createdAt"
FROM "RunEvent"
WHERE "message" ~ '^Claude plan: 5-hour usage [0-9]+%'
ORDER BY "id";
