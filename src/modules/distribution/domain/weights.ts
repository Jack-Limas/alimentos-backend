/** Weight of each score component, in points. They always add up to 100. */
export interface Weights {
  priority: number;
  deadlineUrgency: number;
  expiryPressure: number;
}

/** Strategies with their own weights; AI_ASSISTED uses BALANCED and reorders ties with the AI. */
export const RULE_STRATEGIES = ['BALANCED', 'URGENCY_FIRST', 'WASTE_FIRST'] as const;
export type RuleStrategyName = (typeof RULE_STRATEGIES)[number];
export type StrategyName = RuleStrategyName | 'AI_ASSISTED';

export const STRATEGY_WEIGHTS: Readonly<Record<RuleStrategyName, Readonly<Weights>>> =
  Object.freeze({
    BALANCED: Object.freeze({ priority: 40, deadlineUrgency: 35, expiryPressure: 25 }),
    URGENCY_FIRST: Object.freeze({ priority: 20, deadlineUrgency: 70, expiryPressure: 10 }),
    WASTE_FIRST: Object.freeze({ priority: 20, deadlineUrgency: 20, expiryPressure: 60 }),
  });

const WEIGHT_TOTAL_CENTS = 100_00;

const cents = (value: number) => Math.round(value * 100);

export type WeightsProblem = 'NEGATIVE' | 'TOO_MANY_DECIMALS' | 'SUM_NOT_100';

/**
 * Custom weights must be non-negative, have at most 2 decimals and add up to
 * exactly 100 (compared in hundredths, so 33.33 + 33.33 + 33.34 is valid).
 */
export function checkWeights(weights: Weights): WeightsProblem | null {
  const values = [weights.priority, weights.deadlineUrgency, weights.expiryPressure];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return 'NEGATIVE';
  if (values.some((value) => Math.abs(value * 100 - cents(value)) > 1e-6)) {
    return 'TOO_MANY_DECIMALS';
  }
  const total = values.reduce((sum, value) => sum + cents(value), 0);
  return total === WEIGHT_TOTAL_CENTS ? null : 'SUM_NOT_100';
}
