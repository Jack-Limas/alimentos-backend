-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "Strategy" AS ENUM ('BALANCED', 'URGENCY_FIRST', 'WASTE_FIRST', 'AI_ASSISTED');

-- CreateTable
CREATE TABLE "distribution_proposals" (
    "id" UUID NOT NULL,
    "strategy" "Strategy" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "weights" JSONB NOT NULL,
    "businessDate" DATE NOT NULL,
    "processingMs" INTEGER NOT NULL,
    "itemsProcessed" INTEGER NOT NULL,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribution_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_lines" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "lotId" UUID,
    "rank" INTEGER NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "requestedQty" DECIMAL(12,3) NOT NULL,
    "availableQty" DECIMAL(12,3) NOT NULL,
    "recommendedQty" DECIMAL(12,3) NOT NULL,
    "reasons" JSONB NOT NULL,

    CONSTRAINT "proposal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "distribution_proposals_status_createdAt_idx" ON "distribution_proposals"("status", "createdAt");

-- CreateIndex
CREATE INDEX "proposal_lines_proposalId_rank_idx" ON "proposal_lines"("proposalId", "rank");

-- CreateIndex
CREATE INDEX "inventory_movements_orderId_idx" ON "inventory_movements"("orderId");

-- AddForeignKey
ALTER TABLE "distribution_proposals" ADD CONSTRAINT "distribution_proposals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_proposals" ADD CONSTRAINT "distribution_proposals_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "distribution_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Quantity checks (Prisma does not model CHECK constraints)
ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_requestedQty_positive" CHECK ("requestedQty" > 0);
ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_availableQty_nonnegative" CHECK ("availableQty" >= 0);
ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_recommendedQty_nonnegative" CHECK ("recommendedQty" >= 0);
