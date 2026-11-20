// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useTableHand } from './useOnlinePoker';

const fixtures = vi.hoisted(() => ({
  read: vi.fn(),
  joins: new Map<string, (status: string) => void>(),
}));

vi.mock('./types', async (original) => ({ ...await original<object>(), RUNTIME_LIVE: true }));
vi.mock('./client', () => ({
  loadHandStateLive: fixtures.read,
  loadSeatsLive: async () => [],
  loadTableHostLive: async () => null,
  onlinePokerClient: { ping: async () => ({ ok: true }) },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    channel(name: string) {
      const channel = {
        on: () => channel,
        subscribe(callback: (status: string) => void) {
          fixtures.joins.set(name, callback);
          return channel;
        },
      };
      return channel;
    },
    removeChannel: vi.fn(),
  },
}));

it('queues one refresh behind a pending hand read and ignores a prior table rejoin', async () => {
  let resolveInitial!: (value: null) => void;
  fixtures.read.mockReturnValueOnce(new Promise(resolve => { resolveInitial = resolve; }));
  fixtures.read.mockResolvedValue(null);
  const table = renderHook(({ id }) => useTableHand(id), { initialProps: { id: 'a' } });
  try {
    await act(async () => {
      fixtures.joins.get('op-table-a')!('SUBSCRIBED');
      fixtures.joins.get('op-table-a')!('SUBSCRIBED');
    });
    expect(fixtures.read).toHaveBeenCalledTimes(1);
    await act(async () => resolveInitial(null));
    expect(fixtures.read).toHaveBeenCalledTimes(2);
    table.rerender({ id: 'b' });
    await act(async () => fixtures.joins.get('op-table-a')!('SUBSCRIBED'));
    expect(fixtures.read.mock.calls.map(([id]) => id)).toEqual(['a', 'a', 'b']);
    await act(async () => fixtures.joins.get('op-table-b')!('SUBSCRIBED'));
    expect(fixtures.read.mock.calls.map(([id]) => id)).toEqual(['a', 'a', 'b', 'b']);
  } finally {
    table.unmount();
  }
});
