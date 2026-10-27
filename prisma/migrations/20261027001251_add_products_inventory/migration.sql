-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('FRUITS_VEGETABLES', 'DAIRY', 'MEAT_POULTRY', 'FISH', 'BAKERY', 'GRAINS_LEGUMES', 'CANNED', 'BEVERAGES', 'FROZEN', 'OTHER');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('KG', 'L', 'UNIT', 'BOX');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRY', 'EXIT_DISPATCH', 'EXIT_WASTE', 'ADJUSTMENT', 'RETURN');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "unit" "Unit" NOT NULL,
    "minStock" DECIMAL(12,3) NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lots" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "lotCode" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "initialQuantity" DECIMAL(12,3) NOT NULL,
    "expiryDate" DATE NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "reason" TEXT,
    "orderId" UUID,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_name_key" ON "products"("name");

-- CreateIndex
CREATE INDEX "inventory_lots_productId_expiryDate_idx" ON "inventory_lots"("productId", "expiryDate");

-- CreateIndex
CREATE INDEX "inventory_movements_lotId_idx" ON "inventory_movements"("lotId");

-- CreateIndex
CREATE INDEX "inventory_movements_type_createdAt_idx" ON "inventory_movements"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity checks added by hand (Prisma does not model CHECK constraints).
-- Stock can never go negative, even if application code had a bug.
ALTER TABLE "products" ADD CONSTRAINT "products_minStock_nonnegative" CHECK ("minStock" >= 0);
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_initialQuantity_positive" CHECK ("initialQuantity" > 0);
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_quantity_positive" CHECK ("quantity" > 0);
