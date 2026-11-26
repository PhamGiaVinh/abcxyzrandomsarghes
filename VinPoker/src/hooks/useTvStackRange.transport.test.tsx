// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SupabaseClientProvider } from '@/integrations/supabase/SupabaseClientContext';
import { useTvStackRange } from './useTvStackRange';

afterEach(() => vi.restoreAllMocks());

it('clears on tournament change, ignores late responses and recovers after going offline', async () => {
  let finishOld: (value: unknown) => void = () => {};
  const old = new Promise(resolve => { finishOld = resolve; });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => ({
    abortSignal: () => args.p_tournament_id === 'old' ? old : Promise.resolve({ error: null,
      data: name.includes('snapshot') ? { ok: true, access: 'public', tournamentId: args.p_tournament_id,
        sections: { ranking: { freshness: { state: 'current' }, items: [{ chips: 10000 }, { chips: 30000 }] },
          tables: { freshness: { state: 'current' }, catalog: [{ tableId: 'table' }] } } }
        : { access: 'public', tableId: 'table', state: 'last_completed', hand: { id: 'hand' } },
    }),
  }));
  const client = { rpc } as any;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(SupabaseClientProvider, { client, children });
  const { result, rerender } = renderHook(({ id }) => useTvStackRange(id, 2, 40000), { initialProps: { id: 'old' }, wrapper });
  expect(result.current).toBeNull();
  rerender({ id: 'new' });
  await waitFor(() => expect(result.current?.largest).toBe(30000));
  await act(async () => finishOld({ data: null, error: null }));
  expect(result.current?.largest).toBe(30000);
  await act(async () => window.dispatchEvent(new Event('offline')));
  expect(result.current).toBeNull();
  await act(async () => window.dispatchEvent(new Event('online')));
  await waitFor(() => expect(result.current?.smallest).toBe(10000));
});

it('renders matching live TV and editor values through the same public reads', async () => {
  const { render, screen, within } = await import('@testing-library/react');
  const { TvBroadcastBoard } = await import('@/components/tv/TvBroadcastBoard');
  const { TvBroadcastPreview } = await import('@/components/tv/TvBroadcastPreview');
  const { useMockTvData } = await import('@/lib/tv/mockTvData');
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  let state = 'waiting';
  const client = { rpc: (name: string) => ({ abortSignal: async () => ({ error: null,
    data: name.includes('snapshot') ? { ok: true, access: 'public', tournamentId: 'tour', sections: {
      ranking: { freshness: { state: 'current' }, items: [{ chips: 10000 }, { chips: 30000 }] },
      tables: { freshness: { state: 'current' }, catalog: [{ tableId: 'a' }] },
    } } : { access: 'public', tableId: 'a', state, hand: state === 'waiting' ? null : { id: 'h' } },
  }) }) } as any;
  function Fixture() {
    const sample = useMockTvData(false);
    const data = { ...sample, tournamentId: 'tour', playersRemaining: 2, totalChips: 40000 };
    return createElement(SupabaseClientProvider, { client, children: [
      createElement('div', { key: 'tv', 'data-testid': 'tv' }, createElement(TvBroadcastBoard, { data })),
      createElement('div', { key: 'preview', 'data-testid': 'preview' }, createElement(TvBroadcastPreview, { data, live: true, onLayoutChange: () => {} })),
    ] });
  }
  const view = render(createElement(Fixture));
  const extrema = (id: string) => within(screen.getByTestId(id)).getByText('Largest Stack').nextElementSibling?.textContent;
  await waitFor(() => expect(extrema('tv')).toBe('—'));
  expect(extrema('preview')).toBe('—');
  state = 'live';
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(extrema('tv')).toContain('30.000'));
  expect(extrema('preview')).toBe(extrema('tv'));
  state = 'last_completed';
  view.unmount();
  render(createElement(Fixture));
  await waitFor(() => expect(extrema('preview')).toContain('30.000'));
  expect(extrema('preview')).toBe(extrema('tv'));
  vi.unstubAllGlobals();
});
