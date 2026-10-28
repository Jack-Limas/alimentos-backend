import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import { proposalIdParamsSchema } from '../distribution/distribution.schemas.js';
import type { ProposalAiInsight } from '../distribution/distribution.repository.js';
import type { PlanningActor } from '../distribution/distribution.service.js';
import {
  aiLocaleBodySchema,
  explanationQuerySchema,
  type Briefing,
  type RescuePlan,
} from './ai.schemas.js';
import type { AiResponse, AiService } from './ai.service.js';

export interface AiController {
  explainProposal: (request: FastifyRequest) => Promise<AiResponse<ProposalAiInsight>>;
  rescuePlan: (request: FastifyRequest) => Promise<AiResponse<RescuePlan>>;
  briefing: (request: FastifyRequest) => Promise<AiResponse<Briefing>>;
}

// `authorize` already checked the claims, so the role is ADMIN or OPERATOR.
const plannerOf = (request: FastifyRequest): PlanningActor => ({
  ...actorOf(request),
  role: request.user.role,
});

export function createAiController(service: AiService): AiController {
  const localeOf = (request: FastifyRequest) => aiLocaleBodySchema.parse(request.body).locale;

  return {
    explainProposal: (request) => {
      const { id } = proposalIdParamsSchema.parse(request.params);
      const { refresh } = explanationQuerySchema.parse(request.query);
      return service.explainProposal(
        id,
        { locale: localeOf(request), refresh },
        plannerOf(request),
      );
    },
    rescuePlan: (request) => service.rescuePlan(localeOf(request), plannerOf(request)),
    briefing: (request) => service.briefing(localeOf(request), plannerOf(request)),
  };
}
