import type {
  OrderPriority,
  OrderStatus,
  Prisma,
  ProposalStatus,
  Strategy,
  Unit,
} from '@prisma/client';
import type { NewAuditLog } from '../audit/index.js';
import type {
  DistributionReason,
  ProposalSummary,
  RankedOrder,
  SnapshotLot,
  SnapshotOrder,
  Weights,
} from './domain/index.js';

/** A PENDING order as the snapshot shows it: engine fields plus what the UI displays. */
export interface SnapshotOrderRow extends SnapshotOrder {
  customerName: string;
}

export interface SnapshotProductRow {
  id: string;
  name: string;
  unit: Unit;
}

export interface SnapshotRows {
  orders: SnapshotOrderRow[];
  lots: SnapshotLot[];
  products: SnapshotProductRow[];
}

/** Stored summary: the engine summary plus the ranking of every order. */
export type StoredSummary = ProposalSummary & { ranking: RankedOrder[] };

export interface ProposalRecord {
  id: string;
  strategy: Strategy;
  status: ProposalStatus;
  weights: Weights;
  /** @db.Date, read as midnight UTC. */
  businessDate: Date;
  processingMs: number;
  itemsProcessed: number;
  degraded: boolean;
  summary: StoredSummary;
  createdById: string;
  confirmedById: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
}

export interface ProposalLineRecord {
  id: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  lotId: string | null;
  rank: number;
  score: Prisma.Decimal;
  requestedQty: Prisma.Decimal;
  availableQty: Prisma.Decimal;
  recommendedQty: Prisma.Decimal;
  reasons: DistributionReason[];
  order: {
    number: number;
    priority: OrderPriority;
    status: OrderStatus;
    dueDate: Date;
    customerName: string;
  };
  product: { name: string; unit: Unit };
  lot: { lotCode: string | null; expiryDate: Date } | null;
}

export interface ProposalDetailRecord extends ProposalRecord {
  /** Ordered by rank, then by line insertion order. */
  lines: ProposalLineRecord[];
}

export interface NewProposalLine {
  id: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  lotId: string | null;
  rank: number;
  score: number;
  requestedQty: number;
  availableQty: number;
  recommendedQty: number;
  reasons: DistributionReason[];
}

export interface NewProposal {
  id: string;
  strategy: Strategy;
  weights: Weights;
  businessDate: Date;
  processingMs: number;
  itemsProcessed: number;
  summary: StoredSummary;
  createdById: string;
  lines: NewProposalLine[];
  audit: NewAuditLog;
}

export interface ConfirmAllocation {
  movementId: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  lotId: string;
  qty: number;
}

export interface ConfirmProposal {
  proposalId: string;
  userId: string;
  confirmedAt: Date;
  /** Every line with recommendedQty > 0, in rank order. */
  allocations: ConfirmAllocation[];
  /** Orders with at least one allocation, each with its history row id. */
  orders: { orderId: string; historyId: string }[];
  /** Note on the history rows and reason of the movements: "proposal:<id>". */
  note: string;
  audit: NewAuditLog;
}

export type StaleReason = 'NOT_DRAFT' | 'STOCK_CHANGED' | 'ORDER_CHANGED';

/**
 * The proposal no longer matches the database (another confirmation, an exit
 * or a cancellation happened in between). Nothing of the confirmation was stored.
 */
export class StaleProposalError extends Error {
  constructor(
    public readonly reason: StaleReason,
    public readonly details: { lotId?: string; productId?: string; orderId?: string } = {},
  ) {
    super(`The proposal is stale: ${reason}`);
    this.name = 'StaleProposalError';
  }
}

export interface DistributionRepository {
  /**
   * PENDING orders with their items, lots with stock expiring on or after
   * `minExpiry`, and the products they mention. Three queries in total.
   */
  loadSnapshot(minExpiry: Date): Promise<SnapshotRows>;
  /** Proposal + lines + audit row in one transaction. */
  createProposal(proposal: NewProposal): Promise<ProposalRecord>;
  /** Newest first. */
  listProposals(
    filter: { status?: ProposalStatus | undefined },
    page: { skip: number; take: number },
  ): Promise<{ items: ProposalRecord[]; total: number }>;
  findProposal(id: string): Promise<ProposalDetailRecord | null>;
  /**
   * All in one transaction: DRAFT → CONFIRMED, conditional lot decrements,
   * EXIT_DISPATCH movements, allocatedQty, PENDING → IN_PREPARATION, history
   * and audit. Throws StaleProposalError and rolls everything back when any
   * condition fails.
   */
  confirm(input: ConfirmProposal): Promise<void>;
  /** DRAFT → DISCARDED with its audit row; false when it was not DRAFT. */
  discard(id: string, audit: NewAuditLog): Promise<boolean>;
}
