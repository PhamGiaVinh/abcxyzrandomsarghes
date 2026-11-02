// tests/onlinePoker/client.test.ts
// GE-2D — the client transport is DARK and contract-locked. These tests prove:
//   * request bodies match the edge's discriminated-union Zod schema, field-for-field
//     (anti-drift vs supabase/functions/online-poker-action/index.ts);
//   * while RUNTIME_LIVE is false NO network call is ever made (the dark guard);
//   * the wire -> view mapper preserves the secrecy boundary (no foreign hole cards).
// Live-DB behaviour (grants, idempotency, race) is re-proven at the GE-2C apply session.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// This suite exercises the OFF branch explicitly. Runtime configuration is ON
// in the product; live transport has its own actual-SDK tests.
vi.mock('@/lib/onlinePoker/types',async original=>({...await original<typeof import('@/lib/onlinePoker/types')>(),RUNTIME_LIVE:false}));

// The supabase client reads import.meta.env at module load and createClient throws
// on missing env — so mock it. The fns double as "was the network touched?" probes.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

import { supabase } from '@/integrations/supabase/client';
import { RUNTIME_LIVE } from '@/lib/onlinePoker/types';
import { isChipString, type WirePublicHandState, type WirePrivateHandState } from '@/lib/onlinePoker/wire';
import {
  bodyClaimDaily, bodyGetHole, bodySitDown, bodyStandUp, bodyStartHand, bodySubmitAction,
  bodyRebuyOpen,
  newIdemKey, onlinePokerClient, listTablesLive, loadHandStateLive,
  wirePublicToView, wirePrivateToView,
  RuntimeNotLiveError, OnlinePokerError,
} from '@/lib/onlinePoker/client';

const invoke = vi.mocked(supabase.functions.invoke);
const from = vi.mocked(supabase.from);

beforeEach(() => {
  invoke.mockReset();
  from.mockReset();
});

describe('explicit dark runtime fixture', () => {
  it('does not expose the retired unkeyed table-create client method', () => {
    expect(onlinePokerClient).not.toHaveProperty('createOpenTable');
  });
  it('the OFF branch is selected for the no-network guard tests', () => {
    expect(RUNTIME_LIVE).toBe(false);
  });
});

describe('pure request-body builders match the edge Zod schema', () => {
  it('claim_daily_chips has only op', () => {
    expect(bodyClaimDaily()).toEqual({ op: 'claim_daily_chips' });
  });
  it('get_my_hole_cards carries handId', () => {
    expect(bodyGetHole('hand-1')).toEqual({ op: 'get_my_hole_cards', handId: 'hand-1' });
  });
  it('sit_down carries tableId/seat/buyin/idempotencyKey', () => {
    expect(bodySitDown('t1', 3, '500', 'idem-key-1')).toEqual({
      op: 'sit_down', tableId: 't1', seat: 3, buyin: '500', idempotencyKey: 'idem-key-1',
    });
  });
  it('stand_up / start_hand carry tableId + idempotencyKey', () => {
    expect(bodyStandUp('t1', 'idem-key-1')).toEqual({ op: 'stand_up', tableId: 't1', idempotencyKey: 'idem-key-1' });
    expect(bodyStartHand('t1', 'idem-key-1')).toEqual({ op: 'start_hand', tableId: 't1', idempotencyKey: 'idem-key-1' });
  });
  it('rebuy_open carries tableId/amount/idempotencyKey', () => {
    expect(bodyRebuyOpen('t1', '20000', 'idem-key-1')).toEqual({
      op: 'rebuy_open', tableId: 't1', amount: '20000', idempotencyKey: 'idem-key-1',
    });
  });
  it('submit_action omits amount for non-sizing actions', () => {
    expect(bodySubmitAction({ handId: 'h', seat: 2, type: 'call', idempotencyKey: 'idem-key-1' })).toEqual({
      op: 'submit_action', handId: 'h', seat: 2, type: 'call', idempotencyKey: 'idem-key-1',
    });
  });
  it('submit_action includes amount + expectedSeq when present', () => {
    expect(bodySubmitAction({ handId: 'h', seat: 2, type: 'raise', amount: '300', idempotencyKey: 'idem-key-1', expectedSeq: 7 })).toEqual({
      op: 'submit_action', handId: 'h', seat: 2, type: 'raise', amount: '300', idempotencyKey: 'idem-key-1', expectedSeq: 7,
    });
  });
  it('submit_action rejects bet/raise without a valid chip amount', () => {
    expect(() => bodySubmitAction({ handId: 'h', seat: 2, type: 'bet', idempotencyKey: 'idem-key-1' }))
      .toThrowError(OnlinePokerError);
    expect(() => bodySubmitAction({ handId: 'h', seat: 2, type: 'raise', amount: '30.5', idempotencyKey: 'idem-key-1' }))
      .toThrowError(OnlinePokerError);
  });
  it('submit_action rejects any malformed amount even on non-sizing types', () => {
    expect(() => bodySubmitAction({ handId: 'h', seat: 2, type: 'call', amount: '-1', idempotencyKey: 'idem-key-1' }))
      .toThrowError(/chip amount/);
  });
});

describe('chip-string validation mirrors the engine CHIP_RE', () => {
  it('accepts canonical non-negative decimals', () => {
    for (const s of ['0', '1', '250', '1000000']) expect(isChipString(s)).toBe(true);
  });
  it('rejects empty / signed / leading-zero / decimal / spaced / non-numeric', () => {
    for (const s of ['', '-1', '007', '1.5', ' 1', '1e3', 'abc', '0x1']) expect(isChipString(s)).toBe(false);
  });
});

describe('idempotency keys', () => {
  it('are unique and satisfy the edge IdemKey length bound (>=8)', () => {
    const a = newIdemKey(); const b = newIdemKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(200);
  });
});

describe('dark guard — no method touches the network while RUNTIME_LIVE is false', () => {
  it('every edge method rejects with RuntimeNotLiveError and never invokes', async () => {
    await expect(onlinePokerClient.claimDailyChips()).rejects.toBeInstanceOf(RuntimeNotLiveError);
    await expect(onlinePokerClient.getMyHoleCards('h')).rejects.toBeInstanceOf(RuntimeNotLiveError);
    await expect(onlinePokerClient.sitDown('t', 1, '100')).rejects.toBeInstanceOf(RuntimeNotLiveError);
    await expect(onlinePokerClient.standUp('t')).rejects.toBeInstanceOf(RuntimeNotLiveError);
    await expect(onlinePokerClient.startHand('t')).rejects.toBeInstanceOf(RuntimeNotLiveError);
    await expect(onlinePokerClient.submitAction({ handId: 'h', seat: 1, type: 'call' }))
      .rejects.toBeInstanceOf(RuntimeNotLiveError);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('live read helpers reject and never query', async () => {
    await expect(listTablesLive()).rejects.toBeInstanceOf(RuntimeNotLiveError);
    await expect(loadHandStateLive('t')).rejects.toBeInstanceOf(RuntimeNotLiveError);
    expect(from).not.toHaveBeenCalled();
  });
});

// ── mapper fixtures ────────────────────────────────────────────────────────

function publicWire(): WirePublicHandState {
  return {
    config: { handId: 'h1', tableId: 't1', handNo: 42, buttonSeat: 2, sb: '25', bb: '50', schemaVersion: 1 },
    street: 'flop',
    board: ['Ah', 'Kd', '7c'],
    seats: [
      { seat: 1, playerId: 'u1', startingStack: '2000', stack: '1875', committed: '0', totalCommitted: '125', status: 'active', hasActedThisRound: true, canRaise: true },
      { seat: 2, playerId: 'u2', startingStack: '2000', stack: '2100', committed: '0', totalCommitted: '0', status: 'active', hasActedThisRound: false, canRaise: true },
      { seat: 4, playerId: 'u4', startingStack: '1000', stack: '980', committed: '150', totalCommitted: '150', status: 'active', hasActedThisRound: false, canRaise: true },
    ],
    buttonSeat: 2,
    toAct: 4,
    currentBet: '150',
    lastFullRaiseSize: '50',
    aggressor: 4,
    pot: '475',
    sidePots: [],
    status: 'betting',
  };
}

describe('wirePublicToView — projection + secrecy', () => {
  it('maps config/board/pot and sets isButton/isToAct flags from the wire', () => {
    const v = wirePublicToView(publicWire());
    expect(v.handId).toBe('h1');
    expect(v.tableId).toBe('t1');
    expect(v.handNo).toBe(42);
    expect(v.street).toBe('flop');
    expect(v.board).toEqual(['Ah', 'Kd', '7c']);
    expect(v.pot).toBe('475');
    expect(v.buttonSeat).toBe(2);
    expect(v.toActSeat).toBe(4);
    const s2 = v.seats.find((s) => s.seat === 2)!;
    const s4 = v.seats.find((s) => s.seat === 4)!;
    expect(s2.isButton).toBe(true);
    expect(s2.isToAct).toBe(false);
    expect(s4.isButton).toBe(false);
    expect(s4.isToAct).toBe(true);
  });

  it('carries NO hole cards when no private overlay is supplied (secrecy)', () => {
    const v = wirePublicToView(publicWire());
    expect(v.myHoleCards).toBeUndefined();
    expect(v.mySeat).toBeUndefined();
    // no seat object should carry a hidden card field
    for (const s of v.seats) expect((s as Record<string, unknown>).holeCards).toBeUndefined();
  });

  it('attaches ONLY the caller seat overlay when supplied', () => {
    const v = wirePublicToView(publicWire(), { mySeat: 4, myHoleCards: ['Qs', 'Jh'] });
    expect(v.mySeat).toBe(4);
    expect(v.myHoleCards).toEqual(['Qs', 'Jh']);
  });
});

describe('wirePrivateToView — own cards from a private wire', () => {
  it('lifts mySeat + myHoleCards off the private wire', () => {
    const priv: WirePrivateHandState = { ...publicWire(), mySeat: 4, myHoleCards: ['Qs', 'Jh'] };
    const v = wirePrivateToView(priv);
    expect(v.mySeat).toBe(4);
    expect(v.myHoleCards).toEqual(['Qs', 'Jh']);
  });
});

// ── Bug B: a COMPLETED hand must carry the settlement result to the view ──────
// Fixture mirrors a REAL settled all-in showdown observed in the live DB (hand #3):
// seat 3 (6s Kh) beats seat 2 (6c 5h) on board 4d Ad 7d 7c 2s; pot 9700 -> seat 3;
// uncalled 300 refunded to seat 2; chips conserved (9700 + 300 = 10000).
function completedAllInWire(): WirePublicHandState {
  return {
    config: { handId: 'h3', tableId: 't3', handNo: 3, buttonSeat: 3, sb: '25', bb: '50', schemaVersion: 1 },
    street: 'showdown',
    board: ['4d', 'Ad', '7d', '7c', '2s'],
    seats: [
      { seat: 3, playerId: 'u3', startingStack: '4850', stack: '9700', committed: '0', totalCommitted: '4850', status: 'allin', hasActedThisRound: true, canRaise: true, revealedCards: ['6s', 'Kh'] },
      { seat: 2, playerId: 'u2', startingStack: '5150', stack: '300', committed: '0', totalCommitted: '4850', status: 'allin', hasActedThisRound: true, canRaise: true, revealedCards: ['6c', '5h'] },
    ],
    buttonSeat: 3,
    toAct: null,
    currentBet: '0',
    lastFullRaiseSize: '50',
    aggressor: null,
    pot: '0',
    sidePots: [],
    status: 'complete',
    result: {
      endedBy: 'showdown',
      potTotal: '9700',
      potAwards: [{ potIndex: 0, amount: '9700', winners: [3] }],
      payouts: { 3: '9700' },
      refund: { seat: 2, amount: '300' },
    },
  };
}

describe('wirePublicToView — completed hand carries the settlement result (Bug B)', () => {
  it('preserves result (payouts / potAwards / refund), the 5-card board and showdown reveals', () => {
    const v = wirePublicToView(completedAllInWire());
    expect(v.status).toBe('complete');
    expect(v.board).toHaveLength(5);
    expect(v.result).toBeDefined();
    expect(v.result!.endedBy).toBe('showdown');
    expect(v.result!.potTotal).toBe('9700');
    expect(v.result!.payouts[3]).toBe('9700');
    expect(v.result!.refund).toEqual({ seat: 2, amount: '300' });
    // both contesting seats reveal their hole cards at showdown:
    expect(v.seats.find((s) => s.seat === 3)!.revealedCards).toEqual(['6s', 'Kh']);
    expect(v.seats.find((s) => s.seat === 2)!.revealedCards).toEqual(['6c', '5h']);
  });

  it('derives winnerSeats from result.potAwards exactly as the table UI does', () => {
    const v = wirePublicToView(completedAllInWire());
    const winnerSeats = Array.from(new Set(v.result!.potAwards.flatMap((a) => a.winners)));
    expect(winnerSeats).toEqual([3]);
  });

  it('omits result for a hand still in progress (no premature winner)', () => {
    const v = wirePublicToView(publicWire());
    expect(v.result).toBeUndefined();
  });
});
