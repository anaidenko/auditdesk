-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "effortHoursHigh" INTEGER,
ADD COLUMN     "effortHoursLow" INTEGER;

-- Hours Andrii set become a range of one.
UPDATE "Finding" SET "effortHoursLow" = "effortHours", "effortHoursHigh" = "effortHours" WHERE "effortHours" IS NOT NULL;

ALTER TABLE "Finding" DROP COLUMN "effortHours";
