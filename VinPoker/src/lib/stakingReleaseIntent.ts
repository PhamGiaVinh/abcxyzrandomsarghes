import { z } from 'zod';

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const StakingReleaseIntentSchema = z.object({
  actorId: z.string().min(1), dealId: z.string().uuid(),
  amounts: z.object({ backer: money, player: money, fee: money }).strict(),
  payload: z.object({
    release_request_id: z.string().uuid(), preview_hash: z.string().regex(/^[a-f0-9]{32}$/), player_paid: z.literal(true),
    backer_payouts: z.array(z.object({
      purchase_id: z.string().uuid(), payout_method: z.enum(['cash', 'bank_transfer']),
      proof_url: z.string().url().max(2048).nullable(), paid: z.literal(true),
    }).strict()).min(1).max(100).refine(rows => new Set(rows.map(row => row.purchase_id)).size === rows.length),
  }).strict(),
}).strict();
export type StakingReleaseIntent = z.infer<typeof StakingReleaseIntentSchema>;
const PreparationSchema = StakingReleaseIntentSchema.extend({ payload: StakingReleaseIntentSchema.shape.payload.omit({ release_request_id: true }) });
export type StakingReleasePreparation = z.infer<typeof PreparationSchema>;
export const stakingReleasePreparationKey = (actor: string, deal: string) => `vinpoker:staking-release-preparation:v1:${actor}:${deal}`;
export function readStakingReleasePreparation(storage: Pick<Storage, 'getItem'>, actor: string, deal: string) {
  const raw = storage.getItem(stakingReleasePreparationKey(actor, deal));
  if (raw === null) return null;
  const value = PreparationSchema.parse(JSON.parse(raw));
  if (value.actorId !== actor || value.dealId !== deal) throw new Error('STAKING_PREPARATION_SCOPE_INVALID');
  return value;
}
export function prepareStakingReleaseIntent(intent: StakingReleaseIntent): StakingReleasePreparation {
  const { release_request_id: _request, ...payload } = intent.payload;
  return PreparationSchema.parse({ ...intent, payload });
}
export function persistStakingReleasePreparation(storage: Pick<Storage, 'getItem' | 'setItem'>, value: StakingReleasePreparation) {
  const key = stakingReleasePreparationKey(value.actorId, value.dealId), raw = JSON.stringify(PreparationSchema.parse(value));
  const current = storage.getItem(key);
  if (current !== null && current !== raw) throw new Error('STAKING_PREPARATION_PENDING');
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error('STAKING_PREPARATION_SAVE_FAILED');
}
export function clearStakingReleasePreparation(storage: Pick<Storage, 'getItem' | 'removeItem'>, value: StakingReleasePreparation) {
  const key = stakingReleasePreparationKey(value.actorId, value.dealId), raw = storage.getItem(key);
  if (raw === null) return;
  if (raw !== JSON.stringify(PreparationSchema.parse(value))) throw new Error('STAKING_PREPARATION_CHANGED');
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error('STAKING_PREPARATION_CLEAR_FAILED');
}
export const stakingReleaseJournalKey = (actor: string, deal: string) => `vinpoker:staking-release:v1:${actor}:${deal}`;
export function readStakingReleaseIntent(storage: Pick<Storage, 'getItem'>, actor: string, deal: string) {
  const raw = storage.getItem(stakingReleaseJournalKey(actor, deal));
  if (raw === null) return null;
  const intent = StakingReleaseIntentSchema.parse(JSON.parse(raw));
  if (intent.actorId !== actor || intent.dealId !== deal) throw new Error('STAKING_JOURNAL_SCOPE_INVALID');
  const preparing = readStakingReleasePreparation(storage, actor, deal);
  if (preparing && JSON.stringify(preparing) !== JSON.stringify(prepareStakingReleaseIntent(intent))) throw new Error('STAKING_PREPARATION_CHANGED');
  return intent;
}
export function persistStakingReleaseIntent(storage: Pick<Storage, 'getItem' | 'setItem'>, intent: StakingReleaseIntent) {
  const preparing = readStakingReleasePreparation(storage, intent.actorId, intent.dealId);
  if (preparing && JSON.stringify(preparing) !== JSON.stringify(prepareStakingReleaseIntent(intent))) throw new Error('STAKING_PREPARATION_CHANGED');
  const key = stakingReleaseJournalKey(intent.actorId, intent.dealId), raw = JSON.stringify(StakingReleaseIntentSchema.parse(intent));
  const current = storage.getItem(key);
  if (current !== null && current !== raw) throw new Error('STAKING_JOURNAL_PENDING');
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error('STAKING_JOURNAL_SAVE_FAILED');
}
export function clearStakingReleaseIntent(storage: Pick<Storage, 'getItem' | 'removeItem'>, intent: StakingReleaseIntent) {
  const key = stakingReleaseJournalKey(intent.actorId, intent.dealId), raw = storage.getItem(key);
  if (raw === null) return;
  if (raw !== JSON.stringify(StakingReleaseIntentSchema.parse(intent))) throw new Error('STAKING_JOURNAL_CHANGED');
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error('STAKING_JOURNAL_CLEAR_FAILED');
}
