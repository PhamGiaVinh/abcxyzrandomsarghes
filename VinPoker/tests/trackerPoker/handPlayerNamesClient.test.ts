import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { handPlayersHasSnapshotForClient } from '@/lib/tracker-poker/handPlayerNamesClient';

function clientWithProbe() {
  const limit = vi.fn();
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient<Database>, from, select, limit };
}

it('does not cache an unavailable snapshot read as a missing schema', async () => {
  const h = clientWithProbe();
  h.limit.mockResolvedValueOnce({ error: { code: '503', message: 'snapshot temporarily unavailable' } })
    .mockResolvedValueOnce({ error: null });
  await expect(handPlayersHasSnapshotForClient(h.client)).rejects.toThrow('snapshot temporarily unavailable');
  await expect(handPlayersHasSnapshotForClient(h.client)).resolves.toBe(true);
  expect(h.from).toHaveBeenCalledTimes(2);
});

it('rejects transport failure and allows an explicit subsequent retry', async () => {
  const h = clientWithProbe();
  h.limit.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ error: null });
  await expect(handPlayersHasSnapshotForClient(h.client)).rejects.toThrow('Failed to fetch');
  await expect(handPlayersHasSnapshotForClient(h.client)).resolves.toBe(true);
});

it('does not treat permission denial as legacy schema absence', async () => {
  const h = clientWithProbe();
  h.limit.mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
  await expect(handPlayersHasSnapshotForClient(h.client)).rejects.toThrow('permission denied');
});

it('memoizes a confirmed missing column and a successful probe per client', async () => {
  const legacy = clientWithProbe(), current = clientWithProbe();
  legacy.limit.mockResolvedValue({ error: { code: '42703', message: 'column player_name does not exist' } });
  current.limit.mockResolvedValue({ error: null });
  await expect(handPlayersHasSnapshotForClient(legacy.client)).resolves.toBe(false);
  await expect(handPlayersHasSnapshotForClient(legacy.client)).resolves.toBe(false);
  await expect(handPlayersHasSnapshotForClient(current.client)).resolves.toBe(true);
  await expect(handPlayersHasSnapshotForClient(current.client)).resolves.toBe(true);
  expect(legacy.from).toHaveBeenCalledTimes(1);
  expect(current.from).toHaveBeenCalledTimes(1);
});

it('coalesces concurrent probes for the same client', async () => {
  const h = clientWithProbe();
  let resolve!: (value: { error: null }) => void;
  h.limit.mockReturnValue(new Promise(done => { resolve = done; }));
  const first = handPlayersHasSnapshotForClient(h.client), second = handPlayersHasSnapshotForClient(h.client);
  expect(first).toBe(second);
  resolve({ error: null });
  await expect(first).resolves.toBe(true);
  expect(h.from).toHaveBeenCalledTimes(1);
});
