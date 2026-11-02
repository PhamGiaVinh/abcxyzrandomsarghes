import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { expect, it, vi } from 'vitest';
import { drainStakingReleaseEffects } from '../../supabase/functions/_shared/stakingReleaseEffects';
import { deliverStakingReleaseEffect, parseReleaseDeliveryStatus } from '../../supabase/functions/_shared/stakingReleaseDelivery';

const request = '11111111-1111-4111-8111-111111111111', deal = '33333333-3333-4333-8333-333333333333';
async function setup(mode = 'ok') {
  let handler!: (req: Request) => Promise<Response>;
  const jobs = Array.from({ length: 6 }, (_, i) => ({ id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, '0')}`,
    state: 'pending', release_request_id: request, lease_token: deal, kind: 'email', effect_key: `staking-release:${request}:email:${i}`,
    payload: { deal_id: deal, user_id: deal, amount_vnd: 100, role: 'backer', label: 'LOCAL SINK ONLY' } }));
  const invoke = vi.fn(async () => ({ data: { success: true, id: 'LOCAL_ACK' }, error: null }));
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'get_staking_release_effect_status_for_actor_v1') {
      if (mode === 'denied') return { data: null, error: { code: '42501' } };
      if (mode === 'no-receipt') return { data: { state: 'financial_not_verified' }, error: null };
      const delivered = jobs.filter(job => job.state === 'delivered').length, pending = jobs.filter(job => job.state === 'pending').length;
      const processing = jobs.filter(job => job.state === 'processing').length, held = jobs.filter(job => job.state === 'needs_attention').length;
      return { data: { release_request_id: request, deal_id: deal, state: held ? 'needs_attention' : pending + processing ? 'pending' : 'all_delivered',
        total: jobs.length, delivered, pending, processing, needs_attention: held, evidence_missing: false }, error: null };
    }
    if (name === 'claim_staking_release_effect_v1') {
      const job = jobs.find(row => row.state === 'pending');if (job) job.state = 'processing';return { data: job ?? null, error: null };
    }
    if (name === 'finish_staking_release_effect_v1') {
      const job = jobs.find(row => row.id === args.p_id)!;job.state = args.p_error_code ? 'needs_attention' : 'delivered';
      return { data: true, error: null };
    }
    throw new Error('FINANCIAL_OR_UNEXPECTED_RPC_FORBIDDEN: ' + name);
  });
  const admin = { rpc, functions: { invoke }, auth: { admin: { getUserById: async () => ({ data: { user: { email: 'sink@example.invalid' } }, error: null }) } } };
  const clientFactory = vi.fn(() => admin);
  const source = readFileSync('supabase/functions/staking-process-release-effects/index.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    z, Request, Response, drainStakingReleaseEffects, deliverStakingReleaseEffect, parseReleaseDeliveryStatus,
    corsHeaders: {}, json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    authenticateUser: async () => ({ uid: deal }), createAdminClient: clientFactory, requireAdminRoles: async () => ({ isSuper: true }),
    parseBody: async (req: Request, schema: z.ZodType) => {
      const parsed = schema.safeParse(await req.json());return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: new Response('{}', { status: 400 }) };
    }, Deno: { serve: (fn: typeof handler) => { handler = fn; } },
  });
  const run = (body: unknown = { release_request_id: request }) => handler(new Request('http://local.invalid/continue', { method: 'POST', body: JSON.stringify(body) }));
  return { run, rpc, invoke, clientFactory, jobs };
}
it('processes six pending jobs in bounded explicit calls without a financial RPC', async () => {
  const h = await setup();
  expect(await (await h.run()).json()).toMatchObject({ ok: true, delivery: { state: 'pending', delivered: 4, pending: 2 } });
  expect(h.invoke).toHaveBeenCalledTimes(4);
  expect(await (await h.run()).json()).toMatchObject({ ok: true, delivery: { state: 'all_delivered', delivered: 6, pending: 0 } });
  await h.run();expect(h.invoke).toHaveBeenCalledTimes(6);
  expect(h.clientFactory).toHaveBeenCalledWith({ retry: false });
  expect(h.rpc.mock.calls.every(([name]) => !name.includes('commit') && !name.includes('ledger'))).toBe(true);
});
it.each([['denied', 403], ['no-receipt', 409]] as const)('does not claim or send for %s', async (mode, status) => {
  const h = await setup(mode);expect((await h.run()).status).toBe(status);
  expect(h.invoke).not.toHaveBeenCalled();expect(h.rpc.mock.calls.some(([name]) => name === 'claim_staking_release_effect_v1')).toBe(false);
});
it('does not resend held jobs when processing the remaining pending jobs', async () => {
  const h = await setup();h.jobs[0].state = 'needs_attention';
  await h.run();const response = await (await h.run()).json();
  expect(response).toMatchObject({ delivery: { state: 'needs_attention', needs_attention: 1, delivered: 5 } });
  expect(h.invoke).toHaveBeenCalledTimes(5);
});
it('rejects financial parameters rather than treating continuation as a second payout', async () => {
  const h = await setup();expect((await h.run({ release_request_id: request, amount: 100 })).status).toBe(400);
  expect(h.rpc).not.toHaveBeenCalled();expect(h.invoke).not.toHaveBeenCalled();
});
