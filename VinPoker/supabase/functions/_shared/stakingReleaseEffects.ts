// Dedicated release outbox orchestration. No credentials, timers, or automatic send retries.
export interface ReleaseEffect {
  id: string;
  release_request_id: string;
  lease_token: string;
  kind: 'email' | 'publication';
  state: 'processing';
  effect_key: string;
  payload: Record<string, unknown>;
}
interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
interface DrainResult {
  state: 'no_pending' | 'pending' | 'error';
  delivered: number;
  needsAttention: number;
  error?: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validJob(value: unknown, request: string): value is ReleaseEffect {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<ReleaseEffect>;
  return typeof job.id === 'string' && uuid.test(job.id)
    && job.release_request_id === request && typeof job.lease_token === 'string' && uuid.test(job.lease_token)
    && job.state === 'processing' && (job.kind === 'email' || job.kind === 'publication')
    && typeof job.effect_key === 'string' && job.effect_key.startsWith(`staking-release:${request}:`)
    && !!job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload);
}

export async function drainStakingReleaseEffects(
  client: RpcClient,
  request: string,
  deliver: (job: ReleaseEffect) => Promise<{ providerId: string }>,
): Promise<DrainResult> {
  const result: DrainResult = { state: 'pending', delivered: 0, needsAttention: 0 };
  const fail = (error: string): DrainResult => ({ ...result, state: 'error', error });
  if (!uuid.test(request)) return fail('invalid_release_request');
  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) {
    let claimed;
    try { claimed = await client.rpc('claim_staking_release_effect_v1', { p_request: request }); }
    catch { return fail('effect_claim_unavailable'); }
    if (claimed.error) return fail('effect_claim_unavailable');
    // no_pending is not "all delivered": unknown jobs may be held for review.
    if (claimed.data === null) return { ...result, state: 'no_pending' };
    if (!validJob(claimed.data, request) || seen.has(claimed.data.id)) return fail('invalid_effect_contract');
    const job = claimed.data;
    seen.add(job.id);
    let providerId: string | null = null;
    let errorCode: string | null = null;
    try {
      const acknowledgement = await deliver(job);
      if (typeof acknowledgement?.providerId !== 'string' || !acknowledgement.providerId.trim()
        || acknowledgement.providerId.length > 500) throw new Error('invalid_provider_ack');
      providerId = acknowledgement.providerId;
    } catch {
      // Redact provider details; retain durable unknown state, never blind resend.
      errorCode = 'delivery_failed_or_unknown';
    }
    let finished;
    try {
      finished = await client.rpc('finish_staking_release_effect_v1', {
        p_id: job.id, p_token: job.lease_token, p_provider_id: providerId, p_error_code: errorCode,
      });
    } catch { return fail('effect_ack_unknown'); }
    if (finished.error || finished.data !== true) return fail('effect_ack_unknown');
    if (errorCode) result.needsAttention++;
    else result.delivered++;
  }
  return result;
}
