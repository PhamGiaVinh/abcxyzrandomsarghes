// src/lib/onlinePoker/useOnlinePoker.ts
// Online-poker data hooks (friends-practice model). They expose ONE shape to the UI
// and switch their source on RUNTIME_LIVE:
//   * dark (RUNTIME_LIVE === false) -> deterministic mock; no network, ever.
//   * live (RUNTIME_LIVE === true)  -> direct rail reads + realtime + edge actions.
// No wallet: players self-set their chips. The first sitter is the host; the host is
// transferable and auto-reassigns when it leaves (server-side, via op_* RPCs).

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RUNTIME_LIVE } from './types';
import type { ActionType, LobbyTableSummary, PublicHandView } from './types';
import { MOCK_TABLES, mockHand } from './mockData';
import {
  listTablesLive,
  loadHandStateLive,
  loadTableMetaLive,
  loadTableHostLive,
  loadSeatsLive,
  loadLegalActionsLive,
  onlinePokerClient,
  wirePublicToView,
  type LiveTableMeta,
  type LiveSeat,
} from './client';
import { isHoleCardsOk, type RpcOutcome, type WireLegalActions, type WirePrivateHandState } from './wire';
import { derivePokerSounds } from './pokerSounds';
import { deriveMySeatNo, shouldDealSignal, filterLobbyTables, isNewerHandSnap, legalFetchKey, type HandSnapId } from './tableState';
import { playPokerLiveSound } from '@/lib/pokerLiveSound';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';

// ── action fast-path keep-warm (Mức C) ──────────────────────────────────────
// A local constant, NOT a feature flag (scope kept small — flip here to disable). The ping
// keeps the online-poker-action isolate + GoTrue warm while a live table page is open, so
// the FIRST action after idle doesn't pay a cold start. Errors are ALWAYS swallowed: until
// the ping op is deployed the edge zod-rejects it (400), which still warms the isolate.
const ENABLE_PING_WARMUP = true;
const PING_INTERVAL_MS = 100_000;

// ── lobby ──────────────────────────────────────────────────────────────────

export interface LobbyState {
  tables: LobbyTableSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useLobby(): LobbyState {
  const [tables, setTables] = useState<LobbyTableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRead=useRef<()=>void>(()=>{});

  useEffect(() => {
    let cancelled = false,inflight=false,queued=false;
    let controller:AbortController|null=null;
    if (!RUNTIME_LIVE) {
      setTables(MOCK_TABLES);
      setLoading(false);
      setError(null);
      return;
    }
    const load=async()=>{
      if(cancelled)return;
      if(inflight){queued=true;return;}
      inflight=true;setLoading(true);controller=new AbortController();
      try {
        const t=await observeTrackerContextRead(listTablesLive(controller.signal));
      // Hide EMPTY tables from the lobby: an open table with 0 seated players is either a
      // stale leftover (created before the auto-close trigger) or one whose last player
      // just left — never something to join. A freshly created table keeps its host
      // seated (seatedCount >= 1), so this never hides a real table. (No DB write.)
        if(!cancelled){setTables(filterLobbyTables(t));setError(null);}
      }catch(e){
        if(!cancelled)setError(e instanceof Error?(e.message==='tracker_context_read_timeout'?'lobby_read_timeout':e.message):'load_failed');
      }finally{
        controller.abort();inflight=false;
        if(!cancelled){setLoading(false);if(queued){queued=false;void load();}}
      }
    };
    requestRead.current=()=>{void load();};
    void load();
    return () => { cancelled = true;controller?.abort();requestRead.current=()=>{}; };
  }, []);

  // Live: a new/closed table or seat change refreshes the lobby grid.
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    const channel = supabase
      .channel('op-lobby')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'online_poker_tables' }, () => requestRead.current())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'online_poker_seats' }, () => requestRead.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const refresh = useCallback(() => requestRead.current(), []);

  return { tables, loading, error, refresh };
}

// ── single table / hand ──────────────────────────────────────────────────────

export interface TableHandActions {
  /** Sit directly at an empty seat with a self-chosen stack (no wallet). */
  sitOpen: (seat: number, buyin: string) => Promise<RpcOutcome>;
  /** Leave the table (wallet-free; auto-reassigns host if you were host). */
  leaveTable: () => Promise<RpcOutcome>;
  /** Hand the host role to another seated player (host only). */
  transferHost: (toUserId: string) => Promise<RpcOutcome>;
  submitAction: (a: { handId: string; seat: number; type: ActionType; amount?: string }) => Promise<unknown>;
  /** Rebuy a fresh stack after busting (server-dictated amount; busted-only). */
  rebuy: (amount: string) => Promise<RpcOutcome>;
}

export interface TableHandState {
  hand: PublicHandView | null;
  /** Live table seats (occupied), independent of any active hand. */
  seats: LiveSeat[];
  /** The caller's seat number at this table, or null if not seated. */
  mySeatNo: number | null;
  /** The caller's auth user id (live only). */
  myUserId: string | null;
  /** Current host user id (reactive). */
  hostUserId: string | null;
  /** True when the caller is the current host. */
  amIHost: boolean;
  /** Server legal-action menu when it is the caller's turn; else null. */
  legal: WireLegalActions | null;
  loading: boolean;
  error: string | null;
  /** Bumps once when a fresh hand is dealt (drives the deal animation, decoupled from the
   *  result dwell). 0 = no deal observed yet. */
  dealSignal: number;
  /** Seats that received cards on the last dealt hand (the animation flies only to these). */
  dealSeats: number[];
  refresh: () => void;
  /** Fast-path: ingest the SERVER-returned post-action state (SubmitActionOk.view) so the
   *  actor sees their own move in one round trip. NOT optimistic — the view is the engine's
   *  own output; the same high-water (handNo, stateVersion) guard orders it against polls. */
  applyServerView: (view: WirePrivateHandState, stateVersion: number) => void;
  actions: TableHandActions;
}

export function useTableHand(tableId: string): TableHandState {
  const tableScope=useRef({id:tableId});
  if(tableScope.current.id!==tableId)tableScope.current={id:tableId};
  const [hand, setHand] = useState<PublicHandView | null>(null);
  const [handOrigin,setHandOrigin]=useState<object|null>(null);
  const scopedHand=handOrigin===tableScope.current?hand:null;
  const [seats, setSeats] = useState<LiveSeat[]>([]);
  const [seatsOrigin,setSeatsOrigin]=useState<object|null>(null);
  const scopedSeats=seatsOrigin===tableScope.current?seats:[];
  const [uid, setUid] = useState<string | null>(null);
  const uidRef=useRef<string|null>(null);
  const identityScope=useRef<object>({});
  const handMounted=useRef(false);
  const handRead=useRef<{table:object;identity:object;controller:AbortController}|null>(null);
  useEffect(()=>{handMounted.current=true;return()=>{handMounted.current=false;handRead.current?.controller.abort();handRead.current=null;};},[]);
  const [hostUserId, setHostUserId] = useState<string | null>(null);
  const [hostOrigin,setHostOrigin]=useState<object|null>(null);
  const scopedHost=hostOrigin===tableScope.current?hostUserId:null;
  const [legal, setLegal] = useState<WireLegalActions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Deal-animation trigger, driven off the LIVE hand (not the dwell-held felt). Increments
  // exactly once when a fresh hand is first observed; dealSeats = the seats that got cards.
  const [dealSignal, setDealSignal] = useState(0);
  const [dealSeats, setDealSeats] = useState<number[]>([]);
  const prevDealHandIdRef = useRef<string | null>(null);
  // Cache of the caller's hole cards, keyed by handId, so the poll loop doesn't re-hit
  // the edge for cards that never change within a hand. The PUBLIC poll (which carries no
  // holes) never clears it — only a valid private view (hole fetch / applyServerView) writes
  // it, and it resets on a genuinely new hand's fetch-miss or a table change.
  const holesRef = useRef<{ handId: string; priv: { mySeat: number; myHoleCards: string[] } } | null>(null);
  // Previous hand view, kept ONLY to derive opponent-action sound cues (PR C). Starts
  // null so the first snapshot / mid-hand reconnect never plays a burst of history.
  const prevSoundHandRef = useRef<PublicHandView | null>(null);
  // HIGH-WATER mark of the newest (handNo, stateVersion) EVER INGESTED — the fast-path
  // ordering guard. Deliberately NOT "the currently visible hand": a poll returning no hand
  // clears the view but must NOT lower this mark, or a late response from an older hand
  // would resurrect it. Reset ONLY when the tableId truly changes.
  const snapRef = useRef<HandSnapId | null>(null);
  // Legal-menu fetch bookkeeping (one fetch per turn-state, stale responses dropped by key).
  const legalKeyRef = useRef<string | null>(null);
  const lastLegalOkRef = useRef<string | null>(null);
  const legalInflightRef = useRef<string | null>(null);

  // Table switch = a genuinely new world: drop every cross-hand ref (high-water included).
  useEffect(() => {
    return () => {
      snapRef.current = null;
      holesRef.current = null;
      prevSoundHandRef.current = null;
      prevDealHandIdRef.current = null;
      lastLegalOkRef.current = null;
      legalInflightRef.current = null;
    };
  }, [tableId]);

  /**
   * The ONE ingest point for hand snapshots (poll AND submit fast-path). SYNCHRONOUS by
   * contract — guard, side-effect derivations and state commits run in a single block with
   * no `await` in between, so a stale response cannot interleave between the guard check
   * and the commit (the `cancelled` flag alone cannot prevent that microtask gap).
   * Returns true iff the snapshot was accepted.
   */
  const ingestView = useCallback((view: PublicHandView, snap: HandSnapId): boolean => {
    if(view.tableId!==tableScope.current.id)return false;
    if (!isNewerHandSnap(snapRef.current, snap)) return false;
    snapRef.current = { handNo: snap.handNo, stateVersion: snap.stateVersion };
    // Opponent-action sound cues, derived purely from prev->next (skips my own seat, which
    // sounds on submit; [] on the first snapshot). Never allowed to break the table.
    try { derivePokerSounds(prevSoundHandRef.current, view, view.mySeat ?? null).forEach((sound) => playPokerLiveSound(sound)); } catch { /* audio must never break the felt */ }
    prevSoundHandRef.current = view;
    // Deal-animation trigger: a KNOWN previous handId transitioning to a NEW empty-board
    // hand with ≥2 players. Advances the ref exactly once per accepted snapshot.
    const dealCheck = shouldDealSignal(prevDealHandIdRef.current, view);
    if (dealCheck.fire) { setDealSeats(dealCheck.dealSeats); setDealSignal((n) => n + 1); }
    if (view.handId) prevDealHandIdRef.current = view.handId;
    setHand(view);
    setHandOrigin(tableScope.current);
    return true;
  }, []);

  // A private overlay belongs to an auth generation, not merely to a hand UUID.
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    let cancelled = false,authEvents=0;
    const applyIdentity=(next:string|null,force=false)=>{
      if(cancelled||(!force&&uidRef.current===next))return;
      identityScope.current={};uidRef.current=next;setUid(next);
      holesRef.current=null;snapRef.current=null;prevSoundHandRef.current=null;prevDealHandIdRef.current=null;
      legalKeyRef.current=null;lastLegalOkRef.current=null;legalInflightRef.current=null;
      setHand(null);setLegal(null);setDealSeats([]);setTick(n=>n+1);
    };
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      authEvents++;applyIdentity(session?.user?.id??null,event==='SIGNED_OUT');
    });
    void supabase.auth.getUser().then(({ data,error })=>{
      if(!authEvents)applyIdentity(error?null:data?.user?.id??null,!!error);
    }).catch(()=>{if(!authEvents)applyIdentity(null,true);});
    return () => { cancelled = true;identityScope.current={};subscription.unsubscribe(); };
  }, []);

  // Load hand (mock while dark; public rail read + private overlay while live).
  useEffect(() => {
    const issuedIdentity=identityScope.current;
    if (!RUNTIME_LIVE) {
      setHand(mockHand(tableId));
      setHandOrigin(tableScope.current);
      setLoading(false);
      setError(null);
      return;
    }
    const issuedTable=tableScope.current;
    if(handRead.current?.table===issuedTable&&handRead.current.identity===issuedIdentity)return;
    handRead.current?.controller.abort();
    const run={table:issuedTable,identity:issuedIdentity,controller:new AbortController()};handRead.current=run;
    const current=()=>handMounted.current&&handRead.current===run&&tableScope.current===issuedTable&&identityScope.current===issuedIdentity;
    setLoading(true);
    void observeTrackerContextRead((async () => {
      const res = await loadHandStateLive(tableId,run.controller.signal);
      if(!current())return;
      if (!res) {
        // No live hand: clear the VIEW + menu, but KEEP the high-water snapRef — lowering
        // it here would let a late in-flight response of an OLDER hand resurrect that hand.
        setHand(null);setHandOrigin(issuedTable);setLegal(null);setError(null);
        return;
      }
      const { wire, stateVersion } = res;
      // Hole cards are fixed for the life of a hand — fetch once per handId and reuse it
      // across polls. The public poll NEVER clears the cache (it carries no holes).
      let priv: { mySeat: number; myHoleCards: string[] } | undefined;
      if (uidRef.current&&holesRef.current && holesRef.current.handId === wire.config.handId) {
        priv = holesRef.current.priv;
      } else if(uidRef.current) {
        try {
          const hc = (await onlinePokerClient.getMyHoleCards(wire.config.handId)) as RpcOutcome;
          if(!current())return;
          if (isHoleCardsOk(hc)) {
            priv = { mySeat: hc.seat, myHoleCards: hc.cards };
            holesRef.current = { handId: wire.config.handId, priv };
          }
        } catch { /* not seated / disabled — render public-only, no overlay */ }
      }
      const view = wirePublicToView(wire, priv);
      if (!current()) return;
      // Sounds + deal signal + setHand live inside the shared SYNCHRONOUS ingest, ordered by
      // the high-water (handNo, stateVersion) guard — a stale poll response is dropped here
      // even when a current-scope fetch raced the submit fast-path.
      ingestView(view, { handNo: wire.config.handNo, stateVersion });
      setError(null);
    })())
      .catch((e) => { if (current()) {setHandOrigin(issuedTable);setHand(null);setError(e instanceof Error ? e.message : 'load_failed');} })
      .finally(() => { if(current())setLoading(false);if(handRead.current===run)handRead.current=null;run.controller.abort(); });
  }, [tableId, tick, ingestView]);

  // Legal-action menu — its OWN effect, ONE edge fetch per (handId, stateVersion) while it
  // is genuinely my turn (the old inline fetch re-hit the edge EVERY 1s tick on-turn, which
  // both hammered the function and queued behind submits). Contract:
  //   • success for key K → no refetch until the key changes (every action bumps
  //     state_version server-side, so a re-opened turn always makes a new key);
  //   • failure → NOT cached; the previous menu stays visible and the next tick retries;
  //   • off-turn / no hand → menu cleared immediately (key null);
  //   • a response that lands after the key moved on is DROPPED (stale menu never applies).
  const legalKey = legalFetchKey(
    scopedHand ? { handId: scopedHand.handId, status: scopedHand.status, toActSeat: scopedHand.toActSeat ?? null } : null,
    scopedHand?.mySeat ?? null,
    snapRef.current?.stateVersion ?? null,
  );
  legalKeyRef.current = legalKey;
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    if (legalKey == null) { setLegal(null); return; }
    if (lastLegalOkRef.current === legalKey || legalInflightRef.current === legalKey) return;
    const issuedFor = legalKey;
    const handId = scopedHand?.handId;
    if (!handId) return;
    legalInflightRef.current = issuedFor;
    const issuedIdentity=identityScope.current;
    const issuedTable=tableScope.current;
    loadLegalActionsLive(handId).then((lm) => {
      if(identityScope.current!==issuedIdentity||tableScope.current!==issuedTable)return;
      if (legalInflightRef.current === issuedFor) legalInflightRef.current = null;
      if (legalKeyRef.current !== issuedFor) return; // state moved on — stale menu, drop
      if (lm) { setLegal(lm); lastLegalOkRef.current = issuedFor; }
      // lm null = transient failure (loadLegalActionsLive swallows) → keep the shown menu,
      // retry on the next tick (key stays uncached).
    });
    // `tick` is a deliberate dep: it is the retry heartbeat for transient failures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legalKey, tick]);

  // Fast-path ingest of the server's own post-action state (SubmitActionOk.view). The actor
  // sees their move in ONE round trip; the same guard orders it against in-flight polls.
  const renderIdentity=identityScope.current;
  const renderTable=tableScope.current;
  const applyServerView = useCallback((view: WirePrivateHandState, stateVersion: number) => {
    if(identityScope.current!==renderIdentity||tableScope.current!==renderTable)return;
    const priv = { mySeat: view.mySeat, myHoleCards: view.myHoleCards };
    const pv = wirePublicToView(view, priv);
    const applied = ingestView(pv, { handNo: view.config.handNo, stateVersion });
    // Refresh the hole cache only when the snapshot was actually accepted — an out-of-order
    // response must never clobber a newer hand's cached holes.
    if (applied && view.config.handId) holesRef.current = { handId: view.config.handId, priv };
  }, [ingestView,renderIdentity,renderTable]);

  // Keep-warm ping — only while a live table page is mounted, skipped while hidden, ALL
  // errors swallowed (pre-deploy the edge zod-rejects the op; that reject still warms it).
  useEffect(() => {
    if (!RUNTIME_LIVE || !ENABLE_PING_WARMUP) return;
    const ping = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      onlinePokerClient.ping().catch(() => { /* silent by contract — no toast, no console */ });
    };
    ping();
    const id = setInterval(ping, PING_INTERVAL_MS);
    const onVisible = () => { if (!document.hidden) ping(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [tableId]);

  // Load table seats + current host (live). Seats exist even with no active hand.
  useEffect(() => {
    if (!RUNTIME_LIVE) { setSeats([]); setHostUserId(null); return; }
    let cancelled = false;
    const issuedTable=tableScope.current;
    loadSeatsLive(tableId).then((s) => { if (!cancelled) {setSeats(s);setSeatsOrigin(issuedTable);} }).catch(() => {});
    loadTableHostLive(tableId).then((h) => { if (!cancelled) {setHostUserId(h);setHostOrigin(issuedTable);} }).catch(() => {});
    return () => { cancelled = true; };
  }, [tableId, tick]);

  // Live realtime: re-pull on any change to this table's hands, seats OR table row
  // (the table row carries host_user_id changes). Dark: no-op.
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    const channel = supabase
      .channel(`op-table-${tableId}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'online_poker_hands', filter: `table_id=eq.${tableId}` }, () => setTick((n) => n + 1))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'online_poker_seats', filter: `table_id=eq.${tableId}` }, () => setTick((n) => n + 1))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'online_poker_tables', filter: `id=eq.${tableId}` }, () => setTick((n) => n + 1))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tableId]);

  // Polling fallback (live only): realtime postgres_changes can drop or lag, which would
  // freeze the opponent on stale state even though the engine already advanced the hand.
  // A steady poll guarantees both clients converge to server truth. Paused while the tab
  // is hidden; an immediate refresh fires when it returns.
  //
  // ADAPTIVE cadence so play feels ~1s without hammering an idle table: while a hand is in
  // progress (the latency-sensitive moment — opponents acting, my menu, the showdown) poll
  // every ~1s; with NO hand (idle table waiting for players) back off to ~3s. The value only
  // flips when a hand appears/disappears, so the interval is not re-created every tick.
  const pollMs = scopedHand ? 1000 : 3000;
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setTick((n) => n + 1);
    }, pollMs);
    const onVisible = () => { if (!document.hidden) setTick((n) => n + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [pollMs]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // My seat — AUTHORITATIVE from the live seats table (includes in-hand statuses via
  // loadSeatsLive). Deliberately NOT `hand?.mySeat`: a stale completed-hand snapshot keeps
  // mySeat set even after I've left, which used to make the client think I was still
  // seated and block re-joining (P0). Once I leave, my seat row is vacated → mySeatNo null.
  const mySeatNo = deriveMySeatNo(scopedSeats, uid);
  const amIHost = !!uid && scopedHost === uid;

  // Liveness heartbeat (live + seated): ping the server every ~10s so the stale-seat
  // reaper can free this seat if the tab dies. Fires immediately on sitting and on
  // return-from-background to keep last_seen_at fresh. Wrapped so it cleanly NO-OPS until
  // op_heartbeat exists live (migration 20260923000000 is source-only) — degrades like
  // any other gated feature; never throws into the UI.
  useEffect(() => {
    if (!RUNTIME_LIVE || mySeatNo == null) return;
    const ping = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      // op_heartbeat isn't in the generated DB types yet (source-only) — cast + swallow.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (supabase.rpc as any)('op_heartbeat', { p_table_id: tableId }).then(() => {}, () => {});
    };
    ping(); // immediate, so a freshly-claimed seat is marked live at once
    const id = setInterval(ping, 10000);
    const onVisible = () => { if (!document.hidden) ping(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [tableId, mySeatNo]);

  const actions: TableHandActions = {
    sitOpen: (seat, buyin) => onlinePokerClient.sitOpen(tableId, seat, buyin),
    leaveTable: () => onlinePokerClient.leaveOpenTable(tableId),
    transferHost: (toUserId) => onlinePokerClient.transferHost(tableId, toUserId),
    submitAction: (a) => onlinePokerClient.submitAction(a),
    rebuy: (amount) => onlinePokerClient.rebuyOpen(tableId, amount),
  };

  return { hand:scopedHand, seats:scopedSeats, mySeatNo, myUserId: uid, hostUserId:scopedHost, amIHost,
    legal:handOrigin===tableScope.current?legal:null, loading, error:handOrigin===tableScope.current?error:null,
    dealSignal, dealSeats:handOrigin===tableScope.current?dealSeats:[], refresh, applyServerView, actions };
}

// ── table metadata ─────────────────────────────────────────────────────────

/** Table header data (name, sb, bb, buyin bounds). Dark = mock lookup; live = DB fetch. */
export function useTableMeta(tableId: string): LiveTableMeta | null {
  const mockRow = MOCK_TABLES.find((t) => t.id === tableId);
  const mockMeta: LiveTableMeta | null = mockRow
    ? {
        id: mockRow.id, name: mockRow.name, sb: mockRow.sb, bb: mockRow.bb,
        maxSeats: mockRow.maxSeats, status: mockRow.status,
        minBuyin: String(Number(mockRow.bb) * 20), maxBuyin: String(Number(mockRow.bb) * 200),
        startingStack: String(Number(mockRow.bb) * 40), hostUserId: null,
      }
    : null;

  const scope=useRef({id:tableId});if(scope.current.id!==tableId)scope.current={id:tableId};
  const [snapshot,setSnapshot]=useState<{scope:object;meta:LiveTableMeta|null}|null>(null);

  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    let cancelled = false;const issued=scope.current,controller=new AbortController();
    void observeTrackerContextRead(loadTableMetaLive(tableId,controller.signal))
      .then((m) => { if (!cancelled&&scope.current===issued) setSnapshot({scope:issued,meta:m?.id===tableId?m:null}); })
      .catch(() => { if (!cancelled&&scope.current===issued) setSnapshot({scope:issued,meta:null}); })
      .finally(()=>controller.abort());
    return () => { cancelled = true;controller.abort(); };
  }, [tableId]);

  return RUNTIME_LIVE?(snapshot?.scope===scope.current?snapshot.meta:null):mockMeta;
}
