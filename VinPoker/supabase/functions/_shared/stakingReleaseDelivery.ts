import { emailPayoutExecuted } from './emailTemplates.ts';
import type { ReleaseEffect } from './stakingReleaseEffects.ts';

interface DeliveryClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  auth: { admin: { getUserById(id: string): PromiseLike<{ data: { user: { email?: string | null } | null } | null; error: unknown }> } };
  functions: { invoke(name: string, options: { body: unknown }): PromiseLike<{ data: unknown; error: unknown }> };
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export async function deliverStakingReleaseEffect(client: DeliveryClient, job: ReleaseEffect): Promise<{ providerId: string }> {
  if (job.kind === 'publication') {
    const result = await client.rpc('publish_staking_release_result_v1', { p_effect: job.id, p_token: job.lease_token });
    if (result.error || typeof result.data !== 'string' || !uuid.test(result.data)) throw new Error('publication_not_acknowledged');
    return { providerId: result.data };
  }
  const payload = job.payload;
  if (typeof payload.deal_id !== 'string' || !uuid.test(payload.deal_id)
    || typeof payload.user_id !== 'string' || !uuid.test(payload.user_id)
    || typeof payload.amount_vnd !== 'number' || !Number.isSafeInteger(payload.amount_vnd) || payload.amount_vnd < 0
    || !['player', 'backer'].includes(String(payload.role)) || typeof payload.label !== 'string' || !payload.label)
    throw new Error('invalid_delivery_payload');
  const user = await client.auth.admin.getUserById(payload.user_id);
  const email = user.data?.user?.email;
  if (user.error || !email) throw new Error('recipient_unavailable');
  const template = emailPayoutExecuted({ deal_id: payload.deal_id, amount_vnd: payload.amount_vnd,
    role: payload.role as 'player' | 'backer', label: payload.label });
  const sent = await client.functions.invoke('send-email', { body: { to: email, ...template } });
  if (sent.error || !record(sent.data) || sent.data.success !== true || typeof sent.data.id !== 'string' || !sent.data.id.trim())
    throw new Error('email_not_acknowledged');
  return { providerId: sent.data.id };
}

export interface ReleaseDeliveryStatus {
  release_request_id: string; deal_id: string; state: 'pending' | 'needs_attention' | 'all_delivered';
  total: number; delivered: number; pending: number; processing: number; needs_attention: number; evidence_missing: boolean;
}
export function parseReleaseDeliveryStatus(value: unknown, request: string, deal?: string): ReleaseDeliveryStatus | null {
  if (!record(value) || value.release_request_id !== request || typeof value.deal_id !== 'string' || !uuid.test(value.deal_id)
    || (deal !== undefined && value.deal_id !== deal)) return null;
  for (const key of ['total', 'delivered', 'pending', 'processing', 'needs_attention']) {
    if (typeof value[key] !== 'number' || !Number.isInteger(value[key]) || value[key] < 0 || value[key] > 102) return null;
  }
  const data = value as unknown as ReleaseDeliveryStatus;
  if (data.total !== data.delivered + data.pending + data.processing + data.needs_attention || data.evidence_missing !== (data.total === 0)
    || data.state !== (data.needs_attention > 0 || data.total === 0 ? 'needs_attention' : data.pending + data.processing > 0 ? 'pending' : 'all_delivered')) return null;
  return data;
}
