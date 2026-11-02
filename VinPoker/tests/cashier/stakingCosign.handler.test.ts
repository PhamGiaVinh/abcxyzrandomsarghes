import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { expect, it, vi } from 'vitest';

const request = '11111111-1111-4111-8111-111111111111';
async function call(mode: 'denied' | 'ok' | 'mismatch' | 'readerror') {
  let handler!: (req: Request) => Promise<Response>;
  const writes = vi.fn();
  const access = vi.fn(async () => mode !== 'ok' ? { data: null, error: { code: mode === 'denied' ? '42501' : mode === 'mismatch' ? 'P0001' : '08006', message: 'PRIVATE_DETAILS' } }
    : { data: { success: true, release_request_id: request, deal_id: '33333333-3333-4333-8333-333333333333', status: 'cosigned', existing: true }, error: null });
  const admin = { rpc: access, from: writes };
  const factory = vi.fn(() => admin);
  const source = readFileSync('supabase/functions/staking-cosign-release/index.ts', 'utf8').replace(/^import[\s\S]*?from ["'][^"']+["'];\r?\n/gm, '');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    z, Response, Request, console, corsHeaders: {}, json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    authenticateUser: async () => ({ uid: 'cashier' }), createAdminClient: factory,
    requireAdminRoles: async () => ({ isSuper: false, isCashier: true }),
    parseBody: async (req: Request, schema: z.ZodType) => ({ ok: true, data: schema.parse(await req.json()) }),
    Deno: { serve: (fn: typeof handler) => { handler = fn; } },
  });
  const response = await handler(new Request('http://local.invalid', { method: 'POST', body: JSON.stringify({ release_request_id: request }) }));
  expect(factory).toHaveBeenCalledWith({ retry: false });
  expect(access).toHaveBeenCalledExactlyOnceWith('cosign_staking_release_v1', { p_actor: 'cashier', p_request: request, p_note: null });
  return { response, writes, access };
}
it('approved replay checks club before any success or repair write', async () => {
  const { response, writes, access } = await call('denied');
  expect(response.status).toBe(403);expect(access).toHaveBeenCalled();expect(writes).not.toHaveBeenCalled();
});
it('verified already-cosigned replay is read-only', async () => {
  const { response, writes } = await call('ok');expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, release_request_id: request, status: 'cosigned' });
  expect(writes).not.toHaveBeenCalled();
});
it('approved request with inconsistent deal does not manufacture cosigned success', async () => {
  const { response, writes } = await call('mismatch');expect(response.status).toBe(409);expect(writes).not.toHaveBeenCalled();
});
it('deal lookup failure is unavailable, not not-found or cosigned success', async () => {
  const { response, writes } = await call('readerror');expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('PRIVATE_DETAILS');expect(writes).not.toHaveBeenCalled();
});
