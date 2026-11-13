-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isProtected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Every account that exists today was created by the seed (the real ones and the demo
-- ones): protect them all, so the API can never edit, deactivate or reset them.
UPDATE "users" SET "isProtected" = true;
