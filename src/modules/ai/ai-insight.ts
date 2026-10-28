import type { ProposalAiInsight } from '../distribution/distribution.repository.js';
import type { AiResult } from './ai-gateway.js';
import type { AiLocale, ProposalExplanation } from './ai.schemas.js';

/** What is stored in DistributionProposal.aiInsight: the explanation and how it was made. */
export function toProposalInsight(
  answer: AiResult<ProposalExplanation>,
  locale: AiLocale,
  generatedAt: Date,
): ProposalAiInsight {
  const { summary, highlights, tieBreakOrder } = answer.data;
  return {
    summary,
    highlights,
    ...(tieBreakOrder && tieBreakOrder.length > 0 ? { tieBreakOrder } : {}),
    locale,
    model: answer.meta.model,
    ...(answer.meta.promptVersion ? { promptVersion: answer.meta.promptVersion } : {}),
    latencyMs: answer.latencyMs,
    generatedAt: generatedAt.toISOString(),
  };
}
