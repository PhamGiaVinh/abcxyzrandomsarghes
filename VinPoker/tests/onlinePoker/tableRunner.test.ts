// tests/onlinePoker/tableRunner.test.ts
// GE-2K table runner (source-only; online poker stays DARK). Drives the real
// runTableRunner + dealNextHand through a mock AdminClient (no DB/Edge). Proves: it
// fails closed while disabled, skips tables with an active hand / <2 funded players, is
// idempotent (a duplicate deal is a no-op, not an error), never deals in dry-run, and
// never emits secret data.

import { describe, it, expect } from 'vitest';
import { runTableRunner } from '../../supabase/functions/_shared/pokerRuntime/tableRunner.ts';
import { nextButton, nextHandPosition } from '../../supabase/functions/_shared/pokerRuntime/dealNextHand.ts';

it('uses a confirmed first hand or rotates after a valid previous hand, refusing malformed history', () => {
  expect(nextHandPosition(null, [2, 5])).toEqual({ handNo: 1, button: 2 });
  expect(nextHandPosition({ hand_no: '7', button_seat: 5 }, [2, 5])).toEqual({ handNo: 8, button: 2 });
  expect(nextHandPosition({ hand_no: null, button_seat: 2 }, [2, 5])).toBeNull();
  expect(nextHandPosition({ hand_no: 7, button_seat: null }, [2, 5])).toBeNull();
});

interface Stage {
  enabled?: boolean;
  lastHandUnavailable?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  due?: any; diag?: any; table?: any; seats?: any[]; lastHand?: any; startHand?: any | (() => any);
}

function makeAdmin(stage: Stage) {
  const calls = { startHand: 0, rpc: [] as string[], startStates: [] as unknown[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ok = (data: any) => ({ data, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function builder(rows: any, unavailable = false) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b, eq: () => b, order: () => b, limit: () => b,
      maybeSingle: () => Promise.resolve(unavailable ? { data: null, error: { code: 'TEST' } } : ok(rows)),
      // awaitable for array selects (online_poker_seats)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (f: any, r?: any) => Promise.resolve(ok(rows)).then(f, r),
    };
    return b;
  }
  const admin = {
    from(tbl: string) {
      if (tbl === 'online_poker_tables') return builder(stage.table ?? null);
      if (tbl === 'online_poker_seats') return builder(stage.seats ?? []);
      if (tbl === 'online_poker_hands') return builder(stage.lastHand ?? null, stage.lastHandUnavailable);
      return builder(null);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc(fn: string, _args?: any) {
      calls.rpc.push(fn);
      if (fn === 'op_is_enabled') return Promise.resolve(ok(stage.enabled ?? false));
      if (fn === 'op_run_due_table_ticks') return Promise.resolve(ok(stage.due ?? { outcome: 'ok', tables: [] }));
      if (fn === 'op_table_runner_diag') return Promise.resolve(ok(stage.diag ?? { outcome: 'ok', tables: [] }));
      if (fn === 'op_start_hand') {
        calls.startHand++;
        calls.startStates.push(_args?.p_state);
        const sh = typeof stage.startHand === 'function' ? stage.startHand() : stage.startHand;
        return Promise.resolve(ok(sh ?? { outcome: 'ok', hand_id: _args?.p_state?.config?.handId, state_version: 0 }));
      }
      return Promise.resolve(ok(null));
    },
  };
  return { admin, calls };
}

const TABLE = { id: 't1', sb: '25', bb: '50', max_seats: 6, act_timeout_secs: 30, status: 'open' };
const TWO_FUNDED = [
  { seat_no: 1, user_id: 'u1', stack: '5000', status: 'sitting' },
  { seat_no: 2, user_id: 'u2', stack: '5000', status: 'sitting' },
];

describe('runTableRunner — fail-closed while disabled', () => {
  it('does nothing and never calls op_start_hand when op_is_enabled=false', async () => {
    const { admin, calls } = makeAdmin({ enabled: false, due: { outcome: 'ok', tables: [{ table_id: 't1' }] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runTableRunner(admin as any);
    expect(r.outcome).toBe('disabled');
    expect(r.dealt).toBe(0);
    expect(calls.startHand).toBe(0);
    expect(calls.rpc).not.toContain('op_run_due_table_ticks'); // gated before listing
  });
});

describe('runTableRunner — deals eligible tables', () => {
  it('deals a table the lister returns (happy path)', async () => {
    const { admin, calls } = makeAdmin({
      enabled: true,
      due: { outcome: 'ok', tables: [{ table_id: 't1' }] },
      table: TABLE, seats: TWO_FUNDED, lastHand: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runTableRunner(admin as any);
    expect(r.outcome).toBe('ok');
    expect(r.dealt).toBe(1);
    expect(r.errors).toBe(0);
    expect(calls.startHand).toBe(1);
  });
});

describe('runTableRunner — skips & idempotency', () => {
  it('does not reset the button or hand number when the previous-hand read fails', async () => {
    const { admin, calls } = makeAdmin({ enabled: true, due: { outcome: 'ok', tables: [{ table_id: 't1' }] },
      table: TABLE, seats: TWO_FUNDED, lastHandUnavailable: true });
    const result = await runTableRunner(admin);
    expect(result.errors).toBe(1);
    expect(result.dealt).toBe(0);
    expect(calls.startHand).toBe(0);
  });
  it('skips (does not deal) a table that already has an active hand (op_start_hand → already_active)', async () => {
    const { admin } = makeAdmin({
      enabled: true,
      due: { outcome: 'ok', tables: [{ table_id: 't1' }] },
      table: TABLE, seats: TWO_FUNDED, lastHand: null,
      startHand: { outcome: 'already_active' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runTableRunner(admin as any);
    expect(r.dealt).toBe(0);
    expect(r.skippedAlreadyActive).toBe(1);
    expect(r.errors).toBe(0);
  });

  it('skips a table with fewer than 2 funded seated players (never reaches op_start_hand)', async () => {
    const { admin, calls } = makeAdmin({
      enabled: true,
      due: { outcome: 'ok', tables: [{ table_id: 't1' }] },
      table: TABLE,
      seats: [{ seat_no: 1, user_id: 'u1', stack: '5000', status: 'sitting' }], // only 1 funded
      lastHand: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runTableRunner(admin as any);
    expect(r.dealt).toBe(0);
    expect(r.skippedNotEnough).toBe(1);
    expect(calls.startHand).toBe(0);
  });

  it('is idempotent: duplicate deal attempts are no-ops (already_active), not errors', async () => {
    const { admin } = makeAdmin({
      enabled: true,
      due: { outcome: 'ok', tables: [{ table_id: 't1' }, { table_id: 't1' }] },
      table: TABLE, seats: TWO_FUNDED, lastHand: null,
      startHand: { outcome: 'already_active' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runTableRunner(admin as any);
    expect(r.scanned).toBe(2);
    expect(r.dealt).toBe(0);
    expect(r.skippedAlreadyActive).toBe(2);
    expect(r.errors).toBe(0);
  });
});

describe('runTableRunner — dry-run never deals & reports skip reasons', () => {
  it('classifies open tables but does not deal in dryRun', async () => {
    const { admin, calls } = makeAdmin({
      enabled: true,
      diag: { outcome: 'ok', tables: [
        { table_id: 'a', bucket: 'eligible' },
        { table_id: 'b', bucket: 'active_hand' },
        { table_id: 'c', bucket: 'no_quorum' },
        { table_id: 'd', bucket: 'cooldown' },
      ] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runTableRunner(admin as any, { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.dealt).toBe(0);
    expect(calls.startHand).toBe(0);
    expect(r.diag).toEqual(expect.objectContaining({ eligible: 1, active_hand: 1, no_quorum: 1, cooldown: 1 }));
    expect(calls.rpc).not.toContain('op_run_due_table_ticks'); // dry-run uses the diag, not the lister
  });
});

describe('runTableRunner — no secret output', () => {
  it('does not report a hand dealt when the receipt identifies a different hand', async () => {
    const { admin } = makeAdmin({
      enabled: true,
      due: { outcome: 'ok', tables: [{ table_id: 't1' }] },
      table: TABLE, seats: TWO_FUNDED,
      startHand: { outcome: 'ok', hand_id: 'different-hand', state_version: 0 },
    });
    const result = await runTableRunner(admin);
    expect(result.dealt).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('derives the next hand from the persisted hand when a new runner takes over', async () => {
    const { admin, calls } = makeAdmin({
      enabled: true,
      due: { outcome: 'ok', tables: [{ table_id: 't1' }] },
      table: TABLE, seats: TWO_FUNDED, lastHand: { hand_no: 7, button_seat: 2 },
    });
    const result = await runTableRunner(admin);

    expect(result.dealt).toBe(1);
    expect(calls.startStates).toHaveLength(1);
    expect(calls.startStates[0]).toMatchObject({ config: { handNo: 8, buttonSeat: 1 } });
    expect(JSON.stringify(calls.startStates[0])).not.toMatch(/"deck"|"holeCards"/);
  });

  it('result telemetry contains no cards/deck/holes', async () => {
    const { admin } = makeAdmin({
      enabled: true,
      due: { outcome: 'ok', tables: [{ table_id: 't1' }] },
      table: TABLE, seats: TWO_FUNDED, lastHand: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runTableRunner(admin as any);
    expect(JSON.stringify(r)).not.toMatch(/deck|holeCards|"cards"|board_future/i);
  });
});

describe('nextButton', () => {
  it('advances clockwise among seated seats and wraps', () => {
    expect(nextButton(null, [1, 2, 3])).toBe(1);
    expect(nextButton(1, [1, 2, 3])).toBe(2);
    expect(nextButton(3, [1, 2, 3])).toBe(1);
    expect(nextButton(2, [1, 3, 5])).toBe(3);
    expect(nextButton(5, [1, 3, 5])).toBe(1);
  });
});
