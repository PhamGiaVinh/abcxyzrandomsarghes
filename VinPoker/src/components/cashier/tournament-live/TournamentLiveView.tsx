import { useTournamentTableAppearance } from "@/components/tracker/useTournamentTableAppearance";
import { useState, useEffect, useMemo, useRef, useCallback, type ComponentProps } from "react";
import { TrackerViewerCardProvider, TrackerCardStyleToggle } from "@/components/tracker/TrackerCardStyle";
import { FEATURES } from "@/lib/featureFlags";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Users, Coins, Clock, Layers, WifiOff, RefreshCw, AlertTriangle, Volume2, VolumeX, Bot, Radio, History } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { displayCard } from "@/components/shared/CardSlotPicker";
import { getSeatPositions } from "@/lib/tournament/button";
import { useAuth } from "@/hooks/useAuth";
import { parseTournamentParticipation, parseParticipationSummary } from "@/lib/tournamentParticipation";
import { TdAiAssistantPanel } from "@/components/td-ai/TdAiAssistantPanel";
import { TrackerVisualStyles } from "./PokerVisuals";
import { useTrackerRunoutSounds } from "@/lib/tracker-poker/useTrackerRunoutSounds";
import { markPokerSoundGesture, playPokerLiveSound, stopTrackerPokerSounds, type PokerLiveSound } from "@/lib/pokerLiveSound";
import {
  streetContribution,
  type PotBreakdown,
} from "@/lib/tracker-poker/potEngine";
import { nextToAct } from "@/lib/tracker-poker/handFlow";
import { showdownRevealOrder } from "@/lib/tracker-poker/trackerEngine";
import {
  LiveFelt,
  formatStack,
  formatActionLabel,
  type SeatInfo,
  type ActionLog,
} from "./LiveFelt";
import { ReplayScrubber, type ReplayFrameSource } from "./ReplayScrubber";
import { HandSelector } from "./HandSelector";
import { HandBreakdown } from "./viewer-hub/HandBreakdown";
import { ReplayLiveBanner } from "./ReplayLiveBanner";
import {
  buildReplayFrames,
  detectBigBlind,
  type ReplayHand,
  type ReplayFrame,
} from "@/lib/tracker-poker/replayEngine";
import { parseReplayPublicSettlement } from "@/lib/tracker-poker/replaySettlement";
import {
  createReplayActionFxScheduler,
  deriveReplayPlaybackFx,
  replayActionSoundDelayMs,
} from "@/lib/tracker-poker/replayFx";
import {
  resolveVerifiedPayoutPresentation,
  selectVerifiedPotLayerPresentation,
} from "@/lib/tracker-poker/replayBestFiveFocus";
import {
  replayRunoutFocusPhase,
  createReplayRunoutPresentation,
  nextReplayRunoutPresentation,
  replayRunoutPhaseDuration,
  type ReplayRunoutPresentation,
} from "@/lib/tracker-poker/replayRunoutTimeline";
import { deriveLiveHandDisplay } from "@/lib/tracker-poker/liveDisplay";
import {
  appendTableMotionEvents,
  deriveReplayTableMotionEvents,
  type TableMotionEvent,
} from "@/lib/tracker-poker/tableMotion";
import { shouldCollectCommittedChips } from "@/lib/tracker-poker/livePotCollection";
import { formatViewerBB, formatViewerChipAndBB, formatViewerChipCompact, resolveViewerHandBigBlind } from "@/lib/tracker-poker/viewerAmounts";
import { fetchHandPlayerDisplay, handPlayersHasSnapshot } from "@/lib/tracker-poker/handPlayerNames";
import { loadLatestLiveHand } from "./loadLatestLiveHand";
import { resolveViewerIdentity } from "./viewer-hub/viewerIdentity";
import { resolveReplayCandidates, type ReplayTarget, type ReplayTargetState } from "./viewer-hub/replayTarget";
import { deriveReplayHeaderMetadata } from "./viewer-hub/replayMetadata";
import { PublicSnapshotCoordinator } from "./viewer-hub/publicSnapshotCoordinator";
import { parsePublicTableCurrentResponse } from "./viewer-hub/publicTableHistory";
import { loadPublicCurrentTable } from "./viewer-hub/loadPublicCurrentTable";
import { TableHistoryPanel } from "./viewer-hub/TableHistoryPanel";

const SOUND_KINDS = new Set<string>([
  "fold", "check", "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante",
]);

// Actions that push chips into the pot — get a chip-clink layer + the chip-push
// animation (liveTableFx only). Excludes fold/check.
const CHIP_ACTIONS = new Set<string>(["call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante"]);

const SOUND_MUTE_KEY = "tracker_sound_muted";

type RealtimeStatus = "connecting" | "online" | "offline";

type LiveHandPlayerRow = {
  player_id: string;
  seat_number: number;
  starting_stack: number | null;
  ending_stack: number | null;
  hole_cards: string[] | null;
  player_name?: string | null;
  avatar_url?: string | null;
};

type LiveHandActionRow = {
  id: string;
  street: string | null;
  player_id: string;
  action_type: string;
  action_amount: number | null;
  action_order: number;
};

type PublicHandResponse = {
  id?: string;
  tableId?: string | null;
  tableSessionId?: string | null;
  handNumber?: number | null;
  buttonSeat?: number | null;
  status?: string | null;
  board?: string[];
  pot?: number | null;
  bigBlind?: number | null;
  smallBlind?: number | null;
  levelNumber?: number | null;
  ante?: number | null;
  actions?: Array<{ id: string; playerId: string; entryNumber: number; street: string | null; actionType: string; amount: number | null; order: number }>;
  players?: Array<{ playerId: string; entryNumber: number; seatNumber: number; startingStack: number | null; endingStack: number | null; name: string; avatarUrl: string | null; holeCards: string[] }>;
};
type HandSource = PublicHandResponse & { hand_number?: number | null; table_id?: string | null; button_seat?: number | null; community_cards?: string[] | null; pot_size?: number | null; tracker_big_blind?: number | null; tracker_small_blind?: number | null; tracker_bba?: number | null; tracker_level_number?: number | null };
type PublicHandCatalogResponse = { access?: string; items?: Array<{ id: string; tableId: string | null; handNumber: number; status?: string | null; isVoided?: boolean | null }> };

const STREET_ORDER = ["preflop", "flop", "turn", "river"];
const STREET_LABELS: Record<string, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

const POLL_INTERVAL_MS = 30_000;
// Live Action Engine MVP: faster refresh cadence while a hand is in progress
// (flag-gated). Slow enough to stay cheap, fast enough to feel live.
const LIVE_ACTION_POLL_MS = 2_500;

function formatClockTime(d: Date): string {
  return d.toLocaleTimeString("vi-VN", { hour12: false });
}

export function TournamentLiveView(props: ComponentProps<typeof TournamentLiveViewContent>) {
  return <TrackerViewerCardProvider><TournamentLiveViewContent {...props} /></TrackerViewerCardProvider>;
}

function TournamentLiveViewContent({
  tournamentId,
  orientationOverride = null,
  spectator = false,
  selectedTableIdOverride = null,
  initialReplayTarget = null,
  initialReplayHandNumber = null,
  initialTablePanel = "felt",
  onReplayTargetChange,
}: {
  tournamentId: string;
  /** Presentational only: force the felt orientation (set by the viewer hub's
      Ngang/Dọc toggle). null → auto by device (existing behaviour). Does NOT
      affect any data path; operator callers omit it and are unchanged. */
  orientationOverride?: "landscape" | "portrait" | null;
  /** Presentational only: public spectator view (set by the viewer hub). Hides
      operator-only chrome (realtime/debug banners, TD-AI, LIVE/Replay toggle,
      the right action-timeline + table-stats sidebar). Operator callers omit it
      → false → all chrome shown, unchanged. No data-path change. */
  spectator?: boolean;
  /** Presentational only: the table the viewer hub's table-map picked (public
      view). When set + valid it wins over the internal selector so the featured
      felt shows that table. Operator callers omit it → null → existing behaviour. */
  selectedTableIdOverride?: string | null;
  /** Canonical replay target. UUID is authoritative; hand number is legacy only. */
  initialReplayTarget?: ReplayTarget | null;
  /** Deprecated compatibility prop for callers that still provide `?hand=N`. */
  initialReplayHandNumber?: number | null;
  /** History is a child panel of one table, never a fifth event-level tab. */
  initialTablePanel?: "felt" | "history";
  onReplayTargetChange?: (target: ReplayTarget) => void;
}) {
  const { t, i18n } = useTranslation();
  const { user, isStaffOps, isClubAdmin } = useAuth();
  const [historyReplayTarget, setHistoryReplayTarget] = useState<ReplayTarget | null>(null);
  const requestedReplayTarget = useMemo<ReplayTarget | null>(() => {
    if (initialReplayTarget) return initialReplayTarget;
    if (historyReplayTarget) return historyReplayTarget;
    return initialReplayHandNumber != null
      ? { handId: null, tableId: null, handNumber: initialReplayHandNumber }
      : null;
  }, [
    initialReplayTarget,
    initialReplayHandNumber, historyReplayTarget,
  ]);
  const canTdAi = isStaffOps || isClubAdmin;
  const [tdAiOpen, setTdAiOpen] = useState(false);
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const [communityCards, setCommunityCards] = useState<string[]>([]);
  const [potSize, setPotSize] = useState(0);
  const [potBreakdown, setPotBreakdown] = useState<PotBreakdown | null>(null);
  const [handNumber, setHandNumber] = useState<number | null>(null);
  const [handId, setHandId] = useState<string | null>(null);
  const [handTableId, setHandTableId] = useState<string | null>(null);
  const [buttonSeat, setButtonSeat] = useState(1);
  const [actions, setActions] = useState<ActionLog[]>([]);
  const [tableMotionEvents, setTableMotionEvents] = useState<TableMotionEvent[]>([]);
  const [replayMotionSpeed, setReplayMotionSpeed] = useState(1);
  const [clockData, setClockData] = useState<{
    is_running: boolean;
    remaining_seconds: number;
    current_level: number | null;
    small_blind: number;
    big_blind: number;
    ante: number;
  } | null>(null);
  const appearance = useTournamentTableAppearance(tournamentId);
  const [liveHandBlinds, setLiveHandBlinds] = useState<{ sb: number; bb: number; ante: number; level?: number | null } | null>(null);
  const [handPotMissing, setHandPotMissing] = useState(false);
  const [liveHandBigBlind, setLiveHandBigBlind] = useState(0);
  const [playersRemaining, setPlayersRemaining] = useState(0);
  const [averageStack, setAverageStack] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [softErrorAt, setSoftErrorAt] = useState<Date | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  // Live Action Engine MVP: true while the latest hand is in_progress (drives the
  // flag-gated fast-poll so spectators see each action live).
  const [handInProgress, setHandInProgress] = useState(false);
  // Live Action Engine inc2: the player whose turn it is to act (flag-gated
  // spotlight). null when the flag is off / no live hand.
  const [toActId, setToActId] = useState<string | null>(null);
  // UAT wave 2 (R1): the live hand is an all-in runout (betting closed) — drives the
  // compact status bar's "Đang chạy board" segment instead of a stale to-act name.
  const [liveRunout, setLiveRunout] = useState(false);
  const [liveBettingRoundComplete, setLiveBettingRoundComplete] = useState(false);
  const [liveCompletedHand, setLiveCompletedHand] = useState<ReplayHand | null>(null);
  const [livePayout, setLivePayout] = useState<ReplayRunoutPresentation | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const liveTableScope = selectedTableIdOverride ?? selectedTableId;
  const [tableNames, setTableNames] = useState<Record<string, string>>({});
  const [localRemaining, setLocalRemaining] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [soundMuted, setSoundMuted] = useState(() => {
    try {
      return localStorage.getItem(SOUND_MUTE_KEY) === "1";
    } catch {
      return true;
    }
  });
  // ----- Replay mode (T2b) — frozen snapshot over the live machinery -----
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [tablePanel, setTablePanel] = useState<"felt" | "history">(initialTablePanel);
  const [tableDisplayState, setTableDisplayState] = useState<"live" | "last_completed" | "waiting" | "inactive" | "closed" | null>(null);
  const [tableSessionId, setTableSessionId] = useState<string | null>(null);
  const [replayHandId, setReplayHandId] = useState<string | null>(null);
  const [replayHand, setReplayHand] = useState<ReplayHand | null>(null);
  const [replayFrameState, setReplayFrameState] = useState<{
    handKey: string;
    frame: ReplayFrame;
  } | null>(null);
  const [replayFrameSource, setReplayFrameSource] = useState<ReplayFrameSource>("jump");
  const [replayRunoutPresentation, setReplayRunoutPresentation] = useState<ReplayRunoutPresentation | null>(null);
  const [replayMotionEpoch, setReplayMotionEpoch] = useState(0);
  const [replaySelectedPotIndex, setReplaySelectedPotIndex] = useState(0);
  const [replayTargetState, setReplayTargetState] = useState<ReplayTargetState>({ kind: "idle" });
  // Snapshot of the LIVE table the moment replay was entered. The live machinery
  // keeps advancing in the background while the felt is frozen on the replay frame;
  // comparing against this baseline tells us when to surface "live đã có diễn biến
  // mới" so the spectator can jump back instead of silently falling behind.
  const [liveBaseline, setLiveBaseline] = useState<
    { handNumber: number | null; actionCount: number; boardCount: number } | null
  >(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const requestSeqRef = useRef(0);
  const readScope = `${user?.id ?? "anonymous"}:${tournamentId}:${liveTableScope ?? ""}:${spectator}`;
  const readScopeRef = useRef(readScope);
  readScopeRef.current = readScope;
  const initialLoadedRef = useRef(false);
  const pollingRef = useRef<number | null>(null);
  const zeroRefetchDoneRef = useRef(false);
  const prevActionCountRef = useRef<number | null>(null);
  const prevBoardCountRef = useRef<number | null>(null);
  // liveTableFx chip-push (viewer only): identity nonce so the first action of a
  // NEW hand still fires even though actions.length resets per hand (P2-2).
  const [chipPush, setChipPush] = useState<{ seatNumber: number; nonce: number; kind?: string } | null>(null);
  const lastChipNonceRef = useRef<number | null>(null);
  // liveTableFx replay playback FX: forward-only tracker (frame index + board count)
  // so PLAYING a hand back emits the same sounds + chip-push; scrubbing back is silent.
  const replayFxRef = useRef<{ index: number | null; board: number; revealed: boolean }>({ index: null, board: 0, revealed: false });
  const replayFxPlaybackStateRef = useRef({ soundMuted, spectator, replayMotionSpeed });
  replayFxPlaybackStateRef.current = { soundMuted, spectator, replayMotionSpeed };
  const replayActionFxSchedulerRef = useRef<ReturnType<typeof createReplayActionFxScheduler> | null>(null);
  if (!replayActionFxSchedulerRef.current) {
    replayActionFxSchedulerRef.current = createReplayActionFxScheduler();
  }
  const replayChipSeqRef = useRef(0);
  const replayMotionFrameRef = useRef<ReplayFrame | null>(null);
  const previousLiveHandRef = useRef<string | null>(null);
  const liveHandBlindRef = useRef<{ handId: string; bigBlind: number } | null>(null);
  const observedLiveHandRef = useRef<string | null>(null);
  const liveAwardedHandRef = useRef<string | null>(null);

  const enqueueTableMotion = useCallback((events: TableMotionEvent[]) => {
    if (events.length > 0) setTableMotionEvents((current) => appendTableMotionEvents(current, events));
  }, []);

  useEffect(() => () => replayActionFxSchedulerRef.current?.cancel(), []);

  const loadedReplayHandKey = replayHand
    ? replayHand.hand_id ?? `hand-${replayHand.hand_number}`
    : null;
  const replayFrame = loadedReplayHandKey && replayFrameState?.handKey === loadedReplayHandKey
    ? replayFrameState.frame
    : null;
  const handleReplayFrame = useCallback((handKey: string, frame: ReplayFrame, source: ReplayFrameSource) => {
    setReplayFrameState({ handKey, frame });
    setReplayFrameSource(source);
    if (source !== "playback") setReplayMotionEpoch((current) => current + 1);
  }, []);

  const loadAllData = useCallback(async () => {
    if (readScopeRef.current !== readScope) return;
    const seq = ++requestSeqRef.current;
    const currentRequest = () => seq === requestSeqRef.current && readScopeRef.current === readScope;
    const usePublicCurrentHand = spectator && FEATURES.publicSpectatorRealtimeV2;

    const [currentHandRes, seatsRes, handsRes, clockRes, tournamentRes] = await Promise.all([
      usePublicCurrentHand
        ? loadPublicCurrentTable((name, args) => (supabase.rpc as any)(name, args), tournamentId, liveTableScope, FEATURES.publicSpectatorLastHandHistory)
        : Promise.resolve({ data: null, error: null }),
      usePublicCurrentHand ? Promise.resolve({ data: null, error: null }) : (supabase.rpc as any)(
        "get_tournament_participation_v1", { p_tournament_id: tournamentId }),
      usePublicCurrentHand ? Promise.resolve({ data: [], error: null }) : loadLatestLiveHand(tournamentId, liveTableScope),
      supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId }),
      usePublicCurrentHand
        ? supabase.from("tournaments").select("players_remaining, average_stack").eq("id", tournamentId).single()
        : (supabase.rpc as any)("get_tournament_participation_counts_v1", { p_tournament_id: tournamentId }),
    ]);

    if (!currentRequest()) return;

    // Two-tier error handling: clock RPC errors are non-fatal (clock may be unconfigured).
    const coreError = currentHandRes.error || seatsRes.error || handsRes.error || tournamentRes.error;
    if (coreError) {
      if (!initialLoadedRef.current) {
        setFatalError(coreError.message);
        setLoading(false);
      } else {
        setSoftErrorAt(new Date());
      }
      return;
    }

    const currentResponse = usePublicCurrentHand ? parsePublicTableCurrentResponse(currentHandRes.data) : null;
    if (usePublicCurrentHand && (!currentResponse || currentResponse.access === "revoked")) {
      if (!initialLoadedRef.current) {
        setFatalError("Bàn này không còn được công khai.");
        setLoading(false);
      } else {
        setSoftErrorAt(new Date());
      }
      return;
    }
    const currentHand = currentResponse?.hand as PublicHandResponse | null | undefined;
    const currentState = currentResponse?.state ?? null;
    // Do not put a hand from an old request/session into this viewer. The public
    // current RPC has already matched the canonical table + active session.
    const sourceHands: HandSource[] = usePublicCurrentHand && currentState && currentState !== "waiting" && currentState !== "inactive" && currentState !== "closed" && currentHand
      ? [currentHand]
      : (handsRes.data ?? []) as HandSource[];
    let seatRows: any[] = [];
    let participationSummary: ReturnType<typeof parseParticipationSummary> | null = null;
    if (!usePublicCurrentHand) {
      try {
        const projection = parseTournamentParticipation(seatsRes.data, tournamentId);
        participationSummary = parseParticipationSummary(tournamentRes.data, tournamentId);
        seatRows = projection.seats.filter((seat) => seat.participation_status === "seated");
      } catch (error) {
        if (!initialLoadedRef.current) {
          setFatalError(error instanceof Error ? error.message : "invalid_participation_response");
          setLoading(false);
        } else setSoftErrorAt(new Date());
        return;
      }
    }
    let seatInfos: SeatInfo[] = seatRows.map((s: any) => ({
      player_id: s.player_id,
      display_name: s.player_name || s.player_id.slice(0, 6),
      seat_number: s.seat_number,
      chip_count: s.chip_count,
      is_active: s.is_active,
      table_id: s.table_id ?? null,
      position: "",
      // trackerSeatSetup: operator-set per-seat avatar (undefined when flag off).
      avatar_url: FEATURES.trackerSeatSetup ? (s as any).avatar_url ?? null : null,
    }));

    // Avatars for everyone seated (display_name keeps the operator-entered player_name).
    // Priority: operator-set seat avatar wins over the player's profile pic; a walk-in
    // with no profile uses the seat avatar (or initials).
    if (seatInfos.length > 0) {
      const seatPlayerIds = [...new Set(seatInfos.map((s) => s.player_id))];
      const { data: seatProfiles } = await supabase
        .from("profiles")
        .select("user_id, avatar_url")
        .in("user_id", seatPlayerIds);

      if (!currentRequest()) return;

      const avatarMap = new Map<string, string | null>();
      (seatProfiles || []).forEach((p: any) => avatarMap.set(p.user_id, p.avatar_url ?? null));
      seatInfos = seatInfos.map((s) => ({ ...s, avatar_url: s.avatar_url ?? avatarMap.get(s.player_id) ?? null }));
    }

    let nextHandNumber: number | null = null;
    let nextHandId: string | null = null;
    let nextHandTableId: string | null = null;
    let nextButtonSeat = 1;
    let sourceHandBigBlind = 0;
    let nextHandBlinds: typeof liveHandBlinds = null;
    let nextHandPotMissing = false;
    let nextCommunity: string[] = [];
    let nextPot = 0;
    let nextActions: ActionLog[] = [];
    let nextBreakdown: PotBreakdown | null = null;
    let nextInProgress = false;
    let liveToActId: string | null = null;
    let nextRunout = false;
    let nextBettingRoundComplete = false;
    let nextStartingStacks = new Map<string, number>();
    let nextLiveCompletedHand: ReplayHand | null = null;

    if (sourceHands.length > 0) {
      const hand = sourceHands[0];
      nextHandId = hand.id;
      sourceHandBigBlind = hand.tracker_big_blind ?? 0;
      if (sourceHandBigBlind > 0 && hand.tracker_small_blind != null) nextHandBlinds = { sb: hand.tracker_small_blind, bb: sourceHandBigBlind, ante: hand.tracker_bba ?? 0, level: hand.tracker_level_number };
      nextHandNumber = hand.handNumber ?? hand.hand_number;
      nextHandTableId = hand.tableId ?? hand.table_id ?? liveTableScope ?? null;
      nextButtonSeat = hand.buttonSeat ?? hand.button_seat ?? 1;
      nextCommunity = (hand.board ?? hand.community_cards as string[]) || [];
      nextPot = hand.pot ?? hand.pot_size ?? 0;
      nextHandPotMissing = hand.pot == null && hand.pot_size == null;
      nextInProgress = usePublicCurrentHand ? currentState === "live" : hand.status === "in_progress";

      let actionData: LiveHandActionRow[] | null = null;
      let handPlayers: LiveHandPlayerRow[] | null = null;
      let hasIdentitySnapshot = false;
      if (spectator && FEATURES.publicSpectatorRealtimeV2) {
        const publicHand = usePublicCurrentHand ? currentHand : (await supabase.rpc("get_public_tournament_hand_v2" as never, {
          p_tournament_id: tournamentId,
          p_hand_id: hand.id,
        } as never)).data;
        const safe = (publicHand ?? {}) as PublicHandResponse;
        sourceHandBigBlind = safe.bigBlind ?? 0;
        nextHandBlinds = sourceHandBigBlind > 0 && safe.smallBlind != null ? { sb: safe.smallBlind, bb: sourceHandBigBlind, ante: safe.ante ?? 0, level: safe.levelNumber } : null;
        seatInfos = (safe.players ?? []).map((player) => ({
          player_id: player.playerId, display_name: player.name, avatar_url: player.avatarUrl,
          seat_number: player.seatNumber, chip_count: Math.max(0, currentState === "last_completed" ? player.endingStack ?? 0 : player.startingStack ?? 0),
          is_active: true, table_id: hand.tableId ?? hand.table_id ?? liveTableScope ?? null, position: "",
          hole_cards: player.holeCards ?? [],
        }));
        actionData = (safe.actions ?? []).map((action) => ({
          id: action.id, player_id: action.playerId, entry_number: action.entryNumber,
          street: action.street, action_type: action.actionType,
          action_amount: action.amount, action_order: action.order,
        }));
        handPlayers = (safe.players ?? []).map((player) => ({
          player_id: player.playerId, entry_number: player.entryNumber,
          seat_number: player.seatNumber, starting_stack: player.startingStack,
          ending_stack: player.endingStack, hole_cards: player.holeCards ?? [],
          player_name: player.name, avatar_url: player.avatarUrl,
        }));
        hasIdentitySnapshot = true;
      } else {
        const [{ data: actions }, identitySnapshot] = await Promise.all([
          supabase.from("hand_actions").select("id, street, player_id, action_type, action_amount, action_order").eq("hand_id", hand.id).order("action_order"),
          spectator && FEATURES.liveViewerPulseV2 ? handPlayersHasSnapshot() : Promise.resolve(false),
        ]);
        hasIdentitySnapshot = identitySnapshot;
        const { data: players } = hasIdentitySnapshot
          ? await supabase.from("hand_players")
              .select("player_id, seat_number, starting_stack, ending_stack, hole_cards, player_name, avatar_url")
              .eq("hand_id", hand.id)
          : await supabase.from("hand_players")
              .select("player_id, seat_number, starting_stack, ending_stack, hole_cards")
              .eq("hand_id", hand.id);
        actionData = actions as LiveHandActionRow[] | null;
        handPlayers = players as LiveHandPlayerRow[] | null;
      }

      if (!currentRequest()) return;
      const liveHandPlayers = (handPlayers ?? []) as LiveHandPlayerRow[];
      const liveHandActions = (actionData ?? []) as LiveHandActionRow[];

      if (spectator && FEATURES.liveViewerPulseV2 && !FEATURES.publicSpectatorRealtimeV2 && handPlayers?.length) {
        const historicalDisplay = await fetchHandPlayerDisplay(tournamentId, handPlayers.map((player: any) => player.player_id), { includeProfiles: true });
        if (!currentRequest()) return;
        const rosterByPlayer = new Map(seatRows.map((row: any) => [row.player_id, row]));
        const currentByPlayer = new Map(seatInfos.map((row) => [row.player_id, row]));
        for (const hp of handPlayers as any[]) {
          const roster = rosterByPlayer.get(hp.player_id) as any;
          const historical = historicalDisplay.get(hp.player_id);
          const identity = resolveViewerIdentity({
            playerId: hp.player_id,
            seatNumber: hp.seat_number,
            snapshotName: hp.player_name,
            snapshotAvatarUrl: hp.avatar_url,
            seatName: roster?.player_name,
            seatAvatarUrl: roster?.avatar_url,
            profileName: historical?.name,
            profileAvatarUrl: historical?.avatar,
          });
          const existing = currentByPlayer.get(hp.player_id);
          const snapshotSeat: SeatInfo = {
            ...(existing ?? {} as SeatInfo),
            player_id: hp.player_id,
            display_name: identity.name,
            avatar_url: identity.avatarUrl,
            seat_number: hp.seat_number,
            chip_count: Math.max(0, hp.starting_stack ?? existing?.chip_count ?? 0),
            is_active: true,
            table_id: hand.table_id ?? existing?.table_id ?? null,
            position: existing?.position ?? "",
            hole_cards: hp.hole_cards?.length ? hp.hole_cards : existing?.hole_cards,
          };
          if (existing) seatInfos = seatInfos.map((seat) => seat.player_id === hp.player_id ? snapshotSeat : seat);
          else seatInfos.push(snapshotSeat);
          currentByPlayer.set(hp.player_id, snapshotSeat);
        }
      }

      nextStartingStacks = new Map(liveHandPlayers.map((hp) => [
        hp.player_id,
        Math.max(0, hp.starting_stack ?? 0),
      ]));

      if (actionData && actionData.length > 0) {
        // Action-author names come from tournament_seats.player_name — the SAME source the
        // LIVE seats use (see seatInfos above), keyed by player_id. The old code joined
        // profiles.user_id IN (player_ids), but hand_actions.player_id is a tournament-ENTRY
        // id, not an auth user_id, so the join always missed → the feed showed the raw short
        // id. Reuse the already-loaded seat roster instead of a mis-keyed profiles fetch.
        const actionNameMap = new Map<string, string>();
        seatInfos.forEach((s: any) => {
          if (s.display_name) actionNameMap.set(s.player_id, s.display_name);
        });

        const seatMap = new Map<string, number>();
        const startingStackMap = new Map<string, number>();
        const holeCardsMap = new Map<string, string[]>();
        (handPlayers || []).forEach((hp: any) => {
          seatMap.set(hp.player_id, hp.seat_number);
          startingStackMap.set(hp.player_id, Math.max(0, hp.starting_stack ?? 0));
          if (hp.hole_cards && hp.hole_cards.length > 0) {
            holeCardsMap.set(hp.player_id, hp.hole_cards);
          }
        });
        nextStartingStacks = startingStackMap;

        nextActions = actionData.map((a: any) => ({
          action_id: a.id,
          street: a.street || "preflop",
          player_id: a.player_id,
          display_name: actionNameMap.get(a.player_id) || a.player_id.slice(0, 6),
          seat_number: seatMap.get(a.player_id) || 0,
          action_type: a.action_type,
          action_amount: a.action_amount,
          action_order: a.action_order,
        }));

        const foldedPlayers = new Set<string>();
        const allInPlayers = new Set<string>();
        const lastActionMap = new Map<string, string>();
        const lastActionDataMap = new Map<string, { type: string; amount: number }>();
        actionData.forEach((a: any) => {
          if (a.action_type === "fold") foldedPlayers.add(a.player_id);
          if (a.action_type === "all_in") allInPlayers.add(a.player_id);
          lastActionMap.set(
            a.player_id,
            formatActionLabel({
              street: a.street,
              player_id: a.player_id,
              display_name: "",
              seat_number: 0,
              action_type: a.action_type,
              action_amount: a.action_amount,
              action_order: a.action_order,
            })
          );
          lastActionDataMap.set(a.player_id, { type: a.action_type, amount: a.action_amount ?? 0 });
        });

        seatInfos = seatInfos.map((s) => ({
          ...s,
          is_folded: foldedPlayers.has(s.player_id),
          is_all_in: allInPlayers.has(s.player_id),
          last_action: lastActionMap.get(s.player_id),
          last_action_type: lastActionDataMap.get(s.player_id)?.type,
          last_action_amount: lastActionDataMap.get(s.player_id)?.amount,
          hole_cards: holeCardsMap.get(s.player_id),
        }));

        const liveDisplay = deriveLiveHandDisplay({
          startingStacks: startingStackMap,
          actions: actionData as any,
          inProgress: nextInProgress,
        });
        if (nextInProgress && spectator) {
          seatInfos = seatInfos.map((seat) => ({
            ...seat,
            chip_count: startingStackMap.has(seat.player_id)
              ? liveDisplay.remainingStacks.get(seat.player_id) ?? seat.chip_count
              : seat.chip_count,
          }));
        }

        // Live Action Engine (flag-gated, inc2): per-street current bets + the
        // to-act player. Restricted to THIS hand's participants (hand_players) so
        // it never mixes tables; advisory display only — no card/server authority.
        if (FEATURES.liveActionEngine && nextInProgress) {
          const boardN = nextCommunity.length;
          const curStreet =
            boardN >= 5 ? "river" : boardN >= 4 ? "turn" : boardN >= 3 ? "flop" : "preflop";
          const POSTS = ["post_sb", "post_bb", "post_ante"];
          const streetBets: Record<string, number> = {};
          // UAT wave 2 (Fix 3): whole-hand committed totals — feeds the ALL-IN pill's
          // persistent amount. Reconstruction goes through streetContribution (the
          // single documented DELTA source in potEngine) for BOTH maps.
          const totalBets: Record<string, number> = {};
          const acted = new Set<string>();
          let lastActorSeat = nextButtonSeat;
          let bbAmt = 0;
          actionData.forEach((a: any) => {
            if (a.action_type === "post_bb") bbAmt = Math.max(bbAmt, a.action_amount || 0);
            const add = streetContribution(a.action_type, a.action_amount);
            if (add > 0) totalBets[a.player_id] = (totalBets[a.player_id] || 0) + add;
            if ((a.street || "preflop") !== curStreet) return;
            if (add > 0) streetBets[a.player_id] = (streetBets[a.player_id] || 0) + add;
            if (!POSTS.includes(a.action_type)) acted.add(a.player_id);
            lastActorSeat = seatMap.get(a.player_id) ?? lastActorSeat;
          });
          // UAT wave 2 (Fix 3 + R2), spectator+compact only so the operator's embedded
          // view stays byte-identical: (R2) a seat whose whole stack went in via a
          // stack-consuming CALL is all-in even though no "all_in" action exists
          // (tournament_seats.chip_count is the PRE-hand stack, so remaining =
          // chip_count − totalBets); ALL-IN seats carry their whole-hand total for
          // the pill amount.
          const wantBetChips = spectator && FEATURES.liveFeltCompact;
          // liveBetChips: keep the committed-bet disc visible the WHOLE hand (not just the
          // current street) by carrying the whole-hand committed total in a display-only
          // field. Spectator-only + flag-gated → operator/TV byte-identical. Distinct from
          // total_committed (all-in pill) — do not conflate the two.
          const wantPersistentBet = spectator && FEATURES.liveBetChips;
          const stackConsumed = (s: { player_id: string; chip_count: number }) => {
            const committed = totalBets[s.player_id] || 0;
            const starting = startingStackMap.get(s.player_id) ?? s.chip_count;
            return committed > 0 && starting - committed <= 0;
          };
          const isAllInAug = (s: { player_id: string; chip_count: number }) =>
            allInPlayers.has(s.player_id) || (wantBetChips && stackConsumed(s));
          seatInfos = seatInfos.map((s) => ({
            ...s,
            current_bet: streetBets[s.player_id] || 0,
            ...(wantPersistentBet ? { display_committed_bet: streetBets[s.player_id] || 0 } : {}),
            ...(wantBetChips && isAllInAug(s)
              ? { is_all_in: true, total_committed: totalBets[s.player_id] || 0 }
              : {}),
          }));
          const stackOf = new Map(seatInfos.map((s) => [s.player_id, s.chip_count]));
          const flowPlayers = (handPlayers || []).map((hp: any) => ({
            player_id: hp.player_id,
            seat_number: hp.seat_number,
            current_bet: streetBets[hp.player_id] || 0,
            current_stack: stackOf.get(hp.player_id) ?? 0,
            is_folded: foldedPlayers.has(hp.player_id),
            is_all_in:
              allInPlayers.has(hp.player_id) ||
              (wantBetChips &&
                stackConsumed({ player_id: hp.player_id, chip_count: stackOf.get(hp.player_id) ?? 0 })),
          }));
          liveToActId = nextToAct({
            players: flowPlayers,
            buttonSeat: nextButtonSeat,
            actedThisStreet: acted,
            lastActorSeat,
            bigBlind: bbAmt,
          });
          nextBettingRoundComplete = liveHandActions.some((action) => !POSTS.includes(action.action_type))
            && liveToActId === null;
          // UAT wave 2 (R1, spectator+compact): during an all-in RUNOUT (≥2 live, ≤1
          // eligible, and that seat owes no call) the "waiting on X" spotlight is
          // misleading — betting is closed. Null it and let the status bar say
          // "Đang chạy board" instead.
          if (wantBetChips) {
            const liveFlow = flowPlayers.filter((p) => !p.is_folded);
            const eligibleFlow = liveFlow.filter((p) => !p.is_all_in && p.current_stack > 0);
            const maxStreetBet = Math.max(0, ...Object.values(streetBets));
            const isRunoutLive =
              liveFlow.length >= 2 &&
              eligibleFlow.length <= 1 &&
              (eligibleFlow.length === 0 || eligibleFlow[0].current_bet >= maxStreetBet);
            if (isRunoutLive) {
              liveToActId = null;
              nextRunout = true;
            }
          }
        }

        nextBreakdown = liveDisplay.potBreakdown;
        if (spectator && nextInProgress) nextPot = liveDisplay.potSize;
      }

      if (spectator && !nextInProgress && currentState !== "last_completed") {
        const { data: settlementData, error: settlementError } = await supabase.rpc(
          "get_public_tournament_settlement" as never,
          { p_hand_id: hand.id } as never,
        );
        if (!currentRequest()) return;
        const publicSettlement = settlementError ? null : parseReplayPublicSettlement(settlementData);
        const seatByPlayer = new Map(seatInfos.map((seat) => [seat.player_id, seat]));
        nextLiveCompletedHand = {
          hand_id: hand.id,
          hand_number: hand.hand_number,
          button_seat: hand.button_seat || 1,
          community_cards: nextCommunity,
          stored_pot_size: hand.pot_size,
          players: liveHandPlayers.map((hp) => ({
            player_id: hp.player_id,
            seat_number: hp.seat_number,
            display_name: seatByPlayer.get(hp.player_id)?.display_name ?? hp.player_name ?? hp.player_id.slice(0, 6),
            starting_stack: Math.max(0, hp.starting_stack ?? 0),
            ending_stack: hp.ending_stack ?? null,
            avatar_url: seatByPlayer.get(hp.player_id)?.avatar_url ?? hp.avatar_url ?? null,
            hole_cards: hp.hole_cards?.length ? hp.hole_cards : undefined,
          })),
          actions: liveHandActions.map((action) => ({
            action_id: action.id,
            player_id: action.player_id,
            street: action.street || "preflop",
            action_type: action.action_type,
            action_amount: action.action_amount ?? 0,
            action_order: action.action_order,
          })),
          publicSettlement,
        };
      }
    }

    const capturedBlind = nextHandId && liveHandBlindRef.current?.handId === nextHandId
      ? liveHandBlindRef.current.bigBlind
      : 0;
    // A completed fallback is a historical record.  Never infer a replacement
    // blind from its actions or today's level: an absent stored blind must stay
    // unavailable so amounts render as raw chips plus "— BB".
    const nextHandBigBlind = nextHandId
      ? currentState === "last_completed"
        ? Math.max(0, sourceHandBigBlind)
        : resolveViewerHandBigBlind({
            explicitBigBlind: sourceHandBigBlind > 0 ? sourceHandBigBlind : capturedBlind,
            actions: nextActions,
            startingStacks: nextStartingStacks,
          })
      : 0;
    if (nextHandId && nextHandBigBlind > 0) {
      liveHandBlindRef.current = { handId: nextHandId, bigBlind: nextHandBigBlind };
    }

    if (!currentRequest()) return;
    setSeats(seatInfos);
    setHandNumber(nextHandNumber);
    setHandId(nextHandId);
    setHandTableId(nextHandTableId);
    setButtonSeat(nextButtonSeat);
    setCommunityCards(nextCommunity);
    setPotSize(nextPot);
    setHandPotMissing(nextHandPotMissing);
    setActions(nextActions);
    setPotBreakdown(nextBreakdown);
    setHandInProgress(nextInProgress);
    setToActId(liveToActId);
    setLiveRunout(nextRunout);
    setLiveBettingRoundComplete(nextBettingRoundComplete);
    setLiveHandBigBlind(nextHandBigBlind);
    setLiveHandBlinds(nextHandBlinds);
    setLiveCompletedHand(nextLiveCompletedHand);
    setTableDisplayState(currentState);
    setTableSessionId(currentResponse?.tableSessionId ?? null);

    if (clockRes.data && !clockRes.error) {
      const c = clockRes.data as any;
      setClockData({
        is_running: c.is_running || false,
        remaining_seconds: c.remaining_seconds || 0,
        current_level: c.current_level?.level_number || null,
        small_blind: c.current_level?.small_blind || 0,
        big_blind: c.current_level?.big_blind || 0,
        ante: c.current_level?.ante || 0,
      });
      setLocalRemaining(c.remaining_seconds || 0);
      setIsRunning(c.is_running || false);
      if ((c.remaining_seconds || 0) > 0) zeroRefetchDoneRef.current = false;
    }

    if (participationSummary) {
      setPlayersRemaining(participationSummary.counts.remaining);
      setAverageStack(participationSummary.averageStack);
    } else if (tournamentRes.data) {
      const tournament = tournamentRes.data as any;
      setPlayersRemaining(tournament.players_remaining || 0);
      setAverageStack(tournament.average_stack || 0);
    }

    initialLoadedRef.current = true;
    setFatalError(null);
    setSoftErrorAt(null);
    setLastUpdatedAt(new Date());
    setLoading(false);
  }, [tournamentId, spectator, liveTableScope, readScope]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current != null) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollingRef.current != null) return; // single interval, no leak
    pollingRef.current = window.setInterval(() => {
      loadAllData();
    }, POLL_INTERVAL_MS);
  }, [loadAllData]);

  // Live Action Engine MVP (flag-gated, frontend-only): while a hand is in
  // progress, fast-poll so spectators see each recorded action in near-real-time
  // — `record_action` only writes `hand_actions`, which fires no
  // `tournament_hands` realtime event, so the default path refreshes only when
  // the hand is finalised. Reuses loadAllData (requestSeqRef guard intact).
  // Never runs in replay mode or when the flag is off → zero behaviour change.
  useEffect(() => {
    // VIEWER-ONLY: `spectator` gate keeps the operator's polling cadence unchanged even
    // with the flag ON. Visibility-aware: a backgrounded tab skips the tick, so it stops
    // hitting the DB every 2.5s while not being watched.
    if (!FEATURES.liveActionEngine || !spectator) return;
    if (!tournamentId || mode !== "live" || !handInProgress) return;
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadAllData();
    }, LIVE_ACTION_POLL_MS);
    return () => window.clearInterval(id);
  }, [tournamentId, mode, handInProgress, loadAllData, spectator]);

  useEffect(() => { setSelectedTableId(null); }, [tournamentId]);
  useEffect(() => { setTablePanel(initialTablePanel); }, [initialTablePanel, liveTableScope]);

  // Reset the old hand, pending requests and effects before loading another table.
  useEffect(() => {
    if (!tournamentId) return;
    requestSeqRef.current += 1;
    initialLoadedRef.current = false;
    zeroRefetchDoneRef.current = false;
    setSeats([]);
    setHandId(null);
    setTableMotionEvents([]);
    previousLiveHandRef.current = null;
    replayMotionFrameRef.current = null;
    setHandNumber(null);
    setHandTableId(null);
    setButtonSeat(1);
    setCommunityCards([]);
    setPotSize(0);
    setHandPotMissing(false);
    setActions([]);
    setTableNames({});
    setFatalError(null);
    setSoftErrorAt(null);
    setLastUpdatedAt(null);
    setHandInProgress(false);
    setToActId(null);
    setLiveBettingRoundComplete(false);
    setLiveHandBigBlind(0);
    setLiveHandBlinds(null);
    setTableDisplayState(null);
    setTableSessionId(null);
    setHistoryReplayTarget(null);
    liveHandBlindRef.current = null;
    setMode("live");
    setReplayHandId(null);
    setReplayHand(null);
    setReplayFrameState(null);
    setReplayFrameSource("jump");
    setReplayRunoutPresentation(null);
    setReplayMotionEpoch(0);
    setLiveBaseline(null);
    setLoading(true);
    loadAllData();
    return () => { requestSeqRef.current += 1; };
  }, [tournamentId, loadAllData]);

  useEffect(() => {
    if (!tournamentId) return;
    if (channelRef.current) {
      const prev = channelRef.current;
      channelRef.current = null;
      supabase.removeChannel(prev);
    }

    setRealtimeStatus("connecting");
    const publicV2 = spectator && FEATURES.publicSpectatorRealtimeV2;
    const publicCoordinator = publicV2 ? new PublicSnapshotCoordinator(loadAllData, 1_000) : null;
    const channel = supabase.channel(publicV2 ? `public:tournament-viewer-v2:${tournamentId}` : `live-view:${tournamentId}`, publicV2 ? { config: { private: false } } : undefined);
    if (publicV2) {
      channel.on("broadcast", { event: "changed" }, () => publicCoordinator?.request());
    } else {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_hands", filter: `tournament_id=eq.${tournamentId}` },
        () => loadAllData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_chip_counts", filter: `tournament_id=eq.${tournamentId}` },
        () => loadAllData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_seats", filter: `tournament_id=eq.${tournamentId}` },
        () => loadAllData()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "hand_players", filter: `tournament_id=eq.${tournamentId}` },
        () => loadAllData()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` },
        () => loadAllData()
      );
    }
    channel.subscribe((status) => {
        // Ignore status callbacks from a channel we already replaced/removed.
        if (channelRef.current !== channel) return;
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("online");
          stopPolling();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeStatus("offline");
          startPolling();
        }
    });

    channelRef.current = channel;
    return () => {
      const ch = channelRef.current;
      channelRef.current = null;
      publicCoordinator?.stop();
      if (ch) supabase.removeChannel(ch);
      stopPolling();
    };
  }, [tournamentId, loadAllData, spectator, startPolling, stopPolling]);

  useEffect(() => {
    if (!isRunning || localRemaining <= 0) return;
    const interval = setInterval(() => {
      setLocalRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, localRemaining > 0]);

  // Debounced refetch when the level clock hits 0 — once per zero crossing.
  useEffect(() => {
    if (isRunning && localRemaining <= 0 && initialLoadedRef.current && !zeroRefetchDoneRef.current) {
      zeroRefetchDoneRef.current = true;
      loadAllData();
    }
  }, [isRunning, localRemaining, loadAllData]);

  // Action sounds + (liveTableFx) chip-push. Sounds fire on count increments after
  // first load (unchanged behavior); the chip-push is VISUAL so it is NOT gated by
  // mute and keys off an identity nonce so it survives the per-hand actions reset.
  useEffect(() => {
    const count = actions.length;
    const prev = prevActionCountRef.current;
    prevActionCountRef.current = count;
    const last = actions[count - 1];

    // Sound — unchanged detection (new action by count, respects mute).
    if (mode === "live" && handInProgress && !soundMuted && prev !== null && count > prev && last && SOUND_KINDS.has(last.action_type)) {
      if (FEATURES.liveTableFx && last.action_type === "fold") {
        playPokerLiveSound("fold_muck", { bypassStoredMute: true, profile: "tracker" }); // card-muck swoosh instead of the legacy beep
      } else {
        playPokerLiveSound(last.action_type as PokerLiveSound, { bypassStoredMute: true, profile: "tracker" });
        if (FEATURES.liveTableFx && CHIP_ACTIONS.has(last.action_type)) {
          playPokerLiveSound("chip", { bypassStoredMute: true, profile: "tracker" }); // crisp chip clink layered over the bet mp3
        }
      }
    }

    // Chip-push animation — visual (NOT gated by mute). Composite nonce
    // (handNumber*10000 + count) is unique across hands, so the FX layer's
    // "nonce changed" dedupe fires on the first action of a new hand too (P2-2).
    if (
      FEATURES.liveTableFx && handInProgress &&
      prev !== null &&
      last &&
      CHIP_ACTIONS.has(last.action_type) &&
      (last.seat_number ?? 0) > 0
    ) {
      const nonce = (handNumber ?? 0) * 10000 + count;
      if (lastChipNonceRef.current !== nonce) {
        lastChipNonceRef.current = nonce;
        // kind = the action_type → the viewer colors the flying chip by action (all_in=red, etc.).
        setChipPush({ seatNumber: last.seat_number, nonce, kind: last.action_type });
      }
    }
    if (
      FEATURES.liveTableMotionV2 && spectator && mode === "live" && handInProgress && prev !== null && count > prev &&
      last?.action_type === "fold" && last.seat_number > 0
    ) {
      enqueueTableMotion([{
        id: `live:${handId ?? handNumber}:${last.action_id ?? last.action_order}:fold`,
        handId: handId ?? `hand-${handNumber ?? 0}`,
        kind: "fold_muck",
        seatNumber: last.seat_number,
      }]);
    }
    // handNumber intentionally omitted from deps: it updates in the same render as
    // `actions`, so the effect's closure already has the fresh value on each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, soundMuted, enqueueTableMotion, handId, handNumber, mode, spectator, handInProgress]);

  useEffect(() => {
    const count = communityCards.length;
    const prev = prevBoardCountRef.current;
    prevBoardCountRef.current = count;
    if (mode !== "live" || !handInProgress || prev === null || count <= prev) return;
    // C4 (trackerActionSounds): a street change means the finished street's bets were
    // gathered — play the owner's pot-collect clip before the deal. The prev-count
    // guard above IS the dedupe (fires once per board growth; polling echoes and
    // re-renders keep count unchanged and return early).
    if (!soundMuted) {
      if (FEATURES.trackerActionSounds) playPokerLiveSound("pot_collect", { bypassStoredMute: true, profile: "tracker" });
      if (FEATURES.liveTableFx || FEATURES.trackerActionSounds) {
        // flop riffles in (deal_flop = 3 bursts), turn/river = a single card — with
        // trackerActionSounds on, these kinds resolve to the owner's MP3 clips.
        playPokerLiveSound(count >= 5 ? "deal_river" : count === 4 ? "deal_turn" : "deal_flop", { bypassStoredMute: true, profile: "tracker" });
      } else {
        playPokerLiveSound("deal", { bypassStoredMute: true, profile: "tracker" });
      }
    }
    if (FEATURES.liveTableMotionV2 && spectator && mode === "live" && handId) {
      enqueueTableMotion([{
        id: `live:${handId}:board:${count}`,
        handId,
        kind: "board_reveal",
        street: count >= 5 ? "river" : count === 4 ? "turn" : "flop",
        cards: communityCards.slice(prev),
      }]);
    }
  }, [communityCards, soundMuted, enqueueTableMotion, handId, mode, spectator, handInProgress]);

  const liveShownCardsRef = useRef<{ hand: string | null; players: Set<string> } | null>(null);
  useEffect(() => {
    const shown = new Set(seats.filter(seat => !seat.is_folded && seat.hole_cards?.length === 2).map(seat => seat.player_id));
    const previous = liveShownCardsRef.current;
    liveShownCardsRef.current = { hand: handId, players: shown };
    if (mode !== "live" || !handInProgress || soundMuted || !previous || previous.hand !== handId || !FEATURES.liveTableFx) return;
    if ([...shown].some(id => !previous.players.has(id))) {
      playPokerLiveSound("showdown", { bypassStoredMute: true, profile: "tracker" });
    }
  }, [handId, mode, seats, soundMuted, handInProgress]);

  // Reset sound baselines on tournament switch so the first load stays silent.
  useEffect(() => {
    prevActionCountRef.current = null;
    prevBoardCountRef.current = null;
    lastChipNonceRef.current = null;
    observedLiveHandRef.current = null;
    liveAwardedHandRef.current = null;
  }, [tournamentId]);

  // liveTableFx replay-playback FX: as a completed hand is PLAYED back, emit the
  // same enriched sounds + chip-push the live feed would. Forward-only (the frame
  // index must increase) so scrubbing backward / jumping around stays silent. The
  // Replay "Phát" button is itself a user gesture, so audio is already unlocked.
  // Flag OFF → no-op (replay stays silent, exactly as today).
  useEffect(() => {
    const scheduler = replayActionFxSchedulerRef.current;
    if (mode !== "replay" || !FEATURES.liveTableFx || !replayFrame) {
      scheduler?.cancel();
      replayFxRef.current = { index: null, board: 0, revealed: false };
      return;
    }
    const idx = replayFrame.index;
    const board = replayFrame.displayCards.filter(Boolean).length;
    const prev = replayFxRef.current;
    replayFxRef.current = { index: idx, board, revealed: replayFrame.revealHoleCards };
    if (replayFrameSource !== "playback") {
      scheduler?.cancel();
      return;
    }

    if (!replayFxPlaybackStateRef.current.soundMuted && !prev.revealed && replayFrame.revealHoleCards
      && prev.index !== null && idx === prev.index + 1 && (!replayRunoutPresentation || replayRunoutPresentation.phase === "pot_collect")) {
      playPokerLiveSound("showdown", { bypassStoredMute: true, profile: "tracker" });
    }
    const la = replayFrame.latestAction;
    const fx = deriveReplayPlaybackFx({
      prevIndex: prev.index,
      prevBoard: prev.board,
      index: idx,
      board,
      actionType: la?.action_type ?? null,
      seatNumber: la?.seat_number ?? 0,
    });

    // The final frame contains the entire board; the HUD owns its street cues.
    if (replayRunoutPresentation && replayFrame.index === replayHand?.actions.length) fx.deal = null;
    if (!replayFxPlaybackStateRef.current.soundMuted && fx.deal) {
      playPokerLiveSound(fx.deal, { bypassStoredMute: true, profile: "tracker" });
    }
    const playActionFx = () => {
      const playbackState = replayFxPlaybackStateRef.current;
      if (!playbackState.soundMuted) {
        if (fx.action) playPokerLiveSound(fx.action, { bypassStoredMute: true, profile: "tracker" });
        if (fx.chipClink) playPokerLiveSound("chip", { bypassStoredMute: true, profile: "tracker" });
      }
      // Chip-push is visual + viewer-only (spectator); a monotonic seq keeps the
      // nonce unique even when the same hand is replayed twice.
      if (fx.chipPush && playbackState.spectator && la) {
        replayChipSeqRef.current += 1;
        setChipPush({ seatNumber: la.seat_number, nonce: 1_000_000 + replayChipSeqRef.current, kind: la.action_type });
      }
    };
    const actionDelay = replayActionSoundDelayMs(fx.deal, replayFxPlaybackStateRef.current.replayMotionSpeed);
    const actionKey = `${loadedReplayHandKey ?? "replay"}:${idx}:${board}:${la?.action_id ?? la?.action_order ?? "none"}`;
    scheduler?.schedule(actionKey, actionDelay, playActionFx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayFrame, replayFrameSource, mode]);

  useEffect(() => {
    if (mode !== "replay" || !FEATURES.liveTableMotionV2 || !replayFrame || !replayHand) {
      replayMotionFrameRef.current = null;
      return;
    }
    const previous = replayMotionFrameRef.current;
    replayMotionFrameRef.current = replayFrame;
    if (replayFrameSource !== "playback") return;
    // The HUD owns the persisted all-in final-board cadence. Suppress only this
    // duplicate table-motion overlay; operator/TV and ordinary replay frames keep
    // the existing shared motion stream unchanged.
    const hudOwnsFinalRunout = spectator
      && FEATURES.liveReplayHud
      && replayFrame.index === replayHand.actions.length
      && replayHand.actions.some((action) => action.action_type === "all_in")
      && replayRunoutPresentation?.key.startsWith(
        `${replayHand.hand_id ?? `hand-${replayHand.hand_number}`}:${replayHand.actions.length}:`,
      );
    if (hudOwnsFinalRunout) return;
    const motionHandId = `${replayHand.hand_id ?? `hand-${replayHand.hand_number}`}:run-${replayMotionEpoch}`;
    enqueueTableMotion(deriveReplayTableMotionEvents({
      handId: motionHandId,
      previous,
      current: replayFrame,
    }));
  }, [enqueueTableMotion, mode, replayFrame, replayFrameSource, replayHand, replayMotionEpoch, replayRunoutPresentation, spectator]);

  const toggleSoundMuted = useCallback(() => {
    markPokerSoundGesture("tracker");
    setSoundMuted((m) => {
      const next = !m;
      if (next) stopTrackerPokerSounds();
      try {
        localStorage.setItem(SOUND_MUTE_KEY, next ? "1" : "0");
      } catch {
        // localStorage may be unavailable (private mode) — toggle still works for the session.
      }
      return next;
    });
  }, []);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const displayCards = useMemo(() => {
    const c = communityCards || [];
    return [...c, ...Array(Math.max(0, 5 - c.length)).fill("")];
  }, [communityCards]);

  // Street derived from board size; showdown once any hole cards are revealed.
  const currentStreet = useMemo(() => {
    if (!handNumber) return null;
    if (seats.some((s) => s.hole_cards && s.hole_cards.length > 0)) return "showdown";
    const n = communityCards.length;
    if (n >= 5) return "river";
    if (n === 4) return "turn";
    if (n >= 3) return "flop";
    return "preflop";
  }, [handNumber, seats, communityCards]);

  const bigBlind = liveHandBigBlind;
  const formatBB = useCallback(
    (n: number) => formatViewerBB(n, bigBlind),
    [bigBlind]
  );

  const isReplay = mode === "replay";
  const selectedReplayHand = useMemo(() => {
    if (!replayHand || !requestedReplayTarget) return replayHand;
    if (requestedReplayTarget.handId) {
      return replayHand.hand_id === requestedReplayTarget.handId ? replayHand : null;
    }
    return replayTargetState.kind === "resolved" && replayTargetState.handId === replayHand.hand_id
      ? replayHand
      : null;
  }, [replayHand, replayTargetState, requestedReplayTarget]);
  const selectedReplayHandKey = selectedReplayHand
    ? selectedReplayHand.hand_id ?? `hand-${selectedReplayHand.hand_number}`
    : null;
  useEffect(() => setReplaySelectedPotIndex(0), [selectedReplayHandKey]);
  const selectedReplayFrame = selectedReplayHandKey && replayFrameState?.handKey === selectedReplayHandKey
    ? replayFrameState.frame
    : null;
  const handleSelectedReplayFrame = useCallback((frame: ReplayFrame, source: ReplayFrameSource) => {
    if (!selectedReplayHandKey) return;
    handleReplayFrame(selectedReplayHandKey, frame, source);
  }, [handleReplayFrame, selectedReplayHandKey]);
  const handleSelectedReplayRunoutPresentation = useCallback((presentation: ReplayRunoutPresentation | null) => {
    setReplayRunoutPresentation(presentation);
  }, []);
  const replayShowdownPresentation = useMemo(() => {
    if (!selectedReplayHand?.hand_id || !selectedReplayFrame) return null;
    return resolveVerifiedPayoutPresentation({
      handId: selectedReplayHand.hand_id,
      frame: selectedReplayFrame,
      finalFrameIndex: selectedReplayHand.actions.length,
      settlement: selectedReplayHand.publicSettlement,
      locale: i18n.language,
    });
  }, [i18n.language, selectedReplayFrame, selectedReplayHand]);
  const liveCompletedFrame = useMemo(() => liveCompletedHand
    ? buildReplayFrames(liveCompletedHand, { trackBets: true }).at(-1) ?? null : null, [liveCompletedHand]);
  const liveShowdownPresentation = useMemo(() => {
    if (!liveCompletedHand?.hand_id) return null;
    const finalFrame = liveCompletedFrame;
    if (!finalFrame) return null;
    const presentation = resolveVerifiedPayoutPresentation({
      handId: liveCompletedHand.hand_id,
      frame: finalFrame,
      finalFrameIndex: liveCompletedHand.actions.length,
      settlement: liveCompletedHand.publicSettlement,
      locale: i18n.language,
    });
    if (!presentation.enabled) return null;
    return presentation;
  }, [i18n.language, liveCompletedHand, liveCompletedFrame]);
  const replayRunoutForSelectedHand = selectedReplayHandKey
    && selectedReplayFrame?.index === selectedReplayHand?.actions.length
    && replayRunoutPresentation?.key.startsWith(`${selectedReplayHandKey}:${selectedReplayHand.actions.length}:`)
    ? replayRunoutPresentation
    : null;
  const replayHasVerifiedPotSequence = replayShowdownPresentation?.enabled === true
    && replayShowdownPresentation.potLayers.length > 0;
  const replayVisibleShowdownPresentation = useMemo(() => {
    if (!replayShowdownPresentation?.enabled) return null;
    if (replayRunoutForSelectedHand?.potAwardIndex != null) {
      const scoped = selectVerifiedPotLayerPresentation(
        replayShowdownPresentation,
        replayRunoutForSelectedHand.potAwardIndex,
      );
      return scoped.enabled ? scoped : null;
    }
    // While a keyed cinematic is collecting or revealing cards, do not flash a
    // union of unrelated Main/Side winners. A direct seek/reload at showdown has
    // no keyed cinematic, so show the verified Main Pot immediately.
    if (replayRunoutForSelectedHand) return null;
    if (replayHasVerifiedPotSequence) {
      const main = selectVerifiedPotLayerPresentation(replayShowdownPresentation, replaySelectedPotIndex);
      return main.enabled ? main : null;
    }
    return replayShowdownPresentation;
  }, [replayHasVerifiedPotSequence, replayRunoutForSelectedHand, replaySelectedPotIndex, replayShowdownPresentation]);
  // The HUD owns the verified payout cadence, including each visible runout street.
  useTrackerRunoutSounds(
    replayRunoutForSelectedHand,
    mode === "replay" && spectator && FEATURES.liveReplayHud && FEATURES.liveTableFx && replayFrameSource === "playback",
    soundMuted,
    Boolean(replayVisibleShowdownPresentation?.winners.some(winner => winner.bestFive.length === 5)),
  );
  const replayFocusPhase = replayRunoutFocusPhase(replayRunoutForSelectedHand?.phase ?? (
    replayVisibleShowdownPresentation?.enabled ? "static" : null
  ));

  useEffect(() => {
    if (mode === "live" && handInProgress && handId) observedLiveHandRef.current = handId;
  }, [handId, handInProgress, mode]);

  const livePayoutKey = tableDisplayState === "live" && liveShowdownPresentation?.enabled && liveCompletedHand?.hand_id === handId && !handInProgress
    ? 'live:' + handId : null;
  useEffect(() => {
    if (mode !== "live" || !spectator || !livePayoutKey || !liveShowdownPresentation?.enabled) {
      setLivePayout(null);
      return;
    }
    if (liveAwardedHandRef.current === livePayoutKey) {
      setLivePayout(current => current?.key === livePayoutKey ? current
        : createReplayRunoutPresentation(livePayoutKey, "static", 0));
      return;
    }
    liveAwardedHandRef.current = livePayoutKey;
    const observed = observedLiveHandRef.current === liveShowdownPresentation.handId;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setLivePayout(createReplayRunoutPresentation(livePayoutKey, observed && !reduced ? "pot_collect" : "static", observed && !reduced ? null : 0));
  }, [handInProgress, livePayoutKey, liveShowdownPresentation, mode, spectator]);
  const livePayoutForHand = livePayoutKey && livePayout?.key === livePayoutKey ? livePayout : null;
  const livePotCount = liveShowdownPresentation?.enabled ? liveShowdownPresentation.potLayers.length : 0;
  useEffect(() => {
    if (mode !== "live" || !livePayoutForHand || !livePotCount) return;
    const next = nextReplayRunoutPresentation(livePayoutForHand, livePotCount);
    if (!next) return;
    const timer = window.setTimeout(() => setLivePayout(next), replayRunoutPhaseDuration(livePayoutForHand.phase, 1));
    return () => window.clearTimeout(timer);
  }, [livePayoutForHand, livePotCount, mode]);
  useTrackerRunoutSounds(
    livePayoutForHand, mode === "live" && spectator && FEATURES.liveTableFx, soundMuted,
    Boolean(liveShowdownPresentation?.winners.some(winner => winner.bestFive.length === 5)),
  );
  const liveVisibleShowdownPresentation = liveShowdownPresentation?.enabled
    ? selectVerifiedPotLayerPresentation(liveShowdownPresentation, livePayoutForHand?.potAwardIndex ?? 0) : null;
  const replayFeltPayout = replayRunoutForSelectedHand ?? (replayVisibleShowdownPresentation?.enabled && selectedReplayHandKey
    ? createReplayRunoutPresentation(selectedReplayHandKey + ":static", "static", replaySelectedPotIndex) : null);
  const replayDisplayCards = selectedReplayFrame
    ? replayRunoutForSelectedHand
      ? selectedReplayFrame.displayCards.map((card, index) => (
          index < replayRunoutForSelectedHand.visibleBoardCount ? card : ""
        ))
      : selectedReplayFrame.displayCards
    : null;

  const replayRoundComplete = Boolean((() => {
    if (!selectedReplayHand || !selectedReplayFrame || selectedReplayFrame.index <= 0) return false;
    const ordered = [...selectedReplayHand.actions].sort((a, b) => a.action_order - b.action_order);
    const current = ordered[selectedReplayFrame.index - 1];
    const next = ordered[selectedReplayFrame.index];
    return !!current && (!next || next.street !== current.street);
  })());

  const replayFinalAllInCollection = Boolean(
    spectator
      && isReplay
      && FEATURES.liveReplayHud
      && selectedReplayHand
      && selectedReplayFrame
      && replayRoundComplete
      && selectedReplayHand.actions.some((action) => action.action_type === "all_in")
      && selectedReplayFrame.seats.some((seat) => (
        seat.is_all_in === true
        || [seat.total_committed, seat.display_committed_bet, seat.current_bet]
          .some((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
      ))
  );
  const liveFinalAllInCollection = Boolean(
    spectator
      && !isReplay
      && FEATURES.liveViewerFeltV2
      && FEATURES.liveTableFx
      && liveBettingRoundComplete
      && actions.some((action) => action.action_type === "all_in")
      && seats.some((seat) => (
        seat.is_all_in === true
        || [seat.total_committed, seat.display_committed_bet, seat.current_bet]
          .some((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
      ))
  );
  const collectCommittedChips = shouldCollectCommittedChips({
    enabled: spectator && FEATURES.liveTableFx,
    runout: !isReplay && liveRunout,
    finalAllIn: replayFinalAllInCollection || liveFinalAllInCollection,
    bettingRoundComplete: isReplay ? replayRoundComplete : liveBettingRoundComplete,
    hasCommittedChips: isReplay
      ? Boolean(selectedReplayFrame?.potBreakdown?.totalCommitted)
        || Boolean(selectedReplayFrame?.seats.some((seat) => (
          [seat.total_committed, seat.display_committed_bet, seat.current_bet]
            .some((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
        )))
      : Boolean(potBreakdown?.totalCommitted)
        || Boolean(seats.some((seat) => (
          [seat.total_committed, seat.display_committed_bet, seat.current_bet]
            .some((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
        )))
        || actions.some((action) => action.action_amount > 0 && [
          "post_sb", "post_bb", "post_ante", "bet", "raise", "call", "all_in",
        ].includes(action.action_type)),
  });

  // Replay uses the historical hand's own big blind (the live clock may have moved on).
  const replayBigBlind = selectedReplayHand ? detectBigBlind(selectedReplayHand) : 0;
  const replayFormatBB = useCallback(
    (n: number) => formatViewerBB(n, replayBigBlind),
    [replayBigBlind]
  );
  const replayHeaderMetadata = useMemo(() => deriveReplayHeaderMetadata(selectedReplayHand), [selectedReplayHand]);

  // Keep the displayed level tied to this hand, even after the live clock advances.
  const compactFelt = spectator && FEATURES.liveFeltCompact;
  const feltBlinds = useMemo(() => {
    if (mode === "replay") {
      if (!selectedReplayHand || replayBigBlind <= 0 || selectedReplayHand.small_blind == null) return null;
      return { sb: selectedReplayHand.small_blind, bb: replayBigBlind, ante: selectedReplayHand.ante ?? 0, level: selectedReplayHand.level_number };
    }
    return liveHandBlinds;
  }, [mode, selectedReplayHand, replayBigBlind, liveHandBlinds]);

  // trackerShowdownRevealOrder (spectator): the player_ids in the order they should
  // table their cards at showdown — last aggressor on the final betting street first,
  // else first-to-act from the SB, then clockwise (pure showdownRevealOrder). Only the
  // showing players (hole cards revealed, non-folded). Constant for the hand, so it
  // drives the felt's staggered flip whenever the reveal frame renders. undefined
  // when the flag is off / ≤1 shown → simultaneous reveal (byte-identical).
  const showRevealOrder = spectator && FEATURES.trackerShowdownRevealOrder;
  const revealOrder = useMemo<string[] | undefined>(() => {
    if (!showRevealOrder) return undefined;
    const STREET_IDX: Record<string, number> = { preflop: 0, flop: 1, turn: 2, river: 3, showdown: 4 };
    const AGGR = new Set(["bet", "raise", "all_in"]);
    let shown: { player_id: string; seat_number: number }[];
    let acts: { street: string; seat_number: number; action_type: string; action_order: number }[];
    let btn: number;
    if (mode === "replay") {
      if (!selectedReplayHand) return undefined;
      const seatOfPid = new Map((selectedReplayHand.players || []).map((p) => [p.player_id, p.seat_number]));
      shown = (selectedReplayHand.players || [])
        .filter((p) => p.hole_cards && p.hole_cards.length === 2)
        .map((p) => ({ player_id: p.player_id, seat_number: p.seat_number }));
      acts = (selectedReplayHand.actions || []).map((a) => ({
        street: a.street,
        seat_number: seatOfPid.get(a.player_id) ?? 0,
        action_type: a.action_type,
        action_order: a.action_order,
      }));
      btn = selectedReplayHand.button_seat;
    } else {
      shown = seats
        .filter((s) => s.hole_cards && s.hole_cards.length === 2 && !s.is_folded)
        .map((s) => ({ player_id: s.player_id, seat_number: s.seat_number }));
      acts = actions.map((a) => ({
        street: a.street,
        seat_number: a.seat_number,
        action_type: a.action_type,
        action_order: a.action_order,
      }));
      btn = buttonSeat;
    }
    if (shown.length <= 1) return undefined;
    const maxStreet = acts.reduce((m, a) => Math.max(m, STREET_IDX[a.street] ?? 0), 0);
    const shownSeats = new Set(shown.map((s) => s.seat_number));
    const lastAggr = [...acts]
      .filter((a) => (STREET_IDX[a.street] ?? 0) === maxStreet && AGGR.has(a.action_type))
      .sort((a, b) => a.action_order - b.action_order)
      .pop();
    const finalAggressorSeat = lastAggr && shownSeats.has(lastAggr.seat_number) ? lastAggr.seat_number : null;
    const seatToPid = new Map(shown.map((s) => [s.seat_number, s.player_id]));
    return showdownRevealOrder({ shownSeatNumbers: shown.map((s) => s.seat_number), buttonSeat: btn, finalAggressorSeat })
      .map((sn) => seatToPid.get(sn))
      .filter((x): x is string => !!x);
  }, [showRevealOrder, mode, selectedReplayHand, seats, actions, buttonSeat]);

  // The most recent actor gets the spotlight ring on the felt.
  const latestAction = actions.length > 0 ? actions[actions.length - 1] : null;
  const lastActorId = latestAction?.player_id ?? null;

  // Entering replay freezes the felt; snapshot the live table so we can detect when
  // it has moved on. Going live clears the baseline (and any "new activity" prompt).
  const enterReplay = useCallback(() => {
    setLiveBaseline({ handNumber, actionCount: actions.length, boardCount: communityCards.length });
    setMode("replay");
  }, [handNumber, actions, communityCards]);

  const goLive = useCallback(() => {
    setMode("live");
    setLiveBaseline(null);
  }, []);

  // Deep-link (?hand=N from the spectator hand feed): jump into replay on that hand.
  // Resolve the replay target before choosing a table. A hand UUID is scoped to
  // this tournament; legacy hand numbers are accepted only when unambiguous.
  useEffect(() => {
    let cancelled = false;
    if (!requestedReplayTarget) {
      setReplayTargetState({ kind: "idle" });
      return;
    }

    // Never leave a prior hand visible while a new URL target is being
    // resolved. A missing or ambiguous target must not look like a fallback.
    setReplayHandId(null);
    setReplayHand(null);
    setReplayFrameState(null);
    setReplayFrameSource("jump");
    setReplayRunoutPresentation(null);
    setReplayMotionEpoch((epoch) => epoch + 1);
    setReplayTargetState({ kind: "loading" });
    const resolve = async () => {
      const publicReplay = spectator && FEATURES.publicSpectatorRealtimeV2;
      if (requestedReplayTarget.handId) {
        if (publicReplay && requestedReplayTarget.tableId) {
          const { data, error } = await supabase.rpc("get_public_tournament_table_hand_v2" as never, {
            p_tournament_id: tournamentId,
            p_tournament_table_id: requestedReplayTarget.tableId,
            p_hand_id: requestedReplayTarget.handId,
          } as never);
          if (cancelled) return;
          const hand = data as PublicHandResponse;
          if (error) {
            setReplayTargetState({ kind: "query_error" });
            return;
          }
          setReplayTargetState(resolveReplayCandidates(requestedReplayTarget, hand?.id ? [{
            id: hand.id, table_id: hand.tableId, hand_number: hand.handNumber,
            status: hand.status, is_voided: false,
          }] : []));
          return;
        }
        if (publicReplay) {
          const { data, error } = await supabase.rpc("get_public_tournament_hand_v2" as never, {
            p_tournament_id: tournamentId, p_hand_id: requestedReplayTarget.handId,
          } as never);
          if (cancelled) return;
          const hand = data as PublicHandResponse;
          if (error) { setReplayTargetState({ kind: "query_error" }); return; }
          setReplayTargetState(resolveReplayCandidates(requestedReplayTarget, hand?.id ? [{ id: hand.id, table_id: hand.tableId, hand_number: hand.handNumber, status: hand.status, is_voided: false }] : []));
          return;
        }
        const { data, error } = await supabase
          .from("tournament_hands")
          .select("id, table_id, hand_number, status, is_voided")
          .eq("tournament_id", tournamentId)
          .eq("id", requestedReplayTarget.handId)
          .eq("is_voided", false)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setReplayTargetState({ kind: "query_error" });
          return;
        }
        setReplayTargetState(resolveReplayCandidates(requestedReplayTarget, data ? [data] : []));
        return;
      }

      if (publicReplay) {
        const { data, error } = await supabase.rpc("get_public_tournament_hand_catalog_v2" as never, {
          p_tournament_id: tournamentId,
          p_tournament_table_id: requestedReplayTarget.tableId,
          p_limit: 101,
        } as never);
        if (cancelled) return;
        const catalog = data as PublicHandCatalogResponse;
        if (error || catalog?.access === "revoked") { setReplayTargetState({ kind: "query_error" }); return; }
        const rows = Array.isArray(catalog?.items) ? catalog.items.map((hand) => ({
          id: hand.id, table_id: hand.tableId, hand_number: hand.handNumber,
          status: hand.status, is_voided: hand.isVoided,
        })) : [];
        setReplayTargetState(resolveReplayCandidates(requestedReplayTarget, rows));
        return;
      }
      let query = supabase
        .from("tournament_hands")
        .select("id, table_id, hand_number, status, is_voided")
        .eq("tournament_id", tournamentId)
        .eq("hand_number", requestedReplayTarget.handNumber!)
        .eq("is_voided", false)
        .neq("status", "in_progress")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(2);
      if (requestedReplayTarget.tableId) query = query.eq("table_id", requestedReplayTarget.tableId);
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        setReplayTargetState({ kind: "query_error" });
      } else {
        setReplayTargetState(resolveReplayCandidates(requestedReplayTarget, data ?? []));
      }
    };
    void resolve();
    return () => { cancelled = true; };
  }, [requestedReplayTarget, spectator, tournamentId]);

  useEffect(() => {
    if (requestedReplayTarget) enterReplay();
  }, [requestedReplayTarget, enterReplay]);

  // ----- Multi-table resolution: never mix table_ids on one felt -----
  const tableIds = useMemo(
    () => [...new Set(seats.map((s) => s.table_id).filter((t): t is string => !!t))],
    [seats]
  );

  // A resolved replay hand owns its historical table. While a replay target is
  // loading or invalid, do not substitute the active table or another hand.
  const effectiveTableId = useMemo(() => {
    if (replayTargetState.kind === "resolved") return replayTargetState.tableId;
    if (requestedReplayTarget) return null;
    if (selectedTableIdOverride) return selectedTableIdOverride;
    if (selectedTableId) return selectedTableId;
    if (handTableId && tableIds.includes(handTableId)) return handTableId;
    if (tableIds.length === 1) return tableIds[0];
    return null;
  }, [replayTargetState, requestedReplayTarget, selectedTableIdOverride, selectedTableId, handTableId, tableIds]);

  useEffect(() => () => stopTrackerPokerSounds(), [mode, handId, selectedReplayHandKey, effectiveTableId]);

  const multiTableUnresolved = tableIds.length > 1 && !effectiveTableId;

  const visibleSeats = useMemo(() => {
    if (effectiveTableId) return seats.filter((s) => s.table_id === effectiveTableId);
    // No table_id info at all (legacy single-table data) → safe to show everything.
    if (tableIds.length <= 1) return seats;
    // Multiple tables, none resolved → render nothing rather than mixing tables.
    return [];
  }, [seats, effectiveTableId, tableIds]);

  // Positions are only meaningful when we're showing the table the current hand is on.
  const positionedSeats = useMemo(() => {
    const active = visibleSeats.filter((s) => s.is_active);
    const handMatchesView =
      handNumber != null && (handTableId == null || handTableId === effectiveTableId);
    if (!handMatchesView || active.length === 0) return visibleSeats;
    // Gap-robust labels: getSeatPositions orders the OCCUPIED seats clockwise
    // from the button, so non-contiguous seats (e.g. 1,3,5,7 after eliminations)
    // still get the correct BTN/SB/BB/UTG… Raw getPosition (seat−btn mod count)
    // mislabels once seats have gaps.
    const posBySeat = getSeatPositions(active.map((s) => s.seat_number), buttonSeat);
    return visibleSeats.map((s) => ({
      ...s,
      position: s.is_active ? posBySeat.get(s.seat_number) ?? "" : "",
    }));
  }, [visibleSeats, handNumber, handTableId, effectiveTableId, buttonSeat]);

  const activeSeatsToRender = useMemo(
    () => positionedSeats.filter((s) => s.is_active),
    [positionedSeats]
  );

  useEffect(() => {
    if (!FEATURES.liveTableMotionV2 || !spectator || mode !== "live" || !handInProgress || !handId) return;
    const previous = previousLiveHandRef.current;
    previousLiveHandRef.current = handId;
    if (previous === null || previous === handId) return;
    const seatNumbers = activeSeatsToRender.map((seat) => seat.seat_number);
    if (seatNumbers.length >= 2) {
      enqueueTableMotion([{ id: `live:${handId}:deal`, handId, kind: "deal_hole", seatNumbers }]);
    }
  }, [activeSeatsToRender, enqueueTableMotion, handId, mode, spectator, handInProgress]);

  // Lazy table names for the selector — read-only RPC already used by other tracker panels.
  const tableIdsKey = tableIds.join(",");
  useEffect(() => {
    if (tableIds.length <= 1) return;
    let cancelled = false;
    supabase
      .rpc("get_tournament_tables", { p_tournament_id: tournamentId })
      .then(({ data }) => {
        if (cancelled || !data || !Array.isArray(data)) return;
        const m: Record<string, string> = {};
        data.forEach((t: any) => {
          if (t.table_id) m[t.table_id] = t.table_name || "";
        });
        setTableNames(m);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableIdsKey, tournamentId]);

  if (loading) {
    return (
      <Card className="p-6 space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  if (fatalError) {
    return (
      <Card className="p-8 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 mx-auto text-destructive" />
        <div className="font-semibold">Không tải được dữ liệu live tracker</div>
        <p className="text-xs text-muted-foreground break-all">{fatalError}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setFatalError(null);
            setLoading(true);
            loadAllData();
          }}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Thử lại
        </Button>
      </Card>
    );
  }

  const headerHandNumber = isReplay ? replayHeaderMetadata.handNumber : handNumber;
  const headerPlayerCount = isReplay ? replayHeaderMetadata.playerCount : playersRemaining;
  const headerAverageStack = isReplay ? replayHeaderMetadata.averageStack : averageStack;
  const headerPotSize = isReplay ? replayHeaderMetadata.potSize : potSize;
  const headerFormatBB = isReplay ? replayFormatBB : formatBB;
  const headerStreet = isReplay ? selectedReplayFrame?.currentStreet ?? null : currentStreet;
  // Has the live table advanced since the spectator entered replay? Same-hand new
  // actions get a count; a new hand (or board change) shows the generic prompt.
  const sameLiveHand = liveBaseline != null && handNumber === liveBaseline.handNumber;
  const newLiveActionCount = sameLiveHand
    ? Math.max(0, actions.length - liveBaseline.actionCount)
    : null;
  const hasNewLiveActivity =
    isReplay &&
    liveBaseline != null &&
    (handNumber !== liveBaseline.handNumber ||
      actions.length !== liveBaseline.actionCount ||
      communityCards.length !== liveBaseline.boardCount);
  // The live current hand belongs to one table; only show its breakdown when the
  // viewer is looking at that table (else the felt shows a different table).
  const liveHandOnView =
    handNumber != null && (handTableId == null || handTableId === effectiveTableId);
  // The felt renders either live state or the current replay frame — same props.
  const feltProps = isReplay
    ? selectedReplayFrame
      ? {
          seats: selectedReplayFrame.seats,
          lastActorId: selectedReplayFrame.lastActorId,
          toActId: null,
          displayCards: replayDisplayCards ?? selectedReplayFrame.displayCards,
          potSize: selectedReplayFrame.potSize,
          potBreakdown: selectedReplayFrame.potBreakdown,
          multiTableUnresolved: false,
          handNumber: selectedReplayHand?.hand_number ?? null,
          latestAction: selectedReplayFrame.latestAction,
          showdownResult: selectedReplayFrame.showdownResult,
          formatBB: replayFormatBB,
          buttonSeat: selectedReplayHand?.button_seat ?? null,
          motionHandKey: selectedReplayHand
            ? `${selectedReplayHand.hand_id ?? `hand-${selectedReplayHand.hand_number}`}:run-${replayMotionEpoch}`
            : null,
        }
      : {
          seats: [] as SeatInfo[],
          lastActorId: null,
          toActId: null,
          displayCards: ["", "", "", "", ""],
          potSize: 0,
          potBreakdown: null,
          multiTableUnresolved: false,
          handNumber: null,
          latestAction: null as ActionLog | null,
          formatBB: replayFormatBB,
          buttonSeat: null,
          motionHandKey: null,
        }
    : {
        seats: spectator && livePayoutKey && liveCompletedFrame ? liveCompletedFrame.seats : activeSeatsToRender,
        lastActorId: tableDisplayState === "last_completed" ? null : lastActorId,
        toActId: spectator && FEATURES.liveActionEngine && tableDisplayState === "live" ? toActId : null,
        displayCards,
        potSize,
        potBreakdown,
        multiTableUnresolved,
        handNumber,
        latestAction,
        formatBB,
        buttonSeat,
        motionHandKey: tableDisplayState === "last_completed" ? null : handId,
      };
  const guardViewerIdentity = spectator && FEATURES.liveViewerRPTShell;
  const safeViewerName = (name: string | null | undefined, playerId: string): string => {
    if (!guardViewerIdentity) return name || playerId.slice(0, 6);
    const trimmed = name?.trim() || "";
    const prefix = playerId.slice(0, 6).toLowerCase();
    return trimmed && trimmed.toLowerCase() !== prefix && !/^[a-f0-9]{6}$/i.test(trimmed) && !/^[a-f0-9-]{24,}$/i.test(trimmed)
      ? trimmed
      : t("liveHub.handFeed.unknownPlayer", "Người chơi");
  };
  const viewerFeltProps = guardViewerIdentity
    ? {
        ...feltProps,
        seats: feltProps.seats.map((seat) => ({
          ...seat,
          display_name: safeViewerName(seat.display_name, seat.player_id),
        })),
        latestAction: feltProps.latestAction
          ? {
              ...feltProps.latestAction,
              display_name: safeViewerName(feltProps.latestAction.display_name, feltProps.latestAction.player_id),
            }
          : feltProps.latestAction,
      }
    : feltProps;
  const viewerReplayPlayers = guardViewerIdentity && selectedReplayHand
    ? selectedReplayHand.players.map((player) => ({
        ...player,
        display_name: safeViewerName(player.display_name, player.player_id),
      }))
    : selectedReplayHand?.players;

  if (tablePanel === "history") {
    return <div className="space-y-3">
      <TrackerVisualStyles />
      <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs font-bold">
        <button type="button" onClick={() => { setTablePanel("felt"); goLive(); }} className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-muted-foreground hover:text-emerald-300"><Radio className="h-3.5 w-3.5" /> {tableDisplayState === "last_completed" ? "Bàn" : "LIVE"}</button>
        <button type="button" onClick={() => { setTablePanel("felt"); enterReplay(); }} className="flex min-h-11 items-center gap-1.5 border-l border-border px-3 py-1.5 text-muted-foreground hover:text-amber-300"><History className="h-3.5 w-3.5" /> Phát lại</button>
        <button type="button" aria-current="page" className="flex min-h-11 items-center gap-1.5 border-l border-border bg-[hsl(var(--viewer-neon)_/_0.14)] px-3 py-1.5 text-[hsl(var(--viewer-neon))]"><History className="h-3.5 w-3.5" /> Lịch sử bàn chơi</button>
      </div>
      <TableHistoryPanel
        tournamentId={tournamentId}
        tableId={effectiveTableId}
        currentSessionId={tableSessionId}
        onSelectHand={(target) => {
          setHistoryReplayTarget(target);
          setTablePanel("felt");
          setMode("replay");
          onReplayTargetChange?.(target);
        }}
        onAccessRevoked={() => {
          setHistoryReplayTarget(null);
          setReplayHand(null);
          setReplayHandId(null);
          setReplayFrameState(null);
          setFatalError("Lịch sử bàn không còn được công khai.");
        }}
      />
    </div>;
  }

  return (
    <div className="space-y-3">
      <TrackerVisualStyles />
      {canTdAi && !spectator && (
        <TdAiAssistantPanel open={tdAiOpen} onOpenChange={setTdAiOpen} tournamentId={tournamentId} />
      )}
      {!spectator && realtimeStatus === "offline" && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/15 border border-amber-500/30 rounded-lg text-xs text-amber-400">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            Realtime offline — dữ liệu có thể cũ. Tự động tải lại mỗi 30 giây.
            {lastUpdatedAt && <> Cập nhật cuối: {formatClockTime(lastUpdatedAt)}.</>}
          </span>
        </div>
      )}
      {!spectator && realtimeStatus === "connecting" && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground">
          <RefreshCw className="w-3 h-3 animate-spin" /> Đang kết nối realtime...
        </div>
      )}
      {!spectator && softErrorAt && (
        <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Không tải được dữ liệu mới nhất ({formatClockTime(softErrorAt)}) — đang hiển thị lần cập
            nhật cuối{lastUpdatedAt && <> lúc {formatClockTime(lastUpdatedAt)}</>}.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2 p-3 bg-gradient-to-r from-card to-card/80 border border-emerald-500/20 rounded-lg border-l-4 border-l-emerald-500 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-lg font-bold text-emerald-400 tracking-wide">
            {headerHandNumber
              ? `Hand #${headerHandNumber}`
              : isReplay
                ? replayTargetState.kind === "idle" || replayTargetState.kind === "loading"
                  ? "Loading replay..."
                  : "Replay unavailable"
                : "Waiting..."}
          </div>
          {headerStreet && (
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest border ${
                headerStreet === "showdown"
                  ? "bg-red-500/15 text-red-400 border-red-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
              }`}
            >
              {headerStreet}
            </span>
          )}
          {!isReplay && tableDisplayState === "live" && clockData && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-400 rounded-md text-sm font-mono font-bold border border-amber-500/20">
              <Clock className="w-4 h-4" />
              {formatTime(Math.max(0, localRemaining))}
            </span>
          )}
          {!isReplay && tableDisplayState === "live" && clockData?.current_level && (
            <span className="text-xs text-muted-foreground font-mono">
              Lv.{clockData.current_level} &middot; {formatStack(clockData.small_blind)}/
              {formatStack(clockData.big_blind)}
              {clockData.ante > 0 && (
                <span className="text-amber-400">
                  {" "}
                  &middot; A {formatStack(clockData.ante)}
                </span>
              )}
            </span>
          )}
          {!isReplay && tableDisplayState === "last_completed" && liveHandBlinds && (
            <span className="text-xs text-muted-foreground font-mono">
              {formatViewerChipCompact(liveHandBlinds.sb)}/{formatViewerChipCompact(liveHandBlinds.bb)} · Ante {formatViewerChipCompact(liveHandBlinds.ante)}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {canTdAi && !spectator && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-emerald-500/40 text-emerald-300 hover:text-emerald-200"
              onClick={() => setTdAiOpen(true)}
            >
              <Bot className="w-3.5 h-3.5 mr-1" /> {t("tdAi.entry")}
            </Button>
          )}
          {headerPlayerCount != null && (
            <span className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> {headerPlayerCount} {t("tournamentLive.liveView.players")}
            </span>
          )}
          {headerAverageStack != null && (
            <span className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" /> AVG: {spectator ? (headerFormatBB(headerAverageStack) ?? "— BB") : formatStack(headerAverageStack)}
            </span>
          )}
          {headerPotSize != null && (
            <span className="flex items-center gap-1">
              <Coins className="w-3.5 h-3.5 text-emerald-400" /> Pot:{" "}
              <strong className="text-emerald-400 text-sm">{spectator ? formatViewerChipAndBB(tableDisplayState === "last_completed" && handPotMissing ? null : headerPotSize, isReplay ? replayBigBlind : bigBlind) : formatStack(headerPotSize)}</strong>
              {!spectator && headerPotSize > 0 && headerFormatBB(headerPotSize) && (
                <span className="text-[10px] text-muted-foreground">({headerFormatBB(headerPotSize)})</span>
              )}
            </span>
          )}
          {!isReplay && lastUpdatedAt && (
            <span className="text-[10px] text-muted-foreground/70" title="Lần cập nhật dữ liệu thành công gần nhất">
              ↻ {formatClockTime(lastUpdatedAt)}
            </span>
          )}
          <button
            onClick={toggleSoundMuted}
            title={soundMuted ? "Bật âm thanh hành động" : "Tắt âm thanh hành động"}
            className={`p-1.5 rounded-md border transition-colors ${
              soundMuted
                ? "text-muted-foreground border-border hover:border-amber-500/40"
                : "text-amber-400 border-amber-500/40 bg-amber-500/10"
            }`}
          >
            {soundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {spectator && handId && bigBlind <= 0 && (
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          {t("liveHub.replay.missingBlind", "Chưa có blind của hand")}
        </div>
      )}

      {/* Operator-only inline table picker. Hidden for spectators — the viewer
          hub provides the table-map picker (which drives selectedTableIdOverride). */}
      {!spectator && tableIds.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-card border border-emerald-500/20 rounded-lg text-xs">
          <span className="text-muted-foreground">
            Giải có nhiều bàn — chọn bàn để xem live:
          </span>
          {tableIds.map((tid) => (
            <button
              key={tid}
              onClick={() => setSelectedTableId(tid)}
              className={`px-2.5 py-1 rounded-md border font-semibold transition-colors ${
                effectiveTableId === tid
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                  : "bg-transparent text-muted-foreground border-border hover:border-emerald-500/40"
              }`}
            >
              {tableNames[tid] || (spectator && FEATURES.liveViewerRPTShell ? t("liveHub.watch.liveTable", "Bàn trực tiếp") : tid.slice(0, 6))}
              {handTableId === tid && <span className="ml-1 text-[9px] text-amber-400">● hand</span>}
            </button>
          ))}
        </div>
      )}

      {/* Live / Replay mode toggle — available to spectators too, so the public
          viewer can replay past hands (watch what happened). */}
      <div className="flex items-center gap-3 flex-wrap">
        {!spectator && <TrackerCardStyleToggle />}
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs font-bold">
          <button
            onClick={goLive}
            className={`flex min-h-11 items-center gap-1.5 px-3 py-1.5 transition-colors ${
              !isReplay && tableDisplayState === "live" ? "bg-emerald-500/20 text-emerald-300" : "text-muted-foreground hover:text-emerald-300"
            }`}
          >
            <Radio className="w-3.5 h-3.5" /> {tableDisplayState === "last_completed" && !isReplay ? "Bàn" : "LIVE"}
          </button>
          <button
            onClick={enterReplay}
            className={`flex min-h-11 items-center gap-1.5 px-3 py-1.5 transition-colors border-l border-border ${
              isReplay ? "bg-amber-500/20 text-amber-300" : "text-muted-foreground hover:text-amber-300"
            }`}
          >
            <History className="w-3.5 h-3.5" /> Phát lại
          </button>
          {spectator && FEATURES.publicSpectatorLastHandHistory && (
            <button
              type="button"
              onClick={() => setTablePanel("history")}
              className="flex min-h-11 items-center gap-1.5 border-l border-border px-3 py-1.5 text-muted-foreground transition-colors hover:text-[hsl(var(--viewer-neon))]"
            >
              <History className="w-3.5 h-3.5" /> Lịch sử bàn chơi
            </button>
          )}
        </div>
        {isReplay && (
          <HandSelector
            tournamentId={tournamentId}
            tableId={effectiveTableId}
            spectator={spectator && FEATURES.publicSpectatorRealtimeV2}
            selectedHandId={replayHandId}
            replayTarget={requestedReplayTarget}
            replayTargetState={replayTargetState}
            onSelectReplayTarget={onReplayTargetChange}
            onLoadStart={(id) => {
              setReplayHandId(id);
              setReplayHand(null);
              setReplayFrameState(null);
              setReplayFrameSource("jump");
              setReplayRunoutPresentation(null);
              replayMotionFrameRef.current = null;
              setTableMotionEvents([]);
              setReplayMotionEpoch((current) => current + 1);
            }}
            onSelectHand={(id, h) => {
              if (requestedReplayTarget && (replayTargetState.kind !== "resolved" || replayTargetState.handId !== id)) return;
              setReplayHandId(id);
              setReplayHand(h);
            }}
          />
        )}
      </div>

      {/* Replay-mode awareness: paused-updates notice, and a jump-back-to-live
          prompt when the live table has moved on while watching a past hand. */}
      {isReplay && (
        <ReplayLiveBanner
          hasNewActivity={hasNewLiveActivity}
          newActionCount={newLiveActionCount}
          onGoLive={goLive}
        />
      )}

      <div className={spectator && ((isReplay && selectedReplayHand && FEATURES.liveReplayHud) || (!isReplay && liveHandOnView && actions.length > 0))
        ? "grid grid-cols-1 gap-3 min-[1200px]:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)] min-[1200px]:items-start"
        : spectator ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 min-[1200px]:grid-cols-[minmax(0,1fr)_280px] gap-3"}>
        <div className="min-w-0">
          {spectator && !isReplay && (tableDisplayState === "waiting" || tableDisplayState === "inactive" || tableDisplayState === "closed") ? (
            <div className="grid min-h-72 place-items-center rounded-[28px] border border-[hsl(var(--viewer-neon)_/_0.28)] bg-card/55 px-5 text-center">
              <div><Users className="mx-auto h-7 w-7 text-[hsl(var(--viewer-neon))]" /><p className="mt-3 text-sm font-bold text-foreground">{tableDisplayState === "waiting" ? "Đang chờ ván đầu" : tableDisplayState === "inactive" ? "Bàn chưa hoạt động" : "Phiên bàn đã đóng"}</p><p className="mt-1 text-xs text-muted-foreground">Trạng thái được xác nhận từ bàn hiện tại.</p></div>
            </div>
          ) : spectator && FEATURES.liveViewerPulseV2 && !isReplay && activeSeatsToRender.length === 0 ? (
            <div className="grid min-h-72 place-items-center rounded-[28px] border border-[hsl(var(--viewer-neon)_/_0.28)] bg-card/55 px-5 text-center">
              <div><Users className="mx-auto h-7 w-7 text-[hsl(var(--viewer-neon))]" /><p className="mt-3 text-sm font-bold text-foreground">Đang đồng bộ người chơi</p><p className="mt-1 text-xs text-muted-foreground">Bàn và action sẽ hiện ngay khi snapshot của ván được tải.</p></div>
            </div>
          ) : (
            <LiveFelt
              {...viewerFeltProps}
              portrait={orientationOverride ? orientationOverride === "portrait" : undefined}
              viewerNeon={spectator && FEATURES.liveHandFeed}
              viewerLayout={spectator && FEATURES.liveViewerFeltV2}
              viewerAmountsInBB={spectator}
              viewerBigBlind={isReplay ? replayBigBlind : bigBlind}
              tableFx={spectator && FEATURES.liveTableFx && (isReplay || tableDisplayState !== "last_completed")}
              chipPush={spectator && FEATURES.liveTableFx && tableDisplayState !== "last_completed" ? chipPush : null}
              potUnavailable={!isReplay && tableDisplayState === "last_completed" && handPotMissing}
              compact={compactFelt}
              blinds={feltBlinds}
              appearance={appearance.data}
              runout={!isReplay && tableDisplayState === "live" && liveRunout}
              collectCommittedChips={tableDisplayState !== "last_completed" && collectCommittedChips}
              revealOrder={revealOrder}
              motionEnabled={spectator && FEATURES.liveTableMotionV2 && (isReplay || tableDisplayState !== "last_completed")}
              motionEvents={tableDisplayState === "last_completed" && !isReplay ? [] : tableMotionEvents}
              motionSpeed={isReplay ? (spectator && FEATURES.liveReplayHud ? replayMotionSpeed : 2) : 1}
              bestFiveFocus={spectator
                ? isReplay && FEATURES.liveReplayHud && replayFocusPhase !== "hidden"
                  ? replayVisibleShowdownPresentation?.focus ?? null
                  : !isReplay && livePayoutForHand?.phase !== "pot_collect" ? liveVisibleShowdownPresentation?.focus ?? null : null
                : null}
              showdownPresentation={spectator
                ? isReplay && FEATURES.liveReplayHud
                  ? replayVisibleShowdownPresentation ?? replayShowdownPresentation
                  : !isReplay ? liveVisibleShowdownPresentation : null
                : null}
              bestFiveFocusPhase={isReplay ? replayFocusPhase : replayRunoutFocusPhase(livePayoutForHand?.phase ?? null)}
              replayRunoutPhase={spectator && isReplay && FEATURES.liveReplayHud
                ? replayRunoutForSelectedHand?.phase ?? null
                : null}
              replayRunoutPresentation={spectator
                ? isReplay && FEATURES.liveReplayHud ? replayFeltPayout : !isReplay ? livePayoutForHand : null
                : null}
              hideUnrecordedHoleCards={spectator && !isReplay && tableDisplayState === "last_completed"}
            />
          )}
          {isReplay && selectedReplayHand && !(spectator && FEATURES.liveReplayHud) && (
            <ReplayScrubber
              key={selectedReplayHand.hand_id ?? `hand-${selectedReplayHand.hand_number}`}
              hand={selectedReplayHand}
              onFrame={handleSelectedReplayFrame}
              hud={spectator && FEATURES.liveReplayHud}
              trackBets={spectator && FEATURES.liveFeltCompact}
              onSpeedChange={setReplayMotionSpeed}
            />
          )}

          {/* Public spectator-only broadcast action breakdown. Spectator-gated →
              the operator render path emits nothing new. */}
          {spectator && isReplay && selectedReplayHand && !FEATURES.liveReplayHud && (
            <HandBreakdown
              actions={selectedReplayHand.actions}
              players={viewerReplayPlayers || selectedReplayHand.players}
              buttonSeat={selectedReplayHand.button_seat}
              bigBlind={replayBigBlind}
              highlightActionOrder={selectedReplayFrame?.latestAction?.action_order}
              showdownResult={selectedReplayFrame?.showdownResult}
            />
          )}
        </div>
          {spectator && !isReplay && liveHandOnView && actions.length > 0 && (
            <aside className="min-w-0">
            <HandBreakdown
              actions={actions}
              players={activeSeatsToRender.map((s) => ({
                player_id: s.player_id,
                seat_number: s.seat_number,
                display_name: guardViewerIdentity ? safeViewerName(s.display_name, s.player_id) : s.display_name,
                avatar_url: s.avatar_url,
              }))}
              buttonSeat={buttonSeat}
              bigBlind={bigBlind}
            />
            </aside>
          )}

        {spectator && isReplay && selectedReplayHand && FEATURES.liveReplayHud && (
          <aside className="min-w-0 min-[1200px]:sticky min-[1200px]:top-[calc(env(safe-area-inset-top)+3.75rem)]">
            <ReplayScrubber
              key={selectedReplayHand.hand_id ?? `hand-${selectedReplayHand.hand_number}`}
              hand={selectedReplayHand}
              onFrame={handleSelectedReplayFrame}
              hud
              trackBets={FEATURES.liveFeltCompact}
              onSpeedChange={setReplayMotionSpeed}
              showdownPresentation={replayShowdownPresentation}
              onRunoutPresentation={handleSelectedReplayRunoutPresentation}
              selectedPotIndex={replaySelectedPotIndex}
              onSelectedPotIndexChange={setReplaySelectedPotIndex}
            />
          </aside>
        )}

        {!spectator && (
        <div className="space-y-3">
          {!isReplay && (
          <div className="bg-card border border-emerald-500/20 rounded-xl p-3">
            <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-2 pb-2 border-b border-emerald-500/10">
              {t("tournamentLive.liveView.actionTimeline")}
            </div>
            <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1">
              {actions.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4 italic">
                  {t("tournamentLive.liveView.noActions")}
                </div>
              )}
              {STREET_ORDER.filter((s) => actions.some((a) => a.street === s)).map((street) => (
                <div key={street} className="mb-2">
                  <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">
                    {STREET_LABELS[street]}
                    {street === "flop" &&
                      displayCards[0] && (
                        <span className="text-muted-foreground font-normal ml-1">
                          ({displayCards
                            .slice(0, 3)
                            .filter(Boolean)
                            .map(displayCard)
                            .join(" ")})
                        </span>
                      )}
                    {street === "turn" &&
                      displayCards[3] && (
                        <span className="text-muted-foreground font-normal ml-1">
                          ({displayCard(displayCards[3])})
                        </span>
                      )}
                    {street === "river" &&
                      displayCards[4] && (
                        <span className="text-muted-foreground font-normal ml-1">
                          ({displayCard(displayCards[4])})
                        </span>
                      )}
                  </div>
                  {actions
                    .filter((a) => a.street === street)
                    .map((action, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between py-1 px-1.5 border-b border-border/10 last:border-0 text-xs"
                      >
                        <span className="text-muted-foreground">
                          <span className="text-emerald-400 font-semibold">
                            {action.display_name}
                          </span>
                        </span>
                        <span
                          className={`font-semibold ${action.action_amount > 0 ? "text-amber-400" : "text-muted-foreground"}`}
                        >
                          {formatActionLabel(action)}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
          )}

          <div className="bg-card border border-emerald-500/20 rounded-xl p-3">
            <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-2 pb-2 border-b border-emerald-500/10">
              {t("tournamentLive.liveView.tableStats")}
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>{t("tournamentLive.liveView.playersRemaining")}</span>
                <span className="text-emerald-400 font-semibold">{playersRemaining}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t("tournamentLive.liveView.averageStack")}</span>
                <span className="text-emerald-400 font-semibold">
                  {formatStack(averageStack)}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t("tournamentLive.liveView.currentPot")}</span>
                <span className="text-emerald-400 font-semibold">{formatStack(potSize)}</span>
              </div>
              {clockData && (
                <>
                  <div className="pt-1.5 border-t border-border/20 text-muted-foreground">
                    <p className="font-semibold">{t("tournamentLive.liveView.currentTournamentClock")}</p>
                    {feltBlinds && (
                      <p className="mt-1 text-[10px] leading-relaxed">
                        {t("tournamentLive.liveView.handBlindsContext")}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("tournamentLive.liveView.level")}</span>
                    <span className="text-emerald-400 font-semibold">
                      {clockData.current_level || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("tournamentLive.liveView.blinds")}</span>
                    <span className="text-amber-400 font-semibold">
                      {formatStack(clockData.small_blind)}/{formatStack(clockData.big_blind)}
                    </span>
                  </div>
                  {clockData.ante > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>{t("tournamentLive.liveView.ante")}</span>
                      <span className="text-amber-400 font-semibold">
                        {formatStack(clockData.ante)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
