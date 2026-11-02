import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { retryFetch } from '../../supabase/functions/_shared/retry';

afterEach(() => { vi.unstubAllGlobals();vi.useRealTimers(); });
function factory(transport: typeof fetch) {
  return common(transport).createAdminClient as (options?: { retry?: boolean }) => typeof fetch;
}
function common(transport: typeof fetch) {
  const exports: Record<string, unknown> = {};
  const source = readFileSync('supabase/functions/_shared/staking-common.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, retryFetch, fetch: transport, Response,
    Deno: { env: { get: () => 'LOCAL_TEST_ONLY' } },
    createClient: (_url: string, _key: string, options: { global: { fetch: typeof fetch } }) => options.global.fetch,
  });
  return exports as { createAdminClient: unknown; requireAdminRoles: (admin: unknown, uid: string) => Promise<Response | { isSuper: boolean; isCashier: boolean }>; requireClubAccess: (admin: unknown, uid: string, club: string | null) => Promise<Response | void> };
}
it('role lookup errors are unavailable, not a successful permission denial or grant', async () => {
  const result = { data: [{ role: 'super_admin' }], error: { message: 'PRIVATE_DB_DETAILS' } };
  const admin = { from: () => ({ select: () => ({ eq: () => ({ in: async () => result }) }) }) };
  const response = await common(vi.fn()).requireAdminRoles(admin, 'LOCAL_ACTOR') as Response;
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('PRIVATE_DB_DETAILS');
});
it('club lookup errors and non-boolean responses never grant access', async () => {
  for (const result of [{ data: true, error: { message: 'PRIVATE_DB_DETAILS' } }, { data: 'false', error: null }, { data: null, error: null }]) {
    const response = await common(vi.fn()).requireClubAccess({ rpc: async () => result }, 'LOCAL_ACTOR', 'LOCAL_CLUB') as Response;
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE_DB_DETAILS');
  }
});
it('verified empty roles and false club membership remain forbidden; valid membership succeeds', async () => {
  const helpers = common(vi.fn());
  const denied = await helpers.requireAdminRoles({ from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) }) }, 'LOCAL_ACTOR') as Response;
  expect(denied.status).toBe(403);
  expect((await helpers.requireClubAccess({ rpc: async () => ({ data: false, error: null }) }, 'LOCAL_ACTOR', 'LOCAL_CLUB') as Response).status).toBe(403);
  expect(await helpers.requireClubAccess({ rpc: async () => ({ data: true, error: null }) }, 'LOCAL_ACTOR', 'LOCAL_CLUB')).toBeUndefined();
});
it('critical no-retry client sends an unknown email POST only once', async () => {
  vi.useFakeTimers();
  const transport = vi.fn(async () => new Response('LOCAL_SEND_UNKNOWN', { status: 500 }));
  vi.stubGlobal('fetch', transport);
  const clientFetch = factory(transport)({ retry: false });
  const pending = clientFetch('http://local.invalid/functions/v1/send-email', { method: 'POST', body: '{}' }).catch(() => null);
  await vi.runAllTimersAsync();await pending;
  expect(transport).toHaveBeenCalledTimes(1);
});
it('keeps legacy caller retry configuration unchanged unless explicitly opted out', () => {
  const transport = vi.fn();
  expect(factory(transport)()).toBe(retryFetch);
});
