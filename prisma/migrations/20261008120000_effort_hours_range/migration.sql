-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "effortHoursHigh" INTEGER,
ADD COLUMN     "effortHoursLow" INTEGER;

-- Hours Andrii set become a range of one, from 1 h, and the size follows them as the editor's does.
UPDATE "Finding"
SET "effortHoursLow" = GREATEST("effortHours", 1),
    "effortHoursHigh" = GREATEST("effortHours", 1),
    "effort" = CASE WHEN "effortHours" <= 2 THEN 'S' WHEN "effortHours" <= 16 THEN 'M' ELSE 'L' END
WHERE "effortHours" IS NOT NULL;

ALTER TABLE "Finding" DROP COLUMN "effortHours";
