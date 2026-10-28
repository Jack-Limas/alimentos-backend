// Pure distribution engine: no Prisma, no clock (processingMs takes an injectable now).
export {
  buildProposal,
  MAX_RESCORES,
  type BuildOptions,
  type FulfillmentStatus,
  type ProposalLineDraft,
  type ProposalResult,
  type ProposalSummary,
  type RankedOrder,
} from './build-proposal.js';
export { isDispatchable, LotBook, MIN_DAYS_TO_DISPATCH } from './lot-book.js';
export { MinHeap } from './min-heap.js';
export {
  DEADLINE_HORIZON_DAYS,
  EXPIRY_HORIZON_DAYS,
  PRIORITY_VALUE,
  scoreOrder,
  type DistributionReason,
  type DistributionReasonCode,
  type OrderScore,
  type ScoreComponents,
} from './score.js';
export type {
  DistributionSnapshot,
  OrderPriority,
  SnapshotItem,
  SnapshotLot,
  SnapshotOrder,
  SnapshotProduct,
} from './snapshot.js';
export {
  BalancedStrategy,
  createStrategy,
  InvalidWeightsError,
  StrategyNotAvailableError,
  UrgencyFirstStrategy,
  WasteFirstStrategy,
  type PrioritizationStrategy,
} from './strategies.js';
export {
  checkWeights,
  RULE_STRATEGIES,
  STRATEGY_WEIGHTS,
  type RuleStrategyName,
  type StrategyName,
  type Weights,
  type WeightsProblem,
} from './weights.js';
