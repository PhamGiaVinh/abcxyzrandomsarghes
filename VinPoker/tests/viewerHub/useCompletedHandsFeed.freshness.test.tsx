import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCompletedHandsFeed } from '@/components/cashier/tournament-live/viewer-hub/useCompletedHandsFeed';

const { rpc,signals } = vi.hoisted(() => ({ rpc: vi.fn(),signals:[] as AbortSignal[] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc:(...args:unknown[])=>{
 const q=Object.assign(Promise.resolve(rpc(...args)),{abortSignal:(signal:AbortSignal)=>{signals.push(signal);return q;}});return q;
} } }));
vi.mock('@/lib/featureFlags', () => ({ FEATURES: { publicSpectatorRealtimeV2: true, liveViewerPulseV2: true } }));
vi.mock('@/lib/tracker-poker/handPlayerNames', () => ({
  handPlayersHasSnapshot: vi.fn(), fetchHandPlayerDisplay: async () => new Map(),
}));
afterEach(() => { cleanup(); rpc.mockReset(); signals.length=0;vi.useRealTimers(); });

it('aborts its owned transport when observation times out',async()=>{
 vi.useFakeTimers();fixture();rpc.mockImplementationOnce(()=>new Promise(()=>{}));
 renderHook(()=>useCompletedHandsFeed('tour'));
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(signals).toHaveLength(1);
 expect(signals[0].aborted).toBe(true);
});
it('aborts the previous scope and unmounted owned read',async()=>{
 vi.useFakeTimers();rpc.mockImplementation(()=>new Promise(()=>{}));
 const view=renderHook(({tour})=>useCompletedHandsFeed(tour),{initialProps:{tour:'A'}});
 await act(async()=>{});
 expect(signals[0].aborted).toBe(false);
 view.rerender({tour:'B'});await act(async()=>{});
 expect(signals[0].aborted).toBe(true);
 expect(signals[1].aborted).toBe(false);
 view.unmount();
 expect(signals[1].aborted).toBe(true);
});

it.each([null,{}, {items:null}, {items:[null]}, {items:[{id:'hand'}]}])('does not report malformed catalog %j as an empty valid feed',async(data)=>{
 fixture();rpc.mockResolvedValueOnce({data,error:null});
 const {result}=renderHook(()=>useCompletedHandsFeed('tour'));
 await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.error).toBe('invalid_public_hand_catalog');
 expect(result.current.items).toEqual([]);
});

it('ends a hung read and ignores its late response after the deadline',async()=>{
  vi.useFakeTimers();fixture();
  let release!:(value:unknown)=>void;
  rpc.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const {result}=renderHook(()=>useCompletedHandsFeed('tour'));
  await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBe('tracker_context_read_timeout');
  await act(async()=>{release({data:{items:[]},error:null});});
  expect(result.current.error).toBe('tracker_context_read_timeout');
  expect(result.current.items).toEqual([]);
});

it('exposes a catalog failure rather than an empty feed and allows explicit recovery', async () => {
  fixture();
  rpc.mockResolvedValueOnce({data:null,error:{message:'TEST catalog unavailable'}});
  const {result}=renderHook(()=>useCompletedHandsFeed('tour'));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe('TEST catalog unavailable');
  expect(result.current.items).toEqual([]);
  await act(async()=>{await result.current.reload();});
  await waitFor(()=>expect(result.current.items[0]?.highHand?.playerId).toBe('p1'));
  expect(result.current.error).toBeNull();
});

it('clears a previously verified feed after a thrown refresh and can recover', async () => {
  fixture();
  const {result}=renderHook(()=>useCompletedHandsFeed('tour'));
  await waitFor(()=>expect(result.current.items[0]?.verificationStatus).toBe('verified'));
  rpc.mockRejectedValueOnce(new Error('TEST offline'));
  await act(async()=>{await result.current.reload();});
  expect(result.current.error).toBe('TEST offline');
  expect(result.current.loading).toBe(false);
  expect(result.current.items).toEqual([]);
  await act(async()=>{await result.current.reload();});
  expect(result.current.error).toBeNull();
  expect(result.current.items[0]?.verificationStatus).toBe('verified');
});

function fixture() {
  let held: Promise<unknown> | null = null;
  let settlementError: { message: string } | null = null;
  let proof: unknown = {
    schemaVersion: 'settlement-outcome-v1', status: 'verified',
    players: [{ playerId: 'p1', potAward: 100, refund: 0, netDelta: 0 }],
    pots: [{ potId: 'main', kind: 'main', amount: 100, winnerIds: ['p1'], allocations: [{ potId: 'main', winnerId: 'p1', amount: 100 }] }],
    refunds: [], handRanks: [{ playerId: 'p1', category: 'pair', bestFive: ['Ac','Ad','2c','3d','4s'], kickers: ['A'] }],
  };
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_public_tournament_hand_catalog_v2') return { error: null, data: { items: [{
      id: 'hand', handNumber: 1, createdAt: '2026-10-21T00:00:00Z', board: ['2c','3d','4s','5c','7d'], pot: 100,
      buttonSeat: 1, tableId: 'table', status: 'completed', isVoided: false, bigBlind: 100,
    }] } };
    if (name === 'get_public_tournament_hand_v2') return { error: null, data: { players: [], actions: [] } };
    if (name === 'get_public_tournament_settlement') return { error: settlementError, data: held ? await held : proof };
    throw new Error(`unexpected RPC ${name}`);
  });
  return { initialProof: proof, setProof: (value: unknown) => { proof = value; },
    setError: (value: { message: string }) => { settlementError = value; },
    setHeld: (value: Promise<unknown> | null) => { held = value; } };
}

it('removes cached verified ranking when a refresh reports current proof pending', async () => {
  const f = fixture();
  const { result } = renderHook(() => useCompletedHandsFeed('tour'));
  await waitFor(() => expect(result.current.items[0]?.highHand?.playerId).toBe('p1'));
  expect(result.current.items[0]?.verificationStatus).toBe('verified');
  f.setProof({ status: 'pending' });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(result.current.items[0]?.highHand).toBeNull());
  expect(result.current.items[0]?.verificationStatus).toBe('unverified');
  expect(rpc.mock.calls.filter(call => call[0] === 'get_public_tournament_settlement')).toHaveLength(2);
});

it('does not reuse verified ranking when the current proof read fails', async () => {
  const f = fixture();
  const { result } = renderHook(() => useCompletedHandsFeed('tour'));
  await waitFor(() => expect(result.current.items[0]?.highHand?.playerId).toBe('p1'));
  f.setError({ message: 'proof unavailable' });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(result.current.items[0]?.highHand).toBeNull());
  expect(result.current.items[0]?.verificationStatus).toBe('unavailable');
});

it('ignores a late old verified response after a newer pending projection', async () => {
  const f = fixture();
  const { result } = renderHook(() => useCompletedHandsFeed('tour'));
  await waitFor(() => expect(result.current.items[0]?.highHand?.playerId).toBe('p1'));
  let release!: (value: unknown) => void;
  f.setHeld(new Promise(done => { release = done; }));
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(rpc.mock.calls.filter(call => call[0] === 'get_public_tournament_settlement')).toHaveLength(2));
  f.setHeld(null); f.setProof({ status: 'pending' });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(result.current.items[0]?.highHand).toBeNull());
  await act(async () => { release(f.initialProof); });
  expect(result.current.items[0]?.highHand).toBeNull();
});
