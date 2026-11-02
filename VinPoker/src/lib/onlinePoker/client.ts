// src/lib/onlinePoker/client.ts
// GE-2D — the client transport for online poker. This is the single place the web
// UI talks to the GE-2C runtime. It is DARK by construction: every method that
// would hit the network first checks RUNTIME_LIVE and throws RuntimeNotLiveError
// while false, so the shell can never reach the backend until the runtime is live.
//
// Two paths, both gated:
//   * intent/writes + secret hole cards -> the `online-poker-action` Edge function
//     (op-discriminated body; the edge runs the engine and routes through op_* RPCs).
//   * public reads (lobby tables, public hand state) -> direct supabase selects on
//     the realtime-published online_poker_* rails (no secrets ever cross this path).
//
// Anti-drift: the request bodies are built by the pure `body*` helpers below, which
// tests/onlinePoker/client.test.ts asserts field-for-field against the edge's Zod
// schema. The wire view shapes live in ./wire.ts (a hand-maintained server mirror).

import { supabase } from '@/integrations/supabase/client';
import { RUNTIME_LIVE } from './types';
import {parseOnlineCreateReceipt,parseOnlineCreateResolution,type OnlineCreatePayload} from './createReceipt';
import type { ActionType, LobbyTableSummary, PublicHandView, PublicSeatView, WalletView } from './types';
import {
  isChipString,
  type ActionRequest,
  type ChipString,
  type RpcOutcome,
  type SubmitActionResult,
  type WireLegalActions,
  type WirePublicHandState,
  type WirePrivateHandState,
} from './wire';

// ── errors ───────────────────────────────────────────────────────────────────

/** Thrown by any network method while the runtime is dark (RUNTIME_LIVE === false). */
export class RuntimeNotLiveError extends Error {
  constructor() {
    super('online poker runtime is not live (RUNTIME_LIVE=false)');
    this.name = 'RuntimeNotLiveError';
  }
}

/** A failed edge/RPC call. `code` is the stable machine code where one exists. */
export class OnlinePokerError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'OnlinePokerError';
    this.code = code;
  }
}

// ── idempotency keys ─────────────────────────────────────────────────────────

/** A per-attempt idempotency key (UUID v4 — satisfies the edge's min(8) IdemKey). */
export function newIdemKey(): string {
  return crypto.randomUUID();
}

// ── pure request-body builders (no network — unit-tested while dark) ─────────
// Each returns the EXACT body the edge's discriminated-union Zod schema expects.

export const bodyClaimDaily = () => ({ op: 'claim_daily_chips' as const });

/** Keep-warm ping — the edge answers {ok:true} right after auth, zero Postgres IO. Until the
 *  ping op is deployed the edge zod-rejects it (400) — callers MUST swallow errors; the
 *  rejected request still warms the isolate (auth + parse run before the reject). */
export const bodyPing = () => ({ op: 'ping' as const });

export const bodyGetHole = (handId: string) => ({ op: 'get_my_hole_cards' as const, handId });

export const bodyLegalActions = (handId: string) => ({ op: 'legal_actions' as const, handId });

export const bodySitDown = (tableId: string, seat: number, buyin: ChipString, idempotencyKey: string) =>
  ({ op: 'sit_down' as const, tableId, seat, buyin, idempotencyKey });

export const bodyStandUp = (tableId: string, idempotencyKey: string) =>
  ({ op: 'stand_up' as const, tableId, idempotencyKey });

export const bodyStartHand = (tableId: string, idempotencyKey: string) =>
  ({ op: 'start_hand' as const, tableId, idempotencyKey });

// Friends-practice (open tables, wallet-free, host succession)
const bodyCreateOpenTable = (name: string, sb: ChipString, bb: ChipString, buyin: ChipString, maxSeats: number) =>
  ({ op: 'create_open_table' as const, name, sb, bb, buyin, maxSeats });

export const bodySitOpen = (tableId: string, seat: number, buyin: ChipString, idempotencyKey: string) =>
  ({ op: 'sit_open' as const, tableId, seat, buyin, idempotencyKey });

export const bodyTransferHost = (tableId: string, toUserId: string) =>
  ({ op: 'transfer_host' as const, tableId, toUserId });

export const bodyLeaveOpenTable = (tableId: string) =>
  ({ op: 'leave_open_table' as const, tableId });

export const bodyRebuyOpen = (tableId: string, amount: ChipString, idempotencyKey: string) =>
  ({ op: 'rebuy_open' as const, tableId, amount, idempotencyKey });

export function bodySubmitAction(req: ActionRequest) {
  // bet/raise must carry a canonical chip amount; reject malformed before the wire.
  if ((req.type === 'bet' || req.type === 'raise') && !isChipString(req.amount)) {
    throw new OnlinePokerError('bad_request', 'bet/raise requires a valid chip amount');
  }
  if (req.amount !== undefined && !isChipString(req.amount)) {
    throw new OnlinePokerError('bad_request', 'invalid chip amount');
  }
  return {
    op: 'submit_action' as const,
    handId: req.handId,
    seat: req.seat,
    type: req.type,
    ...(req.amount !== undefined ? { amount: req.amount } : {}),
    idempotencyKey: req.idempotencyKey,
    ...(req.expectedSeq !== undefined ? { expectedSeq: req.expectedSeq } : {}),
  };
}

// ── edge invocation (gated) ──────────────────────────────────────────────────

/**
 * Invoke the online-poker Edge function with an op-body. THROWS RuntimeNotLiveError
 * while dark — it never reaches the network until RUNTIME_LIVE flips true.
 */
async function invokeEdge<T>(body: Record<string, unknown>): Promise<T> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data, error } = await supabase.functions.invoke('online-poker-action', { body });
  if (error) throw new OnlinePokerError('edge_error', error.message);
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    throw new OnlinePokerError(String((data as { error: unknown }).error));
  }
  return data as T;
}

// ── public client surface ────────────────────────────────────────────────────

export const onlinePokerClient = {
  /** Daily play-chip grant (idempotent per UTC day, server-side). */
  claimDailyChips: () => invokeEdge<RpcOutcome>(bodyClaimDaily()),

  /** Keep-warm ping (see bodyPing). Fire-and-forget; callers swallow all errors. */
  ping: () => invokeEdge<{ ok: true }>(bodyPing()),

  /** The caller's OWN hole cards for a hand (deny-all secrets, auth.uid()-scoped). */
  getMyHoleCards: (handId: string) => invokeEdge<RpcOutcome>(bodyGetHole(handId)),

  /** Server-authoritative legal-action menu for the caller's own seat (engine decides). */
  legalActions: (handId: string) =>
    invokeEdge<{ ok: boolean; legal: WireLegalActions | null; mySeat: number | null }>(bodyLegalActions(handId)),

  /** Take a seat with a play-chip buy-in. */
  sitDown: (tableId: string, seat: number, buyin: ChipString) =>
    invokeEdge<RpcOutcome>(bodySitDown(tableId, seat, buyin, newIdemKey())),

  /** Leave the table (blocked server-side while in an active hand). */
  standUp: (tableId: string) => invokeEdge<RpcOutcome>(bodyStandUp(tableId, newIdemKey())),

  /** Start a new hand at a table (≥2 seated; server deals + assigns the button). */
  startHand: (tableId: string) => invokeEdge<RpcOutcome>(bodyStartHand(tableId, newIdemKey())),

  /** Caller persists this key/payload before dispatch; no key is minted here. */
  createOpenTableWithRequest: async (payload:OnlineCreatePayload,requestId:string,expectedActorId:string) =>
    parseOnlineCreateReceipt(await invokeEdge<unknown>({...bodyCreateOpenTable(payload.name,payload.sb,payload.bb,payload.buyin,payload.maxSeats),requestId,expectedActorId}),requestId),

  /** Resolution never creates a table, including when the receipt is absent. */
  getCreateReceipt: async (payload:OnlineCreatePayload,requestId:string,expectedActorId:string) =>
    parseOnlineCreateResolution(await invokeEdge<unknown>({op:'get_create_receipt',requestId,expectedActorId}),requestId,payload),

  /** Sit directly at an open seat with a self-chosen stack (no wallet). */
  sitOpen: (tableId: string, seat: number, buyin: ChipString) =>
    invokeEdge<RpcOutcome>(bodySitOpen(tableId, seat, buyin, newIdemKey())),

  /** Hand the host role to another seated player (host only). */
  transferHost: (tableId: string, toUserId: string) =>
    invokeEdge<RpcOutcome>(bodyTransferHost(tableId, toUserId)),

  /** Leave an open table (wallet-free; auto-reassigns host if you were host). */
  leaveOpenTable: (tableId: string) => invokeEdge<RpcOutcome>(bodyLeaveOpenTable(tableId)),

  /** Rebuy a fresh stack after busting (server-dictated amount = table starting stack;
   *  busted-only, blocked mid-hand). The client never picks an arbitrary amount. */
  rebuyOpen: (tableId: string, amount: ChipString) =>
    invokeEdge<RpcOutcome>(bodyRebuyOpen(tableId, amount, newIdemKey())),

  /** Submit an action intent; the server re-validates with the engine. */
  submitAction: (req: Omit<ActionRequest, 'idempotencyKey'> & { idempotencyKey?: string }) =>
    invokeEdge<SubmitActionResult>(
      bodySubmitAction({ ...req, idempotencyKey: req.idempotencyKey ?? newIdemKey() }),
    ),
};

export type OnlinePokerClient = typeof onlinePokerClient;

// ── public reads (direct rails; gated) ───────────────────────────────────────
// online_poker_* tables are not in the generated Database type yet (regen owed), so
// reads cross an explicit untyped boundary. These run ONLY on the live path.

/** Untyped supabase accessor for the not-yet-generated online_poker_* rails. */
function rails() {
  return supabase as unknown as {
    from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

/** Live lobby: open/paused tables with real seat counts. Gated by RUNTIME_LIVE. */
export async function listTablesLive(signal?:AbortSignal): Promise<LobbyTableSummary[]> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  let tablesRead=rails()
      .from('online_poker_tables')
      .select('id, name, sb, bb, max_seats, status')
      .neq('status', 'closed')
      .order('name', { ascending: true });
  let seatsRead=rails()
      .from('online_poker_seats')
      .select('table_id')
      .eq('status', 'sitting');
  if(signal){tablesRead=tablesRead.abortSignal(signal);seatsRead=seatsRead.abortSignal(signal);}
  const [tablesRes, seatsRes] = await Promise.all([tablesRead,seatsRead]);
  if (tablesRes.error) throw new OnlinePokerError('tables_load_failed', tablesRes.error.message);
  if (seatsRes.error) throw new OnlinePokerError('seats_load_failed', seatsRes.error.message);
  const counts: Record<string, number> = {};
  for (const s of (seatsRes.data ?? []) as Array<{ table_id: string }>) {
    counts[String(s.table_id)] = (counts[String(s.table_id)] ?? 0) + 1;
  }
  return (tablesRes.data ?? []).map(
    (t: Record<string, unknown>): LobbyTableSummary => ({
      id: String(t.id),
      name: String(t.name ?? ''),
      sb: String(t.sb),
      bb: String(t.bb),
      maxSeats: Number(t.max_seats),
      seatedCount: counts[String(t.id)] ?? 0,
      status: t.status as LobbyTableSummary['status'],
    }),
  );
}

export interface LiveTableMeta {
  id: string;
  name: string;
  sb: string;
  bb: string;
  maxSeats: number;
  status: string;
  /** chip strings — buy-in bounds + default sit amount */
  minBuyin: string;
  maxBuyin: string;
  startingStack: string;
  /** current host (transferable; null if table has no seated players) */
  hostUserId: string | null;
}

/** Single table row by id — for the table page header when RUNTIME_LIVE. */
export async function loadTableMetaLive(tableId: string,signal?:AbortSignal): Promise<LiveTableMeta | null> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  let read = rails()
    .from('online_poker_tables')
    .select('id, name, sb, bb, max_seats, status, min_buyin, max_buyin, starting_stack_default, host_user_id')
    .eq('id', tableId);
  if(signal)read=read.abortSignal(signal);
  const { data, error } = await read.maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    name: String(data.name ?? ''),
    sb: String(data.sb),
    bb: String(data.bb),
    maxSeats: Number(data.max_seats),
    status: String(data.status),
    minBuyin: String(data.min_buyin ?? '0'),
    maxBuyin: String(data.max_buyin ?? '0'),
    startingStack: String(data.starting_stack_default ?? data.min_buyin ?? '0'),
    hostUserId: data.host_user_id ? String(data.host_user_id) : null,
  };
}

/** Current host of a table (reactive — re-read on realtime ticks). Gated. */
export async function loadTableHostLive(tableId: string): Promise<string | null> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data } = await rails()
    .from('online_poker_tables')
    .select('host_user_id')
    .eq('id', tableId)
    .maybeSingle();
  return data?.host_user_id ? String(data.host_user_id) : null;
}

/** The caller's play-chip wallet balance (RLS: own row only). Gated by RUNTIME_LIVE. */
export async function loadWalletLive(): Promise<WalletView> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return { balance: '0' };
  const { data } = await rails()
    .from('online_poker_player_accounts')
    .select('balance')
    .eq('user_id', uid)
    .maybeSingle();
  return { balance: data ? String(data.balance) : '0' };
}

/** A seated player at a table (exists with or WITHOUT an active hand). */
export interface LiveSeat {
  seatNo: number;
  userId: string;
  displayName?: string;
  /** chip string */
  stack: string;
  /** sitting | sitting_out | active | folded | allin */
  status: string;
}

/**
 * Live table seats from online_poker_seats (NOT the hand state) so a player can see
 * who is seated and pick an empty seat even when no hand is in progress. Gated.
 */
export async function loadSeatsLive(tableId: string): Promise<LiveSeat[]> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data, error } = await rails()
    .from('online_poker_seats')
    .select('seat_no, user_id, stack, status')
    .eq('table_id', tableId)
    .in('status', ['sitting', 'sitting_out', 'active', 'folded', 'allin']);
  if (error || !data) return [];
  const rows = data as Array<{ seat_no: number; user_id: string | null; stack: number | string; status: string }>;
  const occupied = rows.filter((r) => r.user_id);

  // Best-effort display names; falls back to the seat number when unavailable.
  const ids = [...new Set(occupied.map((r) => r.user_id as string))];
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data: profs } = await rails().from('profiles').select('id, display_name').in('id', ids);
    for (const p of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
      if (p.display_name) names[p.id] = p.display_name;
    }
  }
  return occupied.map((r) => ({
    seatNo: Number(r.seat_no),
    userId: r.user_id as string,
    displayName: names[r.user_id as string],
    stack: String(r.stack),
    status: r.status,
  }));
}

/** One player's aggregated buy-in history at a table (from the append-only ledger). */
export interface BuyinSummary {
  userId: string;
  displayName?: string;
  /** total chips bought in over the table's lifetime (sum of every sit + rebuy), chip string */
  total: string;
  /** number of buy-in events (sits + rebuys) */
  count: number;
  /** latest event time (ISO) — newest-activity ordering */
  lastAt: string;
}

/**
 * Per-player buy-in totals from the append-only `online_poker_buyins` ledger. Wallet-free
 * friends-practice: an informal record of how many chips each player has bought in (sit +
 * rebuy) over the table's whole lifetime — it SURVIVES a leave→re-sit (a new sit just adds
 * on). Grouped by user (duplicate display names are fine). An unavailable ledger is
 * not an empty ledger. Gated.
 */
export async function loadBuyinsLive(tableId: string): Promise<BuyinSummary[]> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  // online_poker_buyins is not in generated types until applied.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (rails() as any)
    .from('online_poker_buyins')
    .select('user_id, amount, created_at')
    .eq('table_id', tableId)
    .order('created_at', { ascending: true });
  if (error || !data) throw new OnlinePokerError('buyins_load_failed', error?.message);
  const rows = data as Array<{ user_id: string; amount: number | string; created_at: string }>;
  if (!rows.length) return [];

  const agg = new Map<string, { total: bigint; count: number; lastAt: string }>();
  for (const r of rows) {
    if (!r.user_id) continue;
    const cur = agg.get(r.user_id) ?? { total: 0n, count: 0, lastAt: r.created_at };
    cur.total += BigInt(String(r.amount));
    cur.count += 1;
    if (r.created_at > cur.lastAt) cur.lastAt = r.created_at;
    agg.set(r.user_id, cur);
  }

  const ids = [...agg.keys()];
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data: profs } = await rails().from('profiles').select('id, display_name').in('id', ids);
    for (const p of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
      if (p.display_name) names[p.id] = p.display_name;
    }
  }

  return ids
    .map((id) => {
      const a = agg.get(id)!;
      return { userId: id, displayName: names[id], total: a.total.toString(), count: a.count, lastAt: a.lastAt };
    })
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

/** Server-authoritative legal-action menu for the caller's seat, or null if not in the hand. */
export async function loadLegalActionsLive(handId: string): Promise<WireLegalActions | null> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  try {
    const res = await onlinePokerClient.legalActions(handId);
    return res?.legal ?? null;
  } catch {
    return null;
  }
}

/**
 * Live public hand state for a table's most recent hand (no secrets). Gated.
 *
 * Includes 'complete' so the client can SHOW the showdown result (board runout +
 * revealed hands + winner/pot) during the inter-hand cooldown — without it, a just-
 * settled all-in is filtered out and the table jumps silently to the next hand. The
 * completed hand stays the latest for the full cooldown (op_run_due_table_ticks =
 * 4s) and the client polls every ~2.5s, so it is always observed at least once; the
 * ~8s result dwell then holds it across the next deal. 'voided' stays excluded.
 */
export async function loadHandStateLive(
  tableId: string,
  signal?: AbortSignal,
): Promise<{ wire: WirePublicHandState; stateVersion: number } | null> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  // state_version = the CAS counter op_submit_action bumps on EVERY action; carried out so
  // the hook's high-water snapshot guard can drop stale poll responses (fast-path ordering).
  // Whole-row RLS (op_hands_select USING(true)) — spectators read it identically.
  let read = rails()
    .from('online_poker_hands')
    .select('state, state_version')
    .eq('table_id', tableId)
    .in('status', ['dealing', 'betting', 'complete'])
    .order('hand_no', { ascending: false })
    .limit(1);
  if(signal)read=read.abortSignal(signal);
  const { data, error } = await read.maybeSingle();
  if (error) throw new OnlinePokerError('hand_load_failed', error.message);
  if (!data?.state) return null;
  return { wire: data.state as WirePublicHandState, stateVersion: Number(data.state_version ?? 0) };
}

// ── wire -> component view-model mapping (pure) ───────────────────────────────

/**
 * Project a public (or private) wire hand state down to the component view-model
 * (PublicHandView). Secrecy is preserved by construction: the public wire carries
 * no hole cards, so a seat's `myHoleCards` only appears when `priv` is supplied for
 * the caller's own seat. `displayName` is resolved elsewhere (profile lookup).
 */
export function wirePublicToView(
  wire: WirePublicHandState,
  priv?: { mySeat: number; myHoleCards: string[] },
): PublicHandView {
  const seats: PublicSeatView[] = wire.seats.map((s) => ({
    seat: s.seat,
    playerId: s.playerId,
    stack: s.stack,
    committed: s.committed,
    status: s.status,
    revealedCards: s.revealedCards,
    isButton: s.seat === wire.buttonSeat,
    isToAct: s.seat === wire.toAct,
  }));
  return {
    handId: wire.config.handId,
    tableId: wire.config.tableId,
    handNo: wire.config.handNo,
    street: wire.street,
    board: [...wire.board],
    pot: wire.pot,
    toActSeat: wire.toAct,
    buttonSeat: wire.buttonSeat,
    status: wire.status,
    seats,
    // Carry the server's settlement summary so the client can announce the
    // winner / pot at showdown. The wire shape is structurally identical to
    // PublicHandResult; the client never recomputes it.
    ...(wire.result ? { result: wire.result } : {}),
    ...(priv ? { mySeat: priv.mySeat, myHoleCards: [...priv.myHoleCards] } : {}),
  };
}

/** A private wire view (own cards attached) -> component view-model. */
export function wirePrivateToView(wire: WirePrivateHandState): PublicHandView {
  return wirePublicToView(wire, { mySeat: wire.mySeat, myHoleCards: wire.myHoleCards });
}
