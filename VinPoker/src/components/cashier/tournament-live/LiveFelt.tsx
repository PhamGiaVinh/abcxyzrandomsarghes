import { TableLogo, TableBlinds } from '@/components/tracker/TableIdentity';
import { tableAppearanceStyle, type TableAppearance } from '@/components/tracker/tableAppearance';
// Presentational poker felt for the Tournament Live tracker.
//
// PURE component (no data-fetching / realtime / polling — that stays in the
// parent; PR #12 safety machinery untouched). Shared by the public viewer, the
// operator tracker (TournamentLivePanel) and the replay path, so props stay
// backward-compatible and PokerCard(null) behaviour is never changed.
//
// Layout system (anti-overlap):
//  • A reserved CENTER SAFE-ZONE holds the V mark + board + pot in one stacked
//    group. No seat may enter it.
//  • Seats use a tuned 9-max position MAP per orientation — bottom seats sit low
//    on the rim, side seats stay outside the board zone — so nothing collides.
//  • The action ticker lives in a rail BELOW the felt, not on top of it.
//  • Seats are avatar + name + stack only (no name boxes); position badge is small.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTrackerCardStyle } from '@/components/tracker/TrackerCardStyle';
import { TRACKER_TABLE_GEOMETRY, TRACKER_FELT_STYLE, trackerTableSizes, trackerBetPoint, useTrackerTableLayout } from '@/components/tracker/trackerTableLayout';
import { useTranslation } from "react-i18next";
import { PokerCard, CardBack } from "./PokerVisuals";
import { CenterPotStack, ChipStack } from "./ChipStack";
import { FeltStatusBar } from "./FeltStatusBar";
import { TableMotionLayer } from "./TableMotionLayer";
import { useCountUp } from "@/hooks/useCountUp";
import type { PotBreakdown } from "@/lib/tracker-poker/potEngine";
import type { TableMotionEvent } from "@/lib/tracker-poker/tableMotion";
import {
  normalizeReplayCardCode,
  type BestFiveFocus,
  type VerifiedShowdownPresentation,
} from "@/lib/tracker-poker/replayBestFiveFocus";
import { POT_AWARD_TRAVEL_MS, isReplaySettlementPayoutPhase, type ReplayRunoutPhase, type ReplayRunoutPresentation } from "@/lib/tracker-poker/replayRunoutTimeline";
import { shouldCollectCommittedChips } from "@/lib/tracker-poker/livePotCollection";
import { formatViewerChipAndBB } from "@/lib/tracker-poker/viewerAmounts";

/** Count-up text (Phase 3, tableFx only): tweens a numeric display toward its target.
 *  First render / enabled-off / reduced-motion emit the target directly, so static
 *  renders and the operator/TV paths stay byte-identical. Display only — never state. */
function CountUpText({ value, format, enabled }: { value: number; format: (n: number) => string; enabled: boolean }) {
  const v = useCountUp(value, { enabled });
  return <>{format(v)}</>;
}

export interface SeatInfo {
  player_id: string;
  display_name: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
  table_id: string | null;
  position: string;
  avatar_url?: string | null;
  last_action?: string;
  /** Structured copy used by the spectator to format amounts in the hand's BB. */
  last_action_type?: string;
  last_action_amount?: number;
  is_folded?: boolean;
  is_all_in?: boolean;
  hole_cards?: string[];
  /** Chips committed on the CURRENT street (Live Action Engine overlay; 0/undef → no chip shown). */
  current_bet?: number;
  /** Net chips for the hand (ending − starting); set ONLY on a replay's final frame.
   * >0 → winner (gold glow + green "+X" badge under liveTableFx). null/undef → no badge. */
  net_won?: number | null;
  /** Display-only marker from the replay settlement check. */
  pot_winner?: boolean;
  /** Verified payout credited to this seat; absent until settlement matches storage. */
  payout_award?: number | null;
  /** Server-projected stack before pot awards, including any verified refund. */
  payout_starting_stack?: number;
  /** Verified uncalled amount returned to this seat. Refund never implies a winner. */
  refund_award?: number | null;
  /** Public display-only rank from a fresh verified settlement. */
  hand_rank?: { category: string; best_five: string[]; kickers: string[] } | null;
  /** Whole-hand ALL-IN commitment for display status, never a new seat-side pile
   * after the current street has been swept into the pot. */
  total_committed?: number;
  /** Spectator presentation of the current street contribution. Canonical live
   * and replay parents clear it at the street sweep, independently of total_committed. */
  display_committed_bet?: number;
}

export interface ActionLog {
  action_id?: string;
  street: string;
  player_id: string;
  display_name: string;
  seat_number: number;
  action_type: string;
  action_amount: number;
  action_order: number;
}

export function formatStack(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

// RPT-style flying-chip color by action (Option B). Returns a radial-gradient for the
// chip face, or `undefined` for unknown actions so the CSS default (gold) applies — do
// NOT return gold explicitly here, so operator/old paths with no kind stay byte-identical.
export function chipColorFor(kind?: string): string | undefined {
  switch (kind) {
    case "all_in":
      return "radial-gradient(circle at 35% 30%, #ff8a8a, #d33 55%, #7a1111 100%)"; // red
    case "call":
      return "radial-gradient(circle at 35% 30%, #9ff5c9, #2fbf73 55%, #0f6e3e 100%)"; // green
    case "post_sb":
    case "post_bb":
    case "post_ante":
      return "radial-gradient(circle at 35% 30%, #ffc97a, #d97a1e 55%, #7a3e0a 100%)"; // amber
    case "bet":
    case "raise":
      return "radial-gradient(circle at 35% 30%, #ffe7a8, #f5b340 60%, #9a6418 100%)"; // gold
    default:
      return undefined; // CSS fallback (gold)
  }
}

export function formatActionLabel(a: ActionLog, formatAmount: (amount: number) => string = formatStack): string {
  const t = a.action_type;
  if (t === "fold") return "Fold";
  if (t === "check") return "Check";
  if (t === "call") return `Call ${formatAmount(a.action_amount)}`;
  if (t === "bet") return `Bet ${formatAmount(a.action_amount)}`;
  if (t === "raise") return `Raise ${formatAmount(a.action_amount)}`;
  if (t === "all_in") return `All-In ${formatAmount(a.action_amount)}`;
  if (t === "post_sb") return `SB ${formatAmount(a.action_amount)}`;
  if (t === "post_bb") return `BB ${formatAmount(a.action_amount)}`;
  if (t === "post_ante") return `Ante ${formatAmount(a.action_amount)}`;
  return `${t} ${formatAmount(a.action_amount)}`;
}

type Pt = { l: number; t: number };

// Tuned 9-max seat maps. Bottom seats (4–7) sit LOW on the rim; side seats (3,8)
// stay far out — so none of them overlap the centre safe-zone (board + pot).
// Portrait = a tall vertical RACETRACK (5/7 pill): seats line the long left/right
// straights + the rounded top/bottom ends.
const PORTRAIT_SEATS: Record<number, Pt> = {
  1: { l: 37, t: 90 },
  2: { l: 12, t: 74 },
  3: { l: 8, t: 48 },
  4: { l: 20, t: 20 },
  5: { l: 50, t: 10 },
  6: { l: 80, t: 20 },
  7: { l: 92, t: 48 },
  8: { l: 88, t: 74 },
  9: { l: 63, t: 90 },
};
// Landscape = a wide horizontal RACETRACK (13/6 pill) — same seat distribution as the
// operator racetrack, so the viewer reads like a real broadcast table (not an oval).
const LANDSCAPE_SEATS: Record<number, Pt> = {
  1: { l: 37, t: 86 },
  2: { l: 10, t: 62 },
  3: { l: 15, t: 27 },
  4: { l: 34, t: 12 },
  5: { l: 50, t: 9 },
  6: { l: 66, t: 12 },
  7: { l: 85, t: 27 },
  8: { l: 90, t: 62 },
  9: { l: 63, t: 86 },
};

// RACETRACK geometry — wide horizontal pill on desktop (13/6, like the operator
// racetrack) + a tall vertical pill on phones (5/7). The felt uses a stadium radius
// (9999px), and `maxW` caps it so on wide screens it stays a centred, well-
// proportioned table (mx-auto) with side margins instead of sprawling edge-to-edge.
const GEO = {
  portrait: { aspect: "5 / 7", seats: PORTRAIT_SEATS, centerTop: "44%", centerW: "60%", vSize: "clamp(26px,9vw,40px)", maxW: "440px" },
  landscape: { aspect: "13 / 6", seats: LANDSCAPE_SEATS, centerTop: "43%", centerW: "40%", vSize: "clamp(22px,4vw,36px)", maxW: "820px" },
};

// Viewer Felt V2 (viewerLayout-only) — CoinPoker-style geometry: sides pushed further
// out + top/bottom rows raised/lowered so the central column (board + pot) is wide open,
// and the felt is a touch larger. Used ONLY when viewerLayout is on; operator/TV keep GEO.
const PORTRAIT_SEATS_V2: Record<number, Pt> = {
  1: { l: 35, t: 92 }, 2: { l: 10, t: 76 }, 3: { l: 6, t: 50 }, 4: { l: 18, t: 18 }, 5: { l: 50, t: 8 },
  6: { l: 82, t: 18 }, 7: { l: 94, t: 50 }, 8: { l: 90, t: 76 }, 9: { l: 65, t: 92 },
};
const LANDSCAPE_SEATS_V2: Record<number, Pt> = {
  1: { l: 35, t: 88 }, 2: { l: 8, t: 60 }, 3: { l: 13, t: 24 }, 4: { l: 33, t: 9 }, 5: { l: 50, t: 6 },
  6: { l: 67, t: 9 }, 7: { l: 87, t: 24 }, 8: { l: 92, t: 60 }, 9: { l: 65, t: 88 },
};
// Phase-2 rim-tuned VIEWER landscape map (baseline-driven: at 880×406 the V2 top row
// t=6-9 floated pods 26-38px ABOVE the rim, and the bottom pair at l=35/65 sat 105px
// from the stadium's rounded-end centres — read as "seats in the middle of the table").
// V3: top row lowered ONTO the rim (t≈15.5-16 → overhang ≤8px with the Phase-2 scaled
// ~140px pods), bottom pair spread toward the rounded ends (l 35/65→29/71 → ≤63px) and
// raised off the status bar (t 88→82). Only `viewerLayout && !portrait` reads this;
// operator/TV keep LANDSCAPE_SEATS byte-identically.
const LANDSCAPE_SEATS_V3: Record<number, Pt> = {
  1: { l: 29, t: 82 }, 2: { l: 10, t: 62 }, 3: { l: 16, t: 22 }, 4: { l: 34, t: 16 }, 5: { l: 50, t: 15.5 },
  6: { l: 66, t: 16 }, 7: { l: 84, t: 22 }, 8: { l: 90, t: 62 }, 9: { l: 71, t: 82 },
};
const GEO_V2 = {
  portrait: { aspect: "5 / 7", seats: PORTRAIT_SEATS_V2, centerTop: "42%", centerW: "54%", vSize: "clamp(26px,9vw,40px)", maxW: "480px" },
  landscape: { aspect: "13 / 6", seats: LANDSCAPE_SEATS_V2, centerTop: "44%", centerW: "36%", vSize: "clamp(22px,4vw,36px)", maxW: "880px" },
};

// PR-A1 (liveFeltCompact) — REDESIGNED (owner UAT 2026-07-06): the original 2.2:1
// stadium gave NINE seats + showdown reveals + bet discs + board only ~167px of felt
// height at 390px — a showdown pod is ~125px tall, so board/cards/discs/pods overlapped
// by construction while ~470px of the phone below sat empty. The compact portrait now
// uses a TALL 3:4 oval (GG/RPT mobile pattern) with the PROVEN V2 portrait rim anchors
// (the map that fixed the original mobile-overlap bug), keeping everything else compact:
// pot in the status bar, BB-first nameplates, watermark V, dropped face-down backs.
// Used ONLY when viewerLayout && compact && portrait; every other path (operator/TV/
// replay-without-flag, landscape) keeps GEO/GEO_V2 byte-identical.
const GEO_COMPACT_PORTRAIT = {
  aspect: "3 / 4",
  seats: PORTRAIT_SEATS_V2,
  centerTop: "46%",
  centerW: "54%",
  vSize: "clamp(26px,9vw,40px)", // unused in compact (V renders as a watermark instead)
  maxW: "480px",
};

export interface LiveFeltProps {
  /** Active seats already positioned for the table on view. */
  seats: SeatInfo[];
  /** The most recent actor — gets the gold spotlight ring. */
  lastActorId: string | null;
  /** The player whose turn it is to act next (Live Action Engine); null → no spotlight. */
  toActId?: string | null;
  /** Community cards padded to 5 slots ("" = empty → face-down V back). */
  displayCards: string[];
  potSize: number;
  potBreakdown: PotBreakdown | null;
  /** Multiple tables exist and none is resolved — show the picker hint instead. */
  multiTableUnresolved: boolean;
  handNumber: number | null;
  /** Latest action for the bottom rail (null = no actions yet). */
  latestAction: ActionLog | null;
  formatBB: (n: number) => string | null;
  /** Spectator projection: every gameplay amount is rendered as BB only. */
  viewerAmountsInBB?: boolean;
  viewerBigBlind?: number | null;
  /** Narrow-phone vertical layout (tall oval + portrait seat map). */
  portrait?: boolean;
  /** Seat number on the dealer button → renders a "D" puck. Omit/undefined → no puck (felt unchanged). */
  buttonSeat?: number | null;
  /**
   * Operator-console tap-to-select. ADDITIVE: when omitted the seat stays a plain
   * `<div>` (no role/tabIndex/handlers) so the public viewer + replay render is
   * byte-identical. When supplied, each seat becomes a keyboard-operable button
   * that reports its seat number.
   */
  onSeatClick?: (seatNumber: number) => void;
  /**
   * The seat the operator is currently entering an action for. ADDITIVE: null/
   * undefined → no frame (default render unchanged). A matching seat gets an
   * emerald OUTER frame — deliberately distinct from the engine to-act accent
   * ring (poker-accent on the avatar) so "whose turn" and "which seat I'm editing"
   * never read as the same highlight.
   */
  selectedSeat?: number | null;
  /**
   * P2-5 dead-button: the table's physical seat capacity (tournament_tables.max_seats).
   * ADDITIVE — when set, EMPTY physical seats render as dimmed placeholders (so a DEAD
   * button on an empty seat is visible, and the operator can tap one to set it via
   * onSeatClick). Omit/undefined → only occupied seats render (the public viewer +
   * replay + TV are byte-identical).
   */
  physicalSeats?: number;
  /**
   * Public spectator NEON variant (PokerVN / Stitch Dark). ADDITIVE: when true the
   * felt surface becomes dark blue-black with a neon-green (`--primary`) rim + glow
   * instead of the burgundy `--poker-felt` + gold rings. Omit/false → the burgundy
   * felt is byte-identical (operator racetrack / TV / replay unchanged). Set only by
   * the public viewer (and only under the liveHandFeed flag).
   */
  viewerNeon?: boolean;
  /**
   * liveTableFx (viewer-only): master switch for the table FX. ADDITIVE — when false
   * (operator/TV/replay always; viewer when the flag is off) the board key + reveal
   * behave EXACTLY as today (runtime byte-identical). When true the board card key is
   * value-stable (entrance fires once) + the flop staggers in.
   */
  tableFx?: boolean;
  /**
   * liveTableFx chip-push: a transient chip animates from this seat to the pot. Each
   * distinct `nonce` triggers one chip; null → no chips. Viewer-only. `kind` (the
   * originating action_type) colors the chip (all_in=red, call=green, blinds=amber,
   * bet/raise=gold); omitted/unknown → the CSS default gold (byte-identical).
   */
  chipPush?: { seatNumber: number; nonce: number; kind?: string } | null;
  /**
   * Viewer Felt V2 (liveViewerFeltV2): responsive broadcast layout shared by the public
   * viewer and the operator hand-input felt. ADDITIVE — when false/absent (TV/replay
   * without V2) the felt renders byte-identical to today. When true: every card sizes
   * with the FELT's own width (a CSS container query on the oval + `clamp()` inline
   * styles), and the felt uses the black-table viewer skin.
   */
  viewerLayout?: boolean;
  /**
   * PR-A1 (liveFeltCompact): RPT-style compact PUBLIC-VIEWER layout. ADDITIVE — inert
   * unless `viewerLayout` is also on (operator/TV/replay-without-V2 stay byte-identical
   * even if this is passed). When active:
   *  • portrait felt becomes a 2.2:1 wide stadium (≈30% of a phone viewport incl. pods)
   *    with rim-straddling seat anchors; landscape geometry is unchanged;
   *  • seat nameplates show the stack BB-FIRST (chips demoted to the secondary line);
   *    when `formatBB` returns null the chips line renders alone — never a fake BB;
   *  • a persistent one-row status bar (blinds/ante · to-act · pot) renders directly
   *    under the oval (both orientations). Set only by the public viewer
   *    (TournamentLiveView when `spectator && liveFeltCompact`).
   */
  compact?: boolean;
  /**
   * Blind level for the status bar (compact only; ignored otherwise). null/absent or
   * bb<=0 → the blinds segment is hidden (never fabricated). Live passes the clock
   * level; replay passes the HAND's own detected blinds.
   */
  blinds?: { sb: number; bb: number; ante: number; level?: number | null } | null;
  potUnavailable?: boolean;
  appearance?: TableAppearance;
  /**
   * UAT wave 2 (Fix 1 companion): the live hand is an all-in RUNOUT — betting is
   * closed, the board is being dealt out. The status bar's to-act segment shows
   * "Đang chạy board" instead of a (misleading) waiting-on-player name. Compact
   * viewer only; absent → no change.
   */
  runout?: boolean;
  /**
   * Final all-in/replay snapshot with no verified payout sequence yet. This only
   * collects committed chips and never chooses a winner or payout.
   */
  collectCommittedChips?: boolean;
  /** Replay-only display state; never changes chip calculations. */
  showdownResult?: "winner" | "chop" | "needs_resettle" | null;
  /** Verified final-frame card emphasis, derived by the replay parent on every render. */
  bestFiveFocus?: BestFiveFocus | null;
  /** Shared verified showdown model for the center ranking presentation. */
  showdownPresentation?: VerifiedShowdownPresentation | null;
  /** Presentation-only phase for the verified best-five result. */
  bestFiveFocusPhase?: "hidden" | "dim" | "glow" | "static";
  /** Sequential all-in board presentation; only viewer replay supplies this. */
  replayRunoutPhase?: ReplayRunoutPhase | null;
  /**
   * Verified Main/Side Pot sequence for the viewer replay. This is presentation
   * state only: all amounts and recipients come from `showdownPresentation`.
   */
  replayRunoutPresentation?: ReplayRunoutPresentation | null;
  /**
   * trackerShowdownRevealOrder (viewer) — ADDITIVE; absent → simultaneous reveal
   * (byte-identical). player_ids in the order they should table their cards at
   * showdown; each revealed seat's hole-card flip is delayed by its index ×
   * `revealStaggerMs`, so the cards appear in sequence ~0.5s apart.
   */
  revealOrder?: string[];
  /** Per-step delay for the staggered showdown reveal (ms). Default 500 when
   * `revealOrder` is set. */
  revealStaggerMs?: number;
  /** VinPoker-native display events. No event may decide cards, pot or winners. */
  motionEvents?: TableMotionEvent[];
  motionHandKey?: string | null;
  motionSpeed?: number;
  motionEnabled?: boolean;
  /** Static historical hand: never invent card backs for cards not public in the payload. */
  hideUnrecordedHoleCards?: boolean;
}

export function LiveFelt({
  seats,
  lastActorId,
  toActId = null,
  displayCards,
  potSize,
  potBreakdown,
  multiTableUnresolved,
  handNumber,
  latestAction,
  formatBB,
  viewerAmountsInBB = false,
  viewerBigBlind = null,
  portrait: portraitProp,
  buttonSeat = null,
  onSeatClick,
  selectedSeat = null,
  physicalSeats,
  viewerNeon = false,
  tableFx = false,
  chipPush = null,
  viewerLayout = false,
  compact = false,
  blinds = null,
  potUnavailable = false,
  appearance,
  runout = false,
  collectCommittedChips = false,
  showdownResult = null,
  bestFiveFocus = null,
  showdownPresentation = null,
  bestFiveFocusPhase = "static",
  replayRunoutPhase = null,
  replayRunoutPresentation = null,
  revealOrder,
  revealStaggerMs = 500,
  motionEvents = [],
  motionHandKey = null,
  motionSpeed = 1,
  motionEnabled = false,
  hideUnrecordedHoleCards = false,
}: LiveFeltProps) {
  const { t } = useTranslation();
  const unified = !!useTrackerCardStyle();
  const layout = useTrackerTableLayout(portraitProp);
  const portrait = unified ? layout.portrait : portraitProp ?? false;
  const sharedSizes = trackerTableSizes(portrait);
  // V2 uses the wider CoinPoker geometry; operator/TV keep the current GEO (byte-identical).
  // PR-A1 compact is DOUBLE-gated on viewerLayout so it can never touch operator/TV even
  // if the prop leaks; geometry only changes in portrait (landscape 13/6 is already wide).
  const compactActive = viewerLayout && compact;
  const geoSet = viewerLayout ? GEO_V2 : GEO;
  const geo = unified ? (portrait ? TRACKER_TABLE_GEOMETRY.portrait : TRACKER_TABLE_GEOMETRY.landscape) : compactActive && portrait ? GEO_COMPACT_PORTRAIT : portrait ? geoSet.portrait : geoSet.landscape;
  // Phase 2: the VIEWER landscape reads the rim-tuned V3 map; every other path keeps its
  // geo map. All seat/stack/chip-fly placements read `seatMap` so the three stay in sync
  // (module constants → stable identity for the chips-effect dependency).
  const seatMap = !unified && viewerLayout && !portrait ? LANDSCAPE_SEATS_V3 : geo.seats;
  const boardCardCls = "h-[44px] w-[32px] sm:h-[52px] sm:w-[38px]";
  const settlementPayoutPhase = replayRunoutPresentation?.phase ?? null;
  const awardKey = settlementPayoutPhase === "pot_award"
    ? `${replayRunoutPresentation?.key}:${replayRunoutPresentation?.potAwardIndex}` : null;
  const [arrivedAwardKey, setArrivedAwardKey] = useState<string | null>(null);
  useEffect(() => {
    if (!awardKey) { setArrivedAwardKey(null); return; }
    const timer = window.setTimeout(() => setArrivedAwardKey(awardKey), POT_AWARD_TRAVEL_MS);
    return () => window.clearTimeout(timer);
  }, [awardKey]);
  const awardArrived = !awardKey || arrivedAwardKey === awardKey;
  const displayedStack = (seat: SeatInfo): number => {
    if (!viewerLayout || !showdownPresentation?.enabled || seat.payout_starting_stack == null
      || !Number.isFinite(seat.payout_starting_stack) || seat.payout_starting_stack < 0) return seat.chip_count;
    const completedCount = settlementPayoutPhase === "pot_award"
      ? (replayRunoutPresentation?.potAwardIndex ?? 0) + (awardArrived ? 1 : 0)
      : settlementPayoutPhase === "static" || !replayRunoutPresentation
        ? showdownPresentation.potLayers.length : 0;
    const credited = showdownPresentation.potLayers.slice(0, completedCount)
      .flatMap(pot => pot.allocations)
      .filter(allocation => allocation.playerId === seat.player_id)
      .reduce((sum, allocation) => sum + allocation.amount, 0);
    return seat.payout_starting_stack + credited;
  };
  const settlementPayoutActive = viewerLayout
    && tableFx
    && showdownPresentation?.enabled === true
    && (settlementPayoutPhase === "pot_collect" || settlementPayoutPhase === "pot_award");
  // Keep committed chips out of their seat positions for the whole verified
  // settlement sequence. The old gate stopped at pot_award, so static/dim/glow
  // frames mounted the scattered seat stacks again after collection finished.
  const settlementPayoutSequenceActive = viewerLayout
    && tableFx
    && showdownPresentation?.enabled === true
    && replayRunoutPresentation != null
    && isReplaySettlementPayoutPhase(settlementPayoutPhase);
  // Live all-in has no replay HUD settlement model yet, but the server-derived
  // runout state still tells us betting is closed. Keep those committed chips
  // from reappearing around seats; collect them into one neutral center stack.
  // This is deliberately collect-only: no winner, pot layer, or payout is
  // inferred on the client.
  const livePotCollectionActive = viewerLayout
    && tableFx
    && shouldCollectCommittedChips({
      enabled: true,
      runout: runout === true,
      finalAllIn: collectCommittedChips,
      hasCommittedChips: true,
    })
    && replayRunoutPresentation == null;
  const settlementPotResultActive = viewerLayout
    && tableFx
    && showdownPresentation?.enabled === true
    && (settlementPayoutPhase === "pot_award" || settlementPayoutPhase === "static")
    && replayRunoutPresentation?.potAwardIndex != null;
  const hideBaseCenterPot = settlementPayoutSequenceActive || livePotCollectionActive || settlementPotResultActive;
  // Pot-layer recipients are intentionally the sole glow target while chips are
  // awarded and after the last layer settles. We never fall back to a union of
  // unrelated Main/Side winners.
  const bestFiveFocusActive = tableFx
    && bestFiveFocus?.enabled === true
    && bestFiveFocusPhase !== "hidden"
    && settlementPayoutPhase !== "pot_collect";
  const bestFiveGlowActive = bestFiveFocusActive && (bestFiveFocusPhase === "glow" || bestFiveFocusPhase === "static");
  const showdownRankingVisible = bestFiveGlowActive
    && showdownPresentation?.enabled === true
    && showdownPresentation.winners.length > 0;
  const runoutBoardReveal = replayRunoutPhase === "flop" || replayRunoutPhase === "turn" || replayRunoutPhase === "river";
  const cardFocusClass = (card: string, selectedCards: ReadonlySet<string> | undefined): string => {
    if (!bestFiveFocusActive) return "";
    const code = normalizeReplayCardCode(card);
    if (!code) return "";
    return selectedCards?.has(code) ? "tracker-best-five-card" : "tracker-non-best-five-card";
  };
  // Phase 3 (tableFx only): the POT display counts up toward its target instead of
  // jumping (~260ms ease-out). tableFx off / reduced-motion → displayPot === potSize
  // on every render, so operator/TV and static renders are byte-identical. Display
  // only — every gate below still reads the raw potSize.
  const displayPot = useCountUp(potSize, { enabled: tableFx });
  const formatViewerAmount = (amount: number): string => formatBB(amount) ?? "— BB";
  const formatGameplayAmount = viewerAmountsInBB ? formatViewerAmount : formatStack;

  // trackerShowdownRevealOrder: this seat's flip delay = its place in the reveal
  // order × the per-step stagger. Not in `revealOrder` (or prop absent) → undefined
  // → no delay (simultaneous, byte-identical). Index 0 → 0ms (starts immediately).
  const revealDelayStyle = (playerId: string): CSSProperties | undefined => {
    if (!revealOrder) return undefined;
    const i = revealOrder.indexOf(playerId);
    return i > 0 ? { animationDelay: `${i * revealStaggerMs}ms` } : undefined;
  };

  // Viewer Felt V2 — cards size with the FELT's own width (cqi resolves to the
  // container-type set on the oval below) so they never overlap on mobile. Inline
  // width/height beats the fixed Tailwind size class. When viewerLayout is off these
  // are `undefined` → every card keeps its current size (operator/TV byte-identical).
  // Hole cards are sized to ≈85% of the board clamps below (owner: showdown cards were
  // too small — wanted 80-90% of the board). Each term = 0.85 × the matching boardStyle
  // term. viewerLayout-gated only → operator/TV/replay-without-V2 stay byte-identical.
  const holeStyle: CSSProperties | undefined = unified ? sharedSizes.hole : viewerLayout
    ? portrait
      ? { width: "clamp(27px,8.8cqi,40px)", height: "clamp(38px,12.4cqi,56px)" }
      : { width: "clamp(22px,3.9cqi,41px)", height: "clamp(31px,5.4cqi,56px)" }
    : undefined;
  const boardStyle: CSSProperties | undefined = unified ? sharedSizes.board : viewerLayout
    ? portrait
      ? { width: "clamp(30px,11.5cqi,50px)", height: "clamp(42px,16.2cqi,70px)" }
      : { width: "clamp(26px,4.6cqi,48px)", height: "clamp(36px,6.4cqi,66px)" }
    : undefined;
  // Committed-bet chip STACK on the felt (viewerLayout only): disc + label sizing,
  // scaling with the felt via cqi (and uniformly under the narrow-landscape `fit`).
  const stackStyle: CSSProperties | undefined = viewerLayout
    ? portrait
      ? { width: "clamp(12px,4.6cqi,20px)", fontSize: "clamp(7px,2.6cqi,10px)" }
      : { width: "clamp(11px,2.3cqi,18px)", fontSize: "clamp(7px,1.6cqi,10px)" }
    : undefined;
  // Phase 2 (viewerLayout only): the PODS scale with the felt exactly like the cards do.
  // Baseline: fixed 58/70px pods read 7.95% of an 880px felt (N8 broadcast ≈ 12-15%) —
  // players looked lost on the table. 11cqi ≈ 97px at 880 (11%); floors keep the 560px
  // `fit` design width + portrait phones at today's sizes (no regress); caps bound it.
  // When viewerLayout is off all of these are `undefined` → operator/TV byte-identical.
  const podStyle: CSSProperties | undefined = unified ? sharedSizes.pod : viewerLayout
    ? portrait
      ? { width: "clamp(56px,15cqi,84px)" }
      : { width: "clamp(58px,11cqi,112px)" }
    : undefined;
  const avatarStyle: CSSProperties | undefined = unified ? sharedSizes.avatar : viewerLayout
    ? portrait
      ? { width: "clamp(32px,8.5cqi,44px)", height: "clamp(32px,8.5cqi,44px)" }
      : { width: "clamp(34px,5.4cqi,52px)", height: "clamp(34px,5.4cqi,52px)" }
    : undefined;
  const nameTextStyle: CSSProperties | undefined = viewerLayout ? { fontSize: "clamp(10px,1.5cqi,14px)" } : undefined;
  const bbTextStyle: CSSProperties | undefined = viewerLayout ? { fontSize: "clamp(11px,1.6cqi,15px)" } : undefined;
  const subTextStyle: CSSProperties | undefined = viewerLayout ? { fontSize: "clamp(8px,1.2cqi,11px)" } : undefined;
  const badgeTextStyle: CSSProperties | undefined = viewerLayout ? { fontSize: "clamp(7px,0.95cqi,9.5px)" } : undefined;
  const toActTextStyle: CSSProperties | undefined = viewerLayout ? { fontSize: "clamp(7.5px,1cqi,10px)" } : undefined;
  // Where a seat's chip stack sits: lerp from the seat toward the pot center, then
  // COLLISION-GUARDED — clamp the result to a minimum radial gap from the pot center so
  // near-pot/top seats can't land on the board safe-zone and 9 stacks don't converge onto
  // each other at the pot (the board is positionally protected, NOT just by z-order).
  // K + MINGAP are tuned in the 9-handed-all-bet visual check.
  const potCenterT = parseFloat(geo.centerTop) || 43;
  const motionAspect = unified ? (portrait ? 5 / 8 : 1.9) : portrait ? (compactActive ? 3 / 4 : 5 / 7) : 13 / 6;
  // Disc lerp K per surface (measured, 2026-07-06 tall-portrait redesign):
  //  • non-compact: 0.42 + the radial center clamp (unchanged — flag-off byte-identical).
  //  • compact LANDSCAPE (desktop /live): 0.30 "near the seat" (UAT wave 2 tuning — at
  //    0.42 the top-row discs land on the board, top seat t15.5 → 27.5%+disc vs board 29%).
  //  • compact PORTRAIT (tall 3:4 oval): a showdown pod is ~125px tall, so 0.30 landed the
  //    disc on its OWN pod/cards (top seats: 56px from anchor vs 62px pod half-height) →
  //    0.42 for the vertical-traveling rim seats. EXCEPT the middle-side seats (t within
  //    the board band): their discs travel HORIZONTALLY toward the cards — keep those at
  //    0.30 so they stop short of the board's edge (measured: l 19% vs board left 26%).
  const STACK_MINGAP = 16; // % of the felt that the stack center stays clear of the pot
  const stackPt = (pos: Pt): Pt => {
    if (unified) return trackerBetPoint(pos, portrait);
    const k = !compactActive
      ? 0.42
      : !portrait
        ? 0.3
        : Math.abs(pos.t - potCenterT) < 12
          ? 0.3
          : 0.42;
    let l = pos.l + (50 - pos.l) * k;
    let t = pos.t + (potCenterT - pos.t) * k;
    if (compactActive) return { l, t };
    const dx = l - 50;
    const dy = t - potCenterT;
    const d = Math.hypot(dx, dy);
    if (d > 0.01 && d < STACK_MINGAP) {
      l = 50 + (dx / d) * STACK_MINGAP;
      t = potCenterT + (dy / d) * STACK_MINGAP;
    }
    return { l, t };
  };
  const activePotLayerIndex = settlementPotResultActive
    ? replayRunoutPresentation?.potAwardIndex ?? -1
    : -1;
  const activePotLayer = activePotLayerIndex >= 0 ? showdownPresentation?.potLayers[activePotLayerIndex] ?? null : null;
  const verifiedWinnersByPlayerId = new Map(
    showdownPresentation?.winners.map((winner) => [winner.playerId, winner]) ?? [],
  );
  const activePotAwardRows = activePotLayer
    ? activePotLayer.allocations.flatMap((allocation) => {
      const seat = seats.find((candidate) => candidate.player_id === allocation.playerId);
      const winner = verifiedWinnersByPlayerId.get(allocation.playerId);
      return seat && winner ? [{ allocation, seat, winner }] : [];
    })
    : [];
  // Never present an incomplete payout as a winner result. The settlement
  // resolver has already verified every allocation; this is a final UI guard.
  const activePotAwardsComplete = activePotLayer !== null
    && activePotAwardRows.length === activePotLayer.allocations.length;
  const activePotWinnerIds = new Set(
    activePotAwardsComplete ? activePotLayer?.winnerPlayerIds ?? [] : [],
  );
  const visibleSettlementPotLayers = settlementPayoutSequenceActive && showdownPresentation
    ? settlementPayoutPhase === "pot_award" || settlementPayoutPhase === "static"
      ? showdownPresentation.potLayers.slice(Math.max(0, activePotLayerIndex), Math.max(0, activePotLayerIndex) + 1)
      : showdownPresentation.potLayers
    : [];
  const settlementPotPoint = (visibleIndex: number, total: number): Pt => {
    const horizontalOffset = (visibleIndex - (total - 1) / 2) * 13;
    return {
      l: 50 + horizontalOffset,
      t: Math.min(78, potCenterT + (portrait ? 16 : 15)),
    };
  };
  // Keep the scaled pile clear of the cards'8px reveal travel as well as the
  // stationary board. Narrow portrait also needs a reveal gutter: the centered
  // collect pile otherwise crosses the transformed card edge at 320px.
  const settlementPotMarginTop = portrait ? 16 : 24;
  const committedSeatStacks = viewerLayout
    ? seats
      .map((seat) => {
        const slot = ((seat.seat_number - 1) % 9) + 1;
        // Only chips still in front of the seat belong here. Whole-hand totals
        // already swept into the pot must never reappear around the rail.
        const amount = [seat.current_bet, seat.display_committed_bet]
          .find((value) => typeof value === "number" && Number.isFinite(value) && value > 0) ?? 0;
        return { seat, amount, point: stackPt(seatMap[slot] || seatMap[1]) };
      })
      .filter(({ seat, amount }) => !seat.is_folded && amount > 0)
    : [];
  // Once the all-in reaches the verified outcome, leaving committed stacks at
  // each seat would imply that the chips were never settled. Direct jumps render
  // the resolved table immediately; the animated path replaces them with travel.
  const hideCommittedSeatStacks = settlementPayoutSequenceActive || livePotCollectionActive || bestFiveFocusActive;
  // V2 forces its OWN premium surface, so the redesign never depends on the
  // separate liveHandFeed/viewerNeon flag being on (review P1).
  const neon = viewerNeon || viewerLayout;
  // liveTableFx chip-push: a transient chip per distinct nonce flies seat→pot.
  // Reduced-motion → never enqueue (so the absent onAnimationEnd can't orphan a chip).
  const [chips, setChips] = useState<{ id: number; fx: string; fy: string; color?: string }[]>([]);
  const lastChipNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!chipPush || lastChipNonce.current === chipPush.nonce) return;
    lastChipNonce.current = chipPush.nonce;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const slot = ((chipPush.seatNumber - 1) % 9) + 1;
    const pos = seatMap[slot] || seatMap[1];
    // Phase 3: cap the transient queue at 3 — at 8× replay (125ms/step vs the ~520ms fly
    // animation) unbounded pushes stack into chip spam; the newest 3 keep the effect legible.
    setChips((cs) => [...cs, { id: chipPush.nonce, fx: `${pos.l}%`, fy: `${pos.t}%`, color: chipColorFor(chipPush.kind) }].slice(-3));
  }, [chipPush, seatMap]);

  // V2 landscape scale-to-fit: a wide 9-max table can't fit a narrow phone width without
  // overlap, so below LANDSCAPE_DESIGN_W we render the felt at that design width and scale
  // the WHOLE thing down to fit (everything shrinks uniformly → never overlaps). Portrait is
  // untouched (it already fits, and stays the big-readable option). Wide screens (≥ design
  // width) also untouched. Operator/TV (viewerLayout off) never measure.
  const LANDSCAPE_DESIGN_W = 560;
  const FIT_PAD = 26; // breathing room above/below for pods that straddle the rim
  const feltWrapRef = layout.ref;
  const [fit, setFit] = useState<{ scale: number; h: number } | null>(null);
  useEffect(() => {
    if ((!viewerLayout && !unified) || portrait) { setFit(null); return; }
    const el = feltWrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (!w || w >= LANDSCAPE_DESIGN_W) { setFit(null); return; }
      const scale = w / LANDSCAPE_DESIGN_W;
      const designH = LANDSCAPE_DESIGN_W / motionAspect;
      setFit({ scale, h: Math.round(designH * scale) + FIT_PAD * 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewerLayout, portrait, unified, motionAspect, feltWrapRef]);

  return (
    <div
      className={`w-full${unified ? ' tracker-unified' : ''}${bestFiveFocusActive ? ` tracker-best-five-focus-active tracker-best-five-focus-${bestFiveFocusPhase}` : ""}${settlementPayoutActive ? ` tracker-settlement-payout-${settlementPayoutPhase}` : ""}`}
      ref={feltWrapRef}
    >
      {/* Felt oval — scales with container; seats may straddle the rim so the
          container is overflow-visible (never clips a seat). When `fit` is set
          (narrow landscape) a height-reserver clips the oversized design-width box
          and the oval is scaled down to fit, so a wide 9-max table never overlaps. */}
      {/* When fit: a real height-reserver box clips the oversized design-width felt.
          When NOT fit: display:contents → this wrapper vanishes, so operator/TV/portrait
          render the oval exactly as before (byte-identical). */}
      <div
        style={
          fit
            ? { position: "relative", height: fit.h, overflow: "hidden" }
            : unified ? { paddingTop: 16, paddingBottom: 16 } : compactActive && portrait
              ? // Compact stadium: rim-straddling pods extend ~44px above/below the short
                // oval — reserve that space so nothing above (headers) or below (status
                // bar) ever overlaps a pod. Non-compact keeps display:contents (identical).
                { paddingTop: 44, paddingBottom: 44 }
              : { display: "contents" }
        }
      >
      <div
        data-tracker-table={unified ? (portrait ? 'portrait' : 'landscape') : undefined}
        className={fit ? "overflow-visible" : "relative mx-auto w-full overflow-visible"}
        style={
          fit
            ? {
                // Fit (narrow landscape): render at the design width, CENTER it (absolute +
                // left 50% + translateX(-50%) — margin-auto can't center an element wider
                // than its container), then scale the whole thing down to fit.
                aspectRatio: geo.aspect,
                position: "absolute",
                left: "50%",
                top: `${FIT_PAD}px`,
                width: `${LANDSCAPE_DESIGN_W}px`,
                transform: `translateX(-50%) scale(${fit.scale})`,
                transformOrigin: "top center",
                containerType: "inline-size",
              }
            : {
                // Default (byte-identical with pre-V2): the oval scales with its container.
                aspectRatio: geo.aspect,
                maxWidth: geo.maxW,
                // V2: make the oval a size container so card `cqi` units resolve to the FELT
                // width. inline-size containment only fixes the inline axis — height still
                // comes from aspectRatio + width, so there is no sizing side-effect.
                ...(viewerLayout || unified ? { containerType: "inline-size" } : {}),
              }
        }
      >
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            ...tableAppearanceStyle(appearance),
            borderRadius: unified ? (portrait ? '38% / 22%' : '28% / 42%') : '9999px',
            // viewerLayout (V2) → RPT-style BLACK felt + a thin neon-green rim hint.
            // `neon` (old viewerNeon-only path) keeps the green felt; default =
            // burgundy operator/TV felt.
            background: unified ? TRACKER_FELT_STYLE.background : viewerLayout
              ? "radial-gradient(80% 72% at 50% 40%, #16181d 0%, #090b0f 58%, #020304 100%)"
              : neon
              ? "radial-gradient(62% 60% at 50% 38%, hsl(158 30% 13%) 0%, hsl(158 30% 13%) 50%, hsl(210 13% 5%) 100%)"
              : "radial-gradient(62% 60% at 50% 38%, hsl(var(--poker-felt)) 0%, hsl(var(--poker-felt)) 50%, hsl(var(--poker-felt-dark)) 100%)",
            boxShadow: unified ? TRACKER_FELT_STYLE.boxShadow : viewerLayout
              ? "inset 0 0 0 1.5px hsl(var(--primary) / 0.24), inset 0 18px 48px rgba(255,255,255,0.025), inset 0 0 82px rgba(0,0,0,0.74), 0 18px 48px rgba(0,0,0,0.56), 0 0 28px hsl(var(--primary) / 0.07)"
              : neon
              ? "inset 0 0 0 5px hsl(var(--primary) / 0.4), inset 0 0 0 7px hsl(210 13% 5% / 0.85), inset 0 0 0 8px hsl(var(--primary) / 0.55), inset 0 0 70px rgba(0,0,0,0.55), 0 22px 55px rgba(0,0,0,0.45), 0 0 36px hsl(var(--primary) / 0.12)"
              : "inset 0 0 0 5px hsl(var(--poker-gold) / 0.5), inset 0 0 0 7px hsl(var(--poker-felt-dark) / 0.85), inset 0 0 0 8px hsl(var(--poker-gold) / 0.7), inset 0 0 70px rgba(0,0,0,0.5), 0 22px 55px rgba(0,0,0,0.42)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            borderRadius: "9999px",
            background: "radial-gradient(52% 42% at 50% 20%, rgba(255,255,255,0.06), transparent 72%)",
          }}
        />

        {/* CENTER SAFE-ZONE — V mark + board + pot, one stacked group. Seats stay
            out of this area. pointer-events-none so it never blocks the felt. */}
        <div
          className="pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ top: geo.centerTop, width: geo.centerW, maxWidth: unified ? '400px' : "244px" }}
        >
          {compactActive && portrait ? (
            // Compact-portrait: the V is ABSOLUTE behind the board (no layout impact). On the
            // viewer it's transparent → no visible letter; the short felt keeps board + pot.
            <div
              data-testid="felt-v"
              aria-hidden="true"
              className="tracker-display absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 font-black leading-none"
              style={{ fontSize: "clamp(44px,20cqi,72px)", color: "transparent" }}
            >
              V
            </div>
          ) : (
            // Stacked V above the board. VIEWER → kept only as a TRANSPARENT SPACER: it read
            // as clutter over the top-center pods, but its height holds the board low enough
            // to clear the top-seat hole cards + chips, so we hide the letter (transparent)
            // without moving the board. OPERATOR/TV → the visible brand V (byte-identical).
            <div
              data-testid="felt-v"
              aria-hidden={viewerLayout || undefined}
              className="tracker-display mb-2 font-black leading-none"
              style={{
                fontSize: geo.vSize,
                color: viewerLayout ? "transparent" : neon ? "hsl(var(--primary) / 0.5)" : "hsl(var(--poker-gold) / 0.55)",
                textShadow: viewerLayout ? undefined : "0 1px 2px rgba(0,0,0,0.45)",
              }}
            >
              V
            </div>
          )}
          {potSize > 0 && compactActive && portrait && !hideBaseCenterPot && (
            <div data-testid="felt-total-pot" className="relative mb-2 flex flex-col items-center">
              {viewerLayout ? (
                <CenterPotStack compact label={`${t("liveHub.felt.pot", "POT").toUpperCase()} ${formatGameplayAmount(displayPot)}`} />
              ) : (
                <div className="tracker-pot-pulse inline-flex flex-col items-center rounded-full bg-black/70 px-4 py-1.5 shadow-[0_0_18px_hsl(var(--viewer-neon)_/_0.16)]" style={{ border: "1px solid hsl(var(--poker-gold) / 0.58)" }}>
                  <div className="tracker-display text-[8px] font-black uppercase tracking-[0.22em]" style={{ color: "hsl(var(--poker-gold) / 0.82)" }}>{t("liveHub.felt.totalPot", "Total Pot")}</div>
                  <div className="tracker-num text-xl font-black leading-tight" style={{ color: "hsl(var(--viewer-neon))" }}>{formatStack(displayPot)}</div>
                </div>
              )}
            </div>
          )}
          {unified && <><TableLogo url={appearance?.logoUrl} /><TableBlinds {...blinds} /></>}
          {/* Board — revealed cards face up. VIEWER: undealt slots render NOTHING (the
              face-down placeholders sat in front of the top-center seats, covering their
              pods/stacks/bet chips preflop). Operator/TV keep the V-logo backs → byte-identical. */}
          <div data-testid="board-cards" className={`flex items-center justify-center ${viewerLayout && portrait ? "gap-1" : "gap-1.5"}`}>
            {displayCards.map((card, i) => {
              if (!card) {
                // Preserve the five-card board footprint during the viewer-only
                // all-in runout without rendering a card back or exposing a card.
                if (viewerLayout && replayRunoutPhase) {
                  return <div key={`${i}-runout-slot`} aria-hidden="true" className={`${boardCardCls} invisible`} />;
                }
                return viewerLayout ? null : <CardBack key={`${i}-back`} size="md" className={boardCardCls} style={boardStyle} />;
              }
              const focusClass = cardFocusClass(card, bestFiveFocus?.boardCardCodes);
              const runoutDelay = replayRunoutPhase === "flop"
                ? i * 90
                : replayRunoutPhase === "turn" && i === 3
                  ? 0
                  : replayRunoutPhase === "river" && i === 4
                    ? 0
                    : null;
              return (
                <PokerCard
                  // tableFx → value-stable key (entrance fires once); else the current key
                  // (runtime byte-identical for operator/TV/replay). Keys aren't in the DOM.
                  key={tableFx ? card : `${i}-${card}`}
                  card={card}
                  size="md"
                  className={[
                    boardCardCls,
                    focusClass,
                    runoutBoardReveal ? "tracker-runout-board-card" : "",
                    runoutBoardReveal ? `tracker-runout-board-${replayRunoutPhase}` : "",
                  ].filter(Boolean).join(" ")}
                  // V2 boardStyle (clamp) merges with the FX stagger delay; both absent → undefined.
                  style={
                    boardStyle || runoutDelay !== null || (tableFx && i < 3)
                      ? {
                          ...boardStyle,
                          ...(runoutDelay !== null
                            ? { animationDelay: `${runoutDelay}ms` }
                            : tableFx && i < 3
                              ? { animationDelay: `${i * (unified ? 90 : 45)}ms` }
                              : {}),
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
          {showdownRankingVisible && (
            <div
              data-testid="felt-showdown-ranking"
              role="status"
              aria-live="polite"
              className="tracker-showdown-result mt-2 flex max-w-full flex-col items-center gap-0.5 rounded-full border border-[hsl(var(--poker-gold)/0.52)] bg-black/65 px-3 py-1 text-center shadow-[0_0_18px_hsl(var(--poker-gold)/0.18)]"
            >
              {showdownPresentation.isChop && (
                <span className="tracker-display text-[8px] font-black uppercase tracking-[0.18em] text-[hsl(var(--poker-gold)/0.82)]">
                  {t("liveHub.felt.chopPot", "Chop pot")}
                </span>
              )}
              {showdownPresentation.winners.map((winner) => (
                <span
                  key={winner.playerId}
                  data-testid={`felt-showdown-ranking-${winner.playerId}`}
                  className="tracker-display max-w-full truncate text-[10px] font-black leading-tight text-[hsl(var(--poker-gold))] sm:text-[11px]"
                >
                  {winner.rankingText}
                </span>
              ))}
            </div>
          )}
          {/* Compact portrait: the pot lives in the STATUS BAR below (RPT pattern) — the
              short felt keeps only the board centered, so 9-max pods never collide. */}
          {potSize > 0 && !(compactActive && portrait) && !hideBaseCenterPot && (
            <div
              {...(viewerLayout ? { "data-testid": "felt-total-pot" } : {})}
              className={`mt-2.5 flex flex-col items-center${viewerLayout ? " relative" : ""}`}
            >
              {viewerLayout ? (
                <CenterPotStack label={`${t("liveHub.felt.pot", "POT").toUpperCase()} ${potUnavailable ? "—" : viewerAmountsInBB ? formatViewerChipAndBB(displayPot, viewerBigBlind ?? blinds?.bb ?? null) : formatGameplayAmount(displayPot)}`} />
              ) : <div
                className="tracker-pot-pulse inline-flex flex-col items-center rounded-full bg-black/55 px-3.5 py-1"
                style={{ border: "1px solid hsl(var(--poker-gold) / 0.42)" }}
              >
                <div className={`tracker-display text-[8px] uppercase tracking-[0.22em]${viewerLayout ? " inline-flex items-center gap-1" : ""}`} style={{ color: "hsl(var(--poker-gold) / 0.78)" }}>
                  {viewerLayout && (
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: "radial-gradient(circle at 35% 30%, #ffe7a8, #f5b340 60%, #9a6418 100%)", boxShadow: "0 0 0 1px rgba(0,0,0,.4)" }}
                    />
                  )}
                  {t("liveHub.felt.pot", "Pot")}
                </div>
                <div className="tracker-num text-lg font-bold leading-tight sm:text-xl" style={{ color: "hsl(var(--poker-gold))" }}>
                  {potUnavailable ? "—" : viewerAmountsInBB ? formatViewerChipAndBB(displayPot, viewerBigBlind ?? blinds?.bb ?? null) : formatStack(displayPot)}
                  {!viewerAmountsInBB && formatBB(potSize) && (
                    <span className="ml-1.5 text-[10px] font-normal" style={{ color: "hsl(var(--poker-gold) / 0.6)" }}>
                      ({formatBB(displayPot)})
                    </span>
                  )}
                </div>
              </div>}
              {potBreakdown && potBreakdown.sidePots.length > 0 && (
                <div
                  className={
                    viewerLayout
                      ? "absolute left-1/2 top-full mt-1 flex max-w-[244px] -translate-x-1/2 flex-wrap justify-center gap-1"
                      : "mt-1 flex flex-wrap justify-center gap-1"
                  }
                  style={viewerLayout ? { width: "max-content" } : undefined}
                >
                  {potBreakdown.pots.map((pot, i) => (
                    <span
                      key={i}
                      className={`tracker-num rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-bold border ${
                        i === 0
                          ? "border-emerald-400/40 text-emerald-300"
                          : "border-[hsl(var(--poker-gold)/0.4)] text-[hsl(var(--poker-gold))]"
                      }`}
                    >
                      {i === 0 ? t("liveHub.felt.main", "Main") : t("liveHub.felt.side", "Side {{i}}", { i })} {formatGameplayAmount(pot.amount)}
                      <span className="ml-1 font-normal opacity-60">({pot.eligible_player_ids.length})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {seats.map((seat) => {
          const slot = ((seat.seat_number - 1) % 9) + 1;
          const pos = seatMap[slot] || seatMap[1];
          const posStyle: CSSProperties = { left: `${pos.l}%`, top: `${pos.t}%`, transform: "translate(-50%, -50%)" };

          const isLastActor = !seat.is_folded && lastActorId === seat.player_id;
          const isToAct = !seat.is_folded && !seat.is_all_in && toActId === seat.player_id;
          const initials = seat.display_name.slice(0, 2).toUpperCase();
          // Dealer "D" puck: exact seat when buttonSeat is supplied, else fall
          // back to the BTN position label so the puck shows on every felt path.
          const isButtonSeat =
            buttonSeat != null
              ? seat.seat_number === buttonSeat
              : seat.position === "BTN" || seat.position === "BTN/SB";

          const avatarBorder = seat.is_folded
            ? "border-border/30"
            : seat.is_all_in
              ? "border-red-400/70"
              : isToAct
                ? "border-[hsl(var(--poker-accent))]"
                : isLastActor
                  ? "border-[hsl(var(--poker-gold)/0.85)]"
                  : "border-[hsl(var(--poker-gold)/0.5)]";
          const avatarRing = isToAct
            ? "ring-2 ring-[hsl(var(--poker-accent)/0.55)]"
            : isLastActor
              ? "ring-1 ring-[hsl(var(--poker-gold)/0.4)]"
              : "";
          const nameShadow = { textShadow: "0 1px 3px rgba(0,0,0,0.95)" };
          // Winner identity remains server-proven; payout/rank/refund copy is kept
          // out of the felt so the verified best-five cards carry the result.
          // During payout, only the active verified pot layer receives the winner
          // halo. Once every pot has settled, best-five focus restores the final
          // verified winner set.
          const isWinner = (settlementPotResultActive && activePotWinnerIds.has(seat.player_id))
            || (bestFiveGlowActive && bestFiveFocus?.winnerPlayerIds.has(seat.player_id) === true);

          // ADDITIVE operator-console hooks. Both fragments are "" and the spread
          // is {} when the props are absent, so the default (viewer/replay) render
          // is byte-identical. The selection frame sits on the OUTER wrapper and
          // is emerald — distinct from the to-act accent ring on the avatar.
          const isSelected = selectedSeat != null && seat.seat_number === selectedSeat;
          const interactiveCls = onSeatClick ? " cursor-pointer" : "";
          const selectedCls = isSelected
            ? ` rounded-2xl ring-2 ring-emerald-400 ring-offset-2 ${
                viewerLayout ? "ring-offset-black" : "ring-offset-[hsl(var(--poker-felt-dark))]"
              } shadow-[0_0_16px_rgba(16,185,129,0.55)]`
            : "";
          const interactiveProps = onSeatClick
            ? {
                role: "button" as const,
                tabIndex: 0,
                "aria-pressed": isSelected,
                onClick: () => onSeatClick(seat.seat_number),
                onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSeatClick(seat.seat_number);
                  }
                },
              }
            : {};

          return (
            <div
              key={seat.player_id}
              data-tracker-seat={unified ? seat.seat_number : undefined}
              data-seat-selected={unified && isSelected}
              data-seat-acting={unified && isToAct}
              className={`absolute z-10 ${seat.is_folded ? "opacity-50" : ""}${tableFx ? " transition-opacity duration-300 motion-reduce:transition-none" : ""}${interactiveCls}${selectedCls}`}
              style={posStyle}
              {...interactiveProps}
            >
              <div className={`relative flex w-[58px] flex-col items-center text-center sm:w-[70px]${unified ? ' tracker-seat' : ''}`} style={podStyle}>
                {isToAct && (
                  <div
                    className="tracker-display absolute -top-2 z-20 rounded-full px-1.5 py-0.5 text-[7.5px] font-bold uppercase tracking-wide whitespace-nowrap text-white shadow"
                    style={{ background: "hsl(var(--poker-accent))", ...toActTextStyle }}
                  >
                    ◀ {t("liveHub.felt.toAct", "chờ")}
                  </div>
                )}
                <div className={unified ? 'tracker-seat-avatar' : 'relative'}>
                  <div
                    className={`grid ${viewerLayout ? "h-9 w-9 sm:h-10 sm:w-10" : "h-8 w-8 sm:h-9 sm:w-9"} place-items-center overflow-hidden rounded-full border-2 text-[9px] font-bold sm:text-[11px] ${
                      isWinner ? "tracker-win-glow border-[hsl(var(--poker-gold))]" : `${avatarBorder} ${avatarRing}`
                    }${tableFx ? " transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none" : ""}`}
                    style={{
                      background: viewerLayout ? "linear-gradient(180deg,#151922,#030407)" : "linear-gradient(180deg,#2c151b,#0b090d)",
                      color: "hsl(var(--poker-gold))",
                      ...avatarStyle,
                    }}
                  >
                    {seat.avatar_url ? (
                      <img src={seat.avatar_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      initials
                    )}
                  </div>
                  {seat.position && (
                    <span
                      className={`tracker-display absolute -top-1 -right-2 rounded-full px-1 py-px text-[7px] font-semibold uppercase leading-none ${
                        seat.position === "BTN" ? "text-black" : "text-amber-200/85"
                      }`}
                      style={
                        seat.position === "BTN"
                          ? { background: "hsl(var(--poker-gold))", ...badgeTextStyle }
                          : { background: "rgba(18,11,7,0.85)", border: "1px solid hsl(var(--poker-gold) / 0.4)", ...badgeTextStyle }
                      }
                    >
                      {seat.position}
                    </span>
                  )}
                  {isButtonSeat && (
                    <span
                      aria-label="Dealer"
                      className="tracker-display absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full text-[7px] font-black leading-none text-black shadow ring-1 ring-black/40"
                      style={{ background: "hsl(var(--poker-gold))" }}
                    >
                      D
                    </span>
                  )}
                </div>
                {viewerLayout || unified ? (
                  // V2: a CoinPoker-style "nameplate" capsule — name + stack grouped in one
                  // dark, neon-bordered pill so each seat reads as a tight unit.
                  // PR-A1 compact: the stack goes BB-FIRST (RPT pattern — meaningful at any
                  // level) with chips demoted to a smaller secondary line. formatBB null
                  // (no blind level) → chips render alone exactly as today: never a fake BB.
                  <div
                    className={`mt-1 flex max-w-full flex-col items-center rounded-md px-1.5 py-[3px] leading-none${unified ? ' tracker-seat-plate' : ''}`}
                    title={`${seat.display_name} · ${displayedStack(seat)}`}
                    style={unified ? undefined : { background: "rgba(3,5,8,0.9)", border: "1px solid hsl(var(--primary) / 0.28)", boxShadow: "0 1px 3px rgba(0,0,0,0.6)" }}
                  >
                    <div className={`tracker-display max-w-full truncate text-[10px] font-semibold leading-tight text-white sm:text-[11px]${unified ? ' tracker-seat-name' : ''}`} style={unified ? undefined : nameTextStyle}>
                      {seat.display_name}
                    </div>
                    {viewerAmountsInBB ? (
                      <div data-testid={`felt-stack-${seat.player_id}`} data-stack-target={displayedStack(seat)} className="tracker-num mt-[1px] whitespace-nowrap text-[11px] font-bold leading-none" style={{ color: "hsl(146 62% 56%)", ...bbTextStyle }}>
                        <CountUpText value={displayedStack(seat)} format={formatViewerAmount} enabled={tableFx} />
                      </div>
                    ) : compactActive && formatBB(seat.chip_count) ? (
                      <>
                        <div className="tracker-num mt-[1px] whitespace-nowrap text-[11px] font-bold leading-none" style={{ color: "hsl(146 62% 56%)", ...bbTextStyle }}>
                          <CountUpText value={displayedStack(seat)} format={(n) => formatBB(n) ?? formatStack(n)} enabled={tableFx} />
                        </div>
                        <div className="tracker-num mt-[1px] whitespace-nowrap text-[8px] font-semibold leading-none text-white/60" style={subTextStyle}>
                          <CountUpText value={displayedStack(seat)} format={formatStack} enabled={tableFx} />
                        </div>
                      </>
                    ) : (
                      <div className="tracker-num mt-[1px] text-[10px] font-bold leading-none" style={{ color: "hsl(146 62% 56%)", ...bbTextStyle }}>
                        <CountUpText value={displayedStack(seat)} format={formatStack} enabled={tableFx} />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="tracker-display mt-1 max-w-full truncate text-[10px] font-semibold leading-tight text-white sm:text-[11px]" style={nameShadow}>
                      {seat.display_name}
                    </div>
                    <div className="tracker-num text-[10px] font-bold leading-tight" style={{ color: "hsl(var(--poker-stack))", textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}>
                      {formatStack(seat.chip_count)}
                    </div>
                  </>
                )}
                {settlementPotResultActive && activePotAwardsComplete && awardArrived && activePotLayer
                  && activePotLayer.allocations.filter(a => a.playerId === seat.player_id).map(allocation => (
                    <span key={`${activePotLayer.potId}-${seat.player_id}`}
                      data-testid={`felt-settlement-award-label-${seat.player_id}`}
                      className="tracker-settlement-award-label mt-1"
                      style={{ position: "relative", zIndex: 30 }}>
                      +{formatGameplayAmount(allocation.amount)}
                    </span>
                  ))}
                {/* Committed-bet indicator. viewerLayout → an RPT-style chip STACK rendered
                    ON THE FELT (in the placement layer below the seats map), NOT a pill here.
                    Operator/TV (viewerLayout off) keep the standalone ALL IN label as today,
                    so their render is byte-identical even with current_bet now populated. */}
                {!viewerLayout && seat.is_all_in && (
                  <div className="mt-0.5 text-[8px] font-bold text-red-400" style={nameShadow}>{t("liveHub.felt.allIn", "ALL IN")}</div>
                )}
                {viewerLayout && seat.is_all_in && !seat.is_folded && !hideCommittedSeatStacks
                  && ![seat.current_bet,seat.display_committed_bet].some(value=>typeof value==='number'&&Number.isFinite(value)&&value>0) && (
                  <div data-testid={`felt-all-in-status-${seat.player_id}`}
                    className="mt-0.5 max-w-full text-[8px] font-bold text-red-400"
                    title={t('liveHub.felt.sweptAllIn','Tổng chip đã cược trong hand; đã gom vào pot')}
                    style={nameShadow}>
                    {t("liveHub.felt.allIn", "ALL IN")}
                    {typeof seat.total_committed==='number'&&Number.isFinite(seat.total_committed)&&seat.total_committed>0
                      ? ` · ${formatGameplayAmount(seat.total_committed)}` : ''}
                  </div>
                )}
                {seat.is_folded && <div className="mt-0.5 text-[8px] text-zinc-300" style={nameShadow}>{t("liveHub.felt.folded", "FOLDED")}</div>}
                {!seat.is_folded && !seat.is_all_in && seat.last_action && (
                  <div className="mt-0.5 max-w-full truncate text-[8px] text-amber-300/90" style={nameShadow}>
                    {viewerAmountsInBB && seat.last_action_type && seat.last_action_amount != null
                      ? formatActionLabel({
                          street: "",
                          player_id: seat.player_id,
                          display_name: seat.display_name,
                          seat_number: seat.seat_number,
                          action_type: seat.last_action_type,
                          action_amount: seat.last_action_amount,
                          action_order: 0,
                        }, formatViewerAmount)
                      : seat.last_action}
                  </div>
                )}
                {/* Compact: face-DOWN backs are dropped entirely (RPT pods carry no cards
                    until a reveal) — the short felt can't afford the extra pod height.
                    Revealed cards (showdown/all-in) still render. Non-compact unchanged. */}
                {!seat.is_folded && (!hideUnrecordedHoleCards || (seat.hole_cards && seat.hole_cards.length === 2)) && (unified || !compactActive || (seat.hole_cards && seat.hole_cards.length === 2)) && (
                <div
                  data-testid="seat-holecards"
                  className={`mt-0.5 flex justify-center gap-0.5${unified ? ' tracker-seat-cards' : ''}`}
                >
                  {seat.hole_cards && seat.hole_cards.length === 2 ? (
                    // trackerShowdownRevealOrder: stagger the flip by this seat's place
                    // in the reveal order (index * revealStaggerMs added to the existing
                    // tracker-card-reveal pop). revealOrder absent → delay undefined →
                    // today's simultaneous reveal (byte-identical). Reduced-motion kills
                    // the animation entirely (CSS), so the delay is moot for a11y.
                    seat.hole_cards.map((card, ci) => {
                      const focusClass = cardFocusClass(card, bestFiveFocus?.holeCardCodesByPlayerId.get(seat.player_id));
                      const viewerClass = viewerLayout ? "drop-shadow-[0_2px_5px_rgba(0,0,0,0.65)]" : "";
                      return (
                        <PokerCard
                          key={ci}
                          card={card}
                          size="xs"
                          className={[viewerClass, focusClass].filter(Boolean).join(" ") || undefined}
                          muted={seat.is_folded}
                          style={{ ...holeStyle, ...revealDelayStyle(seat.player_id) }}
                        />
                      );
                    })
                  ) : (
                    [0, 1].map((ci) => <CardBack key={ci} size="xs" muted={seat.is_folded} style={holeStyle} />)
                  )}
                </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Verified payout presentation. Committed chips converge first, then the
            server-projected Main Pot and each Side Pot leave the center in order.
            This branch is viewer-replay-only and never changes a chip value. */}
        {(settlementPayoutSequenceActive || livePotCollectionActive || settlementPotResultActive) && (
          <div data-testid="felt-settlement-payout-motion" className="pointer-events-none absolute inset-0 z-[24] overflow-visible" aria-hidden="true">
            {(settlementPayoutPhase === "pot_collect" || livePotCollectionActive) && committedSeatStacks.map(({ seat, amount, point }) => (
              <div
                key={`collect-stack-${seat.player_id}`}
                data-testid="felt-settlement-collect-stack"
                className="tracker-settlement-stack-collect absolute"
                style={{
                  left: `${point.l}%`,
                  top: `${point.t}%`,
                  "--sp-dx": `${50 - point.l}cqi`,
                  "--sp-dy": `${(settlementPotPoint(0, 1).t - point.t) / motionAspect}cqi`,
                } as CSSProperties}
              >
                <ChipStack label={formatGameplayAmount(amount)} allIn={seat.is_all_in} sizeStyle={stackStyle} />
              </div>
            ))}

            {(settlementPayoutPhase === "pot_collect" || livePotCollectionActive) && (
              <div
                data-testid="felt-settlement-collect-center"
                className={`absolute -translate-x-1/2${portrait ? " -translate-y-1/2" : ""}`}
                style={{ left: "50%", top: `${settlementPotPoint(0, 1).t}%`, marginTop: settlementPotMarginTop }}
              >
                <CenterPotStack compact label={`${t("liveHub.felt.pot", "POT").toUpperCase()} ${formatGameplayAmount(displayPot)}`} />
              </div>
            )}

            {(settlementPayoutPhase === "pot_collect" ? [] : visibleSettlementPotLayers).map((pot, visibleIndex) => {
              const point = settlementPotPoint(visibleIndex, visibleSettlementPotLayers.length);
              const isAwardingPot = settlementPayoutPhase === "pot_award" && visibleIndex === 0;
              return (
                <div
                  key={pot.potId}
                  data-testid={`felt-settlement-pot-${pot.kind}-${visibleIndex}`}
                  // On a scaled landscape felt, half the fixed-height chip pile
                  // used to rise over the five-card board. Grow downward from
                  // the existing below-board anchor; portrait keeps its spacing.
                  className={`absolute -translate-x-1/2${portrait ? " -translate-y-1/2" : ""}`}
                  style={{ left: `${point.l}%`, top: `${point.t}%`, marginTop: settlementPotMarginTop }}
                >
                  <CenterPotStack compact
                    label={`${pot.kind === "main" ? t("liveHub.felt.main", "Main") : t("liveHub.felt.side", "Side {{i}}", { i: activePotLayerIndex })} ${formatGameplayAmount(pot.amount)}`}
                  />
                  {isAwardingPot && activePotAwardsComplete && activePotAwardRows.flatMap(({ allocation, seat }, allocationIndex) => {
                    const slot = ((seat.seat_number - 1) % 9) + 1;
                    const target = stackPt(seatMap[slot] || seatMap[1]);
                    return [0, 1, 2].map((chip) => (
                      <span
                        key={`${pot.potId}-${allocation.playerId}-${chip}`}
                        data-testid={`felt-settlement-award-${allocation.playerId}`}
                        className="tracker-settlement-chip tracker-settlement-chip-award"
                        style={{
                          left: "50%",
                          top: "0%",
                          "--sp-dx": `${target.l - point.l}cqi`,
                          "--sp-dy": `${(target.t - point.t) / motionAspect}cqi`,
                          animationDelay: `${allocationIndex * 55 + chip * 22}ms`,
                        } as CSSProperties}
                      />
                    ));
                  })}
                </div>
              );
            })}


          </div>
        )}

        {settlementPotResultActive && activePotAwardsComplete && activePotLayer && (
          <section
            data-testid="felt-settlement-award-announcement"
            className={portrait ? "sr-only" : "tracker-settlement-award-announcement pointer-events-none absolute z-[25] -translate-x-1/2 -translate-y-1/2"}
            style={{ left: "50%", top: `${Math.max(13, potCenterT - (portrait ? 19 : 17))}%` }}
            role="status"
            aria-live="polite"
          >
            <div className="tracker-settlement-award-title">
              {activePotLayer.kind === "main"
                ? t("liveHub.felt.mainPot", "Main Pot")
                : t("liveHub.felt.sidePot", "Side Pot")}
            </div>
            <div className="tracker-settlement-award-recipients">
              {activePotAwardRows.map(({ allocation, winner }) => {
                const awardBB = formatBB(allocation.amount);
                return (
                  <div
                    key={`award-announcement-${activePotLayer.potId}-${allocation.playerId}`}
                    data-testid={`felt-settlement-award-recipient-${allocation.playerId}`}
                    className="tracker-settlement-award-recipient"
                  >
                    <span className="truncate">{winner.playerName}</span>
                    <span className="tracker-num whitespace-nowrap">+{viewerAmountsInBB ? awardBB ?? "— BB" : `${formatStack(allocation.amount)}${awardBB ? ` (${awardBB})` : ""}`}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Committed-bet CHIP STACKS on the felt (viewerLayout only). A pointer-events-none
            layer placed in front of each betting/all-in seat, toward the pot (collision-guarded
            stackPt). Operator/TV never render this → byte-identical. z-[15]: above the felt,
            below the to-act badge (z-20) and the flying chip-push (z-[25]). */}
        {viewerLayout && !hideCommittedSeatStacks &&
          committedSeatStacks
            .map(({ seat: s, amount: amt, point: pt }) => {
              // Position only the unswept street contribution. The separate ALL-IN
              // status above retains whole-hand information without duplicating chips.
              // UAT wave 2 (Fix 3, compact only): the ALL-IN pill prefers the seat's
              // WHOLE-HAND committed total (survives street sweeps), and — RPT style —
              // shows the AMOUNT ALONE on the red pill: the red stack already signals
              // all-in, and the wide "ALL IN 29.9M" labels collided on 9-max bottom
              // rows at 390px. Non-compact keeps today's exact label logic.
              const allInAmt = compactActive ? (s.total_committed ?? amt) : amt;
              const label = s.is_all_in
                ? allInAmt > 0
                  ? compactActive
                    ? formatGameplayAmount(allInAmt)
                    : `${t("liveHub.felt.allIn", "ALL IN")} ${formatGameplayAmount(allInAmt)}`
                  : t("liveHub.felt.allIn", "ALL IN")
                : formatGameplayAmount(amt);
              return (
                <div
                  key={`stack-${s.player_id}-${s.is_all_in ? "allin" : amt}`}
                  data-tracker-bet={unified ? s.seat_number : undefined}
                  className="pointer-events-none absolute z-[15] -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${pt.l}%`, top: `${pt.t}%` }}
                >
                  <ChipStack label={label} allIn={s.is_all_in} sizeStyle={stackStyle} />
                </div>
              );
            })}

        {/* P2-5 ADDITIVE: empty physical seats (only when physicalSeats is supplied —
            absent for the public viewer/replay/TV, so their render is byte-identical).
            A dead button shows its "D" puck here; an operator tap sets the button. */}
        {physicalSeats != null &&
          Array.from({ length: physicalSeats }, (_, i) => i + 1)
            .filter((n) => !seats.some((s) => s.seat_number === n))
            .map((n) => {
              const slot = ((n - 1) % 9) + 1;
              const pos = seatMap[slot] || seatMap[1];
              const posStyle: CSSProperties = { left: `${pos.l}%`, top: `${pos.t}%`, transform: "translate(-50%, -50%)" };
              const isButtonSeat = buttonSeat != null && buttonSeat === n;
              const tap = onSeatClick;
              return (
                <div
                  key={`empty-${n}`}
                  data-tracker-seat={unified ? n : undefined}
                  className={`absolute z-10 flex flex-col items-center opacity-60${unified ? ' min-h-11 min-w-11' : ''}${tap ? " cursor-pointer" : ""}`}
                  style={posStyle}
                  {...(tap
                    ? {
                        role: "button" as const,
                        tabIndex: 0,
                        onClick: () => tap(n),
                        onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            tap(n);
                          }
                        },
                      }
                    : {})}
                >
                  <div className="relative grid h-9 w-9 place-items-center rounded-full border border-dashed border-white/25 bg-black/20 text-[9px] font-bold text-white/45 sm:h-10 sm:w-10">
                    {n}
                    {isButtonSeat && (
                      <span
                        aria-label="Dealer (dead button)"
                        className="tracker-display absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full text-[7px] font-black leading-none text-black shadow ring-1 ring-black/40"
                        style={{ background: "hsl(var(--poker-gold))" }}
                      >
                        D
                      </span>
                    )}
                  </div>
                  <div className="tracker-display mt-1 text-[9px] font-medium text-white/40">{t("liveHub.felt.emptySeat", "Trống")}</div>
                </div>
              );
            })}

        {/* liveTableFx chip-push layer — transient gold chips flying seat→pot. */}
        {chips.length > 0 && (
          <div className="pointer-events-none absolute inset-0 z-[25] overflow-visible" aria-hidden="true">
            {chips.map((c) => (
              <span
                key={c.id}
                className="tracker-chip-push"
                onAnimationEnd={() => setChips((cs) => cs.filter((x) => x.id !== c.id))}
                style={
                  {
                    "--cp-fx": c.fx,
                    "--cp-fy": c.fy,
                    "--cp-tx": "50%",
                    "--cp-ty": geo.centerTop,
                    // Action color (all_in=red, call=green, blinds=amber, bet/raise=gold).
                    // Omitted when undefined → the .tracker-chip-push CSS default (gold) fires.
                    ...(c.color ? { "--chip-color": c.color } : {}),
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}

        <TableMotionLayer
          enabled={motionEnabled && viewerLayout}
          handKey={motionHandKey}
          events={motionEvents}
          seatPositions={seatMap}
          potPosition={{ l: 50, t: potCenterT }}
          aspectRatio={motionAspect}
          speed={motionSpeed}
        />

        {multiTableUnresolved && (
          <div className="absolute inset-0 z-30 flex items-center justify-center">
            <div className="rounded-lg bg-black/45 px-6 py-3 text-center text-sm text-zinc-200 backdrop-blur-sm">
              {t("liveHub.felt.multiTable", "Giải có nhiều bàn — chọn bàn ở trên để xem live.")}
            </div>
          </div>
        )}

        {!multiTableUnresolved && !handNumber && (
          <div className="absolute inset-0 z-30 flex items-center justify-center">
            <div className="rounded-lg bg-black/45 px-6 py-3 text-sm text-zinc-200 backdrop-blur-sm">
              {t("liveHub.felt.waiting", "Chờ dealer bắt đầu hand...")}
            </div>
          </div>
        )}
      </div>
      </div>

      {/* PR-A1 compact: persistent status bar docked right under the oval (RPT pattern).
          compactActive-gated → operator/TV/replay-without-flag emit nothing new. */}
      {compactActive && (
        <FeltStatusBar
          blinds={blinds}
          toActName={
            toActId ? seats.find((s) => s.player_id === toActId)?.display_name ?? null : null
          }
          potSize={displayPot}
          formatBB={formatBB}
          viewerAmountsInBB={viewerAmountsInBB}
          runout={runout}
        />
      )}

      {compactActive && showdownResult && (
        <div
          data-testid="felt-showdown-result"
          className={`mx-auto mt-1.5 w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
            showdownResult === "chop"
              ? "border-[hsl(var(--viewer-neon)_/_0.55)] bg-[hsl(var(--viewer-neon)_/_0.12)] text-[hsl(var(--viewer-neon))]"
              : showdownResult === "needs_resettle"
                ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                : "border-[hsl(var(--poker-gold)_/_0.5)] bg-[hsl(var(--poker-gold)_/_0.1)] text-[hsl(var(--poker-gold))]"
          }`}
        >
          {showdownResult === "chop"
            ? t("liveHub.felt.chopPot", "Chop pot")
            : showdownResult === "needs_resettle"
              ? t("liveHub.felt.needsResettle", "Cần tính lại kết quả")
              : t("liveHub.felt.showdown", "Showdown")}
        </div>
      )}

      {/* Action rail — OUTSIDE the felt so it never collides with the table. */}
      {latestAction && (
        <div className="mt-2.5 px-2">
          <div className="tracker-display mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-amber-500/30 bg-black/65 px-3.5 py-1.5 text-xs">
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-amber-400/80">{t("liveHub.felt.action", "Hành động")}</span>
            <span className="truncate text-amber-100">
              {latestAction.seat_number > 0 && <span className="text-amber-300/70">{t("liveHub.seat", "Ghế {{n}}", { n: latestAction.seat_number })} · </span>}
              <span className="font-semibold text-emerald-300">{latestAction.display_name}</span>{" "}
              <span className="tracker-num">{formatActionLabel(latestAction, formatGameplayAmount)}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
