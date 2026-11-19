// supabase/functions/_shared/pokerRuntime/dealNextHand.ts
// GE-2K — deal the NEXT hand at one table. The TS engine (shuffle + createHand) runs
// ONLY here (in the Deno Edge); persistence goes through the existing op_start_hand RPC.
// This is the same recipe as online-poker-action's handleStart, factored out behind a
// minimal AdminClient interface so the table runner and unit tests can drive it.
//
// Server-authoritative: cards/winner/pot are decided by the engine; the client never deals.
// Hole-card secrecy is preserved by op_start_hand (deck/holes land in online_poker_hand_secrets).

import { createHand, shuffledDeck, cryptoRng32 } from '../pokerEngine/index.ts';
import {
  serializeAuthoritative, buildSeatInputs, buildHandConfig, ENGINE_VERSION, type SeatRow,
} from '../pokerAdapter/index.ts';

const DEFAULT_ACT_TIMEOUT_SECS = 30;

/** The minimal Supabase surface dealNextHand needs (the real service-role client fits;
 *  tests pass a mock). Loosely typed on purpose — mirrors the untyped rails() boundary. */
export interface AdminClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
}

export type DealReason =
  | 'table_not_found' | 'table_not_open' | 'seats_load_failed' | 'previous_hand_unavailable'
  | 'satellite_level_unavailable'
  | 'not_enough_players' | 'could_not_start_hand' | 'already_active' | 'disabled' | 'start_hand_failed';

export type DealResult =
  | { ok: true; tableId: string; handId: string; handNo: number; buttonSeat: number }
  | { ok: false; tableId: string; reason: DealReason };

/** Next button seat clockwise after the previous button among the seated seats. */
export function nextButton(prev: number | null, seatNos: number[]): number {
  if (prev == null) return seatNos[0];
  const after = seatNos.filter((s) => s > prev);
  return after.length ? after[0] : seatNos[0];
}

/** Both deal paths use the same confirmed hand sequence and clockwise rotation. */
export function nextHandPosition(previous: { hand_no: unknown; button_seat: unknown } | null, seatNos: number[]) {
  if (previous === null) return { handNo: 1, button: nextButton(null, seatNos) };
  if (!previous || typeof previous !== 'object') return null;
  const rawHandNo = previous.hand_no;
  const handNo = typeof rawHandNo === 'number' || (typeof rawHandNo === 'string' && /^\d+$/.test(rawHandNo))
    ? Number(rawHandNo) : NaN;
  const button = previous.button_seat;
  if (!Number.isSafeInteger(handNo) || handNo < 1 || handNo >= Number.MAX_SAFE_INTEGER
    || typeof button !== 'number' || !Number.isInteger(button) || button < 1 || button > 10) return null;
  return { handNo: handNo + 1, button: nextButton(button, seatNos) };
}

/**
 * Read the table + funded seats, advance the button, run the engine to build a hand, and
 * persist it via op_start_hand. Returns a discriminated result; never throws on a normal
 * skip (table not open / <2 funded / already an active hand). The one-active-hand partial
 * unique index makes a concurrent double-deal a no-op (op_start_hand → 'already_active').
 */
export async function dealNextHand(
  admin: AdminClient, tableId: string, actorUserId: string | null,
): Promise<DealResult> {
  const { data: table, error: tErr } = await admin
    .from('online_poker_tables')
    .select('id, sb, bb, max_seats, act_timeout_secs, status')
    .eq('id', tableId).maybeSingle();
  if (tErr || !table) return { ok: false, tableId, reason: 'table_not_found' };
  if (table.status !== 'open') return { ok: false, tableId, reason: 'table_not_open' };

  const { data: seatRows, error: sErr } = await admin
    .from('online_poker_seats')
    .select('seat_no, user_id, stack, status')
    .eq('table_id', tableId);
  if (sErr) return { ok: false, tableId, reason: 'seats_load_failed' };

  const seated = ((seatRows ?? []) as SeatRow[]).filter(
    (r) => r.user_id && r.status === 'sitting' && Number(r.stack) > 0,
  );
  if (seated.length < 2) return { ok: false, tableId, reason: 'not_enough_players' };

  const { data: last, error: lastError } = await admin
    .from('online_poker_hands')
    .select('hand_no, button_seat')
    .eq('table_id', tableId)
    .order('hand_no', { ascending: false }).limit(1).maybeSingle();

  const seatNos = seated.map((s) => s.seat_no).sort((a, b) => a - b);
  const position = lastError ? null : nextHandPosition(last, seatNos);
  if (!position) return { ok: false, tableId, reason: 'previous_hand_unavailable' };
  const { handNo, button } = position;

  const { data: level, error: levelError } = await admin.rpc('op_read_satellite_deal_level', {
    p_table_id: tableId,
    p_actor_user_id: actorUserId,
  });
  if (levelError || (level?.mode !== 'practice' && level?.mode !== 'ready')) {
    return { ok: false, tableId, reason: 'satellite_level_unavailable' };
  }
  const satellite = level.mode === 'ready' ? level : null;
  const roundNo = satellite?.roundNo;
  if (roundNo !== undefined && (typeof roundNo !== 'string' || !/^[1-9]\d*$/.test(roundNo))) {
    return { ok: false, tableId, reason: 'satellite_level_unavailable' };
  }
  const handId = crypto.randomUUID();
  const seatInputs = buildSeatInputs(seated);
  const originalDeck = shuffledDeck(cryptoRng32);

  let built;
  try {
    const blinds = satellite ?? table;
    const { schemaVersion, ...config } = buildHandConfig(
      { id: table.id, sb: blinds.sb, bb: blinds.bb }, handId, handNo, button,
    );
    built = createHand(satellite
      ? { ...config, bigBlindAnte: BigInt(satellite.bigBlindAnte) }
      : { ...config, schemaVersion }, [...originalDeck], seatInputs);
  } catch {
    return { ok: false, tableId, reason: 'could_not_start_hand' };
  }
  if (built.error) return { ok: false, tableId, reason: 'could_not_start_hand' };

  const split = serializeAuthoritative(built.state);
  const deadline = built.state.toAct != null
    ? new Date(Date.now() + (Number(table.act_timeout_secs) || DEFAULT_ACT_TIMEOUT_SECS) * 1000).toISOString()
    : null;

  const { data, error } = await admin.rpc('op_start_hand', {
    p_state: satellite ? {
      ...split.stateJson,
      satelliteLevel: { clockRevision: satellite.clockRevision, levelStartSecond: satellite.levelStartSecond },
      ...(roundNo === undefined ? {} : { satelliteRound: roundNo }),
    } : split.stateJson,
    p_deck: originalDeck,
    p_board_future: split.liveDeck,
    p_holes: split.holes,
    p_events: built.events.map((e) => ({ type: e.type, payload: e.payload })),
    p_engine_version: ENGINE_VERSION,
    p_act_deadline: deadline,
    p_actor_user_id: actorUserId, // op_start_hand ignores this (system actor → null is fine)
  });
  if (error) return { ok: false, tableId, reason: 'start_hand_failed' };
  if (data?.outcome === 'already_active') return { ok: false, tableId, reason: 'already_active' };
  if (data?.outcome === 'disabled') return { ok: false, tableId, reason: 'disabled' };
  if (data?.outcome !== 'ok' || data.hand_id !== handId || data.state_version !== 0) {
    return { ok: false, tableId, reason: 'start_hand_failed' };
  }

  return { ok: true, tableId, handId, handNo, buttonSeat: button };
}
