import { z } from 'zod';

/**
 * What alimentos-ai answers (contract 5). The service already sanitizes its
 * output, but the backend validates again: anything that does not match is
 * treated as UPSTREAM_ERROR.
 */
export const aiMetaSchema = z.object({
  model: z.string().min(1),
  promptVersion: z.string().optional(),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  attempts: z.number().int().positive().optional(),
  discardedItems: z.number().int().nonnegative().optional(),
});

export type AiServiceMeta = z.infer<typeof aiMetaSchema>;

export const proposalExplanationSchema = z.object({
  summary: z.string().min(1),
  highlights: z.array(z.string().min(1)).max(20),
  tieBreakOrder: z.array(z.string().min(1)).max(200).optional(),
});

export const rescuePlanSchema = z.object({
  actions: z
    .array(
      z.object({
        product: z.string().min(1),
        action: z.enum(['DONATE', 'REALLOCATE', 'PRIORITIZE']),
        rationale: z.string().min(1),
      }),
    )
    .max(200),
});

export const briefingSchema = z.object({
  summary: z.string().min(1),
  topActions: z.array(z.string().min(1)).max(20),
});

export type ProposalExplanation = z.infer<typeof proposalExplanationSchema>;
export type RescuePlan = z.infer<typeof rescuePlanSchema>;
export type Briefing = z.infer<typeof briefingSchema>;

/** `{ error: { code, category?, retryAfterSec? } }` from alimentos-ai. */
export const aiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    category: z.string().optional(),
    retryAfterSec: z.number().nonnegative().optional(),
  }),
});

/** Body of POST /ai/*: the client sends only the language (and IDs in the path). */
export const aiLocaleBodySchema = z
  .strictObject({ locale: z.enum(['es', 'en']).default('es') })
  .default({ locale: 'es' });

export const explanationQuerySchema = z.object({
  refresh: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export type AiLocale = z.infer<typeof aiLocaleBodySchema>['locale'];
