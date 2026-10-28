import { AUDIT_ACTIONS, type AuditService } from '../audit/index.js';
import type { Actor } from '../../shared/http/actor.js';
import type { AiAnswer, AiClient } from './ai-client.js';
import type { BriefingInput, ProposalExplanationInput, RescuePlanInput } from './ai-context.js';
import { AiError } from './ai-error.js';
import type { Briefing, ProposalExplanation, RescuePlan } from './ai.schemas.js';

export type AiEndpoint = 'proposal-explanation' | 'rescue-plan' | 'briefing';

/** What a caller of the gateway gets: the answer plus the wall time seen by the backend. */
export interface AiResult<T> extends AiAnswer<T> {
  latencyMs: number;
}

export interface AiGateway {
  readonly configured: boolean;
  explainProposal(
    input: ProposalExplanationInput,
    actor: Actor,
    entityId?: string,
  ): Promise<AiResult<ProposalExplanation>>;
  rescuePlan(input: RescuePlanInput, actor: Actor): Promise<AiResult<RescuePlan>>;
  briefing(input: BriefingInput, actor: Actor): Promise<AiResult<Briefing>>;
}

export interface AiGatewayDeps {
  client: AiClient;
  audit: AuditService;
  /** Milliseconds clock for the latency. */
  now?: () => number;
}

/**
 * Every AI call goes through here and leaves one AI_REQUESTED audit row with
 * the endpoint, the outcome category and the latency; never the prompt, the
 * answer or any key.
 */
export function createAiGateway({
  client,
  audit,
  now = () => performance.now(),
}: AiGatewayDeps): AiGateway {
  async function run<T>(
    endpoint: AiEndpoint,
    actor: Actor,
    entityId: string | undefined,
    call: () => Promise<AiAnswer<T>>,
  ): Promise<AiResult<T>> {
    const started = now();
    const record = (category: string, model?: string) =>
      audit
        .record({
          userId: actor.userId,
          action: AUDIT_ACTIONS.AI_REQUESTED,
          entity: 'AI',
          entityId: entityId ?? null,
          metadata: {
            endpoint,
            category,
            latencyMs: Math.round(now() - started),
            ...(model ? { model } : {}),
          },
          ip: actor.ip,
        })
        // Auditing never breaks the answer.
        .catch(() => undefined);

    try {
      const answer = await call();
      const latencyMs = Math.round(now() - started);
      await record('OK', answer.meta.model);
      return { ...answer, latencyMs };
    } catch (error) {
      if (error instanceof AiError) await record(error.category);
      throw error;
    }
  }

  return {
    get configured() {
      return client.configured;
    },
    explainProposal: (input, actor, entityId) =>
      run('proposal-explanation', actor, entityId, () => client.explainProposal(input)),
    rescuePlan: (input, actor) =>
      run('rescue-plan', actor, undefined, () => client.rescuePlan(input)),
    briefing: (input, actor) => run('briefing', actor, undefined, () => client.briefing(input)),
  };
}
