import { z } from 'zod';
const count = z.number().int().nonnegative().max(102);
const schema = z.object({
  release_request_id: z.string().uuid(), deal_id: z.string().uuid(),
  state: z.enum(['pending', 'needs_attention', 'all_delivered']), total: count,
  pending: count, processing: count, delivered: count, needs_attention: count, evidence_missing: z.boolean(),
});
export type StakingReleaseDelivery = z.infer<typeof schema>;
export function parseStakingReleaseDelivery(value: unknown, request: string, deal: string): StakingReleaseDelivery | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  if (data.release_request_id !== request || data.deal_id !== deal
    || data.total !== data.pending + data.processing + data.delivered + data.needs_attention
    || data.evidence_missing !== (data.total === 0)
    || data.state !== (data.needs_attention > 0 || data.total === 0 ? 'needs_attention' : data.pending + data.processing > 0 ? 'pending' : 'all_delivered')) return null;
  return data;
}
