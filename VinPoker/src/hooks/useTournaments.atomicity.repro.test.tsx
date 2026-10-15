import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateTournament, useUpdateTournament, type CreateTournamentInput } from './useTournaments';

// Formerly a diagnostic asserting the legacy partial-save defect still existed.
// Migration88 replaces that path: now verify the actual canonical hook boundary.
// Mocked RPCs prove client routing/recovery, NOT PostgreSQL transaction atomicity.
const backend = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/SupabaseClientContext', () => ({ useSupabaseClient: () => backend }));
const club = 'ee800000-0000-4000-8000-000000000002';
const tour = 'ee800000-0000-4000-8000-000000000003';
const input: CreateTournamentInput = {
  expected_actor_id: 'ee800000-0000-4000-8000-000000000001',
  request_id: 'ee800000-0000-4000-8000-000000000081',
  club_id: club, name: 'Changed', swing_duration_minutes: 45,
  table_ids: ['ee800000-0000-4000-8000-000000000010'],
};
const update = { ...input, id: tour, expected_updated_at: '2026-10-16T00:00:00Z',
  expected_active_table_ids: ['ee800000-0000-4000-8000-000000000009'] };
const success = { data: { ok: true, tournament: { id: tour, club_id: club, updated_at: '2026-10-16T01:00:00Z' } }, error: null };
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { gcTime: 0 } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, invalidate };
}
beforeEach(() => {
  vi.resetAllMocks();
  backend.from.mockImplementation(() => { throw new Error('Legacy direct writes are forbidden'); });
});
afterEach(cleanup);

describe('canonical config hook regression replacing legacy partial-save diagnostic', () => {
  for (const mode of ['create', 'update'] as const) {
    it(`${mode} forwards rejection without another writer or success invalidation`, async () => {
      backend.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'configuration_table_close_rejected' } });
      const context = setup();
      const hook = renderHook(() => ({ create: useCreateTournament(), update: useUpdateTournament() }), { wrapper: context.wrapper });
      await act(async () => {
        const pending = mode === 'create' ? hook.result.current.create.mutateAsync(input) : hook.result.current.update.mutateAsync(update);
        await expect(pending).rejects.toMatchObject({ code: 'configuration_table_close_rejected', outcomeUnknown: false });
      });
      expect(backend.rpc).toHaveBeenCalledTimes(1);
      expect(backend.rpc.mock.calls[0][0]).toBe('save_tournament_config_v1');
      expect(backend.from).not.toHaveBeenCalled();
      expect(context.invalidate).not.toHaveBeenCalled();
    });
  }
  it('creates via one atomic RPC and invalidates only the requested club after success', async () => {
    backend.rpc.mockResolvedValue(success);
    const context = setup();
    const hook = renderHook(() => useCreateTournament(), { wrapper: context.wrapper });
    await act(async () => { await expect(hook.result.current.mutateAsync(input)).resolves.toMatchObject({ id: tour }); });
    expect(backend.rpc).toHaveBeenCalledExactlyOnceWith('save_tournament_config_v1', {
      p_expected_actor_id: input.expected_actor_id, p_request_id: input.request_id, p_club_id: club, p_tournament_id: null,
      p_config: { name: 'Changed', description: null, swing_duration_minutes: 45, warn_at_minutes: 5, crit_at_minutes: 2 },
      p_table_ids: input.table_ids, p_expected_updated_at: null, p_expected_active_table_ids: [],
    });
    expect(backend.from).not.toHaveBeenCalled();
    expect(context.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['tournaments', club] });
  });
  it('updates with exact CAS/table fences rather than deleting and recreating links', async () => {
    backend.rpc.mockResolvedValue(success);
    const hook = renderHook(() => useUpdateTournament(), { wrapper: setup().wrapper });
    await act(async () => { await hook.result.current.mutateAsync(update); });
    expect(backend.rpc).toHaveBeenCalledExactlyOnceWith('save_tournament_config_v1', expect.objectContaining({
      p_tournament_id: tour, p_expected_updated_at: update.expected_updated_at,
      p_expected_active_table_ids: update.expected_active_table_ids, p_request_id: input.request_id,
    }));
    expect(backend.from).not.toHaveBeenCalled();
  });
  it('recovers response loss through the original actor-bound receipt without a second save', async () => {
    backend.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(success);
    const hook = renderHook(() => useCreateTournament(), { wrapper: setup().wrapper });
    await act(async () => { await expect(hook.result.current.mutateAsync(input)).resolves.toMatchObject({ id: tour }); });
    expect(backend.rpc.mock.calls.map(([name]) => name)).toEqual(['save_tournament_config_v1', 'get_tournament_config_save_receipt_v1']);
    expect(backend.rpc.mock.calls[1][1]).toEqual({ p_request_id: input.request_id, p_expected_actor_id: input.expected_actor_id });
    expect(backend.from).not.toHaveBeenCalled();
  });
  it('recovery-only never sends the mutation again', async () => {
    backend.rpc.mockResolvedValue(success);
    const hook = renderHook(() => useUpdateTournament(), { wrapper: setup().wrapper });
    await act(async () => { await hook.result.current.mutateAsync({ ...update, recover_only: true }); });
    expect(backend.rpc).toHaveBeenCalledExactlyOnceWith('get_tournament_config_save_receipt_v1', {
      p_request_id: input.request_id, p_expected_actor_id: input.expected_actor_id,
    });
    expect(backend.from).not.toHaveBeenCalled();
  });
});
