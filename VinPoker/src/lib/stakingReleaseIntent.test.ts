import { beforeEach, expect, it } from 'vitest';
import { clearStakingReleaseIntent, persistStakingReleaseIntent, readStakingReleaseIntent, stakingReleaseJournalKey, prepareStakingReleaseIntent, persistStakingReleasePreparation, readStakingReleasePreparation, clearStakingReleasePreparation, type StakingReleaseIntent } from './stakingReleaseIntent';
const intent: StakingReleaseIntent = {
  actorId: 'actor-a', dealId: '33333333-3333-4333-8333-333333333333', amounts: { backer: 80100, player: 720900, fee: 199000 },
  payload: { release_request_id: '11111111-1111-4111-8111-111111111111', preview_hash: 'a'.repeat(32), player_paid: true,
    backer_payouts: [{ purchase_id: '22222222-2222-4222-8222-222222222222', payout_method: 'cash', proof_url: null, paid: true }] },
};
beforeEach(() => localStorage.clear());
it('recovers preparation without a request UUID and promotes only the identical frozen payload', () => {
  const preparation = prepareStakingReleaseIntent(intent);persistStakingReleasePreparation(localStorage, preparation);
  expect(readStakingReleasePreparation(localStorage, intent.actorId, intent.dealId)).toEqual(preparation);
  expect(readStakingReleasePreparation(localStorage, 'other-actor', intent.dealId)).toBeNull();
  persistStakingReleaseIntent(localStorage, intent);
  expect(readStakingReleaseIntent(localStorage, intent.actorId, intent.dealId)).toEqual(intent);
  clearStakingReleasePreparation(localStorage, preparation);
  expect(readStakingReleaseIntent(localStorage, intent.actorId, intent.dealId)).toEqual(intent);
});
it('does not promote or clear a preparation with changed payees/proofs/amounts', () => {
  const preparation = prepareStakingReleaseIntent(intent);persistStakingReleasePreparation(localStorage, preparation);
  const changed = { ...intent, amounts: { ...intent.amounts, player: 1 } };
  expect(() => persistStakingReleaseIntent(localStorage, changed)).toThrow('STAKING_PREPARATION_CHANGED');
  expect(() => clearStakingReleasePreparation(localStorage, prepareStakingReleaseIntent(changed))).toThrow('STAKING_PREPARATION_CHANGED');
  expect(readStakingReleasePreparation(localStorage, intent.actorId, intent.dealId)).toEqual(preparation);
});
it('fails closed if preparation storage drops a write', () => {
  expect(() => persistStakingReleasePreparation({ getItem: () => null, setItem: () => {} }, prepareStakingReleaseIntent(intent))).toThrow('STAKING_PREPARATION_SAVE_FAILED');
});
it('recovers exact intent after serialization and isolates actors/deals', () => {
  persistStakingReleaseIntent(localStorage, intent);
  expect(readStakingReleaseIntent(localStorage, intent.actorId, intent.dealId)).toEqual(intent);
  expect(readStakingReleaseIntent(localStorage, 'actor-b', intent.dealId)).toBeNull();
  clearStakingReleaseIntent(localStorage, intent);
  expect(readStakingReleaseIntent(localStorage, intent.actorId, intent.dealId)).toBeNull();
});
it('does not replace or clear a different pending payload', () => {
  persistStakingReleaseIntent(localStorage, intent);
  const other = { ...intent, payload: { ...intent.payload, preview_hash: 'b'.repeat(32) } };
  expect(() => persistStakingReleaseIntent(localStorage, other)).toThrow('STAKING_JOURNAL_PENDING');
  expect(() => clearStakingReleaseIntent(localStorage, other)).toThrow('STAKING_JOURNAL_CHANGED');
  expect(readStakingReleaseIntent(localStorage, intent.actorId, intent.dealId)).toEqual(intent);
});
it.each(['broken-json', JSON.stringify({ ...intent, actorId: 'actor-b' }), JSON.stringify({ ...intent, amounts: { ...intent.amounts, backer: -1 } })])('rejects corrupt/scope-invalid data without deleting evidence', raw => {
  const key = stakingReleaseJournalKey(intent.actorId, intent.dealId);localStorage.setItem(key, raw);
  expect(() => readStakingReleaseIntent(localStorage, intent.actorId, intent.dealId)).toThrow();
  expect(localStorage.getItem(key)).toBe(raw);
});
it('does not report persisted when storage silently drops the write', () => {
  expect(() => persistStakingReleaseIntent({ getItem: () => null, setItem: () => {} }, intent)).toThrow('STAKING_JOURNAL_SAVE_FAILED');
});
