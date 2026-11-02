import { expect, it, vi } from 'vitest';
import { drainStakingReleaseEffects } from '../../supabase/functions/_shared/stakingReleaseEffects';

const request = '11111111-1111-4111-8111-111111111111';
const job = { id: '22222222-2222-4222-8222-222222222222', release_request_id: request,
  lease_token: '33333333-3333-4333-8333-333333333333', kind: 'email', state: 'processing',
  effect_key: `staking-release:${request}:email:player`, payload: { user_id: 'test-user', amount_vnd: 80100 } };

function setup() {
  let claimed = false;
  const rpc = vi.fn(async (name: string) => name === 'claim_staking_release_effect_v1'
    ? { data: claimed ? null : (claimed = true, job), error: null }
    : { data: true, error: null });
  const deliver = vi.fn(async () => ({ providerId: 'LOCAL_SINK_ACK' }));
  return { rpc, deliver };
}
it('records provider ack through the exact lease, without writing ledger or direct tables', async () => {
  const h = setup();
  const result = await drainStakingReleaseEffects(h, request, h.deliver);
  expect(result).toMatchObject({ state: 'no_pending', delivered: 1, needsAttention: 0 });
  expect(h.rpc).toHaveBeenCalledWith('finish_staking_release_effect_v1', {
    p_id: job.id, p_token: job.lease_token, p_provider_id: 'LOCAL_SINK_ACK', p_error_code: null,
  });
  expect(h.deliver).toHaveBeenCalledTimes(1);
});
it('marks a rejected send unknown and never retries it in the same drain', async () => {
  const h = setup();h.deliver.mockRejectedValue(new Error('SECRET PROVIDER DETAIL'));
  expect(await drainStakingReleaseEffects(h, request, h.deliver)).toMatchObject({ needsAttention: 1, delivered: 0 });
  expect(h.rpc).toHaveBeenCalledWith('finish_staking_release_effect_v1', expect.objectContaining({
    p_provider_id: null, p_error_code: 'delivery_failed_or_unknown',
  }));
  expect(JSON.stringify(h.rpc.mock.calls)).not.toContain('SECRET');
  expect(h.deliver).toHaveBeenCalledTimes(1);
});
it('stops on lost finish response rather than sending again', async () => {
  const h = setup();h.rpc.mockImplementation(async name => {
    if (name === 'finish_staking_release_effect_v1') throw new Error('ack lost');
    return { data: job, error: null };
  });
  expect(await drainStakingReleaseEffects(h, request, h.deliver)).toMatchObject({ state: 'error', error: 'effect_ack_unknown' });
  expect(h.deliver).toHaveBeenCalledTimes(1);
});
it.each([{ ...job, release_request_id: 'wrong-request' }, { ...job, lease_token: null }, { ...job, kind: 'unexpected' }])('rejects a malformed or cross-request job before delivery', async bad => {
  const h = setup();h.rpc.mockResolvedValue({ data: bad, error: null });
  expect(await drainStakingReleaseEffects(h, request, h.deliver)).toMatchObject({ state: 'error', error: 'invalid_effect_contract' });
  expect(h.deliver).not.toHaveBeenCalled();
});
it('does not treat an invalid provider acknowledgement as delivered', async () => {
  const h = setup();h.deliver.mockResolvedValue({ providerId: '' });
  expect(await drainStakingReleaseEffects(h, request, h.deliver)).toMatchObject({ needsAttention: 1, delivered: 0 });
});
it('bounds work and reports remaining work instead of claiming completion', async () => {
  let index = 0;
  const h = setup();h.rpc.mockImplementation(async name => ({ data: name === 'claim_staking_release_effect_v1'
    ? { ...job, id: `22222222-2222-4222-8222-${String(++index).padStart(12, '0')}` } : true, error: null }));
  expect(await drainStakingReleaseEffects(h, request, h.deliver)).toMatchObject({ state: 'pending', delivered: 4 });
  expect(h.deliver).toHaveBeenCalledTimes(4);
});
it('does not execute a duplicate job returned by a broken claim contract twice', async () => {
  const h = setup();h.rpc.mockImplementation(async name => ({ data: name === 'claim_staking_release_effect_v1' ? job : true, error: null }));
  expect(await drainStakingReleaseEffects(h, request, h.deliver)).toMatchObject({ state: 'error', error: 'invalid_effect_contract' });
  expect(h.deliver).toHaveBeenCalledTimes(1);
});
