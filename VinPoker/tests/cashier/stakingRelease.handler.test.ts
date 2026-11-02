import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { expect, it, vi } from 'vitest';
import { drainStakingReleaseEffects } from '../../supabase/functions/_shared/stakingReleaseEffects';
import { deliverStakingReleaseEffect, parseReleaseDeliveryStatus } from '../../supabase/functions/_shared/stakingReleaseDelivery';

const ids = {
  request: '11111111-1111-4111-8111-111111111111',
  purchase: '22222222-2222-4222-8222-222222222222',
  deal: '33333333-3333-4333-8333-333333333333',
};
async function execute(duplicate = false, mode = 'ok') {
  let handler!: (req: Request) => Promise<Response>;
  const writes: { table: string; action: string; value: unknown }[] = [];
  let effectClaimed = false;
  const invoke = vi.fn(async () => mode === 'sendfail'
    ? { data: null, error: { message: 'LOCAL SEND UNKNOWN' } }
    : { data: { success: true, id: 'LOCAL_EMAIL_ACK' }, error: null });
  const rpc = vi.fn(async (name: string) => {
    if (name === 'get_staking_release_effect_status_for_actor_v1') return { data: { release_request_id: ids.request, deal_id: ids.deal,
      state: mode === 'sendfail' ? 'needs_attention' : 'all_delivered', total: 3, delivered: ['sendfail', 'contradict'].includes(mode) ? 2 : 3,
      pending: 0, processing: 0, needs_attention: ['sendfail', 'contradict'].includes(mode) ? 1 : 0, evidence_missing: false }, error: null };
    if (name === 'claim_staking_release_effect_v1') {
      if (effectClaimed || !['email', 'publication', 'sendfail'].includes(mode)) return { data: null, error: null };
      effectClaimed = true;
      return { data: { id: ids.purchase, release_request_id: ids.request, lease_token: ids.deal,
        kind: mode === 'publication' ? 'publication' : 'email', state: 'processing', effect_key: `staking-release:${ids.request}:email:player`,
        payload: { deal_id: ids.deal, user_id: ids.purchase, amount_vnd: 80100, role: 'player', label: '<untrusted>' } }, error: null };
    }
    if (name === 'finish_staking_release_effect_v1') return { data: true, error: null };
    if (name === 'publish_staking_release_result_v1') return { data: ids.deal, error: null };
    if (name !== 'commit_staking_release_v2') throw new Error('unexpected RPC');
    if (mode === 'lost') throw new Error('LOCAL response lost');
    if (mode === 'denied') return { data: null, error: { code: '42501' } };
    if (mode === 'conflict') return { data: null, error: { code: 'P0001' } };
    if (mode === 'malformed') return { data: { success: true }, error: null };
    return { data: { success: true, status: 'completed', release_request_id: ids.request, deal_id: ids.deal,
      amounts: { backer: 80100, player: 720900, fee: 199000 } }, error: null };
  });
  const admin = { rpc, functions: { invoke }, auth: { admin: { getUserById: async () => ({ data: { user: { email: 'sink@example.invalid' } }, error: null }) } }, from: (table: string) => {
    const q = {
      select: () => q, eq: () => q, is: () => q, limit: () => q, ilike: () => q,
      insert: (value: unknown) => { writes.push({ table, action: 'insert', value }); return q; },
      update: (value: unknown) => { writes.push({ table, action: 'update', value }); return q; },
      delete: () => { writes.push({ table, action: 'delete', value: null }); return q; },
      maybeSingle: async () => ({ data: table === 'staking_release_requests'
        ? { id: ids.request, deal_id: ids.deal, status: 'approved', executed_at: null, cosigned_by_admin_id: 'cosigner' }
        : table === 'staking_deals' ? { id: ids.deal, status: 'cosigned', player_id: 'player', club_id: 'club',
          result_prize_vnd: 1000000, filled_percent: 10, platform_archive_fee: 199000,
          backer_payout_vnd: 80100, player_payout_vnd: 720900 }
        : { id: 'existing-result' }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'staking_purchases'
        ? [{ id: ids.purchase, backer_id: 'backer', percent: 10, status: 'funded' }] : null, error: null }).then(resolve),
    };
    return q;
  } };
  const clientFactory = vi.fn(() => admin);
  const source = readFileSync('supabase/functions/staking-execute-release/index.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    z, Response, Request, Date, console: { error: vi.fn() }, drainStakingReleaseEffects,
    deliverStakingReleaseEffect, parseReleaseDeliveryStatus,
    corsHeaders: {}, json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    authenticateUser: async () => ({ uid: 'operator' }), createAdminClient: clientFactory,
    requireAdminRoles: async () => ({ isSuper: true, isCashier: false }), requireClubAccess: async () => undefined,
    parseBody: async (req: Request, schema: z.ZodType) => {
      const result = schema.safeParse(await req.json());
      return result.success ? { ok: true, data: result.data } : { ok: false, response: new Response('invalid', { status: 400 }) };
    },
    Deno: { env: { get: () => 'LOCAL_ONLY' }, serve: (fn: typeof handler) => { handler = fn; } },
  });
  const payout = { purchase_id: ids.purchase, payout_method: 'cash', paid: true };
  const response = await handler(new Request('http://local.invalid/release', { method: 'POST', body: JSON.stringify({
    release_request_id: ids.request, preview_hash: 'a'.repeat(32), player_paid: true, backer_payouts: duplicate ? [payout, payout] : [payout],
  }) }));
  return { response, writes, rpc, invoke, clientFactory };
}

it('rejects duplicate purchase confirmations before any financial write', async () => {
  const { response, writes } = await execute(true);
  expect(response.status).toBe(400);
  expect(writes).toEqual([]);
});
it('preserves the existing single purchase payout amounts for valid input', async () => {
  const { response, writes, rpc, clientFactory } = await execute();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, amounts: { backer: 80100, player: 720900, fee: 199000 } });
  expect(writes).toEqual([]);
  expect(rpc.mock.calls.filter(([name]) => name === 'commit_staking_release_v2')).toHaveLength(1);
  expect(clientFactory).toHaveBeenCalledWith({ retry: false });
});
it.each([['lost', 500], ['denied', 403], ['conflict', 409], ['malformed', 502]] as const)('fails closed for %s without legacy financial fallback', async (mode, status) => {
  const { response, writes, rpc } = await execute(false, mode);
  expect(response.status).toBe(status);expect(writes).toEqual([]);
  expect(rpc.mock.calls.some(([name]) => name === 'claim_staking_release_effect_v1')).toBe(false);
});
it.each(['email', 'publication', 'sendfail'])('separates committed money from %s delivery outcome', async mode => {
  const { response, writes, rpc, invoke } = await execute(false, mode);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, delivery: { state: mode === 'sendfail' ? 'needs_attention' : 'all_delivered' }, effects: {
    delivered: mode === 'sendfail' ? 0 : 1, needsAttention: mode === 'sendfail' ? 1 : 0,
  } });
  expect(writes).toEqual([]);
  if (mode === 'publication') {
    expect(invoke).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('publish_staking_release_result_v1', { p_effect: ids.purchase, p_token: ids.deal });
  } else {
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('send-email', expect.objectContaining({ body: expect.objectContaining({ html: expect.stringContaining('&lt;untrusted&gt;') }) }));
  }
});
it('does not display all-delivered for a contradictory delivery summary', async () => {
  const { response } = await execute(false, 'contradict');
  expect(await response.json()).toMatchObject({ success: true, delivery: { state: 'unavailable' } });
});
