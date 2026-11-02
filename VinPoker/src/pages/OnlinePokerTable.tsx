// src/pages/OnlinePokerTable.tsx
// Friends-practice TABLE: open seating (no approval, no wallet), with a transferable
// host. Click an empty seat → choose your chips → sit. The first sitter is the host;
// the host can hand the role to another seated player, and it auto-reassigns when the
// host leaves. Server-authoritative: the engine decides cards, legality, winner, chips.

import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/hooks/useAuth';
import { FEATURES } from '@/lib/featureFlags';
import { RUNTIME_LIVE, type ActionType, type PublicHandResult, type PublicHandView, type PublicSeatView } from '@/lib/onlinePoker/types';
import type { RpcOutcome, SubmitActionResult } from '@/lib/onlinePoker/wire';
import { useTableHand, useTableMeta } from '@/lib/onlinePoker/useOnlinePoker';
import type { LiveSeat, LiveTableMeta } from '@/lib/onlinePoker/client';
import { loadBuyinsLive, type BuyinSummary } from '@/lib/onlinePoker/client';
import { PokerComingSoon } from '@/components/poker/PokerComingSoon';
import { SeatRing } from '@/components/poker/SeatRing';
import { HeroHud } from '@/components/poker/HeroHud';
import { HandStateViewer } from '@/components/poker/HandStateViewer';
import { ActionBar } from '@/components/poker/ActionBar';
import { ShowdownResult } from '@/components/poker/ShowdownResult';
import { AllInRunout } from '@/components/poker/AllInRunout';
import { isAllInShowdown, ALLIN_CINEMATIC_TOTAL_MS } from '@/lib/onlinePoker/allinCinematic';
import { occupiedCount, isTableLive, emptyStateLabel } from '@/lib/onlinePoker/tableDisplay';
import { SitDownDialog } from '@/components/poker/SitDownDialog';
import { BustoutDialog } from '@/components/poker/BustoutDialog';
import { actionToSound } from '@/lib/onlinePoker/pokerSounds';
import { playPokerLiveSound, markPokerSoundGesture, isPokerSoundMuted, setPokerSoundMuted } from '@/lib/pokerLiveSound';
import { readImmersivePref, writeImmersivePref, requestFullscreenBestEffort, exitFullscreenBestEffort } from '@/lib/onlinePoker/immersive';
import { iAmInLiveHand as computeIAmInLiveHand, classifySubmitResult } from '@/lib/onlinePoker/tableState';
import { readFeltSkin, writeFeltSkin, type FeltSkin } from '@/lib/onlinePoker/feltSkin';
import { ChevronLeft, Crown, LogIn, Volume2, VolumeX, Maximize2, Minimize2, Palette, Settings } from 'lucide-react';

const fmtChips = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};

/** Map RPC/edge outcome codes to a friendly Vietnamese message. */
const OUTCOME_VN: Record<string, string> = {
  bad_buyin: 'Số chip không hợp lệ.',
  bad_blinds: 'Blind không hợp lệ.',
  seat_taken: 'Ghế vừa có người ngồi, chọn ghế khác nhé.',
  already_seated: 'Bạn đã ngồi ở bàn này rồi.',
  bad_seat: 'Ghế không hợp lệ.',
  disabled: 'Poker đang tạm đóng.',
  unauthenticated: 'Bạn cần đăng nhập.',
  table_not_found: 'Không tìm thấy bàn.',
  table_not_open: 'Bàn đang đóng.',
  not_seated: 'Bạn chưa ngồi ở bàn này.',
  not_host: 'Chỉ chủ bàn mới làm được việc này.',
  target_not_seated: 'Người này chưa ngồi ở bàn.',
  in_active_hand: 'Đang trong ván — không thể rời lúc này.',
  not_your_turn: 'Chưa tới lượt bạn.',
  not_in_betting: 'Ván chưa tới vòng cược.',
  seat_cannot_act: 'Ghế này không thể hành động.',
  action_not_legal: 'Hành động không hợp lệ.',
  amount_required: 'Cần nhập số tiền cược.',
  illegal_amount: 'Số tiền cược không hợp lệ.',
  race_lost: 'Trạng thái vừa thay đổi, thử lại.',
  bad_amount: 'Số chip mua thêm không hợp lệ.',
  has_chips: 'Bạn vẫn còn chip, không cần mua thêm.',
};
const vn = (code?: string) => (code && OUTCOME_VN[code]) || 'Có lỗi xảy ra, thử lại.';

/** Merge the active hand (if any) with the live seats into a full maxSeats ring. */
function buildRingView(meta: LiveTableMeta, hand: PublicHandView | null, seats: LiveSeat[], mySeatNo: number | null): PublicHandView {
  const handByNo = new Map<number, PublicSeatView>();
  if (hand) for (const s of hand.seats) handByNo.set(s.seat, s);
  const liveByNo = new Map<number, LiveSeat>();
  for (const s of seats) liveByNo.set(s.seatNo, s);

  const ringSeats: PublicSeatView[] = [];
  for (let n = 1; n <= meta.maxSeats; n++) {
    const hs = handByNo.get(n);
    if (hs) {
      // Keep the HAND seat intact (revealedCards / status / settled stack must NOT be
      // lost at showdown); only borrow the live displayName so the felt + winner panel
      // can name the player.
      const ls = liveByNo.get(n);
      ringSeats.push(ls?.displayName && !hs.displayName ? { ...hs, displayName: ls.displayName } : hs);
      continue;
    }
    const ls = liveByNo.get(n);
    if (ls) {
      ringSeats.push({ seat: n, playerId: ls.userId, displayName: ls.displayName, stack: ls.stack, committed: '0', status: 'sitting_out' });
    } else {
      ringSeats.push({ seat: n, playerId: null, stack: '0', committed: '0', status: 'empty' });
    }
  }

  return {
    handId: hand?.handId ?? '',
    tableId: meta.id,
    handNo: hand?.handNo ?? 0,
    street: hand?.street ?? 'preflop',
    board: hand?.board ?? [],
    pot: hand?.pot ?? '0',
    toActSeat: hand?.toActSeat ?? null,
    buttonSeat: hand?.buttonSeat ?? 0,
    status: hand?.status ?? 'complete',
    seats: ringSeats,
    // Carry the server settlement so the felt can glow the winner + the result panel
    // can announce the pot. Preserved through the merge (never recomputed client-side).
    ...(hand?.result ? { result: hand.result } : {}),
    myHoleCards: hand?.myHoleCards,
    mySeat: hand?.mySeat ?? mySeatNo ?? undefined,
  };
}

/** A full snapshot of a just-completed hand, held on screen during the showdown dwell. */
type DwellSnap = {
  ringView: PublicHandView;
  winnerSeats: number[];
  result: PublicHandResult;
  handId: string;
  capturedAt: number;
  /** how long to hold the snapshot — longer for the all-in cinematic runout. */
  holdMs: number;
};
const RESULT_DWELL_MS = 8000;

export default function OnlinePokerTable() {
  const { tableId = '' } = useParams();
  const { user } = useAuth();
  const { hand, seats, mySeatNo, myUserId, hostUserId, amIHost, legal, loading, dealSignal, dealSeats, refresh, applyServerView, actions } = useTableHand(tableId);
  const table = useTableMeta(tableId);

  const [sitSeat, setSitSeat] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bustOpen, setBustOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const buyinScope = JSON.stringify([user?.id ?? null, tableId]);
  const [buyinRead, setBuyinRead] = useState<{ scope: string; status: 'loading' | 'ready' | 'error'; rows: BuyinSummary[] } | null>(null);
  const [buyinRetry, setBuyinRetry] = useState(0);
  const buyins = buyinRead?.scope === buyinScope ? buyinRead.rows : [];
  const buyinStatus = buyinRead?.scope === buyinScope ? buyinRead.status : 'loading';
  const bustHandledRef = useRef(false);
  const [muted, setMuted] = useState<boolean>(isPokerSoundMuted());

  // Scope the append-only ledger to the current actor/table. Failed reads are not empty.
  useEffect(() => {
    if (!settingsOpen || !RUNTIME_LIVE || !tableId || !user?.id) return;
    let alive = true;
    setBuyinRead({ scope: buyinScope, status: 'loading', rows: [] });
    loadBuyinsLive(tableId)
      .then((rows) => { if (alive) setBuyinRead({ scope: buyinScope, status: 'ready', rows }); })
      .catch(() => { if (alive) setBuyinRead({ scope: buyinScope, status: 'error', rows: [] }); });
    return () => { alive = false; };
  }, [settingsOpen, tableId, user?.id, buyinScope, buyinRetry]);
  const toggleMute = () => { const v = !muted; setPokerSoundMuted(v); setMuted(v); markPokerSoundGesture(); };

  // UI-4 — optional felt skin (emerald default / premium burgundy+gold), persisted locally.
  const [feltSkin, setFeltSkin] = useState<FeltSkin>(readFeltSkin);
  const toggleSkin = () => { const next: FeltSkin = feltSkin === 'premium' ? 'emerald' : 'premium'; setFeltSkin(next); writeFeltSkin(next); };

  // Mobile immersive table mode (CSS-default; native fullscreen requested on the gesture).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [immersive, setImmersive] = useState<boolean>(readImmersivePref);
  const enterImmersive = () => { setImmersive(true); writeImmersivePref(true); markPokerSoundGesture(); requestFullscreenBestEffort(rootRef.current); };
  const exitImmersive = () => { setImmersive(false); writeImmersivePref(false); exitFullscreenBestEffort(); };
  // Lock body scroll + allow Escape to leave; restore + exit native fullscreen on unmount.
  useEffect(() => {
    if (!immersive) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setImmersive(false); writeImmersivePref(false); exitFullscreenBestEffort(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prevOverflow; document.removeEventListener('keydown', onKey); };
  }, [immersive]);
  useEffect(() => () => { exitFullscreenBestEffort(); }, []); // safety on page unmount

  // Best-effort auto-leave when the player exits the table (SPA route unmount / tab close).
  // A ref carries the latest seated / in-hand state into the unmount cleanup. This is
  // ADVISORY only — an async leave fired during unload may not complete; the reliable
  // cleanup is the server-side stale-seat reaper (PR-B). Never leave mid-hand (the server
  // forbids it, and the timeout-sweep force-folds an absent actor on their turn).
  const leaveRef = useRef<{ seated: boolean; inActiveHand: boolean; leave: () => Promise<unknown> } | null>(null);
  // P1-1: a page UNLOAD (reload / tab close / bfcache) must KEEP the seat — the server
  // reaper reclaims a genuinely-abandoned seat after its grace window. `pagehide` flags the
  // unload so the unmount cleanup below does NOT auto-leave on a reload; only a real in-app
  // navigation away from the table (cleanup with no preceding unload) still leaves.
  const unloadingRef = useRef(false);
  useEffect(() => {
    const fireLeave = () => {
      const r = leaveRef.current;
      if (r && r.seated && !r.inActiveHand) void r.leave().catch(() => {});
    };
    // ANY pagehide = a page unload (reload / close / bfcache) → keep the seat (do NOT leave).
    const onPageHide = () => { unloadingRef.current = true; };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      if (!unloadingRef.current) fireLeave(); // leave only on a genuine in-app route change
    };
  }, []);

  // ── showdown result dwell ───────────────────────────────────────────────────
  // When a hand completes with a settlement result, snapshot the WHOLE completed hand
  // (felt + reveals + winner + result) and hold it ~8s. The server may auto-deal the
  // next hand immediately; the snapshot keeps the board runout / revealed hands / winner
  // visible so the result is never silently overwritten. Display-only — never blocks the
  // server; cleared on timeout, when a NEW hand needs my action, or when I act.
  const [dwell, setDwell] = useState<DwellSnap | null>(null);
  const dwellHandIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!table || !hand || hand.status !== 'complete' || !hand.result || !hand.handId) return;
    if (!isTableLive(table.status, occupiedCount(seats))) return; // never capture a result for a closed/empty table
    if (dwellHandIdRef.current === hand.handId) return; // snapshot each completion once
    dwellHandIdRef.current = hand.handId;
    const ringView = buildRingView(table, hand, seats, mySeatNo);
    const winnerSeats = Array.from(new Set(hand.result.potAwards.flatMap((a) => a.winners)));
    // All-in showdowns play a longer cinematic runout; give the snapshot enough headroom
    // (the AllInRunout's onDone clears it earlier; this is the safety fallback).
    const holdMs = isAllInShowdown(ringView) ? ALLIN_CINEMATIC_TOTAL_MS + 2000 : RESULT_DWELL_MS;
    setDwell({ ringView, winnerSeats, result: hand.result, handId: hand.handId, capturedAt: Date.now(), holdMs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.handId, hand?.status]);

  useEffect(() => {
    if (!dwell) return;
    const id = setTimeout(() => setDwell(null), dwell.holdMs);
    return () => clearTimeout(id);
  }, [dwell]);

  // A genuinely NEW hand drops the held result so the felt yields to the live hand. The
  // render-time `freshDeal` gate (below) already HIDES the dwell on the same render the deal
  // signal bumps — this effect releases the dwell STATE + its timer and re-arms bustout. A
  // fresh non-cinematic deal (board empty) OR a hand that now needs MY action both qualify.
  // Never cut an all-in cinematic short — it finishes via AllInRunout's own onDone.
  useEffect(() => {
    if (!dwell || !hand || hand.handId === dwell.handId) return;
    const cinematicDwell = isAllInShowdown(dwell.ringView);
    const fresh = hand.status !== 'complete' && (hand.board?.length ?? 0) === 0;
    const needsMyAction = hand.status === 'betting' && hand.toActSeat === mySeatNo;
    // Release the dwell STATE in lockstep with the render-time gate: a fresh non-cinematic
    // deal, or a hand that needs MY action (drops even a cinematic so I'm never blocked).
    if (needsMyAction || (fresh && !cinematicDwell)) setDwell(null);
  }, [hand?.handId, hand?.toActSeat, hand?.status, hand?.board?.length, mySeatNo, dwell]);

  // PR C — switching tables must not carry a previous table's held result/cinematic. Use
  // the effect CLEANUP (which fires only when tableId actually changes — and on unmount —
  // never on first mount) so a freshly-snapshotted result isn't wiped on initial render.
  useEffect(() => {
    return () => { setDwell(null); dwellHandIdRef.current = null; };
  }, [tableId]);

  // PR C — a table that goes closed / empty (no players) must not keep showing a stale
  // result. Clear the dwell so the felt falls back to the empty state.
  useEffect(() => {
    if (!isTableLive(table?.status, occupiedCount(seats))) setDwell(null);
  }, [table?.status, seats]);

  // E4 — bustout. After settlement the server writes the busted player's seat stack to 0
  // (migration 20260907000000), so a seated player with 0 chips and no live hand has lost
  // all their chips. Offer leave/rebuy ONCE per bust, and only after any result dwell has
  // finished (so the outcome is seen first). Dismissable to keep spectating; re-armed only
  // once the player is no longer busted (e.g. after leaving). Never decides chips client-side.
  const myStackStr = seats.find((s) => s.userId === myUserId)?.stack;
  const inLiveHand = !!hand && (hand.status === 'dealing' || hand.status === 'betting');
  const isBusted = mySeatNo != null && myStackStr != null && Number(myStackStr) === 0 && !inLiveHand;
  useEffect(() => {
    if (isBusted && !dwell) {
      if (!bustHandledRef.current) { bustHandledRef.current = true; setBustOpen(true); }
    } else if (!isBusted) {
      bustHandledRef.current = false;
      setBustOpen(false);
    }
  }, [isBusted, dwell]);

  if (!FEATURES.onlinePoker) return <PokerComingSoon />;

  if (!table) {
    return (
      <div className="container mx-auto max-w-2xl p-4">
        <Card className="space-y-3 p-6 text-center">
          <p className="text-muted-foreground">{loading ? 'Đang tải bàn…' : 'Không tìm thấy bàn này.'}</p>
          <Button asChild variant="outline"><Link to="/poker">Về sảnh</Link></Button>
        </Card>
      </div>
    );
  }

  if (RUNTIME_LIVE && !user) {
    return (
      <div className="container mx-auto max-w-2xl p-4">
        <Card className="space-y-4 p-6 text-center">
          <h1 className="text-lg font-bold">{table.name}</h1>
          <p className="text-muted-foreground">Đăng nhập để vào bàn chơi (chip ảo).</p>
          <Button asChild className="gap-2"><Link to="/auth"><LogIn className="h-4 w-4" /> Đăng nhập</Link></Button>
          <div><Button asChild variant="ghost" size="sm"><Link to="/poker">← Về sảnh</Link></Button></div>
        </Card>
      </div>
    );
  }

  const seated = mySeatNo != null;
  const inActiveHand = !!hand && (hand.status === 'dealing' || hand.status === 'betting');
  // I can leave any time UNLESS my own seat is genuinely contesting the live hand
  // (active/allin) — the server blocks that to preserve chip conservation. Just being at
  // the table while OTHERS play (sitting_out / joined after the deal) must NOT block leave.
  const iAmInLiveHand = computeIAmInLiveHand(hand, mySeatNo);
  const seatedPlayers = [...seats].sort((a, b) => a.seatNo - b.seatNo);
  const occupied = occupiedCount(seats);
  const tableLive = isTableLive(table.status, occupied);

  // Keep the unmount-leave snapshot current every render.
  leaveRef.current = { seated, inActiveHand, leave: actions.leaveTable };

  // PR C — only show a held result on a LIVE table; never for a closed / empty one.
  // P0 deal-anim fix: when a genuinely NEW hand has been dealt (handId changed from the
  // dwell's, board empty, not complete), drop the held result RIGHT HERE in render — NOT in
  // an effect, which clears one commit too late and lets DealAnimation fire over the stale
  // felt. This makes the felt the live new hand on the SAME render the deal signal bumps, so
  // the cards fly over the correct empty felt to the correct seat positions. An all-in
  // cinematic dwell is PRESERVED (excluded) so AllInRunout finishes via its own onDone.
  const cinematicDwell = !!dwell && isAllInShowdown(dwell.ringView);
  const newHand = !!hand && !!hand.handId && hand.handId !== dwell?.handId;
  // freshDeal = a new hand just dealt (board empty) → drops a NON-cinematic held result so
  // the deal flourish flies over the clean felt. needsMyAction drops the dwell even mid-
  // cinematic (never block me). An all-in cinematic is otherwise PRESERVED until its own
  // AllInRunout onDone — a new hand merely ARRIVING must not cut the runout short.
  const freshDeal = newHand && hand?.status !== 'complete' && (hand?.board?.length ?? 0) === 0;
  const needsMyAction = newHand && hand?.status === 'betting' && hand?.toActSeat === mySeatNo;
  const dropDwell = needsMyAction || (freshDeal && !cinematicDwell);
  const showing: DwellSnap | null = (tableLive && dwell && !dropDwell) ? dwell : null;
  // Once the dwell ends a completed hand can still be the latest (no new deal yet), and a
  // non-live table should show nothing — in both cases clear the felt (null hand → empty
  // board) so a stale completed board never lingers. During an active hand or the dwell
  // the real hand / snapshot is shown, so #329's cinematic is untouched.
  const completedLingering = !showing && hand?.status === 'complete';
  const feltHand = (!tableLive || completedLingering) ? null : hand;
  const ringView = buildRingView(table, feltHand, seats, mySeatNo);
  const feltView = showing ? showing.ringView : ringView;
  const feltWinners = showing ? showing.winnerSeats : undefined;
  // An all-in showdown replays as a cinematic runout (its own felt + reveals + equity +
  // result); other states use the plain felt + result panel below.
  const cinematic = !!showing && isAllInShowdown(showing.ringView);

  const openSit = (seatNo: number) => {
    // Don't offer to sit until the first load settles — a reload could otherwise briefly
    // open the dialog for a seat the player already occupies (server would then reject).
    if (loading) return;
    if (seated) { toast.info('Bạn đã ngồi ở bàn này rồi.'); return; }
    setSitSeat(seatNo);
  };

  const confirmSit = async (buyin: string) => {
    if (sitSeat == null) return;
    markPokerSoundGesture(); // first deliberate table action → unlock audio
    try {
      const res = (await actions.sitOpen(sitSeat, buyin)) as RpcOutcome;
      if (res?.outcome === 'ok') { toast.success(`Đã ngồi vào ghế ${sitSeat}`); setSitSeat(null); refresh(); }
      else toast.error(vn(res?.outcome));
    } catch { toast.error('Không ngồi được, thử lại.'); }
  };

  const leave = async () => {
    try {
      const res = (await actions.leaveTable()) as RpcOutcome;
      if (res?.outcome === 'ok') {
        // Clear local seat-bound UI at once so I can immediately re-join (don't wait for
        // the poll). mySeatNo is seats-authoritative, so refresh() drops `seated` too.
        toast.success('Đã rời bàn.');
        setSitSeat(null);
        setBustOpen(false);
        bustHandledRef.current = false;
        refresh();
      } else if (res?.outcome === 'in_active_hand') {
        toast.error('Bạn đang trong ván, không thể rời ngay. Sẽ rời được sau khi xong ván.');
      } else {
        toast.error(vn(res?.outcome));
      }
    } catch { toast.error('Không rời được, thử lại.'); }
  };

  // Rebuy a fresh stack after busting. The amount is server-dictated (= the table's
  // starting stack); the client just sends that value and the server re-validates it.
  // On success the seat stack > 0, so the bustout effect closes the modal on next load.
  const rebuy = async () => {
    try {
      const res = (await actions.rebuy(table.startingStack)) as RpcOutcome;
      if (res?.outcome === 'ok') { toast.success('Đã mua thêm chip.'); setBustOpen(false); }
      else if (res?.outcome !== 'has_chips') toast.error(vn(res?.outcome));
      refresh();
    } catch { toast.error('Không mua được chip, thử lại.'); }
  };

  // Host-transfer RPC wrapper, surfaced in the ⚙️ settings sheet ("Trao quyền"). The server
  // also auto-reassigns host to the next seated player on leave, so continuity never depends
  // on this — it is the discretionary, stay-seated hand-off.
  const transfer = async (toUserId: string, name: string) => {
    try {
      const res = (await actions.transferHost(toUserId)) as RpcOutcome;
      if (res?.outcome === 'ok') { toast.success(`Đã trao quyền chủ bàn cho ${name}`); refresh(); }
      else toast.error(vn(res?.outcome));
    } catch { toast.error('Không trao quyền được, thử lại.'); }
  };

  const submit = async (a: { type: ActionType; amount?: string }) => {
    if (!hand || mySeatNo == null || submitting) return; // ignore re-taps while a submit is in flight
    setDwell(null); // acting on the new hand drops any lingering result view
    setSubmitting(true);
    // Instant audio feedback for MY action (opponents' sounds are derived from polling in
    // useTableHand, which skips my seat to avoid doubling up).
    markPokerSoundGesture();
    playPokerLiveSound(actionToSound(a.type));
    try {
      const res = (await actions.submitAction({ handId: hand.handId, seat: mySeatNo, type: a.type, amount: a.amount })) as SubmitActionResult;
      const kind = classifySubmitResult(res);
      if (kind === 'rejected') {
        toast.error(vn((res as { code?: string }).code));
      } else if (kind === 'fastpath') {
        // Fast-path: the edge already returned the engine's post-action state — render it NOW
        // (one round trip, NOT optimistic: it is the server's own output, ordered against
        // in-flight polls by the hook's high-water guard). refresh() converges seats/host in
        // the background without blocking the felt.
        const ok = res as Extract<SubmitActionResult, { ok: true }>;
        applyServerView(ok.view, ok.stateVersion);
        refresh();
      } else {
        // 'refetch' fallback (deployed edge variant without `view` / unexpected shape):
        // the old refresh path — never a dead-end.
        refresh();
      }
    } catch { toast.error('Gửi hành động thất bại, thử lại.'); }
    finally { setSubmitting(false); }
  };

  const nameFor = (s: LiveSeat) => (s.userId === myUserId ? 'Bạn' : s.displayName || `Ghế ${s.seatNo}`);

  return (
    <div
      ref={rootRef}
      className={immersive
        // TRUE full-screen: no max-width, no outer padding, no gap — the felt fills every edge.
        // The header floats over the top (absolute) so it never steals layout height. Only the
        // bottom safe-area is reserved (home indicator); the top notch is handled by the header.
        ? 'fixed inset-0 z-[60] flex h-[100dvh] w-full flex-col overflow-hidden bg-background [padding-bottom:env(safe-area-inset-bottom)]'
        // Chrome-less route (no Layout nav): on MOBILE drop side padding + gap so the felt
        // fills edge-to-edge (the header floats over the top); restore padding/centering at sm:
        // so desktop stays a centred table.
        : 'mx-auto flex min-h-[100dvh] w-full flex-col bg-background [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] sm:max-w-4xl sm:gap-2 sm:p-4'}
      style={{ background: 'radial-gradient(130% 85% at 50% 26%, #0b1410 0%, #07090b 72%)' }}
    >
      {/* Header floats over the felt's top edge (both modes) so it never steals layout height
          and the felt reaches the top — N8-style thin top bar. */}
      <header className="absolute inset-x-0 top-0 z-50 flex items-center gap-1 bg-gradient-to-b from-black/60 via-black/30 to-transparent px-2 pb-3 [padding-top:max(0.25rem,env(safe-area-inset-top))]">
        {immersive ? (
          <Button variant="ghost" size="sm" onClick={exitImmersive}><Minimize2 className="h-4 w-4" /> Thoát</Button>
        ) : (
          <Button asChild variant="ghost" size="sm"><Link to="/poker"><ChevronLeft className="h-4 w-4" /> Sảnh</Link></Button>
        )}
        <h1 className="truncate text-base font-semibold">{table.name}</h1>
        <Badge variant="outline" className="tabular-nums text-[11px]">{fmtChips(table.sb)}/{fmtChips(table.bb)}</Badge>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={toggleSkin}
          aria-label="Đổi giao diện bàn"
          title={feltSkin === 'premium' ? 'Giao diện: Cao cấp (chạm để về Xanh)' : 'Giao diện: Xanh (chạm để Cao cấp)'}
        >
          <Palette className={feltSkin === 'premium' ? 'h-4 w-4 text-amber-300' : 'h-4 w-4'} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={immersive ? exitImmersive : enterImmersive}
          aria-label={immersive ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
          title={immersive ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
        >
          {immersive ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMute}
          aria-label={muted ? 'Bật tiếng' : 'Tắt tiếng'}
          title={muted ? 'Bật tiếng' : 'Tắt tiếng'}
        >
          {muted ? <VolumeX className="h-4 w-4 text-muted-foreground" /> : <Volume2 className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          aria-label="Cài đặt bàn"
          title="Cài đặt bàn — người chơi · xem ván · rời bàn"
        >
          <Settings className="h-4 w-4" />
        </Button>
        {amIHost && <Badge className="gap-1"><Crown className="h-3 w-3" /> Chủ bàn</Badge>}
      </header>

      {/* All-in showdown → cinematic runout replay (staged reveals → flop → equity → turn
          → equity → river → result). Otherwise the felt: the live hand, or the held
          showdown snapshot. Empty seats are tap-to-sit when you're not seated / no result. */}
      {/* Felt is the page — the table floats in the dark void with no card chrome around
          it, centered in the available height so it dominates the screen. */}
      {/* `relative` so the action dock / result / hint can FLOAT over the felt's bottom edge
          (N8) instead of pushing it up — the felt keeps its full size every turn, no resize. */}
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        {cinematic && showing ? (
          <AllInRunout hand={showing.ringView} bb={table.bb} skin={feltSkin} onDone={() => setDwell(null)} />
        ) : (
          <SeatRing
            hand={feltView}
            bb={table.bb}
            winnerSeats={feltWinners}
            dealSignal={dealSignal}
            dealSeats={dealSeats}
            skin={feltSkin}
            // N8: the hero leaves the ring → rendered as a screen-corner <HeroHud> below.
            // This frees the lower-left so seat 1 no longer overlaps the hero.
            heroAsHud
            // N8: the felt fills the screen (mobile edge-to-edge; desktop stays centred).
            fill
            // Sit is allowed on any OPEN table (incl. an empty one — that's how you start
            // it); only a closed table or an active result/cinematic blocks it.
            onEmptySeatClick={!seated && !loading && !showing && table.status !== 'closed' ? openSit : undefined}
          />
        )}

        {/* hero HUD — my own cards + stack pinned to the SCREEN's bottom-left corner (N8).
            Hidden during the all-in cinematic (it shows its own hero). Lifts above the action
            dock while it's my turn so the buttons never cover the cards. */}
        {!(cinematic && showing) && (
          <HeroHud hand={feltView} bb={table.bb} />
        )}

        {/* ── bottom overlay (N8) — result / action dock / waiting hint float over the felt's
            bottom edge. OFF-TURN nothing renders → the felt owns the whole screen. A scrim
            fades the felt under the dock for readability; pointer-events only on the content. */}

        {/* showdown result — winner / pot / refund, held during the dwell. Cinematic shows its
            own result at the end (excluded). Takes priority over the dock + hint. */}
        {showing && !cinematic && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-1 pb-1 pt-12 bg-gradient-to-t from-black/80 via-black/45 to-transparent">
            <div className="pointer-events-auto">
              <ShowdownResult
                result={showing.result}
                handNo={showing.ringView.handNo}
                seats={showing.ringView.seats}
                mySeat={showing.ringView.mySeat}
                bb={table.bb}
              />
            </div>
          </div>
        )}

        {/* action dock — ONLY when it's my turn (N8: no dock off-turn). The "menu loading"
            strip lives inside ActionBar (my turn, legal not yet arrived). */}
        {!showing && inActiveHand && hand?.toActSeat === mySeatNo && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-1 pb-1 pt-12 bg-gradient-to-t from-black/80 via-black/45 to-transparent sm:inset-x-auto sm:left-auto sm:right-3 sm:bottom-3 sm:w-[21rem] sm:bg-none sm:p-0">
            {/* Mobile: a full-width bottom dock (scrim fades the felt under it). Desktop / tablet
                (sm:): the dock moves to the bottom-RIGHT as a compact panel (no scrim) so the
                bottom-centre hero seat stays clear — the GG / N8 desktop layout. ActionBar's
                logic + sizing are unchanged; only its container moves.
                pointer-events-none here — ActionBar re-enables taps per control group so its
                empty centre lets felt taps (and the hero HUD) through. */}
            <ActionBar hand={hand!} legal={legal ?? undefined} bb={table.bb} busy={submitting} onAction={submit} />
          </div>
        )}

        {/* status hint — closed/empty table or a live table between hands. A light centred
            pill (no heavy scrim); suppressed while a result/cinematic is shown. */}
        {!showing && !inActiveHand && (
          <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-2">
            {!tableLive ? (
              <div className="rounded-xl border border-white/10 bg-black/55 px-4 py-3 text-center text-sm text-muted-foreground backdrop-blur-sm">
                {emptyStateLabel(table.status, occupied)}
              </div>
            ) : seated && occupied < 2 ? (
              // Only the "waiting for players" hint remains; the between-hands "Ván mới…" line
              // is removed (N8: between hands the felt owns the screen, no status strip).
              <div className="rounded-xl border border-white/10 bg-black/55 px-4 py-3 text-center text-sm text-muted-foreground backdrop-blur-sm">
                Đang chờ thêm người chơi…
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ⚙️ Settings sheet — players + host transfer + hand review + leave, moved off the
          felt area so the bottom of the screen stays just the action dock (N8 layout). */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-[min(22rem,92vw)] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Cài đặt bàn</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-5">
            {/* seat status + leave (moved here from below the felt) */}
            <div className="flex flex-wrap items-center gap-2">
              {seated ? (
                <>
                  <Badge variant="secondary">Bạn đang ngồi ghế {mySeatNo}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={leave}
                    disabled={iAmInLiveHand}
                    title={iAmInLiveHand ? 'Bạn đang trong ván — sẽ rời được sau khi xong ván' : undefined}
                  >
                    {iAmInLiveHand ? 'Rời sau ván' : 'Đứng dậy / rời bàn'}
                  </Button>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">Chạm một ghế trống trên bàn để vào chơi.</span>
              )}
            </div>

            {/* players + host controls */}
            {seatedPlayers.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Người chơi tại bàn</div>
                <div className="space-y-1.5">
                  {seatedPlayers.map((s) => {
                    const isHost = s.userId === hostUserId;
                    const isMe = s.userId === myUserId;
                    return (
                      <div key={s.seatNo} className="flex items-center gap-2 text-sm">
                        <span className="w-7 text-center text-xs text-muted-foreground tabular-nums">#{s.seatNo}</span>
                        <span className={`truncate ${isMe ? 'font-semibold' : ''}`}>{nameFor(s)}</span>
                        {isHost && <Badge variant="outline" className="gap-1 border-primary/40 text-primary"><Crown className="h-3 w-3" /> Chủ</Badge>}
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{fmtChips(s.stack)}</span>
                        {amIHost && !isHost && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => transfer(s.userId, nameFor(s))}>
                            Trao quyền
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* buy-in history — informal record of how many chips each player has bought in
                (sit + rebuy) over this table's lifetime; survives a leave→re-sit. */}
            {RUNTIME_LIVE && user && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lịch sử buy-in</div>
                {buyinStatus === 'loading' && <p role="status" className="text-sm text-muted-foreground">Đang tải lịch sử buy-in…</p>}
                {buyinStatus === 'error' && <div role="alert" className="space-y-2 text-sm">
                  <p>Không tải được lịch sử buy-in.</p>
                  <Button size="sm" variant="outline" aria-label="Thử lại lịch sử buy-in" onClick={() => setBuyinRetry((n) => n + 1)}>Thử lại</Button>
                </div>}
                {buyinStatus === 'ready' && buyins.length === 0 && <p className="text-sm text-muted-foreground">Chưa có lịch sử buy-in.</p>}
                <div className="space-y-1.5">
                  {buyins.map((b) => (
                    <div key={b.userId} className="flex items-center gap-2 text-sm">
                      <span className={`truncate ${b.userId === myUserId ? 'font-semibold' : ''}`}>{b.displayName ?? 'Người chơi'}</span>
                      {b.count > 1 && <span className="shrink-0 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">×{b.count}</span>}
                      <span className="ml-auto shrink-0 font-semibold tabular-nums text-primary">{fmtChips(b.total)}</span>
                    </div>
                  ))}
                </div>
                {buyins.length > 0 && <div className="mt-1.5 text-[11px] text-muted-foreground">Tổng chip mỗi người đã buy-in (gồm rebuy) tại bàn này.</div>}
              </div>
            )}

            {/* hand review — the public hand-state inspector (verify the public payload). */}
            {(showing || inActiveHand) && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Xem ván (hand review)</div>
                <HandStateViewer hand={showing ? showing.ringView : hand!} />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <SitDownDialog
        open={sitSeat != null}
        onOpenChange={(v) => { if (!v) setSitSeat(null); }}
        seatNo={sitSeat}
        tableName={table.name}
        sb={table.sb}
        bb={table.bb}
        defaultStack={table.startingStack}
        onConfirm={confirmSit}
      />

      <BustoutDialog
        open={bustOpen}
        onOpenChange={setBustOpen}
        onLeave={async () => { await leave(); setBustOpen(false); }}
        rebuyEnabled={FEATURES.onlinePokerRebuy}
        rebuyAmount={table.startingStack}
        onRebuy={rebuy}
      />
    </div>
  );
}
