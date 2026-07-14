-- AddEnumValue
ALTER TYPE "EmailEventType" ADD VALUE 'opened';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "trackOpens" BOOLEAN NOT NULL DEFAULT true;
