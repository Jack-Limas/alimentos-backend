import { ProposalStatus, Strategy } from '@prisma/client';
import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';

const weight = z.number().min(0).max(100);

export const proposalIdParamsSchema = z.object({ id: z.uuid() });

// strictObject: the client chooses a strategy (and optionally weights), never
// scores, quantities or lines. Anything else is a 400.
export const createProposalSchema = z.strictObject({
  strategy: z.enum(Strategy),
  weights: z
    .strictObject({ priority: weight, deadlineUrgency: weight, expiryPressure: weight })
    .optional(),
});

export const proposalListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ProposalStatus).optional(),
});

export type CreateProposalBody = z.infer<typeof createProposalSchema>;
export type ProposalListQuery = z.infer<typeof proposalListQuerySchema>;
