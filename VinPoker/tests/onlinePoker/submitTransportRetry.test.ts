import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { onlinePokerClient } from '@/lib/onlinePoker/client';

const mock = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: mock.invoke }, auth: { getSession: mock.getSession } },
}));
const intent = { handId: 'fixture-hand', seat: 2, type: 'fold' as const };
const receipt = { data: { ok: true, handId: intent.handId, stateVersion: 1 }, error: null };
const session = (id: string, access_token: string) => ({ data: { session: { user: { id }, access_token } }, error: null });

beforeEach(() => {
  mock.invoke.mockReset();
  mock.getSession.mockReset().mockResolvedValue(session('actor', 'fixture-token'));
});

it.each([
  new FunctionsFetchError(new Error('connection lost')),
  new FunctionsHttpError(new Response(null, { status: 503 })),
])('retries once using the original action and idempotency key', async error => {
  mock.invoke.mockResolvedValueOnce({ data: null, error }).mockResolvedValueOnce(receipt);
  mock.getSession.mockResolvedValueOnce(session('actor', 'initial')).mockResolvedValueOnce(session('actor', 'refreshed'));
  await expect(onlinePokerClient.submitAction(intent)).resolves.toEqual(receipt.data);
  expect(mock.invoke).toHaveBeenCalledTimes(2);
  const [, before] = mock.invoke.mock.calls[0];
  const [, after] = mock.invoke.mock.calls[1];
  expect(after.body).toEqual(before.body);
  expect(before.body.idempotencyKey).toEqual(expect.any(String));
  expect(before.headers.Authorization).toBe('Bearer initial');
  expect(after.headers.Authorization).toBe('Bearer refreshed');
});

it('stops if the account changed during the failed attempt', async () => {
  mock.invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new Error('connection lost')) });
  mock.getSession.mockResolvedValueOnce(session('actor', 'initial')).mockResolvedValueOnce(session('other', 'other'));
  await expect(onlinePokerClient.submitAction(intent)).rejects.toMatchObject({ code: 'auth_scope_changed' });
  expect(mock.invoke).toHaveBeenCalledTimes(1);
});

it('does not retry rejected actions or loop on network failure', async () => {
  mock.invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(new Response(null, { status: 409 })) });
  await expect(onlinePokerClient.submitAction(intent)).rejects.toMatchObject({ code: 'edge_error' });
  expect(mock.invoke).toHaveBeenCalledTimes(1);
  mock.invoke.mockClear().mockResolvedValue({ data: null, error: new FunctionsFetchError(new Error('connection lost')) });
  await expect(onlinePokerClient.submitAction(intent)).rejects.toMatchObject({ code: 'edge_error' });
  expect(mock.invoke).toHaveBeenCalledTimes(2);
});
