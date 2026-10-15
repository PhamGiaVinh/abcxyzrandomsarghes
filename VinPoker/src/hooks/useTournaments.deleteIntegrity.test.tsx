import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const backend = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/SupabaseClientContext', () => ({ useSupabaseClient: () => backend }));
import { useDeleteTournament } from './useTournaments';
const input = { id: 'tour-test', club_id: 'club-test' };
function setup(retry: boolean | number = false) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry, retryDelay: 0 } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { invalidate, wrapper };
}
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

it.each([null, {}, [], { ok: true }, { deleted: true, tournament_id: input.id },
  { ok: true, deleted: false, tournament_id: input.id },
  { ok: true, deleted: true, tournament_id: 'other-tour' },
  { ok: true, deleted: true, tournament_id: input.id, error: 'contradictory' },
].map(data => [data]))('does not report deletion or invalidate the cache for unverified proof %j', async data => {
  backend.rpc.mockResolvedValue({ data, error: null });
  const context = setup();
  const hook = renderHook(() => useDeleteTournament(), { wrapper: context.wrapper });
  await act(async () => { await expect(hook.result.current.mutateAsync(input)).rejects.toThrow('tournament_delete_unverified'); });
  expect(context.invalidate).not.toHaveBeenCalled();
  expect(backend.rpc).toHaveBeenCalledTimes(1);
});

it('accepts only the exact tournament deletion proof', async () => {
  backend.rpc.mockResolvedValue({ data: { ok: true, deleted: true, tournament_id: input.id }, error: null });
  const context = setup();
  const hook = renderHook(() => useDeleteTournament(), { wrapper: context.wrapper });
  await act(async () => { await hook.result.current.mutateAsync(input); });
  expect(backend.rpc).toHaveBeenCalledExactlyOnceWith('ops_delete_tournament_safe', { p_tournament_id: input.id, p_reason: 'tournament_hook_delete' });
  expect(context.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['tournaments', input.club_id] });
});

it('preserves explicit server blockers without retrying', async () => {
  backend.rpc.mockResolvedValue({ data: { ok: false, error: 'tournament_has_related_evidence' }, error: null });
  const context = setup();
  const hook = renderHook(() => useDeleteTournament(), { wrapper: context.wrapper });
  await act(async () => { await expect(hook.result.current.mutateAsync(input)).rejects.toThrow('tournament_has_related_evidence'); });
  expect(context.invalidate).not.toHaveBeenCalled();
  expect(backend.rpc).toHaveBeenCalledTimes(1);
});

it('does not infer deletion after a transport failure', async () => {
  backend.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
  const context = setup();
  const hook = renderHook(() => useDeleteTournament(), { wrapper: context.wrapper });
  await act(async () => { await expect(hook.result.current.mutateAsync(input)).rejects.toThrow('Failed to fetch'); });
  expect(context.invalidate).not.toHaveBeenCalled();
  expect(backend.rpc).toHaveBeenCalledTimes(1);
});

it('does not inherit automatic mutation retries from the host QueryClient', async () => {
  backend.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
  const hook = renderHook(() => useDeleteTournament(), { wrapper: setup(2).wrapper });
  await act(async () => { await expect(hook.result.current.mutateAsync(input)).rejects.toThrow('Failed to fetch'); });
  expect(backend.rpc).toHaveBeenCalledTimes(1);
});

it('existing workflows trigger and execute both deletion response seams', () => {
  const hook = readFileSync(resolve(process.cwd(), '../.github/workflows/tournament-table-write-scope.yml'), 'utf8');
  const ops = readFileSync(resolve(process.cwd(), '../.github/workflows/ops-floor-cashier-disposable-db.yml'), 'utf8');
  expect(hook).toContain('VinPoker/src/lib/tournamentDeleteResult.ts');
  expect(hook).toContain('src/hooks/useTournaments.deleteIntegrity.test.tsx --maxWorkers');
  expect(ops).toContain('VinPoker/src/lib/tournamentDeleteResult.ts');
  expect(ops).toContain('tests/opsFloorCashier/opsMutations.contract.test.ts');
});
