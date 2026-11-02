// tests/onlinePoker/onlinePokerTableStale.test.tsx
// PR C — table-view stale cleanup, at the component level. Mocks the data hooks so we can
// drive: a live all-in completion (cinematic plays), a closed table / empty table (no
// stale board), a tableId switch (clears held result), and a new hand needing my action
// (clears held result). #329 cinematic must still fire on a valid live all-in.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ useTableHand: vi.fn(), useTableMeta: vi.fn(), useParams: vi.fn(), buyins: vi.fn(), actor: 'u1' }));
vi.mock('@/lib/onlinePoker/client', () => ({ loadBuyinsLive: (...args: unknown[]) => h.buyins(...args) }));

vi.mock('@/lib/onlinePoker/useOnlinePoker', () => ({
  useTableHand: (id: string) => h.useTableHand(id),
  useTableMeta: (id: string) => h.useTableMeta(id),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: h.actor } }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => h.useParams() };
});
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import OnlinePokerTable from '@/pages/OnlinePokerTable';

const meta = (status = 'open') => ({ id: 't1', name: 'Bàn 1', sb: '25', bb: '50', maxSeats: 9, status, minBuyin: '1000', maxBuyin: '10000', startingStack: '2000', hostUserId: null });
const seat = (n: number, userId: string) => ({ seatNo: n, userId, displayName: 'P' + n, stack: '5000', status: 'sitting' });
const allInDone = () => ({
  handId: 'h1', tableId: 't1', handNo: 5, street: 'showdown', board: ['2s', 'Qd', 'Ad', '3d', '4h'],
  pot: '0', toActSeat: null, buttonSeat: 1, status: 'complete',
  result: { endedBy: 'showdown', potTotal: '20000', potAwards: [{ potIndex: 0, amount: '20000', winners: [2] }], payouts: { 2: '20000' } },
  seats: [
    { seat: 1, playerId: 'u1', displayName: 'An', stack: '0', committed: '0', status: 'allin', revealedCards: ['8s', 'Tc'] },
    { seat: 2, playerId: 'u2', displayName: 'Bình', stack: '20000', committed: '0', status: 'allin', revealedCards: ['Ac', '5d'] },
  ],
  mySeat: 1, myHoleCards: ['8s', 'Tc'],
});
// A NON-cinematic completed hand (ended by fold, not an all-in showdown) → held as a plain
// result panel, NOT the AllInRunout cinematic. Used to prove a fresh deal drops it.
const foldDone = () => ({
  handId: 'h1', tableId: 't1', handNo: 5, street: 'flop', board: ['2s', 'Qd', 'Ad'],
  pot: '0', toActSeat: null, buttonSeat: 1, status: 'complete',
  result: { endedBy: 'fold', potTotal: '300', potAwards: [{ potIndex: 0, amount: '300', winners: [1] }], payouts: { 1: '300' } },
  seats: [
    { seat: 1, playerId: 'u1', displayName: 'An', stack: '5300', committed: '0', status: 'active' },
    { seat: 2, playerId: 'u2', displayName: 'Bình', stack: '4700', committed: '0', status: 'folded' },
  ],
  mySeat: 1, myHoleCards: ['8s', 'Tc'],
});
const betting = (toAct: number) => ({
  handId: 'h2', tableId: 't1', handNo: 6, street: 'preflop', board: [], pot: '75', toActSeat: toAct, buttonSeat: 1, status: 'betting',
  seats: [{ seat: 1, playerId: 'u1', stack: '5000', committed: '25', status: 'active' }, { seat: 2, playerId: 'u2', stack: '5000', committed: '50', status: 'active' }],
  mySeat: 1,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const thState = (over: any = {}) => ({ hand: null, seats: [], mySeatNo: null, myUserId: 'u1', hostUserId: null, amIHost: false, legal: null, loading: false, refresh: vi.fn(), actions: { sitOpen: vi.fn().mockResolvedValue({ outcome: 'ok' }), leaveTable: vi.fn().mockResolvedValue({ outcome: 'ok' }), transferHost: vi.fn().mockResolvedValue({ outcome: 'ok' }), submitAction: vi.fn().mockResolvedValue({ ok: true }) }, ...over });

const renderTable = () => render(<MemoryRouter><OnlinePokerTable /></MemoryRouter>);

beforeEach(() => { h.actor = 'u1'; h.useParams.mockReturnValue({ tableId: 't1' }); h.buyins.mockReset().mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('OnlinePokerTable — PR C stale-table cleanup', () => {
  it.each(['table', 'actor'])('ignores an old ledger response after %s changes', async (kind) => {
    h.useTableMeta.mockReturnValue(meta()); h.useTableHand.mockReturnValue(thState());
    let resolveOld!: (rows: unknown[]) => void;
    h.buyins.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce([]);
    const { rerender } = renderTable(); fireEvent.click(screen.getByRole('button', { name: 'Cài đặt bàn' }));
    if (kind === 'table') h.useParams.mockReturnValue({ tableId: 't2' });
    else h.actor = 'u2';
    rerender(<MemoryRouter><OnlinePokerTable /></MemoryRouter>);
    expect(await screen.findByText('Chưa có lịch sử buy-in.')).toBeInTheDocument();
    await act(async () => { resolveOld([{ userId: 'u1', displayName: 'LATE OLD PLAYER', total: '9999', count: 1, lastAt: '' }]); });
    expect(screen.queryByText('LATE OLD PLAYER')).not.toBeInTheDocument();
    expect(screen.getByText('Chưa có lịch sử buy-in.')).toBeInTheDocument();
    expect(h.buyins).toHaveBeenCalledTimes(2);
  });
  it('shows a failed ledger read, retries only on request, and distinguishes verified empty', async () => {
    h.useTableMeta.mockReturnValue(meta()); h.useTableHand.mockReturnValue(thState());
    h.buyins.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce([]);
    renderTable(); fireEvent.click(screen.getByRole('button', { name: 'Cài đặt bàn' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được lịch sử buy-in');
    expect(h.buyins).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại lịch sử buy-in' }));
    expect(await screen.findByText('Chưa có lịch sử buy-in.')).toBeInTheDocument();
    expect(h.buyins).toHaveBeenCalledTimes(2);
  });

  it('never carries a previous table ledger into a loading or failed new table', async () => {
    h.useTableMeta.mockReturnValue(meta()); h.useTableHand.mockReturnValue(thState());
    h.buyins.mockResolvedValueOnce([{ userId: 'u1', displayName: 'OLD TABLE PLAYER', total: '5000', count: 1, lastAt: '' }]);
    const { rerender } = renderTable(); fireEvent.click(screen.getByRole('button', { name: 'Cài đặt bàn' }));
    expect(await screen.findByText('OLD TABLE PLAYER')).toBeInTheDocument();
    let rejectNew!: (error: Error) => void;
    h.buyins.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectNew = reject; }));
    h.useParams.mockReturnValue({ tableId: 't2' });
    rerender(<MemoryRouter><OnlinePokerTable /></MemoryRouter>);
    expect(screen.queryByText('OLD TABLE PLAYER')).not.toBeInTheDocument();
    expect(screen.getByText('Đang tải lịch sử buy-in…')).toBeInTheDocument();
    await act(async () => { rejectNew(new Error('503')); });
    expect(screen.queryByText('OLD TABLE PLAYER')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được lịch sử buy-in');
  });
  it('a valid live all-in completion still plays the #329 cinematic', async () => {
    h.useTableMeta.mockReturnValue(meta('open'));
    h.useTableHand.mockReturnValue(thState({ hand: allInDone(), seats: [seat(1, 'u1'), seat(2, 'u2')], mySeatNo: 1 }));
    renderTable();
    expect(await screen.findByText('All-in!')).toBeInTheDocument();
  });

  it('a CLOSED table hides the completed hand and shows "Bàn đã đóng"', () => {
    h.useTableMeta.mockReturnValue(meta('closed'));
    h.useTableHand.mockReturnValue(thState({ hand: allInDone(), seats: [seat(1, 'u1'), seat(2, 'u2')], mySeatNo: 1 }));
    renderTable();
    expect(screen.queryByText('All-in!')).not.toBeInTheDocument();
    expect(screen.queryByText(/Kết quả ván/)).not.toBeInTheDocument();
    expect(screen.getByText('Bàn đã đóng')).toBeInTheDocument();
  });

  it('occupied_seats=0 hides the completed hand and shows "Bàn trống"', () => {
    h.useTableMeta.mockReturnValue(meta('open'));
    h.useTableHand.mockReturnValue(thState({ hand: allInDone(), seats: [], mySeatNo: null }));
    renderTable();
    expect(screen.queryByText('All-in!')).not.toBeInTheDocument();
    expect(screen.getByText(/Bàn trống/)).toBeInTheDocument();
  });

  it('switching tableId clears the held cinematic/result', async () => {
    h.useTableMeta.mockReturnValue(meta('open'));
    h.useTableHand.mockReturnValue(thState({ hand: allInDone(), seats: [seat(1, 'u1'), seat(2, 'u2')], mySeatNo: 1 }));
    const { rerender } = renderTable();
    expect(await screen.findByText('All-in!')).toBeInTheDocument();
    await act(async () => { h.useParams.mockReturnValue({ tableId: 't2' }); rerender(<MemoryRouter><OnlinePokerTable /></MemoryRouter>); });
    expect(screen.queryByText('All-in!')).not.toBeInTheDocument();
  });

  it('a new hand needing MY action clears the held result', async () => {
    h.useTableMeta.mockReturnValue(meta('open'));
    h.useTableHand.mockReturnValue(thState({ hand: allInDone(), seats: [seat(1, 'u1'), seat(2, 'u2')], mySeatNo: 1 }));
    const { rerender } = renderTable();
    expect(await screen.findByText('All-in!')).toBeInTheDocument();
    h.useTableHand.mockReturnValue(thState({ hand: betting(1), seats: [seat(1, 'u1'), seat(2, 'u2')], mySeatNo: 1 }));
    await act(async () => { rerender(<MemoryRouter><OnlinePokerTable /></MemoryRouter>); });
    expect(screen.queryByText('All-in!')).not.toBeInTheDocument();
  });

  // P0 deal-anim regression lock: a fresh new hand (board empty) must drop a NON-cinematic
  // held result EVEN WHEN it is NOT my turn — the old rule only cleared on my-action, which
  // left the felt showing the old hand while the deal signal fired, so the flourish was
  // never seen. The render-time freshDeal gate fixes this.
  it('a fresh new hand (not my turn) drops a non-cinematic held result', async () => {
    h.useTableMeta.mockReturnValue(meta('open'));
    h.useTableHand.mockReturnValue(thState({ hand: foldDone(), seats: [seat(1, 'u1'), seat(2, 'u2')], mySeatNo: 1 }));
    const { rerender } = renderTable();
    expect(await screen.findByText(/Kết quả ván/)).toBeInTheDocument();
    // next hand dealt, toAct=2 (NOT me) → old "needs my action" rule would not fire.
    h.useTableHand.mockReturnValue(thState({ hand: betting(2), seats: [seat(1, 'u1'), seat(2, 'u2')], mySeatNo: 1 }));
    await act(async () => { rerender(<MemoryRouter><OnlinePokerTable /></MemoryRouter>); });
    expect(screen.queryByText(/Kết quả ván/)).not.toBeInTheDocument();
  });

  // Amendment #3 lock: an all-in cinematic must NOT be cut short by a new hand merely
  // ARRIVING (not my turn). It finishes via AllInRunout's own onDone.
  it('an all-in cinematic is NOT cut short when a new hand arrives (not my turn)', async () => {
    h.useTableMeta.mockReturnValue(meta('open'));
    h.useTableHand.mockReturnValue(thState({ hand: allInDone(), seats: [seat(1, 'u1'), seat(2, 'u2')], mySeatNo: 1 }));
    const { rerender } = renderTable();
    expect(await screen.findByText('All-in!')).toBeInTheDocument();
    h.useTableHand.mockReturnValue(thState({ hand: betting(2), seats: [seat(1, 'u1'), seat(2, 'u2')], mySeatNo: 1 }));
    await act(async () => { rerender(<MemoryRouter><OnlinePokerTable /></MemoryRouter>); });
    expect(screen.getByText('All-in!')).toBeInTheDocument();
  });
});
