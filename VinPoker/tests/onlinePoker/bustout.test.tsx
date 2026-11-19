// tests/onlinePoker/bustout.test.tsx
// E4 — bustout modal at the component level. A seated player whose live seat stack is 0
// (the server writes settled stacks back, migration 20260907000000) and who is NOT in a
// live hand sees the "Bạn đã hết chip" dialog: "Đứng dậy rời bàn" calls leave_open_table,
// "Mua thêm chip" is disabled. The modal must NOT show mid-hand (all-in still in play) nor
// when the player still has chips. Server stays the only authority over chips.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/onlinePoker/client', () => ({ loadBuyinsLive: vi.fn().mockResolvedValue([]) }));

const h = vi.hoisted(() => ({ useTableHand: vi.fn(), useTableMeta: vi.fn(), useParams: vi.fn() }));
// E5 — toggle FEATURES.onlinePokerRebuy per test (all other flags keep their real values).
const ff = vi.hoisted(() => ({ rebuy: false }));

vi.mock('@/lib/onlinePoker/useOnlinePoker', () => ({
  useTableHand: (id: string) => h.useTableHand(id),
  useTableMeta: (id: string) => h.useTableMeta(id),
}));
vi.mock('@/lib/featureFlags', async (orig) => {
  const actual = await (orig() as Promise<{ FEATURES: Record<string, unknown> }>);
  return { ...actual, FEATURES: { ...actual.FEATURES, get onlinePokerRebuy() { return ff.rebuy; } } };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => h.useParams() };
});
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import OnlinePokerTable from '@/pages/OnlinePokerTable';

const meta = (status = 'open') => ({ id: 't1', name: 'Bàn 1', sb: '25', bb: '50', maxSeats: 9, status, minBuyin: '1000', maxBuyin: '10000', startingStack: '2000', hostUserId: null });
const seat = (n: number, userId: string, stack: string) => ({ seatNo: n, userId, displayName: 'P' + n, stack, status: 'sitting' });
const bettingHand = (toAct: number) => ({
  handId: 'h9', tableId: 't1', handNo: 9, street: 'preflop', board: [], pot: '75', toActSeat: toAct, buttonSeat: 1, status: 'betting',
  seats: [{ seat: 1, playerId: 'u1', stack: '0', committed: '5000', status: 'allin' }, { seat: 2, playerId: 'u2', stack: '5000', committed: '50', status: 'active' }],
  mySeat: 1,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const thState = (over: any = {}) => ({
  hand: null, seats: [], seatReadStatus: 'ready', mySeatNo: null, myUserId: 'u1', hostUserId: null, amIHost: false, legal: null, loading: false, refresh: vi.fn(),
  actions: {
    sitOpen: vi.fn().mockResolvedValue({ outcome: 'ok' }),
    leaveTable: vi.fn().mockResolvedValue({ outcome: 'ok' }),
    transferHost: vi.fn().mockResolvedValue({ outcome: 'ok' }),
    submitAction: vi.fn().mockResolvedValue({ ok: true }),
    rebuy: vi.fn().mockResolvedValue({ outcome: 'ok' }),
  },
  ...over,
});

const renderTable = () => render(<MemoryRouter><OnlinePokerTable /></MemoryRouter>);

beforeEach(() => { h.useParams.mockReturnValue({ tableId: 't1' }); h.useTableMeta.mockReturnValue(meta('open')); ff.rebuy = false; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('OnlinePokerTable — E4 bustout modal', () => {
  it('seated with 0 chips and no live hand → shows "Bạn đã hết chip"', async () => {
    h.useTableHand.mockReturnValue(thState({ seats: [seat(1, 'u1', '0'), seat(2, 'u2', '5000')], mySeatNo: 1 }));
    renderTable();
    expect(await screen.findByText('Bạn đã hết chip')).toBeInTheDocument();
  });

  it('"Đứng dậy rời bàn" calls leaveTable', async () => {
    const leaveTable = vi.fn().mockResolvedValue({ outcome: 'ok' });
    h.useTableHand.mockReturnValue(thState({
      seats: [seat(1, 'u1', '0'), seat(2, 'u2', '5000')], mySeatNo: 1,
      actions: { sitOpen: vi.fn(), leaveTable, transferHost: vi.fn(), submitAction: vi.fn() },
    }));
    renderTable();
    const leaveBtn = await screen.findByRole('button', { name: /Đứng dậy rời bàn/ });
    await act(async () => { fireEvent.click(leaveBtn); });
    expect(leaveTable).toHaveBeenCalledTimes(1);
  });

  it('rebuy flag OFF → "Mua thêm chip" is disabled (no rebuy op live)', async () => {
    h.useTableHand.mockReturnValue(thState({ seats: [seat(1, 'u1', '0'), seat(2, 'u2', '5000')], mySeatNo: 1 }));
    renderTable();
    const rebuy = await screen.findByRole('button', { name: /Mua thêm chip/ });
    expect(rebuy).toBeDisabled();
  });

  it('rebuy flag ON → fixed-amount button calls rebuy(startingStack)', async () => {
    ff.rebuy = true;
    const rebuy = vi.fn().mockResolvedValue({ outcome: 'ok' });
    h.useTableHand.mockReturnValue(thState({
      seats: [seat(1, 'u1', '0'), seat(2, 'u2', '5000')], mySeatNo: 1,
      actions: { sitOpen: vi.fn(), leaveTable: vi.fn().mockResolvedValue({ outcome: 'ok' }), transferHost: vi.fn(), submitAction: vi.fn(), rebuy },
    }));
    renderTable();
    // Fixed amount = table startingStack '2000' → "Mua thêm 2,000 chip", enabled.
    const btn = await screen.findByRole('button', { name: /Mua thêm 2,000 chip/ });
    expect(btn).toBeEnabled();
    await act(async () => { fireEvent.click(btn); });
    expect(rebuy).toHaveBeenCalledWith('2000');
  });

  it('does NOT show while still in a live hand (all-in, stack 0 mid-hand)', () => {
    h.useTableHand.mockReturnValue(thState({ hand: bettingHand(2), seats: [seat(1, 'u1', '0'), seat(2, 'u2', '5000')], mySeatNo: 1 }));
    renderTable();
    expect(screen.queryByText('Bạn đã hết chip')).not.toBeInTheDocument();
  });

  it('does NOT show when the player still has chips', () => {
    h.useTableHand.mockReturnValue(thState({ seats: [seat(1, 'u1', '5000'), seat(2, 'u2', '5000')], mySeatNo: 1 }));
    renderTable();
    expect(screen.queryByText('Bạn đã hết chip')).not.toBeInTheDocument();
  });

  it('does NOT show when the viewer is not seated', () => {
    h.useTableHand.mockReturnValue(thState({ seats: [seat(2, 'u2', '5000')], mySeatNo: null }));
    renderTable();
    expect(screen.queryByText('Bạn đã hết chip')).not.toBeInTheDocument();
  });
});
