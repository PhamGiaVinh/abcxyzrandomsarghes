import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateTournament, useUpdateTournament } from './useTournaments';

// Diagnostic reproduction of the actual legacy hook, NOT a repair acceptance
// suite. Passing means the named partial-write defect remains reproducible.
const store = vi.hoisted(() => ({
  tournamentName: 'Original',
  created: false,
  links: [{ tournament_id: 'other-tour', table_id: 'new-table' }],
  failDelete: false,
  failInsert: false,
}));
vi.mock('@/integrations/supabase/SupabaseClientContext', () => ({
  useSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'tournaments') {
        const result = () => ({ select: () => ({ single: async () => ({
          data: { id: 'tour', name: store.tournamentName }, error: null,
        }) }) });
        return {
          insert: (payload: { name: string }) => {
            store.created = true;
            store.tournamentName = payload.name;
            return result();
          },
          update: (payload: { name?: string }) => ({ eq: () => {
            if (payload.name) store.tournamentName = payload.name;
            return result();
          } }),
        };
      }
      const remove = async (column: 'table_id' | 'tournament_id', values: string[]) => {
        if (store.failDelete) return { error: { message: 'DELETE FAILED' } };
        store.links = store.links.filter((link) => !values.includes(link[column]));
        return { error: null };
      };
      return {
        delete: () => ({
          eq: (column: 'table_id' | 'tournament_id', value: string) => remove(column, [value]),
          in: remove,
        }),
        insert: async (links: { tournament_id: string; table_id: string }[]) => {
          if (store.failInsert) return { error: { message: 'INSERT FAILED' } };
          store.links.push(...links);
          return { error: null };
        },
      };
    },
  }),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const input = { club_id: 'club-a', name: 'Changed', swing_duration_minutes: 45, table_ids: ['new-table'] };

describe('legacy tournament config diagnostic reproduction (not fixed)', () => {
  beforeEach(() => {
    Object.assign(store, { tournamentName: 'Original', created: false,
      links: [{ tournament_id: 'other-tour', table_id: 'new-table' }], failDelete: false, failInsert: false });
  });
  it('REPRO: failed link insert leaves newly created tournament and removes old links', async () => {
    store.failInsert = true;
    const hook = renderHook(() => useCreateTournament(), { wrapper: wrapper() });
    await act(async () => {
      await expect(hook.result.current.mutateAsync(input)).rejects.toMatchObject({ message: 'INSERT FAILED' });
    });
    expect(store.created).toBe(true);
    expect(store.links).toEqual([]);
  });
  it('REPRO: failed link delete is ignored and creation still returns success', async () => {
    store.failDelete = true;
    const hook = renderHook(() => useCreateTournament(), { wrapper: wrapper() });
    await act(async () => {
      await expect(hook.result.current.mutateAsync(input)).resolves.toMatchObject({ id: 'tour' });
    });
    expect(store.links).toEqual([
      { tournament_id: 'other-tour', table_id: 'new-table' },
      { tournament_id: 'tour', table_id: 'new-table' },
    ]);
  });
  it('REPRO: failed update link insert leaves changed settings and removes existing links', async () => {
    store.failInsert = true;
    store.links = [{ tournament_id: 'tour', table_id: 'old-table' }];
    const hook = renderHook(() => useUpdateTournament(), { wrapper: wrapper() });
    await act(async () => {
      await expect(hook.result.current.mutateAsync({ ...input, id: 'tour' })).rejects.toMatchObject({ message: 'INSERT FAILED' });
    });
    expect(store.tournamentName).toBe('Changed');
    expect(store.links).toEqual([]);
  });
});
