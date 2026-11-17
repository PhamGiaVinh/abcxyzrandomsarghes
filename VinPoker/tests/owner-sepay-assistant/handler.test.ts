import { describe, expect, it, vi } from 'vitest';
import { transferableAbortController } from 'node:util';
import { createHandler, type Environment } from '../../supabase/functions/owner-sepay-assistant/handler';
import { businessDay } from '../../supabase/functions/owner-sepay-assistant/contracts';
const actor = '11111111-1111-4111-8111-111111111111';
const club = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const day = businessDay(new Date());
const plan = { intent: 'cashflow', from: day, to: day, search: null };
const env: Environment = { url: 'https://isolated.test', anonKey: 'anon-test', serviceKey: 'SERVICE_PRIVATE', enabled: true,
  geminiKey: 'GEMINI_PRIVATE', geminiModel: 'test-explicit-model', freeTierConfirmed: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const config = { status: 'ok', provider: 'sepay', is_active: true, has_api_token: true, master_account_number: '12345678' };
const req = (extra = {}) => new Request('https://edge.test', { method: 'POST', headers: { Authorization: 'Bearer owner-session' }, body: JSON.stringify({ clubId: club, requestId, question: 'thu chi hôm nay', ...extra }) });
function fixture(options: { denied?: boolean; revoked?: boolean; quota?: boolean; duplicate?: boolean; billing?: boolean; foreign?: boolean } = {}) {
  let ownerChecks = 0;
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = vi.fn(async (url, init) => {
    const path = String(url); calls.push({ url: path, init });
    if (path.endsWith('/auth/v1/user')) return json({ id: actor });
    if (path.endsWith('/rpc/is_club_owner')) return json(!options.denied && !(options.revoked && ++ownerChecks >= 3));
    if (path.endsWith('/rpc/sepay_get_club_payment_config')) return json(config);
    if (path.endsWith('/rpc/owner_sepay_reserve_request_v1')) return json({ allowed: !options.duplicate, duplicate: !!options.duplicate });
    if (path.endsWith('/rpc/sepay_get_club_api_token')) return json('SEPAY_PRIVATE');
    if (path.startsWith('https://generativelanguage.googleapis.com/')) return options.quota ? json({}, 429) : json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(plan) }] } }] });
    const u = new URL(path);
    if (u.pathname === '/v2/bank-accounts') return json({ status: 'success', data: [{ id: actor, account_number: '12345678', active: 1 }], meta: { pagination: { has_more: false, current_page: 1, per_page: 100, total: 1, last_page: 1 } } });
    if (u.pathname === '/v2/transactions') return json({ status: 'success', data: [{ id: requestId, bank_account_id: actor, account_number: options.foreign ? '87654321' : '12345678', transaction_date: `${day} 01:00:00`, transfer_type: 'in', amount_in: 500000, amount_out: 0, code: null, webhook_success: 0, transaction_content: 'PAYER_PRIVATE', accumulated: 999999 }], meta: { pagination: { has_more: false, current_page: 1, per_page: 100, total: 1, last_page: 1 } } });
    throw Error('Unexpected HTTP route');
  });
  return { calls, handler: createHandler({ ...env, freeTierConfirmed: !options.billing }, fetcher) };
}
describe('owner assistant HTTP boundary (isolated transport fixtures)', () => {
  it('cancels a stalled body at the deadline and handles an already-aborted request', async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const body = new ReadableStream({ cancel() { cancelled = true; } });
      const request = new Request('https://edge.test', { method: 'POST', body, headers: { Authorization: 'Bearer owner-session' }, duplex: 'half' } as RequestInit);
      const fetcher = vi.fn();
      const pending = createHandler(env, fetcher)(request);
      await vi.advanceTimersByTimeAsync(20_001);
      expect((await pending).status).toBe(504); expect(cancelled).toBe(true);
      // Request is Node's native implementation; jsdom's signal has another brand.
      const abort = transferableAbortController(); abort.abort();
      const stopped = new Request('https://edge.test', { method: 'POST', signal: abort.signal, headers: { Authorization: 'Bearer owner-session' }, body: '{}' });
      expect((await createHandler(env, fetcher)(stopped)).status).toBe(504);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('is dark by default and rejects unauthenticated/extra client credential fields', async () => {
    const fetcher = vi.fn();
    expect((await createHandler({ ...env, enabled: false }, fetcher)(req())).status).toBe(503);
    expect((await createHandler(env, fetcher)(new Request('https://edge.test', { method: 'POST' }))).status).toBe(401);
    expect((await createHandler(env, fetcher)(req({ token: 'client-secret' }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('denies other club owners before provider, token or SePay calls', async () => {
    const f = fixture({ denied: true });
    expect((await f.handler(req())).status).toBe(403);
    expect(f.calls).toHaveLength(2);
  });
  it('does not call AI without confirmed free configuration', async () => {
    const f = fixture({ billing: true });
    expect((await f.handler(req())).status).toBe(503);
    expect(f.calls.some(c => c.url.includes('googleapis'))).toBe(false);
  });
  it('halts on duplicate and does not spend another model request', async () => {
    const f = fixture({ duplicate: true });
    expect((await f.handler(req())).status).toBe(409);
    expect(f.calls.some(c => c.url.includes('googleapis'))).toBe(false);
  });
  it('reports free quota exhausted with no retry/fallback/SePay fetch', async () => {
    const f = fixture({ quota: true }); const response = await f.handler(req());
    expect(response.status).toBe(429); expect(await response.json()).toEqual({ error: 'FREE_QUOTA_EXHAUSTED' });
    expect(f.calls.filter(c => c.url.includes('googleapis'))).toHaveLength(1);
    expect(f.calls.some(c => c.url.includes('userapi.sepay.vn'))).toBe(false);
  });
  it('returns deterministic totals and sends no bank data or service credentials to Gemini', async () => {
    const f = fixture(); const response = await f.handler(req());
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.text(); expect(body).toContain('500000');
    expect(body).not.toMatch(/PRIVATE|12345678|PAYER|999999/);
    const model = f.calls.find(c => c.url.includes('googleapis'))!;
    expect(String(model.init?.body)).not.toMatch(/PRIVATE|12345678|500000/);
    expect(f.calls.filter(c => c.url.includes('userapi.sepay.vn')).every(c => c.init?.method === 'GET')).toBe(true);
  });
  it('withholds fetched financial results when ownership is revoked before return', async () => {
    const f = fixture({ revoked: true }); const response = await f.handler(req());
    expect(response.status).toBe(403); expect(await response.text()).not.toContain('500000');
  });
  it('fails closed if provider returns another account', async () => {
    const f = fixture({ foreign: true }); expect((await f.handler(req())).status).toBe(502);
  });
});
