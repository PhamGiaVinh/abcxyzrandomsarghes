import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { expect, it, vi } from 'vitest';
const deal = '33333333-3333-4333-8333-333333333333', request = '11111111-1111-4111-8111-111111111111';
async function call(mode = 'ok', extra = false) {
  let handler!: (req: Request) => Promise<Response>;
  const rpc = vi.fn(async () => {
    if (mode === 'lost') throw new Error('PRIVATE_NETWORK');
    if (mode === 'denied') return { data: null, error: { code: '42501', message: 'PRIVATE_DB' } };
    if (mode === 'unavailable') return { data: null, error: { code: '08006', message: 'PRIVATE_DB' } };
    return { data: mode === 'malformed' ? {} : { success: true, release_request_id: request,
      deal_id: mode === 'wrongdeal' ? request : deal, status: 'release_requested', existing: false }, error: null };
  });
  const from = vi.fn(() => { throw new Error('Direct writes forbidden'); });
  const factory = vi.fn(() => ({ rpc, from }));
  const source = readFileSync('supabase/functions/staking-request-release/index.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    z, Request, Response, corsHeaders: {}, json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    authenticateUser: async () => ({ uid: 'LOCAL_ACTOR' }), createAdminClient: factory,
    requireAdminRoles: async () => ({ isSuper: true, isCashier: false }),
    parseBody: async (req: Request, schema: z.ZodType) => { const parsed = schema.safeParse(await req.json());return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: new Response('{}', { status: 400 }) }; },
    Deno: { serve: (fn: typeof handler) => { handler = fn; } },
  });
  const response = await handler(new Request('http://local.invalid', { method: 'POST', body: JSON.stringify({ deal_id: deal, backer_amount: 80100, player_amount: 720900, note: null, ...(extra ? { actor: 'FORGED' } : {}) }) }));
  return { response, rpc, from, factory };
}
it('uses only one atomic RPC bound to authenticated actor with no retry or table-write fallback', async () => {
  const { response, rpc, from, factory } = await call();expect(response.status).toBe(200);
  expect(factory).toHaveBeenCalledWith({ retry: false });expect(from).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledExactlyOnceWith('request_staking_release_v1', { p_actor: 'LOCAL_ACTOR', p_deal: deal, p_backer: 80100, p_player: 720900, p_note: null });
});
it.each([['lost', 503], ['denied', 403], ['unavailable', 503], ['malformed', 502], ['wrongdeal', 502]])('rejects %s without a fallback write', async (mode, status) => {
  const { response, from, rpc } = await call(String(mode));expect(response.status).toBe(status);
  expect(await response.text()).not.toContain('PRIVATE_');expect(from).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledTimes(1);
});
it('rejects forged extra fields before invoking the writer', async () => {
  const { response, rpc } = await call('ok', true);expect(response.status).toBe(400);expect(rpc).not.toHaveBeenCalled();
});
