// Controller hook for the STANDALONE operator console (`/tracker/hand-input`).
//
// It is the ENGINE-ONLY subset of HandInputPanel's orchestration: the console is
// mounted only when `FEATURES.trackerEngineMode` is on (the page gates it), so the
// manual-mode branches (advisory nextToAct, manual bet sizing, manual board/street
// jump) are dropped here — the engine path is unconditional. The embedded
// HandInputPanel is NOT touched; this hook reuses the SAME pure libraries
// (trackerEngine, trackerWorkflow, button, resumeHand, potEngine, handFlow) and the
// SAME 7 Edge payloads (built in handInputEdge.ts), so "write-path unchanged" is
// provable, not just asserted.
//
// URL keys are DISTINCT from the panel's `hiTable`: `table` is the authoritative
// resume key; `hand`/`street`/`actor` are write-only mirrors (never read back, so
// no resume loops) for the mockup's refresh-safe context.

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Card } from "@/components/shared/CardSlotPicker";
import { getSeatPositions } from "@/lib/tournament/button";
import { nextButtonFromBlindLineage } from "@/lib/tournament/deadButton";
import { readBlindLineage, readHandBlindLevel, type RecordedBlindLineage } from "@/lib/tournament/readBlindLineage";
import {
  replayActions,
  deriveResumeStreet,
  nextActionOrderFrom,
  type ResumeActionRow,
} from "./resumeHand";
import { computePotBreakdown, contributionsFromActions, toSidePotsJson } from "@/lib/tracker-poker/potEngine";
import { actorView } from "@/lib/tracker-poker/handFlow";
import {
  actorToAct,
  isRoundComplete,
  betToAdded,
  foldWinner,
  settleFoldWin,
  settleSelectedWinners,
  blindSeats,
  firstPreflopActor,
  snapshotBlindLevel,
  hasLevelChangedDuringHand,
  isRunout,
  showdownRevealOrder,
  type EngineState,
  type BlindLevelSnapshot,
  type ClockLevel,
} from "@/lib/tracker-poker/trackerEngine";
import { FEATURES } from "@/lib/featureFlags";
import { settleShowdown, type ShowdownLayerResult } from "@/lib/tracker-poker/trackerShowdown";
import { computeRankShifts } from "@/lib/tracker-poker/rankShift";
import { clearBettingState, survivorsAfterHand } from "./postHand";
import {
  deriveTrackerWorkflowState,
  isActionState,
  isBoardEntryState,
  boardEntryStreet,
  REQUIRED_BOARD_COUNT,
} from "./trackerWorkflow";
import type { RailSeat } from "./SeatRail";
import type { InputTableLoadState, InputTableSummary } from "./InputTableMap";
import { resolveTournamentTableId, type TournamentTableIdentityRow } from "./tableIdentity";
import { formatStack } from "./format";
import { friendlyValidationError } from "./validationMessages";
import {
  buildNextHandNumberRequest,
  classifyActionWriteFailure,
  createActionWriteGuard,
  createTableLoadGuard,
  isConfirmedActionWrite,
  isConfirmedCompletedHandReadback,
  isConfirmedRosterWrite,
  resolveTableHandIdentity,
  type TableLoadToken,
} from "./trackerAsyncGuards";
import { createSingleFlightGuard } from "@/lib/singleFlight";
import type { SyncPhase } from "./ViewerSyncStatus";
import type { User } from "@supabase/supabase-js";
import {
  buildStartHandBody,
  buildRecordActionBody,
  buildUpdateCommunityCardsBody,
  buildShowHoleCardsBody,
  buildRecordHandBody,
  buildVoidHandBody,
  buildDeleteLastActionBody,
  readEdgeError,
  type EdgePlayer,
} from "./handInputEdge";
import {
  ROLLBACK_CLEAR_FROM,
  ROLLBACK_STREET_LABELS,
  nextRollbackStep,
  planStreetRollback,
  rollbackTargetFrom,
  type StreetRollbackState,
} from "./streetRollback";
import {
  ACTION_SOUND_KINDS,
  playTrackerSound,
  playTrackerSoundOnce,
} from "@/lib/trackerSound";
import type { PokerLiveSound } from "@/lib/pokerLiveSound";
import { ensureRecordedHandDisplayOutcome } from "@/lib/tracker-poker/recordedHandDisplayOutcome";
import type {
  VoiceActionMetadata,
  VoiceActionProposal,
  VoiceBoardCommitReceipt,
  VoiceFinishCommitReceipt,
  VoiceHoleCardsCommitReceipt,
} from "@/lib/trackerVoice";
import { resolveHandLockActorId, resolveHandLockClaim } from "./handLockClaim";

type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export interface PlayerState {
  player_id: string;
  entry_number: number;
  seat_number: number;
  display_name: string;
  starting_stack: number;
  current_stack: number;
  is_active: boolean;
  position: string;
  current_bet: number;
  total_bet: number;
  is_folded: boolean;
  is_all_in: boolean;
  avatar_url?: string | null;
}

export interface ActionRecord {
  street: Street;
  player_id: string;
  display_name: string;
  seat_number: number;
  action_type: string;
  amount: number;
  action_order: number;
}

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];
const STREET_LABELS: Record<Street, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

function formatActionLabel(a: ActionRecord): string {
  const type = a.action_type;
  if (type === "fold") return "Fold";
  if (type === "check") return "Check";
  if (type === "call") return `Call ${formatStack(a.amount)}`;
  if (type === "bet") return `Bet ${formatStack(a.amount)}`;
  if (type === "raise") return `Raise ${formatStack(a.amount)}`;
  if (type === "all_in") return `All-In ${formatStack(a.amount)}`;
  if (type === "post_sb") return `SB ${formatStack(a.amount)}`;
  if (type === "post_bb") return `BB ${formatStack(a.amount)}`;
  if (type === "post_ante") return `Ante ${formatStack(a.amount)}`;
  return `${type} ${formatStack(a.amount)}`;
}

const STREET_LABELS_EXPORT = STREET_LABELS;
export { STREET_LABELS_EXPORT as STANDALONE_STREET_LABELS };

// trackerMultiTable: map one get_tracker_table_locks row → the InputTableSummary lock
// fields. Shared by the initial load AND the periodic refresh so the two never drift.
function lockFieldsFrom(lock: any) {
  const ageSec = lock?.heartbeat_age_seconds;
  return {
    lockHandId: lock?.hand_id ?? null,
    lockedByName: lock?.locked_by_name ?? null,
    lockedByOther: !!lock && !lock.is_self && lock.locked_by_user_id != null,
    lockAgeMin: typeof ageSec === "number" ? Math.floor(ageSec / 60) : null,
    lockStale: !!lock?.is_stale,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function useStandaloneHandInput(tournamentId: string) {
  const [tableId, setTableId] = useState("");
  const [tableName, setTableName] = useState("");
  const [handNumber, setHandNumber] = useState<number | "">("");
  const [availableTables, setAvailableTables] = useState<InputTableSummary[]>([]);
  const [tableLoadState, setTableLoadState] = useState<InputTableLoadState>("loading");
  const [tableLoadError, setTableLoadError] = useState<string | null>(null);
  const [tableReloadAttempt, setTableReloadAttempt] = useState(0);
  const [tableSelectionNotice, setTableSelectionNotice] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [currentStreet, setCurrentStreet] = useState<Street>("preflop");
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [communityCards, setCommunityCards] = useState<(Card | null)[]>([null, null, null, null, null]);
  const [betAmount, setBetAmount] = useState("");
  const [buttonSeat, setButtonSeat] = useState<number>(1);
  const [buttonConfirmed, setButtonConfirmed] = useState(false);
  // Preceding hand blind positions drive only the next-hand suggestion.
  const [maxSeats, setMaxSeats] = useState<number>(9);
  const [lastBlindLineage, setLastBlindLineage] = useState<RecordedBlindLineage | null>(null);
  const [buttonOverridden, setButtonOverridden] = useState(false);
  const [selectedWinners, setSelectedWinners] = useState<string[]>([]);
  const [muckedPlayerIds, setMuckedPlayerIds] = useState<Set<string>>(new Set());
  const [showdownLayers, setShowdownLayers] = useState<ShowdownLayerResult[]>([]);
  // P2-2: the operator has flipped hole cards for an all-in runout this hand.
  const [revealDone, setRevealDone] = useState(false);
  // UAT wave 2 (P1 undo rule): hole cards were actually BROADCAST (persisted) this
  // hand — an undo then preserves revealDone; a never-broadcast reveal/skip is
  // cleared when the restored snapshot is no longer a runout.
  const holeCardsBroadcastRef = useRef(false);
  const [blindLevelSnapshot, setBlindLevelSnapshot] = useState<BlindLevelSnapshot | null>(null);
  const [blindLevelCanonical, setBlindLevelCanonical] = useState(false);
  const [blindsConfirmedLocal, setBlindsConfirmedLocal] = useState(false);
  // P2-3: operator marks this hand as having a dead small blind (no SB posted).
  const [deadSb, setDeadSb] = useState(false);
  const [sbAmount, setSbAmount] = useState(0);
  const [bbAmount, setBbAmount] = useState(0);
  const [liveLevelNumber, setLiveLevelNumber] = useState<number | null>(null);
  // A1 (trackerBlindAutoSeed): the FULL live level from the 25s poll (amounts, not just
  // the number) so the stale-level banner can show next-hand SB/BB, + when the blind
  // snapshot was fetched (provenance shown in BlindSetupPanel). Both are inert extra
  // state unless the flag-gated UI consumes them.
  const [liveLevel, setLiveLevel] = useState<ClockLevel | null>(null);
  const [blindFetchedAt, setBlindFetchedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionSyncBlocked, setActionSyncBlocked] = useState(false);
  const [syncPhase, setSyncPhase] = useState<SyncPhase>("idle");
  const [syncLabel, setSyncLabel] = useState<string | null>(null);
  const [handId, setHandId] = useState<string | null>(null);
  const [handStarted, setHandStarted] = useState(false);
  const [nextActionOrder, setNextActionOrder] = useState(1);
  const [lastHandId, setLastHandId] = useState<string | null>(null);
  const [endingStacks, setEndingStacks] = useState<Record<string, number>>({});
  const [endingStacksManuallyEdited, setEndingStacksManuallyEdited] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [playerHoleCards, setPlayerHoleCards] = useState<Record<string, (Card | null)[]>>({});
  const [orphanHand, setOrphanHand] = useState<{ id: string; hand_number: number } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<
    { players: PlayerState[]; actions: ActionRecord[]; currentStreet: Street; nextActionOrder: number }[]
  >([]);
  const [sentCommunityStreets, setSentCommunityStreets] = useState<Set<Street>>(new Set());
  const [persistedBoardCount, setPersistedBoardCount] = useState(0);
  // C2 (trackerStreetRollback) — the running "Hoàn tác cả vòng" chain (null = idle).
  // The ref mirror lets stable callbacks (resetHand's useCallback) hard-gate without
  // adding the chain to their dep lists.
  const [streetRollback, setStreetRollback] = useState<StreetRollbackState | null>(null);
  const streetRollbackRef = useRef<StreetRollbackState | null>(null);
  streetRollbackRef.current = streetRollback;
  // C4 (trackerActionSounds) — owner P0 dedupe: deal/pot-collect sounds fire once per
  // (handId, street, kind) tuple, so a retried send or replayed state never double-plays.
  const playedSoundsRef = useRef<Set<string>>(new Set());
  // trackerSeatSetup: false once we learn tournament_seats.avatar_url is absent (migration
  // not applied) → the roster panel disables the avatar control ("chưa áp dụng") but keeps
  // name/chip. Stays true when the flag is off (irrelevant).
  const [avatarSupported, setAvatarSupported] = useState(true);
  // B1 review fix: independent feature-detect for the MID-HAND display RPC
  // (set_tracker_seat_display, migration 20261220000000). Deliberately separate from
  // avatarSupported — the pre-hand roster RPC is applied live and must never be
  // disabled by the newer RPC's 42883.
  const [midHandEditSupported, setMidHandEditSupported] = useState(true);
  // A5 resilience: the orphan hand id armed to auto-resume once its table's seats
  // have loaded (self-clears after firing once — see the effect near handleVoidOrphan).
  const [autoResumeArmed, setAutoResumeArmed] = useState<string | null>(null);
  // A3 preview: tournament-wide leaderboard snapshot fetched when Review is reached,
  // used ONLY to compute the "rank after this hand" strip (never persisted, never
  // blocks submit — best-effort decoration, see `rankShifts` below).
  const [leaderboardBefore, setLeaderboardBefore] = useState<{ player_id: string; chip_count: number }[] | null>(
    null
  );
  // Async table loads and action writes must not outlive the table/hand that created
  // them. The refs provide synchronous protection before React can re-render.
  const tableLoadGuardRef = useRef(createTableLoadGuard());
  const actionWriteGuardRef = useRef(createActionWriteGuard());
  const handSubmitGuardRef = useRef(createSingleFlightGuard());
  const actionScopeRef = useRef("");
  const loadedTableSessionRef = useRef<{ tournamentId: string; tableId: string; sessionId: string | null } | null>(null);
  const blockedActionScopeRef = useRef<string | null>(null);
  const claimedHandLockRef = useRef<string | null>(null);
  const rosterIntentRef = useRef(new Map<string, { fingerprint: string; requestId: string }>());
  const rosterTokensRef = useRef(new Map<string, string>());
  const rosterScopeRef = useRef("");
  const rosterGenerationRef = useRef(0);
  const rosterMountedRef = useRef(true);
  const rosterFlightRef = useRef(createSingleFlightGuard());
  const voidFlightRef = useRef(createSingleFlightGuard());
  const voidOwnsSubmittingRef = useRef(false);
  const manualCardsFlightsRef = useRef(new Map<string, ReturnType<typeof createSingleFlightGuard>>());
  const manualCardsOwnsSubmittingRef = useRef(false);
  const rosterContext = availableTables.find((table) => table.id === tableId);
  const rosterScope = `${user?.id}:${tournamentId}:${rosterContext?.tournamentTableId}:${rosterContext?.tableSessionId}:${rosterContext?.controlEpoch}`;
  if (rosterScopeRef.current !== rosterScope) {
    rosterScopeRef.current = rosterScope;
    rosterGenerationRef.current += 1;
  }
  useEffect(() => {
    // Render/reload may detach loading, but pending semantic-context flights
    // survive it. A reload is not proof that an in-flight mutation finished.
    if (manualCardsOwnsSubmittingRef.current) {
      manualCardsOwnsSubmittingRef.current = false;
      setSubmitting(false);
    }
  }, [rosterScope, tableId, handId]);
  useEffect(() => {
    rosterMountedRef.current = true;
    return () => { rosterMountedRef.current = false; rosterGenerationRef.current += 1; };
  }, []);

  // ----- URL params -------------------------------------------------------
  // `table` is authoritative (drives the resume-on-return flow). hand/street/actor
  // are write-only mirrors. Distinct from the panel's `hiTable` so the two screens
  // never fight over the same query key.
  const [searchParams, setSearchParams] = useSearchParams();
  const spRef = useRef(searchParams);
  spRef.current = searchParams;
  const resumedTableRef = useRef<string | null>(null);
  const tableListLoadGuardRef = useRef(createTableLoadGuard());
  const loadedTablesTournamentRef = useRef<string | null>(null);
  const activeTournamentRef = useRef(tournamentId);

  const setTableParam = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(spRef.current);
      if (id) next.set("table", id);
      else next.delete("table");
      setSearchParams(next, { replace: true });
    },
    [setSearchParams]
  );

  const retryTableLoad = useCallback(() => {
    setTableReloadAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  useEffect(() => {
    actionScopeRef.current = `${tableId}:${handId ?? "draft"}`;
  }, [tableId, handId]);

  const claimHandLock = useCallback(async (targetHandId: string): Promise<boolean> => {
    const actorId = await resolveHandLockActorId(user?.id, async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) setUser(data.user);
      return data.user?.id;
    });
    if (!actorId) return false;

    const { data, error } = await supabase.rpc("heartbeat_lock", {
      p_hand_id: targetHandId,
      p_user_id: actorId,
    });
    const resolution = resolveHandLockClaim(data, error, actorId);
    if (!resolution.ok) {
      claimedHandLockRef.current = null;
      setActionSyncBlocked(true);
      setIsReadOnly(true);
      toast.error("Không thể nhận quyền điều hành hand. Màn hình chỉ xem cho đến khi claim lock thành công.");
      return false;
    }

    claimedHandLockRef.current = targetHandId;
    setActionSyncBlocked(false);
    setIsReadOnly(false);
    return true;
  }, [user?.id]);

  useEffect(() => {
    const tableGuard = tableLoadGuardRef.current;
    const tableListGuard = tableListLoadGuardRef.current;
    return () => {
      tableGuard.dispose();
      tableListGuard.dispose();
    };
  }, []);

  useEffect(() => {
    if (activeTournamentRef.current === tournamentId) return;

    activeTournamentRef.current = tournamentId;
    if (voidOwnsSubmittingRef.current || manualCardsOwnsSubmittingRef.current) {
      voidOwnsSubmittingRef.current = false;
      manualCardsOwnsSubmittingRef.current = false;
      setSubmitting(false);
    }
    tableLoadGuardRef.current.begin("");
    tableListLoadGuardRef.current.begin("");
    actionScopeRef.current = "";
    loadedTablesTournamentRef.current = null;
    resumedTableRef.current = null;
    setTableId("");
    setTableName("");
    setPlayers([]);
    setHandId(null);
    setHandStarted(false);
    setLastHandId(null);
    setOrphanHand(null);
    setAutoResumeArmed(null);
    setIsReadOnly(false);
    setActionSyncBlocked(false);
    setTableSelectionNotice(null);
  }, [tournamentId]);

  // ----- Load tables (read-only enrichment, no new RPC) -------------------
  useEffect(() => {
    let cancelled = false;
    const requestToken = tableListLoadGuardRef.current.begin(tournamentId);
    loadedTablesTournamentRef.current = null;
    setAvailableTables([]);
    setTableSelectionNotice(null);

    const isCurrentRequest = () => !cancelled && tableListLoadGuardRef.current.isCurrent(requestToken);

    if (!tournamentId) {
      setTableLoadState("not_found");
      setTableLoadError("Thiếu mã giải đấu.");
      return () => {
        cancelled = true;
      };
    }

    setTableLoadState("loading");
    setTableLoadError(null);
    const loadTables = async () => {
      try {
        const { data: tournament, error: tournamentError } = await supabase
          .from("tournaments")
          .select("id")
          .eq("id", tournamentId)
          .maybeSingle();

        if (!isCurrentRequest()) return;
        if (tournamentError) {
          setTableLoadState("error");
          setTableLoadError("Không thể xác minh giải đang mở. Hãy kiểm tra quyền truy cập rồi thử lại.");
          return;
        }
        if (!tournament) {
          setTableLoadState("not_found");
          setTableLoadError("Không tìm thấy giải hoặc bạn không có quyền truy cập.");
          return;
        }

        if (FEATURES.floorDeferredTrackerMoveV1) {
          const { data: contextData, error: contextError } = await supabase.rpc(
            "get_tracker_hand_input_tables_v3" as any, { p_tournament_id: tournamentId },
          );
          if (!isCurrentRequest()) return;
          const context = contextData as { ok?: boolean; tables?: unknown[] } | null;
          if (contextError || !context?.ok || !Array.isArray(context.tables)) {
            setTableLoadState("error");
            setTableLoadError("Không thể tải phiên bàn Tracker. Hãy thử lại.");
            return;
          }
          const parsed = context.tables.map((raw) => {
            const row = raw as Record<string, unknown>;
            if (typeof row.table_id !== "string" || typeof row.tournament_table_id !== "string"
              || typeof row.table_name !== "string" || typeof row.player_count !== "number"
              || typeof row.has_live_hand !== "boolean"
              || !Number.isInteger(row.max_seats)
              || (row.table_session_id !== null && typeof row.table_session_id !== "string")
              || (row.table_session_id !== null && typeof row.control_epoch !== "number")) return null;
            return {
              id: row.table_id,
              physicalTableId: row.table_id,
              tournamentTableId: row.tournament_table_id,
              tableSessionId: row.table_session_id,
              controlEpoch: row.control_epoch as number | null,
              maxSeats: row.max_seats as number,
              name: row.table_name,
              playerCount: row.player_count,
              hasLiveHand: row.has_live_hand,
            };
          });
          if (parsed.some((row) => row === null)
            || new Set(parsed.map((row) => row?.id)).size !== parsed.length) {
            setTableLoadState("error");
            setTableLoadError("Dữ liệu phiên bàn không hợp lệ. Hãy tải lại.");
            return;
          }
          const lockByTable = new Map<string, unknown>();
          if (FEATURES.trackerMultiTable && user?.id) {
            const { data: lockData, error: lockError } = await supabase.rpc(
              "get_tracker_table_locks" as any,
              { p_tournament_id: tournamentId, p_actor_user_id: user.id },
            );
            if (!isCurrentRequest()) return;
            const locks = lockData as { ok?: boolean; locks?: Array<{ table_id: string }> } | null;
            if (!lockError && locks?.ok && Array.isArray(locks.locks)) {
              locks.locks.forEach((lock) => lockByTable.set(lock.table_id, lock));
            }
          }
          loadedTablesTournamentRef.current = tournamentId;
          setAvailableTables((parsed as InputTableSummary[]).map((table) => ({
            ...table,
            ...lockFieldsFrom(lockByTable.get(table.id)),
          })));
          setTableLoadState("ready");
          return;
        }

        const { data, error: tablesError } = await supabase.rpc("get_tournament_tables", { p_tournament_id: tournamentId });
        if (!isCurrentRequest()) return;
        if (tablesError) {
          setTableLoadState("error");
          setTableLoadError("Không thể tải danh sách bàn. Hãy thử lại.");
          return;
        }
        const base = (Array.isArray(data) ? data : []).flatMap((t: any) => {
          const physicalTableId = typeof t.table_id === "string" ? t.table_id : "";
          if (!physicalTableId) return [];
          return [{
            id: physicalTableId,
            physicalTableId,
            tournamentTableId: null as string | null,
            name: t.table_name || physicalTableId.slice(0, 8),
          }];
        });
        const [
          { data: canonicalTableRows },
          { data: seatRows, error: seatError },
          { data: liveHands, error: liveHandsError },
        ] = await Promise.all([
          supabase
            .from("tournament_tables")
            .select("id, table_id")
            .eq("tournament_id", tournamentId),
          supabase
            .from("tournament_seats")
            .select("table_id, player_id")
            .eq("tournament_id", tournamentId)
            .eq("is_active", true),
          supabase
            .from("tournament_hands")
            .select("table_id")
            .eq("tournament_id", tournamentId)
            .eq("status", "in_progress"),
        ]);
        if (!isCurrentRequest()) return;
        if (seatError || liveHandsError) {
          setTableLoadState("error");
          setTableLoadError("Không thể tải trạng thái bàn. Hãy thử lại.");
          return;
        }
        const countByTable = new Map<string, number>();
        (seatRows ?? []).forEach((s: any) => {
          if (s.player_id) countByTable.set(s.table_id, (countByTable.get(s.table_id) || 0) + 1);
        });
        const liveSet = new Set<string>((liveHands ?? []).map((h: any) => h.table_id));

        // trackerMultiTable: enrich with "who holds each table" via the read-only lock RPC.
        // Flag OFF → this call is skipped entirely (byte-identical). If the migration isn't
        // applied the RPC 42883s → we swallow it and just omit lock info (no crash).
        const lockByTable = new Map<string, any>();
        if (FEATURES.trackerMultiTable && user?.id) {
          const { data: lockData, error: lockErr } = await supabase.rpc("get_tracker_table_locks" as any, {
            p_tournament_id: tournamentId,
            p_actor_user_id: user.id,
          });
          const res = lockData as { ok?: boolean; locks?: any[] } | null;
          if (!lockErr && res?.ok && Array.isArray(res.locks)) {
            res.locks.forEach((l: any) => lockByTable.set(l.table_id, l));
          }
        }
        if (!isCurrentRequest()) return;
        loadedTablesTournamentRef.current = tournamentId;
        setAvailableTables(
          base.map((t) => ({
            ...t,
            tournamentTableId: resolveTournamentTableId(
              (Array.isArray(canonicalTableRows) ? canonicalTableRows : []) as TournamentTableIdentityRow[],
              t.physicalTableId,
            ),
            playerCount: countByTable.get(t.id) || 0,
            hasLiveHand: liveSet.has(t.id),
            ...lockFieldsFrom(lockByTable.get(t.id)),
          }))
        );
        setTableLoadState("ready");
      } catch {
        if (!isCurrentRequest()) return;
        setAvailableTables([]);
        setTableLoadState("error");
        setTableLoadError("Không thể tải danh sách bàn. Hãy thử lại.");
      }
    };
    void loadTables();
    return () => {
      cancelled = true;
    };
    // Review fix: gate user?.id on the flag so flag-OFF the dep is a constant null and
    // the base table queries don't double-fire when auth resolves async (byte-identical).
  }, [tournamentId, FEATURES.trackerMultiTable ? user?.id ?? null : null, tableReloadAttempt]);

  // trackerMultiTable review fix: while the picker is open (no table selected), refresh
  // JUST the lock info every ~45s — so a lock that goes stale becomes takeover-able
  // without a page reload, and the shown age isn't frozen. The base table list is NOT
  // re-fetched. Flag OFF (or a table selected) → no interval, no RPC.
  useEffect(() => {
    if (!FEATURES.trackerMultiTable || tableId || !tournamentId || !user?.id) return;
    let cancelled = false;
    const refreshLocks = async () => {
      const { data, error } = await supabase.rpc("get_tracker_table_locks" as any, {
        p_tournament_id: tournamentId,
        p_actor_user_id: user.id,
      });
      if (cancelled || error) return;
      const res = data as { ok?: boolean; locks?: any[] } | null;
      if (!res?.ok || !Array.isArray(res.locks)) return;
      const lockByTable = new Map<string, any>(res.locks.map((l: any) => [l.table_id, l]));
      setAvailableTables((prev) => prev.map((t) => ({ ...t, ...lockFieldsFrom(lockByTable.get(t.id)) })));
    };
    const id = setInterval(refreshLocks, 45000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tournamentId, tableId, user?.id]);

  // ----- Heartbeat lock ---------------------------------------------------
  useEffect(() => {
    if (!handId || !handStarted || !user?.id) return;
    let failCount = 0;
    const MAX_FAILS = 2;
    const heartbeat = async () => {
      try {
        const { data, error } = await supabase.rpc("heartbeat_lock", { p_hand_id: handId, p_user_id: user.id });
        const resolution = resolveHandLockClaim(data, error, user.id);
        if (!resolution.ok) {
          const isAuthError = [
            "actor_mismatch",
            "actor_not_allowed",
            "tracker_lock_owned_by_another",
            "tracker_lock_ambiguous",
          ].includes(resolution.code);
          failCount++;
          if (isAuthError) {
            // trackerMultiTable: name whoever took the table over (best-effort) instead
            // of the generic "phiên hết hạn". Flag OFF → the old generic toast, unchanged.
            if (FEATURES.trackerMultiTable && tournamentId) {
              supabase
                .rpc("get_tracker_table_locks" as any, { p_tournament_id: tournamentId, p_actor_user_id: user.id })
                .then(({ data }) => {
                  const locks = (data as any)?.locks as any[] | undefined;
                  const mine = Array.isArray(locks) ? locks.find((l) => l.hand_id === handId) : null;
                  toast.error(
                    mine?.locked_by_name
                      ? `Bàn đã được ${mine.locked_by_name} tiếp quản — màn hình chuyển sang chỉ xem.`
                      : "Bàn đã được người khác tiếp quản — màn hình chuyển sang chỉ xem."
                  );
                });
            } else {
              toast.error("Phiên làm việc đã hết hạn. Vui lòng tải lại trang.");
            }
            setActionSyncBlocked(true);
            setIsReadOnly(true);
            return;
          }
          if (failCount >= MAX_FAILS) {
            toast.warning("Mất kết nối phiên làm việc. Vui lòng kiểm tra lại trạng thái bàn.");
            setActionSyncBlocked(true);
            setIsReadOnly(true);
          }
        } else {
          failCount = 0;
          claimedHandLockRef.current = handId;
          setActionSyncBlocked(false);
          setIsReadOnly(false);
        }
      } catch {
        failCount++;
        if (failCount >= MAX_FAILS) {
          toast.warning("Mất kết nối phiên làm việc.");
          setActionSyncBlocked(true);
          setIsReadOnly(true);
        }
      }
    };
    // The start/resume handlers claim before enabling the writer. This fallback
    // covers only a restored in-progress hand that bypassed those handlers.
    if (claimedHandLockRef.current !== handId) void heartbeat();
    const interval = setInterval(heartbeat, 120000);
    return () => clearInterval(interval);
  }, [handId, handStarted, tournamentId, user?.id]);

  const markSync = useCallback((phase: SyncPhase, label?: string) => {
    setSyncPhase(phase);
    if (label !== undefined) setSyncLabel(label);
  }, []);

  const reloadAfterActionUncertainty = useCallback(() => {
    if (actionSyncBlocked) window.location.reload();
  }, [actionSyncBlocked]);

  const resetHand = useCallback((opts?: {
    restoreStacks?: boolean;
    tableId?: string;
    loadToken?: TableLoadToken;
    loadNextHandNumber?: boolean;
  }) => {
    // C2 hard-gate (ref: stable callback, no dep churn): never wipe local state while
    // the rollback chain is mid-flight — server deletes would keep landing on it.
    if (streetRollbackRef.current) {
      toast.error("Đang hoàn tác vòng — chờ xong đã");
      return;
    }
    setCurrentStreet("preflop");
    setActions([]);
    setCommunityCards([null, null, null, null, null]);
    setBetAmount("");
    setEndingStacks({});
    setEndingStacksManuallyEdited(false);
    setPlayerHoleCards({});
    setNextActionOrder(1);
    setUndoStack([]);
    setSelectedActorId(null);
    setSelectedWinners([]);
    setMuckedPlayerIds(new Set());
    setShowdownLayers([]);
    setRevealDone(false);
    holeCardsBroadcastRef.current = false;
    setBlindLevelSnapshot(null);
    setBlindLevelCanonical(false);
    setBlindFetchedAt(null);
    setBlindsConfirmedLocal(false);
    setDeadSb(false);
    setButtonOverridden(false); // P2-5: new hand → the dead-button suggestion drives the button again
    setSentCommunityStreets(new Set());
    setPersistedBoardCount(0);
    playedSoundsRef.current.clear(); // C4: fresh dedupe window per hand
    setSyncPhase("idle");
    setSyncLabel(null);
    // BUGFIX: the previous hand's betting state MUST NOT leak into the next hand
    // (stale total_bet → inflated side_pots on submit + ghost Main/Side pills on a
    // not-yet-started felt). restoreStacks is true ONLY from handleVoid — see
    // clearBettingState's doc for why any other restore would be wrong.
    setPlayers((prev) => clearBettingState(prev, opts?.restoreStacks === true));
    const targetTableId = opts?.tableId ?? tableId;
    const targetHandTableId = availableTables.find((table) => table.id === targetTableId)?.tournamentTableId ?? targetTableId;
    const loadToken = opts?.loadToken ?? tableLoadGuardRef.current.capture(targetTableId);
    if (targetTableId && opts?.loadNextHandNumber !== false) {
      supabase
        .rpc("get_next_hand_number", buildNextHandNumberRequest(tournamentId, targetHandTableId))
        .then(({ data }) => {
          if (data && tableLoadGuardRef.current.isCurrent(loadToken)) setHandNumber(data);
        });
    }
  }, [availableTables, tableId, tournamentId]);

  // A3: apply the server-confirmed stack from ChipQuickEditPanel. It becomes the base
  // for the NEXT hand too (this only ever runs between hands), so both starting_stack
  // and current_stack move together — no optimistic write happens before this; the
  // panel calls it only after `update_seats` succeeds and it re-fetched the row.
  const handleChipQuickEdit = useCallback((playerId: string, newStack: number) => {
    setPlayers((prev) =>
      prev.map((p) => (p.player_id === playerId ? { ...p, current_stack: newStack, starting_stack: newStack } : p))
    );
  }, []);

  // trackerSeatSetup: the SINGLE roster write. One atomic SECURITY DEFINER RPC sets the
  // seat's name + chip (+ tournament_chip_counts, so start_hand seeds correctly) and,
  // when p_touch_avatar, the avatar — guarding tracker/floor/owner/super_admin itself.
  // No client dual-write. On success the server-confirmed row is merged into `players`
  // (id/entry_number authoritative for later edits + start_hand). Returns the RPC result.
  const handleSetRosterSeat = useCallback(
    async (args: {
      seatNumber: number;
      playerName: string;
      chipCount: number;
      existingPlayerId?: string | null;
      touchAvatar?: boolean;
      avatarUrl?: string | null;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (isReadOnly) {
        toast.error("Phiên làm việc đã hết hạn");
        return { ok: false };
      }
      const context = availableTables.find((table) => table.id === tableId);
      if (!user?.id || !context?.tournamentTableId || !context.tableSessionId || !Number.isInteger(context.controlEpoch)) {
        toast.error("Chưa xác minh được phiên bàn. Hãy tải lại trước khi setup ghế.");
        return { ok: false, error: "roster_context_required" };
      }
      const scope = rosterScopeRef.current;
      const generation = rosterGenerationRef.current;
      const tokenKey = `${user.id}:${tournamentId}:${context.tableSessionId}:${context.controlEpoch}:${args.seatNumber}`;
      const seatToken = rosterTokensRef.current.get(tokenKey);
      if (!seatToken) {
        toast.error("Chưa xác minh dữ liệu ghế. Hãy tải lại bàn trước khi sửa.");
        return { ok: false, error: "roster_snapshot_required" };
      }
      const payload = {
        p_tournament_id: tournamentId,
        p_tournament_table_id: context.tournamentTableId,
        p_table_session_id: context.tableSessionId,
        p_expected_epoch: context.controlEpoch,
        p_seat_number: args.seatNumber,
        p_player_name: args.playerName,
        p_chip_count: args.chipCount,
        p_existing_player_id: args.existingPlayerId ?? null,
        p_touch_avatar: args.touchAvatar ?? false,
        p_avatar_url: args.avatarUrl ?? null,
        p_expected_seat_token: seatToken,
      };
      const fingerprint = JSON.stringify(payload);
      // Keep unresolved intent reachable after epoch changes in the same session.
      const storageKey = `vinpoker:roster-pending:${user.id}:${tournamentId}:${context.tournamentTableId}:${context.tableSessionId}:${args.seatNumber}`;
      let intent = rosterIntentRef.current.get(storageKey);
      if (!intent) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
          if (typeof saved?.fingerprint === "string" && typeof saved?.requestId === "string") intent = saved;
        } catch { /* In-memory fence remains; no credentials are stored. */ }
      }
      if (intent && intent.fingerprint !== fingerprint) {
        let previous: typeof payload | null = null;
        try { previous = JSON.parse(intent.fingerprint); } catch { /* Invalid local cache cannot authorize a write. */ }
        if (previous?.p_tournament_id === tournamentId
          && previous.p_tournament_table_id === context.tournamentTableId
          && previous.p_table_session_id === context.tableSessionId
          && previous.p_seat_number === args.seatNumber
          && typeof previous.p_expected_epoch === "number"
          && (previous.p_expected_epoch !== context.controlEpoch || previous.p_expected_seat_token !== seatToken)) {
          if (!rosterFlightRef.current.begin()) return { ok: false, error: "roster_write_in_flight" };
          const prior = await Promise.resolve(supabase.rpc("set_tracker_table_roster_seat_v2" as any,
            { ...previous, p_request_id: intent.requestId }))
            .then(result => result, error => ({ data: null, error }))
            .finally(() => rosterFlightRef.current.finish());
          if (!rosterMountedRef.current || generation !== rosterGenerationRef.current) {
            return { ok: false, error: "stale_roster_context" };
          }
          const receipt = prior.data as { ok?: boolean; error?: string } | null;
          const confirmed = !prior.error && isConfirmedRosterWrite(receipt, {
            tableId: previous.p_tournament_table_id, sessionId: previous.p_table_session_id,
            epoch: previous.p_expected_epoch, seatNumber: previous.p_seat_number, chipCount: previous.p_chip_count,
          });
          const rejected = !prior.error && receipt?.ok === false
            && ["STALE_STATE", "STALE_ROSTER_STATE", "table_session_mismatch"].includes(receipt.error ?? "");
          if (confirmed || rejected) {
            rosterIntentRef.current.delete(storageKey);
            try { sessionStorage.removeItem(storageKey); } catch { /* Receipt remains server-owned. */ }
            toast.info(confirmed ? "Lần lưu trước đã được xác nhận. Tải lại bàn trước khi sửa tiếp."
              : "Lần lưu cũ không được áp dụng. Kiểm tra lại dữ liệu và thử lại.");
            return { ok: false, error: "previous_intent_resolved" };
          }
        }
        toast.error("Lần lưu ghế trước chưa rõ kết quả. Hãy thử lại đúng dữ liệu cũ trước khi sửa.");
        return { ok: false, error: "unknown_previous_intent" };
      }
      intent ??= { fingerprint, requestId: crypto.randomUUID() };
      if (!rosterFlightRef.current.begin()) return { ok: false, error: "roster_write_in_flight" };
      rosterIntentRef.current.set(storageKey, intent);
      try { sessionStorage.setItem(storageKey, JSON.stringify(intent)); } catch { /* Server receipt remains authoritative. */ }
      const clearIntent = () => {
        rosterIntentRef.current.delete(storageKey);
        try { sessionStorage.removeItem(storageKey); } catch { /* No business state is stored here. */ }
      };
      const { data, error } = await Promise.resolve(supabase.rpc("set_tracker_table_roster_seat_v2" as any, {
        ...payload, p_request_id: intent.requestId,
      })).then((result) => result, (error) => ({ data: null, error }))
        .finally(() => rosterFlightRef.current.finish());
      if (!rosterMountedRef.current || generation !== rosterGenerationRef.current
        || scope !== rosterScopeRef.current) return { ok: false, error: "stale_roster_context" };
      if (error) {
        // 42883 = function not applied yet → degrade (two-tier gate).
        if ((error as any).code === "42883") {
          setAvatarSupported(false);
          toast.error("Tính năng setup bàn chưa được áp dụng trên máy chủ.");
          return { ok: false, error: "not_applied" };
        }
        toast.error(error.message || "Lỗi setup ghế");
        return { ok: false, error: error.message };
      }
      const res = data as { ok: boolean; error?: string; seat?: any; table_session_id?: string } | null;
      if (!res?.ok) {
        if (res?.ok === false && res.error !== "IDEMPOTENCY_CONFLICT") clearIntent();
        const map: Record<string, string> = {
          actor_not_allowed: "Phiên đăng nhập không hợp lệ — hãy tải lại trang.",
          actor_not_authorized: "Bạn không có quyền setup bàn này (cần tracker/floor/owner của club).",
          hand_in_progress: "Đang có ván trên bàn — không sửa roster được.",
          table_mismatch: "Bàn không thuộc giải này.",
          seat_gone: "Ghế này vừa thay đổi — hãy tải lại bàn.",
          seat_conflict: "Ghế vừa có người khác ngồi — hãy tải lại bàn.",
          bad_avatar_url: "Ảnh avatar không hợp lệ.",
          bad_player_name: "Tên không hợp lệ (1–40 ký tự).",
          bad_chip_count: "Số chip không hợp lệ.",
          bad_seat_number: "Số ghế không hợp lệ.",
          tournament_not_found: "Không tìm thấy giải.",
          table_session_mismatch: "Phiên bàn đã đóng hoặc thay đổi. Hãy tải lại bàn.",
          STALE_STATE: "Chế độ bàn đã thay đổi. Hãy tải lại trước khi sửa ghế.",
          STALE_ROSTER_STATE: "Stack hoặc người ngồi đã thay đổi. Hãy tải lại bàn; dữ liệu cũ không được ghi đè.",
          seat_locked: "Ghế đang khóa; hãy mở khóa trước khi xếp người.",
          pending_move: "Bàn hoặc ghế đang chờ chuyển người; hãy giải quyết trước.",
        };
        toast.error(map[res?.error ?? ""] ?? res?.error ?? "Lỗi setup ghế");
        return { ok: false, error: res?.error };
      }
      const seat = res.seat;
      if (!isConfirmedRosterWrite(res, { tableId: context.tournamentTableId, sessionId: context.tableSessionId,
        epoch: context.controlEpoch!, seatNumber: args.seatNumber, chipCount: args.chipCount })) {
        toast.error("Chưa xác minh được kết quả lưu ghế. Thử lại đúng dữ liệu để kiểm tra receipt.");
        return { ok: false, error: "unknown_roster_result" };
      }
      clearIntent();
      // A replayed committed receipt may describe a stack that another writer
      // has since changed. Confirm current snapshot before applying it to UI.
      const fresh = await Promise.resolve(supabase.rpc("get_tracker_roster_snapshot_v1" as any, {
        p_tournament_id: tournamentId, p_tournament_table_id: context.tournamentTableId,
        p_table_session_id: context.tableSessionId, p_expected_epoch: context.controlEpoch,
      })).then(value => value, error => ({ data: null, error }));
      if (!rosterMountedRef.current || generation !== rosterGenerationRef.current) {
        return { ok: true, error: "stale_roster_context" };
      }
      const current = fresh.data as any;
      const currentSeat = current?.seats?.find((item: any) => item.seat_number === args.seatNumber);
      if (fresh.error || current?.ok !== true || current.table_session_id !== context.tableSessionId
        || current.tournament_table_id !== context.tournamentTableId || current.control_epoch !== context.controlEpoch
        || typeof (res as any).seat_token !== "string" || currentSeat?.token !== (res as any).seat_token
        || currentSeat?.seat?.chip_count !== seat.chip_count || currentSeat?.seat?.player_id !== seat.player_id) {
        rosterTokensRef.current.delete(tokenKey);
        toast.info("Đã xác nhận lần lưu. Dữ liệu hiện tại cần tải lại; không ghi đè stack mới bằng receipt cũ.");
        return { ok: true, error: "roster_refresh_required" };
      }
      rosterTokensRef.current.set(tokenKey, currentSeat.token);
      setPlayers((prev) => {
        const merged: PlayerState = {
          player_id: seat.player_id,
          entry_number: seat.entry_number,
          seat_number: seat.seat_number,
          display_name: seat.player_name || String(seat.player_id).slice(0, 6),
          starting_stack: seat.chip_count,
          current_stack: seat.chip_count,
          is_active: true,
          position: prev.find((p) => p.seat_number === seat.seat_number)?.position ?? "",
          current_bet: 0,
          total_bet: 0,
          is_folded: false,
          is_all_in: false,
          avatar_url: seat.avatar_url ?? null,
        };
        const exists = prev.some((p) => p.seat_number === seat.seat_number);
        const next = exists
          ? prev.map((p) => (p.seat_number === seat.seat_number ? merged : p))
          : [...prev, merged];
        return next.sort((a, b) => a.seat_number - b.seat_number);
      });
      return { ok: true };
    },
    [tournamentId, tableId, isReadOnly, user, availableTables]
  );

  // B1 — mid-hand DISPLAY-ONLY edit (name + avatar). Separate narrow RPC that never
  // touches chips and has no hand_in_progress guard, so a typo can be fixed live
  // without VOIDing the hand. The state merge is deliberately PATCH-ONLY: it changes
  // ONLY display_name + avatar_url and must NEVER rebuild PlayerState the way
  // handleSetRosterSeat does — a full rebuild would reset current_stack/current_bet/
  // is_folded/total_bet mid-hand and corrupt the client's running pot math.
  const handleSetSeatDisplay = useCallback(
    async (args: {
      seatNumber: number;
      playerName: string;
      touchAvatar?: boolean;
      avatarUrl?: string | null;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (isReadOnly) {
        toast.error("Phiên làm việc đã hết hạn");
        return { ok: false };
      }
      if (!tableId) return { ok: false };
      const { data, error } = await supabase.rpc("set_tracker_seat_display" as any, {
        p_tournament_id: tournamentId,
        p_table_id: tableId,
        p_seat_number: args.seatNumber,
        p_player_name: args.playerName,
        p_touch_avatar: args.touchAvatar ?? false,
        p_avatar_url: args.avatarUrl ?? null,
        p_actor_user_id: user?.id ?? null,
      });
      if (error) {
        // 42883 = the DISPLAY RPC not applied yet → degrade ONLY the mid-hand editor.
        // Review fix: this must NOT touch avatarSupported — that state gates the LIVE
        // pre-hand avatar feature (a different, already-applied RPC); disabling it here
        // falsely killed a working feature for the whole session.
        if ((error as any).code === "42883") {
          setMidHandEditSupported(false);
          toast.error("Tính năng sửa tên/ảnh giữa ván chưa được áp dụng trên máy chủ.");
          return { ok: false, error: "not_applied" };
        }
        toast.error(error.message || "Lỗi sửa tên/ảnh");
        return { ok: false, error: error.message };
      }
      const res = data as { ok: boolean; error?: string; seat?: any } | null;
      if (!res?.ok) {
        const map: Record<string, string> = {
          actor_not_allowed: "Phiên đăng nhập không hợp lệ — hãy tải lại trang.",
          actor_not_authorized: "Bạn không có quyền sửa bàn này (cần tracker/floor/owner của club).",
          seat_not_found: "Ghế không tồn tại — hãy tải lại bàn.",
          table_mismatch: "Bàn không thuộc giải này.",
          bad_avatar_url: "Ảnh avatar không hợp lệ.",
          bad_player_name: "Tên không hợp lệ (1–40 ký tự).",
          tournament_not_found: "Không tìm thấy giải.",
        };
        toast.error(map[res?.error ?? ""] ?? res?.error ?? "Lỗi sửa tên/ảnh");
        return { ok: false, error: res?.error };
      }
      const seat = res.seat;
      // Review fix: trust the RPC echo for avatar_url. The old `?? p.avatar_url`
      // swallowed a CLEAR (RPC echoes null after deleting the avatar → fallback kept
      // the stale url on the felt while the DB was already cleared).
      setPlayers((prev) =>
        prev.map((p) =>
          p.seat_number === seat.seat_number
            ? { ...p, display_name: seat.player_name || p.display_name, avatar_url: seat.avatar_url ?? null }
            : p
        )
      );
      return { ok: true };
    },
    [tournamentId, tableId, isReadOnly, user]
  );

  // ----- Table select -----------------------------------------------------
  const handleTableChange = useCallback(
    async (newTableId: string) => {
      if (voidOwnsSubmittingRef.current || manualCardsOwnsSubmittingRef.current) {
        voidOwnsSubmittingRef.current = false;
        manualCardsOwnsSubmittingRef.current = false;
        setSubmitting(false);
      }
      rosterTokensRef.current.clear();
      const loadToken = tableLoadGuardRef.current.begin(newTableId);
      const isCurrentLoad = () => tableLoadGuardRef.current.isCurrent(loadToken);
      actionScopeRef.current = `${newTableId}:draft`;
      blockedActionScopeRef.current = null;
      setActionSyncBlocked(false);
      setTableId(newTableId);
      setHandId(null);
      setHandStarted(false);
      setLastHandId(null);
      setButtonConfirmed(false);
      // P2-5: a fresh table load resets the dead-button anchor → the first hand has no
      // suggestion (operator sets the button); subsequent hands auto-suggest.
      setLastBlindLineage(null);
      setButtonOverridden(false);
      // A5: a stale orphan from the PREVIOUS table must never leak into this one —
      // re-armed below only if the NEW table actually has one in progress.
      setOrphanHand(null);
      setAutoResumeArmed(null);
      const tbl = availableTables.find((t) => t.id === newTableId);
      setTableName(tbl?.name || newTableId.slice(0, 8));
      if (!newTableId) {
        setPlayers([]);
        return;
      }

      // P2-5: physical seat capacity for the dead-button ring (read-only; default 9).
      const { data: tableMeta } = await supabase
        .from("tournament_tables")
        .select("max_seats, table_session_id")
        .eq("tournament_id", tournamentId)
        .eq(FEATURES.floorDeferredTrackerMoveV1 && tbl?.tableSessionId ? "id" : "table_id",
          FEATURES.floorDeferredTrackerMoveV1 && tbl?.tableSessionId ? tbl.tournamentTableId! : newTableId)
        .maybeSingle();
      if (!isCurrentLoad()) return;
      const loadedMaxSeats = tbl?.maxSeats ?? (tableMeta as any)?.max_seats ?? 9;
      const loadedSessionId = tbl?.tableSessionId ?? (tableMeta as any)?.table_session_id ?? null;
      loadedTableSessionRef.current = { tournamentId, tableId: newTableId, sessionId: loadedSessionId };
      // Hands FK-reference the tournament-table incarnation, never the reusable
      // physical table used by the table picker. Keep the UI selection separate.
      const handTableId = tbl?.tournamentTableId ?? newTableId;
      setMaxSeats(loadedMaxSeats);

      // trackerSeatSetup: pull the per-seat avatar_url under the flag. If the migration
      // isn't applied yet the column is missing → 42703 → mark unsupported + retry
      // without it (roster still loads; avatars fall back to profiles). Flag OFF → the
      // select is the current column list, byte-identical.
      const baseCols = "player_id, entry_number, seat_number, chip_count, player_name";
      const wantAvatar = FEATURES.trackerSeatSetup;
      let loadedSeats: any[] | null = null;
      let error: any = null;
      if (wantAvatar && loadedSessionId && tbl?.tournamentTableId && Number.isInteger(tbl.controlEpoch)) {
        const r = await supabase.rpc("get_tracker_roster_snapshot_v1" as any, {
          p_tournament_id: tournamentId, p_tournament_table_id: tbl.tournamentTableId,
          p_table_session_id: loadedSessionId, p_expected_epoch: tbl.controlEpoch,
        });
        if (!isCurrentLoad()) return;
        const snapshot = r.data as any;
        if (r.error || snapshot?.ok !== true || snapshot.table_session_id !== loadedSessionId
          || snapshot.tournament_table_id !== tbl.tournamentTableId || snapshot.control_epoch !== tbl.controlEpoch
          || !Array.isArray(snapshot.seats) || snapshot.seats.length !== loadedMaxSeats
          || snapshot.seats.some((item: any) => !Number.isInteger(item.seat_number) || typeof item.token !== "string")) {
          error = r.error ?? new Error("Invalid roster snapshot");
        } else {
          rosterTokensRef.current.clear();
          snapshot.seats.forEach((item: any) => rosterTokensRef.current.set(
            `${user?.id}:${tournamentId}:${loadedSessionId}:${tbl.controlEpoch}:${item.seat_number}`, item.token));
          loadedSeats = snapshot.seats.filter((item: any) => item.seat !== null).map((item: any) => item.seat);
        }
      } else if (wantAvatar) {
        let seatQuery = supabase
          .from("tournament_seats")
          .select(`${baseCols}, avatar_url`)
          .eq("tournament_id", tournamentId)
          .eq("is_active", true);
        seatQuery = loadedSessionId && tbl?.tournamentTableId
          ? seatQuery.filter("tournament_table_id", "eq", tbl.tournamentTableId)
            .filter("table_session_id", "eq", loadedSessionId)
          : seatQuery.eq("table_id", newTableId);
        const r = await seatQuery.order("seat_number");
        if (!isCurrentLoad()) return;
        if (r.error && (r.error as any).code === "42703") {
          setAvatarSupported(false);
        } else {
          loadedSeats = r.data as any[] | null;
          error = r.error;
        }
      }
      if (loadedSeats === null && error === null) {
        let seatQuery = supabase
          .from("tournament_seats")
          .select(baseCols)
          .eq("tournament_id", tournamentId)
          .eq("is_active", true);
        seatQuery = loadedSessionId && tbl?.tournamentTableId
          ? seatQuery.filter("tournament_table_id", "eq", tbl.tournamentTableId)
            .filter("table_session_id", "eq", loadedSessionId)
          : seatQuery.eq("table_id", newTableId);
        const r = await seatQuery.order("seat_number");
        if (!isCurrentLoad()) return;
        loadedSeats = r.data as any[] | null;
        error = r.error;
      }

      if (!isCurrentLoad()) return;
      if (error) {
        toast.error("Không thể tải danh sách người chơi");
        setPlayers([]);
        return;
      }
      if (!loadedSeats?.length) {
        setPlayers([]);
        if (FEATURES.floorDeferredTrackerMoveV1) {
          setAvailableTables((previous) => previous.map((table) =>
            table.id === newTableId ? { ...table, playerCount: 0, hasLiveHand: false } : table));
        }
        return;
      }

      if (FEATURES.floorDeferredTrackerMoveV1) {
        setAvailableTables((previous) => previous.map((table) =>
          table.id === newTableId ? { ...table, playerCount: loadedSeats.length } : table));
      }

      const newPlayers: PlayerState[] = loadedSeats.map((s) => ({
        player_id: s.player_id,
        entry_number: s.entry_number,
        seat_number: s.seat_number,
        display_name: (s as any).player_name || s.player_id.slice(0, 6),
        starting_stack: s.chip_count,
        current_stack: s.chip_count,
        is_active: true,
        position: "",
        current_bet: 0,
        total_bet: 0,
        is_folded: false,
        is_all_in: false,
      }));
      const seatPlayerIds = [...new Set(newPlayers.map((p) => p.player_id))];
      const avatarByUser = new Map<string, string | null>();
      if (seatPlayerIds.length) {
        const { data: seatProfiles } = await supabase
          .from("profiles")
          .select("user_id, avatar_url")
          .in("user_id", seatPlayerIds);
        if (!isCurrentLoad()) return;
        (seatProfiles ?? []).forEach((p: any) => avatarByUser.set(p.user_id, p.avatar_url ?? null));
      }
      // Avatar priority: operator-set per-seat avatar wins over the player's profile pic;
      // a walk-in with no profile uses the seat avatar (or initials).
      setPlayers(
        newPlayers.map((p, i) => ({
          ...p,
          avatar_url: (loadedSeats![i] as any)?.avatar_url ?? avatarByUser.get(p.player_id) ?? null,
        }))
      );
      // Clear the previous hand without requesting a new number yet. The orphan
      // lookup below owns identity resolution and only asks for the next number
      // after it proves there is no in-progress hand on this exact table.
      resetHand({ tableId: newTableId, loadToken, loadNextHandNumber: false });

      const activeNums = loadedSeats
        .filter((s) => s.player_id)
        .map((s) => s.seat_number)
        .sort((a, b) => a - b);

      const { data: lastHand } = loadedSessionId
        ? await supabase.from("tournament_hands")
          .select("id, button_seat, status, is_voided")
          .eq("tournament_id", tournamentId)
          .eq("table_id", handTableId)
          .filter("table_session_id", "eq", loadedSessionId)
          .order("hand_number", { ascending: false })
          .limit(1).maybeSingle()
        : { data: null };

      if (!isCurrentLoad()) return;
      const previousLineage = lastHand?.id && lastHand.status === "completed" && !lastHand.is_voided
        ? await readBlindLineage(lastHand.id) : null;
      if (!isCurrentLoad()) return;
      setLastBlindLineage(previousLineage);
      const restoredSuggestion = nextButtonFromBlindLineage({
        maxSeats: loadedMaxSeats,
        occupiedSeats: activeNums,
        previousDealtSeats: previousLineage?.previousDealtSeats ?? [],
        previousButtonSeat: previousLineage?.previousButtonSeat ?? null,
        previousSbPosition: previousLineage?.previousSbPosition ?? null,
        previousBbSeat: previousLineage?.previousBbSeat ?? null,
      });
      if (restoredSuggestion) {
        setButtonSeat(restoredSuggestion.buttonSeat);
        setButtonConfirmed(true);
      } else {
        setButtonSeat(lastHand?.button_seat ?? activeNums[0] ?? 1);
        setButtonConfirmed(false);
        if (lastHand?.id) {
          toast.warning("Không đủ vị trí blind của hand trước để gợi ý BTN. Hãy chọn BTN thủ công.");
        }
      }

      const identity = await resolveTableHandIdentity({
        loadOrphan: async () => {
          // Physical table identity alone must not resurrect an older session.
          if (!loadedSessionId) return null;
          const { data, error: orphanError } = await supabase
            .from("tournament_hands")
            .select("id, hand_number")
            .eq("tournament_id", tournamentId)
            .eq("table_id", handTableId)
            .filter("table_session_id", "eq", loadedSessionId)
            .eq("status", "in_progress")
            .limit(1)
            .maybeSingle();
          if (orphanError) throw orphanError;
          return data;
        },
        loadNextHandNumber: async () => {
          const { data, error: nextNumberError } = await supabase.rpc(
            "get_next_hand_number",
            buildNextHandNumberRequest(tournamentId, handTableId),
          );
          if (nextNumberError || data == null) {
            throw nextNumberError ?? new Error("Could not load the next hand number");
          }
          return Number(data);
        },
        isCurrent: isCurrentLoad,
      }).catch((error: unknown) => {
        if (isCurrentLoad()) {
          toast.error(error instanceof Error ? error.message : "Không tải được trạng thái hand của bàn");
        }
        return null;
      });
      if (!identity) return;
      if (identity.kind === "stale") return;
      if (FEATURES.floorDeferredTrackerMoveV1) {
        setAvailableTables((previous) => previous.map((table) =>
          table.id === newTableId ? { ...table, hasLiveHand: identity.kind === "resume" } : table));
      }
      if (identity.kind === "resume") {
        setOrphanHand(identity.hand);
        setAutoResumeArmed(identity.hand.id); // A5: fires once seats for THIS table have loaded
      } else {
        setHandNumber(identity.handNumber);
      }
    },
    [availableTables, tournamentId, resetHand]
  );

  const handlePickTable = useCallback(
    (id: string) => {
      setTableSelectionNotice(null);
      setTableParam(id);
      void handleTableChange(id);
    },
    [setTableParam, handleTableChange]
  );

  const backToTableMap = useCallback(() => {
    setTableId("");
    setTableName("");
    setPlayers([]);
    setOrphanHand(null);
    setTableSelectionNotice(null);
    resumedTableRef.current = null;
    setTableParam(null);
    setTableReloadAttempt((attempt) => attempt + 1);
  }, [setTableParam]);

  // trackerMultiTable: claim a STALE lock, then open the table (its orphan hand
  // resumes as usual). Two-writer safety is on the server — takeover_hand_lock refuses
  // a still-fresh lock; the loser's next write is refused by tracker_lock_blocks.
  const handleTakeoverLock = useCallback(
    async (handId: string, tableIdToOpen: string, force = false) => {
      if (!user?.id) return;
      const { data, error } = await supabase.rpc("takeover_hand_lock" as any, {
        p_hand_id: handId,
        p_force: force,
        p_actor_user_id: user.id,
      });
      if (error) {
        if ((error as any).code === "42883") {
          toast.error("Tính năng tiếp quản bàn chưa được áp dụng trên máy chủ.");
          return;
        }
        toast.error(error.message || "Không tiếp quản được bàn");
        return;
      }
      const res = data as { ok: boolean; error?: string; age_seconds?: number } | null;
      if (!res?.ok) {
        const map: Record<string, string> = {
          actor_not_allowed: "Phiên đăng nhập không hợp lệ — hãy tải lại trang.",
          actor_not_authorized: "Bạn không có quyền bàn này (cần tracker/floor).",
          lock_fresh: "Bàn vẫn đang được người khác thao tác — chưa thể tiếp quản.",
          force_requires_floor: "Chỉ floor mới buộc tiếp quản được bàn đang hoạt động.",
          hand_not_in_progress: "Ván đã kết thúc — hãy tải lại danh sách bàn.",
          hand_not_found: "Không tìm thấy ván — hãy tải lại danh sách bàn.",
        };
        toast.error(map[res?.error ?? ""] ?? res?.error ?? "Không tiếp quản được bàn");
        return;
      }
      toast.success("Đã tiếp quản bàn");
      handlePickTable(tableIdToOpen);
    },
    [user, handlePickTable]
  );

  // Resume the table from the URL once, when the list is ready and nothing selected.
  useEffect(() => {
    const tableFromUrl = searchParams.get("table");
    if (
      !tableFromUrl ||
      tableId ||
      tableLoadState !== "ready" ||
      loadedTablesTournamentRef.current !== tournamentId
    ) {
      return;
    }
    if (resumedTableRef.current === tableFromUrl) return;
    resumedTableRef.current = tableFromUrl;
    if (!availableTables.some((t) => t.id === tableFromUrl)) {
      setTableSelectionNotice("Bàn được yêu cầu không thuộc giải đang mở. Hãy chọn một bàn trong danh sách.");
      setTableParam(null);
      return;
    }
    setTableSelectionNotice(null);
    void handleTableChange(tableFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTables, searchParams, tableId, tableLoadState, tournamentId]);

  // ----- Derived ----------------------------------------------------------
  const tournamentTableId = useMemo(
    () => availableTables.find((table) => table.id === tableId)?.tournamentTableId ?? null,
    [availableTables, tableId],
  );

  const potSize = useMemo(
    () =>
      actions.reduce((sum, a) => {
        if (["bet", "raise", "call", "all_in", "post_sb", "post_bb", "post_ante"].includes(a.action_type)) {
          return sum + a.amount;
        }
        return sum;
      }, 0),
    [actions]
  );

  const highestBet = useMemo(
    () => Math.max(0, ...players.filter((p) => !p.is_folded).map((p) => p.current_bet)),
    [players]
  );

  const potBreakdown = useMemo(
    () =>
      computePotBreakdown(
        players.map((p) => ({ player_id: p.player_id, total_bet: p.total_bet, is_folded: p.is_folded }))
      ),
    [players]
  );

  const playerName = useCallback(
    (id: string) => players.find((p) => p.player_id === id)?.display_name || id.slice(0, 6),
    [players]
  );

  const activePlayers = useMemo(() => players.filter((p) => !p.is_folded && !p.is_all_in), [players]);

  // trackerShowdownRevealOrder (operator hint): player_ids of the still-in players in
  // the order they'd table at showdown (last aggressor on the final street first, else
  // first-to-act from the SB, then clockwise). Purely informational — the showdown
  // panel lists players in this order with a ①②③ badge so the operator enters them in
  // the same sequence the viewer reveals. Flag OFF → undefined → panel unchanged.
  const showdownOrderIds = useMemo<string[] | undefined>(() => {
    if (!FEATURES.trackerShowdownRevealOrder) return undefined;
    const shown = players.filter((p) => !p.is_folded);
    if (shown.length <= 1) return undefined;
    const STREET_IDX: Record<string, number> = { preflop: 0, flop: 1, turn: 2, river: 3, showdown: 4 };
    const AGGR = new Set(["bet", "raise", "all_in"]);
    const maxStreet = actions.reduce((m, a) => Math.max(m, STREET_IDX[a.street] ?? 0), 0);
    const shownSeats = new Set(shown.map((p) => p.seat_number));
    const lastAggr = [...actions]
      .filter((a) => (STREET_IDX[a.street] ?? 0) === maxStreet && AGGR.has(a.action_type))
      .sort((a, b) => a.action_order - b.action_order)
      .pop();
    const finalAggressorSeat = lastAggr && shownSeats.has(lastAggr.seat_number) ? lastAggr.seat_number : null;
    const seatToPid = new Map(shown.map((p) => [p.seat_number, p.player_id]));
    return showdownRevealOrder({ shownSeatNumbers: shown.map((p) => p.seat_number), buttonSeat, finalAggressorSeat })
      .map((sn) => seatToPid.get(sn))
      .filter((x): x is string => !!x);
  }, [players, actions, buttonSeat]);

  const usedCards = useMemo(() => {
    const s = new Set<Card>();
    communityCards.filter((c): c is Card => c !== null).forEach((c) => s.add(c));
    Object.values(playerHoleCards).flat().filter((c): c is Card => c !== null).forEach((c) => s.add(c));
    return s;
  }, [communityCards, playerHoleCards]);

  const bigBlind = useMemo(() => actions.find((a) => a.action_type === "post_bb")?.amount ?? 0, [actions]);

  const activeSeatNums = useMemo(() => players.map((p) => p.seat_number), [players]);
  // Dead-button SUGGESTION from the PREVIOUS hand's recorded blind positions. Pre-hand
  // default; stays active until the operator explicitly resets and selects a seat.
  const deadButtonSuggestion = useMemo(
    () => nextButtonFromBlindLineage({
      maxSeats, occupiedSeats: activeSeatNums,
      previousDealtSeats: lastBlindLineage?.previousDealtSeats ?? [],
      previousButtonSeat: lastBlindLineage?.previousButtonSeat ?? null,
      previousSbPosition: lastBlindLineage?.previousSbPosition ?? null,
      previousBbSeat: lastBlindLineage?.previousBbSeat ?? null,
    }),
    [maxSeats, activeSeatNums, lastBlindLineage]
  );
  const suggestionActive = !!deadButtonSuggestion && !buttonOverridden;
  const rawBlinds = useMemo(() => blindSeats(activeSeatNums, buttonSeat), [activeSeatNums, buttonSeat]);
  // 🔴 CARRY-FORWARD: when the suggestion is active the SB/BB shown to the operator
  // come from the dead-button suggestion (correct under empty seats), NOT blindSeats —
  // which would mislabel the SB when the button/SB sit on empty seats.
  const blindSbSeat = suggestionActive ? deadButtonSuggestion!.sbSeat : rawBlinds.sbSeat;
  const blindBbSeat = suggestionActive ? deadButtonSuggestion!.bbSeat : rawBlinds.bbSeat;
  // The suggestion auto-applies its dead SB; the operator can still toggle deadSb on.
  const effectiveDeadSb = (suggestionActive && deadButtonSuggestion!.deadSb) || deadSb;
  // The engine honors the dead-button BB only while the suggestion is active.
  const bbSeatOverride = suggestionActive ? deadButtonSuggestion!.bbSeat : undefined;
  const positionsBySeat = useMemo(() => {
    const positions = getSeatPositions(activeSeatNums, buttonSeat);
    const sbSeat = handStarted
      ? actions.find((action) => action.action_type === "post_sb")?.seat_number ?? null
      : blindSbSeat;
    const bbSeat = handStarted
      ? actions.find((action) => action.action_type === "post_bb")?.seat_number ?? null
      : blindBbSeat;
    for (const [seat, label] of positions) {
      if (label === "BTN" || label === "SB" || label === "BB" || label === "BTN/SB") {
        positions.set(seat, "");
      }
    }
    if (activeSeatNums.includes(buttonSeat)) positions.set(buttonSeat, activeSeatNums.length === 2 ? "BTN/SB" : "BTN");
    if (sbSeat != null && activeSeatNums.includes(sbSeat) && sbSeat !== buttonSeat) positions.set(sbSeat, "SB");
    if (bbSeat != null && activeSeatNums.includes(bbSeat)) positions.set(bbSeat, "BB");
    return positions;
  }, [activeSeatNums, buttonSeat, handStarted, actions, blindSbSeat, blindBbSeat]);
  const firstActorSeat = useMemo(() => {
    if (blindBbSeat == null) return firstPreflopActor(activeSeatNums, buttonSeat);
    const ring = [...activeSeatNums].sort((a, b) => a - b);
    return ring.find((s) => s > blindBbSeat) ?? ring[0] ?? null; // first live seat left of the (effective) BB
  }, [activeSeatNums, buttonSeat, blindBbSeat]);

  // P2-5: pre-fill the suggested button (incl. a dead/empty seat) pre-hand, until the
  // operator resets the button. Suggestion depends on prevBb/occupancy, not
  // buttonSeat → no loop.
  useEffect(() => {
    if (suggestionActive && !handStarted && deadButtonSuggestion) {
      setButtonSeat(deadButtonSuggestion.buttonSeat);
      setButtonConfirmed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionActive, handStarted, deadButtonSuggestion?.buttonSeat]);

  const engineState = useMemo<EngineState>(
    () => ({
      seats: players.map((p) => ({
        player_id: p.player_id,
        seat_number: p.seat_number,
        starting_stack: p.starting_stack,
        stack: p.current_stack,
        street_committed: p.current_bet,
        total_committed: p.total_bet,
        folded: p.is_folded,
        all_in: p.is_all_in,
      })),
      buttonSeat,
      street: currentStreet,
      streetActions: actions
        .filter((a) => a.street === currentStreet)
        .map((a) => ({ player_id: a.player_id, seat_number: a.seat_number, action_type: a.action_type })),
      canonicalActions: actions.map((a) => ({
        player_id: a.player_id,
        street: a.street,
        action_type: a.action_type as "fold" | "check" | "call" | "bet" | "raise" | "all_in" | "post_sb" | "post_bb" | "post_ante",
        action_amount: a.amount,
        action_order: a.action_order,
      })),
      bigBlind,
      deadSb: effectiveDeadSb,
      bbSeatOverride,
      // UAT wave 2 (Fix 1): cover-call runout waiver — module const, no dep needed.
      // Flag OFF ⇒ field false ⇒ engine behavior byte-identical to today.
      coverCallWaiver: FEATURES.trackerCoverCallRunout,
    }),
    [players, buttonSeat, currentStreet, actions, bigBlind, effectiveDeadSb, bbSeatOverride]
  );
  const engineActor = useMemo(() => actorToAct(engineState), [engineState]);

  // ----- Blind-setup snapshot (Layer 1, read-only RPC, never persisted) ---
  useEffect(() => {
    if (!handStarted || blindLevelSnapshot != null) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId });
      if (cancelled) return;
      const snap = snapshotBlindLevel((data as any)?.current_level ?? null);
      setBlindLevelSnapshot(snap);
      setLiveLevelNumber(snap.level_number);
      setBlindFetchedAt(new Date());
      // A1 zero-guard (flag ON): a failed/empty clock (BB 0) must NOT auto-fill —
      // leave the inputs manual (the levelMissing warning shows) instead of seeding 0.
      // Flag OFF → today's exact behavior (set whatever the snapshot holds).
      if (!FEATURES.trackerBlindAutoSeed || snap.big_blind > 0) {
        setSbAmount(snap.small_blind);
        setBbAmount(snap.big_blind);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handStarted, blindLevelSnapshot, tournamentId]);

  useEffect(() => {
    if (!handStarted) return;
    const id = setInterval(async () => {
      const { data } = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId });
      const cl = ((data as any)?.current_level ?? null) as ClockLevel | null;
      setLiveLevelNumber(cl?.level_number ?? null);
      setLiveLevel(cl); // A1: keep the full level so the banner can show next-hand SB/BB
    }, 25000);
    return () => clearInterval(id);
  }, [handStarted, tournamentId]);


  const flowInput = useMemo(() => {
    const streetActions = actions.filter((a) => a.street === currentStreet);
    const acted = new Set(
      streetActions
        .filter((a) => !["post_sb", "post_bb", "post_ante"].includes(a.action_type))
        .map((a) => a.player_id)
    );
    const lastActorSeat = streetActions.length ? streetActions[streetActions.length - 1].seat_number : buttonSeat;
    return {
      players: players.map((p) => ({
        player_id: p.player_id,
        seat_number: p.seat_number,
        starting_stack: p.starting_stack,
        current_bet: p.current_bet,
        current_stack: p.current_stack,
        is_folded: p.is_folded,
        is_all_in: p.is_all_in,
      })),
      buttonSeat,
      actedThisStreet: acted,
      lastActorSeat,
      bigBlind,
      currentStreet,
      canonicalActions: actions.map((a) => ({
        player_id: a.player_id,
        street: a.street,
        action_type: a.action_type as "fold" | "check" | "call" | "bet" | "raise" | "all_in" | "post_sb" | "post_bb" | "post_ante",
        action_amount: a.amount,
        action_order: a.action_order,
      })),
    };
  }, [actions, currentStreet, players, buttonSeat, bigBlind]);

  const toActId = engineActor?.player_id ?? null;

  const effectiveActorId = useMemo(() => {
    if (selectedActorId) {
      const p = players.find((x) => x.player_id === selectedActorId);
      if (p && !p.is_folded && !p.is_all_in) return selectedActorId;
    }
    return toActId;
  }, [selectedActorId, players, toActId]);

  const actorPlayer = useMemo(
    () => players.find((p) => p.player_id === effectiveActorId) ?? null,
    [players, effectiveActorId]
  );
  const actorViewData = useMemo(
    () => actorView(flowInput, effectiveActorId ?? undefined),
    [flowInput, effectiveActorId]
  );
  const actorPos = actorPlayer ? positionsBySeat.get(actorPlayer.seat_number) || "" : "";
  const sbPosted = useMemo(() => actions.some((a) => a.action_type === "post_sb"), [actions]);
  const bbPosted = useMemo(() => actions.some((a) => a.action_type === "post_bb"), [actions]);
  // P2-3: a dead-SB hand needs only the BB posted.
  const blindsConfirmed = blindsConfirmedLocal || (bbPosted && (deadSb || sbPosted));
  const isHeadsUp = players.length === 2;
  const blindLevelMissing = !blindLevelSnapshot || blindLevelSnapshot.level_number == null;
  const blindLevelChanged = hasLevelChangedDuringHand(blindLevelSnapshot, { level_number: liveLevelNumber });

  // trackerWorkflowAids: "Lấy blind mới ngay" — pull the live clock level on demand (the
  // 25s poll may be stale after a level change). Re-seeds the SB/BB INPUTS + re-snapshots
  // (so provenance/banner agree) ONLY when no blind has been posted yet this hand; once a
  // blind is posted it refreshes the live level for the banner but never touches amounts.
  // Placed AFTER sbPosted/bbPosted so the useCallback deps are initialized (no TDZ).
  const refreshLiveLevel = useCallback(async () => {
    const { data } = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId });
    const cl = ((data as any)?.current_level ?? null) as ClockLevel | null;
    setLiveLevelNumber(cl?.level_number ?? null);
    setLiveLevel(cl);
    if (cl && (cl.big_blind ?? 0) > 0 && !blindLevelCanonical && !sbPosted && !bbPosted) {
      const snap = snapshotBlindLevel(cl);
      setBlindLevelSnapshot(snap);
      setSbAmount(snap.small_blind);
      setBbAmount(snap.big_blind);
      setBlindFetchedAt(new Date());
      toast.success(`Đã lấy mức blind mới: Level ${snap.level_number ?? "?"}`);
    } else {
      toast.info("Đã cập nhật mức blind hiện tại (ván đã đặt blind — không đổi số).");
    }
  }, [tournamentId, blindLevelCanonical, sbPosted, bbPosted]);

  const isReview = Object.keys(endingStacks).length > 0;
  const isSummary = isReview;
  const conservationOk = useMemo(() => {
    const start = players.reduce((s, p) => s + p.starting_stack, 0);
    const end = players.reduce((s, p) => s + (endingStacks[p.player_id] ?? p.current_stack), 0);
    return start === end;
  }, [players, endingStacks]);
  const winnerDetermined = useMemo(
    () => players.some((p) => (endingStacks[p.player_id] ?? p.current_stack) > p.current_stack),
    [players, endingStacks]
  );
  const reviewValid = isReview && conservationOk && winnerDetermined;
  const allInRunout = isRunout(engineState.seats);
  const workflowState = deriveTrackerWorkflowState({
    handStarted,
    blindsConfirmed,
    currentStreet,
    persistedBoardCount,
    isReview,
    reviewValid,
    submitted: false,
    // P2-2 all-in runout reveal-first
    isRunout: allInRunout,
    bettingClosed: isRoundComplete(engineState),
    revealDone,
  });
  const showBlindSetup = workflowState === "setup_blinds" && players.length >= 2;
  const showBoardEntry = isBoardEntryState(workflowState);
  const boardEntryStreetNow = boardEntryStreet(workflowState);
  const showShowdownInput = workflowState === "showdown_input";
  const showRunoutReveal = workflowState === "runout_reveal";
  const showActionStep = isActionState(workflowState);

  const needsPostSB = engineActor?.needsPost === "post_sb";
  const needsPostBB = engineActor?.needsPost === "post_bb";

  // ----- Write-only URL mirror (hand/street/actor). Never read back. ------
  useEffect(() => {
    if (!handStarted) return;
    const next = new URLSearchParams(spRef.current);
    if (handNumber !== "") next.set("hand", String(Number(handNumber)));
    next.set("street", currentStreet);
    if (actorPlayer) next.set("actor", String(actorPlayer.seat_number));
    else next.delete("actor");
    const cur = spRef.current.toString();
    if (next.toString() !== cur) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handStarted, handNumber, currentStreet, actorPlayer?.seat_number]);

  // ----- Handlers ---------------------------------------------------------
  // A2 re-entry guard: `submitting` disables the button, but a fast double-tap can fire
  // twice before React flushes state — the ref blocks the second call synchronously so a
  // duplicate/orphan hand can never be started.
  const startingRef = useRef(false);
  const handleStartHand = async () => {
    if (startingRef.current) return;
    if (!tableId || !handNumber || !user?.id) return;
    if (!buttonConfirmed) {
      toast.error("Chọn ghế nút chia bài (BTN) trước khi bắt đầu hand");
      return;
    }
    // Guard: a seated player with 0 chips makes start_hand seed starting_stack = 0,
    // which breaks the server's blind/bet reconstruction (every Call shows "không có
    // cược để call"). Block start with a clear message instead of a broken hand.
    const noChips = players.filter((p) => p.is_active && p.current_stack <= 0);
    if (noChips.length > 0) {
      toast.error(
        `Chưa nạp chip cho ${noChips.length} ghế (${noChips
          .map((p) => `Ghế ${p.seat_number}`)
          .join(", ")}). Hãy nạp chip cho người chơi trước khi bắt đầu hand.`
      );
      return;
    }
    startingRef.current = true; // set AFTER every early-return guard (released in finally)
    setSubmitting(true);
    setActionSyncBlocked(true);
    markSync("sending", `Bắt đầu Hand #${Number(handNumber)}`);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildStartHandBody({
          tournamentId,
          tableId,
          handNumber,
          handTime: new Date().toISOString(),
          buttonSeat,
          tableSessionId: FEATURES.floorDeferredTrackerMoveV1
            ? availableTables.find((table) => table.id === tableId)?.tableSessionId : null,
          tournamentTableId: FEATURES.floorDeferredTrackerMoveV1
            ? availableTables.find((table) => table.id === tableId)?.tournamentTableId : null,
          controlEpoch: FEATURES.floorDeferredTrackerMoveV1
            ? availableTables.find((table) => table.id === tableId)?.controlEpoch : null,
        }),
      });
      const handData = data?.data || data;
      // Defense in depth: even if a future Edge wrapper mistakenly returns a
      // JSONB policy refusal with HTTP 200, never enter local hand state unless
      // the server returned the canonical successful start envelope.
      if (error || data?.error || handData?.error || handData?.status !== "success" || !handData?.hand_id) {
        const nestedError = typeof handData?.error === "string" ? handData.error : null;
        throw new Error(nestedError ?? await readEdgeError(error, data));
      }
      let frozenLevel: BlindLevelSnapshot | null;
      try {
        frozenLevel = await readHandBlindLevel(handData.hand_id);
      } catch (readError) {
        setOrphanHand({ id: handData.hand_id, hand_number: Number(handNumber) });
        throw readError;
      }
      if (!frozenLevel) {
        setOrphanHand({ id: handData.hand_id, hand_number: Number(handNumber) });
        throw new Error("Hand đã tạo nhưng thiếu blind structure từ Floor. Dừng post blind và gọi Floor.");
      }
      setBlindLevelSnapshot(frozenLevel);
      setBlindLevelCanonical(true);
      setSbAmount(frozenLevel.small_blind);
      setBbAmount(frozenLevel.big_blind);
      setLiveLevelNumber(frozenLevel.level_number);
      if (!await claimHandLock(handData.hand_id)) {
        setOrphanHand({ id: handData.hand_id, hand_number: Number(handNumber) });
        markSync("error");
        return;
      }
      setHandId(handData.hand_id);
      setHandStarted(true);
      setNextActionOrder(1);
      toast.success("Hand started");
      markSync("sent", `Hand #${Number(handNumber)} đã bắt đầu`);
    } catch (e: any) {
      toast.error(e.message || "Failed to start hand");
      markSync("error");
      if (orphanHand) setOrphanHand(null);
    } finally {
      startingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleContinueOrphan = async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (!orphanHand) return false;
    const targetOrphan = orphanHand;
    const loadToken = tableLoadGuardRef.current.capture(tableId);
    setSubmitting(true);
    setActionSyncBlocked(true);
    try {
      const loaded = loadedTableSessionRef.current;
      const sessionId = rosterContext?.tableSessionId
        ?? (loaded?.tournamentId === tournamentId && loaded.tableId === tableId ? loaded.sessionId : null);
      if (!sessionId) throw new Error("Không xác minh được phiên bàn để tiếp tục hand. Hãy tải lại bàn.");
      const [handResult, actionResult] = await Promise.all([
        supabase
          .from("tournament_hands")
          .select("id, hand_number, table_id, button_seat, community_cards")
          .eq("id", targetOrphan.id)
          .eq("tournament_id", tournamentId)
          .eq("table_id", tournamentTableId ?? tableId)
          .filter("table_session_id", "eq", sessionId)
          .eq("status", "in_progress")
          .single(),
        supabase
          .from("hand_actions")
          .select("player_id, action_type, action_amount, action_order, street")
          .eq("hand_id", targetOrphan.id)
          .order("action_order", { ascending: true }),
      ]);
      const { data: hand, error: handErr } = handResult;
      const { data: actionRows, error: actErr } = actionResult;
      if (handErr || !hand) throw new Error(handErr?.message || "Không tải được hand đang diễn ra");
      if (actErr) throw new Error(actErr.message);
      if (!tableLoadGuardRef.current.isCurrent(loadToken)) return false;
      const frozenLevel = await readHandBlindLevel(targetOrphan.id);
      if (!tableLoadGuardRef.current.isCurrent(loadToken)) return false;
      if (frozenLevel) {
        setBlindLevelSnapshot(frozenLevel);
        setBlindLevelCanonical(true);
        setSbAmount(frozenLevel.small_blind);
        setBbAmount(frozenLevel.big_blind);
      }
      const rows = (actionRows ?? []) as ResumeActionRow[];

      const stored = Array.isArray(hand.community_cards) ? (hand.community_cards as unknown[]) : [];
      const communitySlots: (Card | null)[] = [0, 1, 2, 3, 4].map((i) => (stored[i] as Card) ?? null);
      const communityCount = stored.filter(Boolean).length;

      const rebuiltPlayers = replayActions(players, rows);
      const rebuiltActions: ActionRecord[] = rows.map((r) => {
        const pl = players.find((p) => p.player_id === r.player_id);
        return {
          street: (r.street ?? "preflop") as Street,
          player_id: r.player_id,
          display_name: pl?.display_name || r.player_id.slice(0, 6),
          seat_number: pl?.seat_number ?? 0,
          action_type: r.action_type,
          amount: r.action_amount ?? 0,
          action_order: r.action_order,
        };
      });

      const sent = new Set<Street>();
      if (communityCount >= 3) sent.add("flop");
      if (communityCount >= 4) sent.add("turn");
      if (communityCount >= 5) sent.add("river");

      setButtonSeat(hand.button_seat ?? buttonSeat);
      setHandNumber(Number(hand.hand_number));
      setCommunityCards(communitySlots);
      setPlayers(rebuiltPlayers);
      setActions(rebuiltActions);
      setCurrentStreet(deriveResumeStreet(rows, communityCount));
      setNextActionOrder(nextActionOrderFrom(rows));
      setSentCommunityStreets(sent);
      setPersistedBoardCount(communityCount);
      setUndoStack([]);
      setSelectedActorId(null);
      if (!await claimHandLock(hand.id)) return false;
      setHandId(hand.id);
      setHandStarted(true);
      setOrphanHand(null);
      if (!opts?.silent) toast.success("Resuming hand #" + hand.hand_number);
      return true;
    } catch (e: any) {
      toast.error(e.message || "Không thể tiếp tục hand");
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  // A5 resilience: an orphan hand on this table resumes AUTOMATICALLY once its seats
  // are loaded — no manual "Tiếp tục" tap for the overwhelmingly common case. The
  // inline banner (console JSX) stays mounted as a fallback for the rare miss (e.g.
  // an empty table whose `players` never populates), and a toast confirms what
  // happened with a "Huỷ ván treo" secondary via a ref so it always calls the LATEST
  // handleVoid — never a stale closure captured back when this effect fired.
  useEffect(() => {
    if (!autoResumeArmed) return;
    if (!orphanHand || orphanHand.id !== autoResumeArmed) return;
    if (!players.length) return;
    const orphanNumber = orphanHand.hand_number;
    setAutoResumeArmed(null);
    void handleContinueOrphan({ silent: true }).then((resumed) => {
      if (!resumed) return;
      toast.success(`Đã tự động tiếp tục Hand #${orphanNumber}`, {
        duration: 8000,
        action: { label: "Huỷ ván treo", onClick: () => handleVoidRef.current() },
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResumeArmed, orphanHand, players]);

  // A lost Edge response is not evidence that the transaction failed. Read only
  // the submitted hand; never retry the writer or resolve a newer "last" hand.
  const voidHandOnServer = async (targetId: string) => {
    const generation = rosterGenerationRef.current;
    const scope = actionScopeRef.current;
    const loadToken = tableLoadGuardRef.current.capture(tableId);
    const current = () => rosterMountedRef.current
      && generation === rosterGenerationRef.current && scope === actionScopeRef.current
      && tableLoadGuardRef.current.isCurrent(loadToken);
    let data: { status?: string; data?: { status?: string; error?: string } } | null = null;
    let error: unknown = null;
    try {
      const response = await supabase.functions.invoke("tournament-live-update", {
        body: buildVoidHandBody({ tournamentId, handId: targetId }),
      });
      data = response.data;
      error = response.error;
    } catch (cause) {
      error = cause;
    }
    if (!current()) return "stale" as const;
    if (!error && data?.status === "success" && data?.data?.status === "success") {
      return "confirmed" as const;
    }
    let query = supabase.from("tournament_hands").select("id, is_voided")
      .eq("id", targetId).eq("tournament_id", tournamentId)
      .eq("table_id", tournamentTableId ?? tableId);
    const loaded = loadedTableSessionRef.current;
    const sessionId = rosterContext?.tableSessionId
      ?? (loaded?.tournamentId === tournamentId && loaded.tableId === tableId ? loaded.sessionId : null);
    if (sessionId) query = query.eq("table_session_id", sessionId);
    let readback;
    try {
      readback = await query.maybeSingle();
    } catch (cause) {
      if (!current()) return "stale" as const;
      throw cause;
    }
    if (!current()) return "stale" as const;
    if (!readback.error && readback.data?.id === targetId && readback.data.is_voided === true) {
      return "recovered" as const;
    }
    throw new Error(await readEdgeError(error, data?.data?.error ? data.data : data));
  };

  const handleVoidOrphan = async () => {
    if (!orphanHand) return;
    if (!voidFlightRef.current.begin()) return;
    voidOwnsSubmittingRef.current = true;
    const generation = rosterGenerationRef.current;
    const scope = actionScopeRef.current;
    const loadToken = tableLoadGuardRef.current.capture(tableId);
    const current = () => rosterMountedRef.current && generation === rosterGenerationRef.current
      && scope === actionScopeRef.current && tableLoadGuardRef.current.isCurrent(loadToken);
    setSubmitting(true);
    try {
      if (await voidHandOnServer(orphanHand.id) === "stale") return;
      toast.success("Orphan hand voided");
      setOrphanHand(null);
    } catch (e: unknown) {
      if (current()) toast.error(e instanceof Error ? e.message : "Không xác minh được kết quả void hand");
    } finally {
      voidFlightRef.current.finish();
      if (current() && voidOwnsSubmittingRef.current) setSubmitting(false);
      voidOwnsSubmittingRef.current = false;
    }
  };

  // Returns whether the action was ACCEPTED (recorded locally + not rejected by the
  // server). Existing callers ignore the return; the A1 one-tap blind flow uses it so a
  // rejected SB stops the sequence instead of blindly posting the BB + confirming.
  const handleAction = async (
    playerId: string,
    actionType: string,
    amountOverride?: number,
    betToOverride?: number, // racetrack ActionDock forwards the "bet to" street TOTAL directly
    metadata?: VoiceActionMetadata,
  ): Promise<boolean> => {
    const player = players.find((p) => p.player_id === playerId);
    if (!player) return false;
    if (isReadOnly) {
      toast.error("Phiên làm việc đã hết hạn");
      return false;
    }
    if (streetRollbackRef.current) {
      toast.error("Đang hoàn tác vòng — chờ xong đã");
      return false;
    }
    // Workflow v2 HARD-GATE: blind posts only during setup_blinds; betting actions
    // only during an action state. Never bypass the state machine.
    const isPost = actionType.startsWith("post_");
    if (isPost && workflowState !== "setup_blinds") {
      toast.error("Chưa tới bước đặt blind");
      return false;
    }
    if (!isPost && !isActionState(workflowState)) {
      toast.error("Chưa tới bước hành động của vòng này");
      return false;
    }

    // amountOverride is post-only (Guard 3): never reaches bet/raise sizing.
    const postOverride = actionType.startsWith("post_") ? amountOverride : undefined;

    let amount = 0;
    const newPlayers = [...players];
    const idx = newPlayers.findIndex((p) => p.player_id === playerId);

    switch (actionType) {
      case "fold":
        newPlayers[idx] = { ...newPlayers[idx], is_folded: true };
        break;
      case "check":
        break;
      case "call": {
        amount = Math.min(highestBet - player.current_bet, player.current_stack);
        if (amount >= player.current_stack) {
          newPlayers[idx] = {
            ...newPlayers[idx],
            current_stack: 0,
            current_bet: player.current_bet + amount,
            total_bet: player.total_bet + amount,
            is_all_in: true,
          };
        } else {
          newPlayers[idx] = {
            ...newPlayers[idx],
            current_stack: player.current_stack - amount,
            current_bet: player.current_bet + amount,
            total_bet: player.total_bet + amount,
          };
        }
        break;
      }
      case "bet":
      case "raise": {
        // Engine "Bet to" (street total) → chips ADDED; all-in only when it
        // consumes the whole stack. action_amount stays = chips added below.
        // The racetrack ActionDock forwards the total via betToOverride; the
        // LiveFelt console uses the betAmount keypad state (same value, same payload).
        const betTo = betToOverride ?? (parseInt(betAmount) || 0);
        const { added, allIn } = betToAdded(betTo, player.current_bet, player.current_stack);
        if (added <= 0) {
          toast.error("Mức cược phải lớn hơn cược hiện tại của ghế");
          return false;
        }
        amount = added;
        newPlayers[idx] = {
          ...newPlayers[idx],
          current_stack: player.current_stack - added,
          current_bet: player.current_bet + added,
          total_bet: player.total_bet + added,
          is_all_in: allIn,
        };
        break;
      }
      case "all_in": {
        amount = player.current_stack;
        newPlayers[idx] = {
          ...newPlayers[idx],
          current_stack: 0,
          current_bet: player.current_bet + amount,
          total_bet: player.total_bet + amount,
          is_all_in: true,
        };
        break;
      }
      case "post_sb": {
        amount = postOverride ?? (parseInt(betAmount) || 0);
        if (amount <= 0) {
          toast.error("Nhập SB");
          return false;
        }
        const actual = Math.min(amount, player.current_stack);
        const allIn = actual >= player.current_stack;
        newPlayers[idx] = {
          ...newPlayers[idx],
          current_stack: player.current_stack - actual,
          current_bet: actual,
          total_bet: player.total_bet + actual,
          is_all_in: allIn,
        };
        amount = actual;
        break;
      }
      case "post_bb": {
        amount = postOverride ?? (parseInt(betAmount) || 0);
        if (amount <= 0) {
          toast.error("Nhập BB");
          return false;
        }
        const actual = Math.min(amount, player.current_stack);
        const allIn = actual >= player.current_stack;
        newPlayers[idx] = {
          ...newPlayers[idx],
          current_stack: player.current_stack - actual,
          current_bet: actual,
          total_bet: player.total_bet + actual,
          is_all_in: allIn,
        };
        amount = actual;
        break;
      }
    }

    const currentOrder = nextActionOrder;
    const actionScope = `${tableId}:${handId ?? "draft"}`;
    if (actionSyncBlocked || blockedActionScopeRef.current === actionScope || actionWriteGuardRef.current.isBlocked(actionScope)) {
      toast.error("Trang thai truoc chua xac minh. Hay tai lai truoc khi thao tac tiep.");
      return false;
    }
    const writeToken = actionWriteGuardRef.current.begin(actionScope);
    if (!writeToken) {
      toast.warning("Dang ghi hanh dong truoc - vui long cho xong.");
      return false;
    }
    const preSnapshot = { players, actions, currentStreet, nextActionOrder };
    const actionRecord: ActionRecord = {
      street: currentStreet,
      player_id: playerId,
      display_name: player.display_name,
      seat_number: player.seat_number,
      action_type: actionType,
      amount,
      action_order: currentOrder,
    };
    const finishWrite = () => {
      const finished = actionWriteGuardRef.current.finish(writeToken);
      if (actionScopeRef.current === writeToken.scope) setSubmitting(false);
      return finished;
    };
    const blockForAuthoritativeReload = () => {
      actionWriteGuardRef.current.markUncertain(writeToken);
      if (actionScopeRef.current !== writeToken.scope) return false;
      blockedActionScopeRef.current = writeToken.scope;
      setActionSyncBlocked(true);
      setSubmitting(false);
      setSelectedActorId(null);
      markSync("uncertain", "Trang thai chua xac minh - tai lai truoc khi tiep tuc");
      toast.error("Khong xac minh duoc hanh dong tren server. Ban da bi khoa - hay tai lai.");
      return false;
    };
    const commitConfirmedAction = () => {
      if (actionScopeRef.current !== writeToken.scope) {
        finishWrite();
        return false;
      }
      setUndoStack((prev) => [...prev, preSnapshot]);
      setNextActionOrder((prev) => prev + 1);
      setPlayers(newPlayers);
      setActions((prev) => [...prev, actionRecord]);
      setBetAmount("");
      if (ACTION_SOUND_KINDS.has(actionType)) playTrackerSound(actionType as PokerLiveSound);
      markSync("sent", `S${player.seat_number} ${formatActionLabel(actionRecord)}`);
      finishWrite();
      return true;
    };

    setSubmitting(true);

    if (!handId) return commitConfirmedAction();

    {
      markSync("sending", `S${player.seat_number} ${actionType}`);
      let data: unknown;
      let error: unknown;
      try {
        ({ data, error } = await supabase.functions.invoke("tournament-live-update", {
          body: buildRecordActionBody({
            tournamentId,
            handId,
            playerId,
            entryNumber: player.entry_number,
            street: currentStreet,
            actionType,
            actionAmount: amount,
            actionOrder: currentOrder,
            metadata,
          }),
        }));
      } catch {
        return blockForAuthoritativeReload();
      }
      if (actionScopeRef.current !== writeToken.scope) {
        finishWrite();
        return false;
      }
      let rejCode: string | undefined;
      let rejMsg: string | undefined;
      const dataRecord = asRecord(data);
      const errorRecord = asRecord(error);
      if (error) {
        try {
          const context = asRecord(errorRecord?.context);
          const parseJson = context?.json;
          const errBody = typeof parseJson === "function" ? await parseJson() : null;
          const errorBody = asRecord(errBody);
          const validation = asRecord(errorBody?.validation);
          rejCode = typeof errorBody?.code === "string" ? errorBody.code : typeof validation?.code === "string" ? validation.code : undefined;
          rejMsg = typeof errorBody?.error === "string" ? errorBody.error : undefined;
        } catch {
          /* body was not JSON */
        }
        if (!rejMsg && typeof errorRecord?.message === "string") rejMsg = errorRecord.message;
      } else if (dataRecord?.error) {
        rejCode = typeof dataRecord.code === "string" ? dataRecord.code : undefined;
        rejMsg = typeof dataRecord.error === "string" ? dataRecord.error : undefined;
      }

      if (error || dataRecord?.error) {
        if (classifyActionWriteFailure({ code: rejCode, message: rejMsg, data }) !== "validation") {
          return blockForAuthoritativeReload();
        }
        setSelectedActorId(null);
        finishWrite();
        toast.error(friendlyValidationError(rejCode, rejMsg), { description: `Mã lỗi: ${rejCode}` });
        markSync("error");
        return false;
      } else if (rejMsg) {
        toast.error(rejMsg);
        markSync("error");
        return false;
      } else {
        if (!isConfirmedActionWrite(data)) return blockForAuthoritativeReload();
        if ((data as any)?.validation?.code) {
          toast.warning(
            `Cảnh báo luật: ${friendlyValidationError((data as any).validation.code, (data as any).validation.message)}`
          );
        }
        markSync(
          "sent",
          `S${player.seat_number} ${formatActionLabel({
            street: currentStreet,
            player_id: playerId,
            display_name: player.display_name,
            seat_number: player.seat_number,
            action_type: actionType,
            amount,
            action_order: currentOrder,
          })}`
        );
      }
    }
    return commitConfirmedAction();
  };

  const handleVoiceAction = async (
    proposal: VoiceActionProposal,
    metadata: VoiceActionMetadata,
  ): Promise<boolean> => {
    if (
      proposal.actor.playerId !== engineActor?.player_id
      || proposal.actor.seatNumber !== engineActor?.seat_number
    ) {
      toast.error(`Đang tới Ghế ${engineActor?.seat_number ?? "?"}. Hãy đọc lại action cho đúng Ghế.`);
      return false;
    }
    return handleAction(
      proposal.actor.playerId,
      proposal.canonicalAction,
      undefined,
      proposal.betToTotal,
      metadata,
    );
  };

  const handleDockAction = (type: string, betTo?: number) => {
    if (!effectiveActorId) {
      toast.error("Chạm một ghế để chọn người hành động");
      return;
    }
    if (type === "all_in") {
      const who = players.find((p) => p.player_id === effectiveActorId);
      const msg = `Xác nhận ALL-IN ${who ? formatStack(who.current_stack) : ""}${who ? ` của ${who.display_name}` : ""}? Toàn bộ stack sẽ vào pot.`;
      if (!confirm(msg)) return;
    }
    handleAction(effectiveActorId, type, undefined, betTo); // racetrack forwards the bet-to total
    setSelectedActorId(null);
  };

  const handlePostBlind = (type: "post_sb" | "post_bb", playerId: string, amount: number) => {
    if (isReadOnly) {
      toast.error("Phiên làm việc đã hết hạn");
      return;
    }
    void handleAction(playerId, type, amount);
  };
  const handleConfirmBlinds = () => {
    if (!bbPosted || (!deadSb && !sbPosted)) {
      toast.error(
        deadSb ? "Hãy post Big Blind trước khi xác nhận" : "Hãy post Small Blind và Big Blind trước khi xác nhận"
      );
      return;
    }
    setBlindsConfirmedLocal(true);
  };
  // A1 (trackerBlindAutoSeed) one-tap blind posting: post SB (unless dead) + BB with the
  // CONFIRMED on-screen amounts, then confirm — 3 taps → 1. A confirm assist, never a
  // silent mutate: the operator sees (and can edit) the amounts before tapping, and the
  // zero-guard blocks posting a 0 blind.
  //
  // IMPORTANT: the two posts must NOT run as sequential awaits in one closure —
  // handleAction reads players/actions/nextActionOrder from ITS render's closure, so a
  // second call before a re-render would reuse the same action_order and overwrite the
  // SB's setPlayers update. Instead this is a tiny step machine: the tap posts the SB;
  // an effect posts the BB on the NEXT render (fresh closure); a second step confirms.
  // A rejected step stops the chain (an accepted SB stays — it WAS recorded).
  const [autoBlindStep, setAutoBlindStep] = useState<null | "bb" | "confirm">(null);
  const handlePostBothBlinds = async () => {
    if (isReadOnly) {
      toast.error("Phiên làm việc đã hết hạn");
      return;
    }
    if (autoBlindStep !== null) return; // chain already running (double-tap guard)
    if (streetRollbackRef.current) {
      toast.error("Đang hoàn tác vòng — chờ xong đã");
      return;
    }
    const sbPlayer = players.find((p) => p.seat_number === blindSbSeat);
    const bbPlayer = players.find((p) => p.seat_number === blindBbSeat);
    if (!bbPlayer || bbAmount <= 0 || (!effectiveDeadSb && (!sbPlayer || sbAmount <= 0))) {
      toast.error("Chưa đủ thông tin blind (ghế/số tiền) — kiểm tra lại SB/BB");
      return;
    }
    if (effectiveDeadSb || sbPosted || !sbPlayer) {
      setAutoBlindStep("bb"); // nothing to post for SB → go straight to the BB step
      return;
    }
    const ok = await handleAction(sbPlayer.player_id, "post_sb", sbAmount);
    if (ok) setAutoBlindStep("bb");
  };
  // Step "bb": runs on the render AFTER the SB post flushed → fresh closure.
  useEffect(() => {
    if (autoBlindStep !== "bb") return;
    if (bbPosted) {
      setAutoBlindStep("confirm");
      return;
    }
    const bbPlayer = players.find((p) => p.seat_number === blindBbSeat);
    if (!bbPlayer || bbAmount <= 0) {
      setAutoBlindStep(null);
      return;
    }
    let cancelled = false;
    void handleAction(bbPlayer.player_id, "post_bb", bbAmount).then((ok) => {
      if (!cancelled) setAutoBlindStep(ok ? "confirm" : null);
    });
    return () => {
      cancelled = true;
    };
    // players/blindBbSeat/bbAmount/bbPosted are read from THIS render's fresh closure;
    // the effect only fires on step changes by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBlindStep]);
  // Step "confirm": both blinds accepted → confirm (the derived sbPosted/bbPosted are
  // fresh here, but confirm directly — this step only runs after accepted posts).
  useEffect(() => {
    if (autoBlindStep !== "confirm") return;
    setBlindsConfirmedLocal(true);
    setAutoBlindStep(null);
  }, [autoBlindStep]);
  // P2-3: toggle "dead small blind" (no SB this hand). Clearing it after an SB was
  // already posted is harmless — sbPosted then drives the normal requirement again.
  const handleToggleDeadSb = () => setDeadSb((v) => !v);

  const handleResetButton = () => {
    if (handStarted || submitting || isReadOnly) return;
    setButtonOverridden(true);
    setButtonConfirmed(false);
  };

  const handleSeatTap = (seat: RailSeat) => {
    if (!handStarted) {
      if (buttonConfirmed || submitting || isReadOnly) return;
      setButtonSeat(seat.seat_number);
      setButtonConfirmed(true);
      setButtonOverridden(true); // P2-5: manual button → drop the dead-button suggestion
      return;
    }
    if (isReadOnly) return;
    if (engineActor && seat.player_id !== engineActor.player_id) {
      toast.warning(`Ghế ${seat.seat_number} chưa tới lượt (đang chờ ghế ${engineActor.seat_number}) — vẫn chọn để chỉnh.`);
    }
    setSelectedActorId(seat.player_id);
  };

  // Felt tap → resolve the seat number to a player, then reuse the rail-tap logic.
  const handleSeatNumberTap = (seatNumber: number) => {
    if (!handStarted) {
      if (buttonConfirmed || submitting || isReadOnly) return;
      setButtonSeat(seatNumber);
      setButtonConfirmed(true);
      setButtonOverridden(true); // P2-5: manual button (incl. an empty seat → dead button)
      return;
    }
    if (isReadOnly) return;
    const p = players.find((x) => x.seat_number === seatNumber);
    if (!p) return;
    if (engineActor && p.player_id !== engineActor.player_id) {
      toast.warning(`Ghế ${seatNumber} chưa tới lượt (đang chờ ghế ${engineActor.seat_number}) — vẫn chọn để chỉnh.`);
    }
    setSelectedActorId(p.player_id);
  };

  const restoreLastSnapshot = () => {
    const snap = undoStack[undoStack.length - 1];
    if (!snap) return;
    setPlayers(snap.players);
    setActions(snap.actions);
    setCurrentStreet(snap.currentStreet);
    setNextActionOrder(snap.nextActionOrder);
    setUndoStack((prev) => prev.slice(0, -1));
    setBetAmount("");
    setSelectedActorId(null);
    // UAT wave 2 (P1 undo rule): restoring a snapshot that is NOT a runout anymore
    // (e.g. undoing the cover-call) invalidates a reveal/skip that was never
    // broadcast — clear revealDone so runout_reveal can fire again. Once hole cards
    // were actually broadcast (persisted server-side) revealDone is preserved.
    if (revealDone && !holeCardsBroadcastRef.current) {
      const live = snap.players.filter((p) => !p.is_folded);
      const elig = live.filter((p) => !p.is_all_in && p.current_stack > 0);
      if (!(live.length >= 2 && elig.length <= 1)) setRevealDone(false);
    }
  };

  const requestDurableUndo = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!handId || !tournamentTableId) return { ok: false, error: "Thiếu phiên bàn Tracker." };
    const storageKey = `tracker-undo:${tournamentId}:${handId}`;
    type PendingUndo = { expectedActionId: string; expectedSourceRevision: number; idempotencyKey: string };
    let pending: PendingUndo | null = null;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) pending = JSON.parse(raw) as PendingUndo;
    } catch {
      return { ok: false, error: "Không lưu được mã hoàn tác an toàn trong trình duyệt." };
    }
    if (!pending) {
      const [handResult, actionResult] = await Promise.all([
        supabase.from("tournament_hands").select("source_revision").eq("id", handId).maybeSingle(),
        supabase.from("hand_actions").select("id").eq("hand_id", handId)
          .order("action_order", { ascending: false }).order("created_at", { ascending: false })
          .order("id", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const sourceRevision = (handResult.data as unknown as { source_revision?: unknown } | null)?.source_revision;
      const actionId = actionResult.data?.id;
      if (handResult.error || actionResult.error || typeof sourceRevision !== "number"
        || !Number.isSafeInteger(sourceRevision) || typeof actionId !== "string") {
        return { ok: false, error: "Không xác minh được action cuối và phiên bản máy chủ." };
      }
      pending = { expectedActionId: actionId, expectedSourceRevision: sourceRevision, idempotencyKey: crypto.randomUUID() };
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(pending));
      } catch {
        return { ok: false, error: "Không lưu được mã hoàn tác an toàn trong trình duyệt." };
      }
    }
    const { data, error } = await supabase.functions.invoke("tournament-live-update", {
      body: buildDeleteLastActionBody({
        tournamentId, tournamentTableId, handId,
        expectedActionId: pending.expectedActionId,
        expectedSourceRevision: pending.expectedSourceRevision,
        idempotencyKey: pending.idempotencyKey,
      }),
    });
    const rejection = (data as { error?: unknown } | null)?.error;
    if (error || rejection) {
      if (error) return { ok: false, error: "Chưa rõ hoàn tác đã ghi hay chưa. Bấm lại để kiểm tra cùng mã yêu cầu." };
      window.sessionStorage.removeItem(storageKey);
      return { ok: false, error: typeof rejection === "string" ? rejection : "Không hoàn tác được hành động." };
    }
    window.sessionStorage.removeItem(storageKey);
    return { ok: true };
  };

  const handleUndo = async () => {
    if (isReadOnly) {
      toast.error("Phiên làm việc đã hết hạn");
      return;
    }
    if (streetRollbackRef.current) {
      toast.error("Đang hoàn tác vòng — chờ xong đã");
      return;
    }
    if (undoStack.length === 0) {
      toast.error("Không có hành động nào để hoàn tác");
      return;
    }
    if (!handId) {
      restoreLastSnapshot();
      return;
    }
    const undo = await requestDurableUndo();
    if (!undo.ok) {
      toast.error(undo.error ?? "Không hoàn tác được hành động");
      return;
    }
    restoreLastSnapshot();
    toast.success("Đã hoàn tác hành động cuối");
  };

  // ── C2 (trackerStreetRollback) — "Hoàn tác cả vòng" ────────────────────────────
  // Decision logic lives in streetRollback.ts (pure, unit-tested); this block is the
  // trigger + the one-step-per-render executor (A1 blind-chain pattern).
  const streetRollbackPlan = useMemo(
    () =>
      planStreetRollback({
        persistedBoardCount,
        actions,
        undoStackLength: undoStack.length,
        isReadOnly,
        submitting,
        chainRunning: streetRollback !== null || autoBlindStep !== null,
        isRunout: allInRunout,
        currentStreet,
        isSummary,
        handId,
      }),
    [
      persistedBoardCount,
      actions,
      undoStack.length,
      isReadOnly,
      submitting,
      streetRollback,
      autoBlindStep,
      allInRunout,
      currentStreet,
      isSummary,
      handId,
    ],
  );

  const handleStreetRollback = () => {
    const plan = streetRollbackPlan;
    if (!plan) return;
    if ("blocked" in plan) {
      toast.error(plan.blocked);
      return;
    }
    const label = ROLLBACK_STREET_LABELS[plan.street];
    // Owner P1 — the confirm states explicitly: how many actions get deleted, which
    // street reverts, that the cards return to the editable slots, and that the
    // viewer sees the cards disappear.
    const lines = [
      `Hoàn tác cả vòng ${label}?`,
      ...(plan.deletes > 0 ? [`• Xoá ${plan.deletes} hành động của vòng ${label}`] : []),
      `• Thu hồi bài ${label} trên viewer — người xem sẽ thấy bài biến mất`,
      `• Bài ${label} quay lại ô nhập để sửa / gửi lại`,
      `Sau đó bạn quay về bước nhập bài ${label}. Để sửa hành động ở vòng trước, bấm tiếp "Hoàn tác" từng bước.`,
    ];
    if (!confirm(lines.join("\n"))) return;
    setSubmitting(true);
    markSync("sending", `Hoàn tác vòng ${label}`);
    setStreetRollback({
      street: plan.street,
      phase: plan.deletes === 0 ? "shrinking" : "deleting",
      deletesRemaining: plan.deletes,
      total: plan.deletes,
    });
  };

  // The executor: ONE async step per render — MANDATORY, because restoreLastSnapshot
  // reads undoStack from its render's closure; a while-loop would pop the same stale
  // snapshot N times. Deletes run strictly BEFORE the board shrink (D4: resume derives
  // its street from MAX(board, actions), so every crash point resolves consistently).
  useEffect(() => {
    if (!streetRollback || !handId) return;
    let cancelled = false;
    const { street } = streetRollback;
    const label = ROLLBACK_STREET_LABELS[street];
    const failChain = (msg: string) => {
      setStreetRollback(null);
      setSubmitting(false);
      markSync("error");
      toast.error(msg);
    };
    const step = nextRollbackStep(streetRollback);
    if (step.kind === "transition_to_shrink") {
      setStreetRollback((s) => (s ? { ...s, phase: "shrinking" } : s));
      return;
    }
    if (step.kind === "delete") {
      const stepNo = streetRollback.total - streetRollback.deletesRemaining + 1;
      markSync("sending", `Hoàn tác ${label} (${stepNo}/${streetRollback.total})`);
      requestDurableUndo()
        .then((undo) => {
          if (cancelled) return;
          if (!undo.ok) {
            // Earlier confirmed deletes stand and were each mirrored by a pop —
            // local == server. Re-tap recomputes the remaining count and resumes.
            const done = streetRollback.total - streetRollback.deletesRemaining;
            failChain(
              `${undo.error ?? "Hoàn tác dừng giữa chừng"} Đã xoá ${done}/${streetRollback.total} hành động.`,
            );
            return;
          }
          restoreLastSnapshot(); // ONE pop — this render's fresh closure
          setStreetRollback((s) => (s ? { ...s, deletesRemaining: s.deletesRemaining - 1 } : s));
        });
      return () => {
        cancelled = true;
      };
    }
    // step.kind === "shrink" — direct invoke with buildUpdateCommunityCardsBody:
    // handleUpdateCommunityCards must NOT be reused (its isBoardEntryState hard-gate
    // would reject — workflowState is still {street}_action at this moment).
    const slice = communityCards.slice(0, step.keepCount).filter((c): c is Card => c !== null);
    supabase.functions
      .invoke("tournament-live-update", {
        body: buildUpdateCommunityCardsBody({ tournamentId, handId, communityCards: slice }),
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || (data as any)?.error) {
          // All deletes already landed; board flags untouched → a coherent
          // "{street} dealt, awaiting first action" state. Re-tap goes straight to
          // shrinking (deletes recompute to 0) — the operation is resumable.
          failChain(
            `Đã xoá hành động nhưng chưa thu hồi được bài ${label} — bấm "Hoàn tác cả vòng" lần nữa để thử lại.`,
          );
          return;
        }
        // Synchronous local rewind — ONE batched commit (D2/D3). currentStreet was
        // already left at the target by the pops (n>0); setting it covers n=0.
        setSentCommunityStreets((prev) => {
          const nx = new Set(prev);
          nx.delete(street);
          return nx;
        });
        setPersistedBoardCount(step.keepCount);
        setCommunityCards((prev) => prev.map((c, idx) => (idx >= step.clearFrom ? null : c)));
        setCurrentStreet(street);
        setSelectedActorId(null);
        setBetAmount("");
        setStreetRollback(null);
        setSubmitting(false);
        markSync("sent", `Đã hoàn tác vòng ${label}`);
        toast.success(
          `Đã hoàn tác cả vòng ${label} — nhập lại bài ${label} hoặc bấm Hoàn tác để sửa vòng trước.`,
        );
      });
    return () => {
      cancelled = true;
    };
    // One step per render; every other input is read from this render's closure by
    // design (the A1 chain pattern).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streetRollback]);

  // View-model for the HandControlsStrip button. null when the flag is off / no
  // rollback target — the strip renders byte-identically to today.
  const streetRollbackUi = useMemo(() => {
    if (!FEATURES.trackerStreetRollback || !handStarted || isSummary) return null;
    if (streetRollback) {
      return {
        label: ROLLBACK_STREET_LABELS[streetRollback.street],
        busy: true,
        progress: `${streetRollback.total - streetRollback.deletesRemaining}/${streetRollback.total}`,
      };
    }
    const target = rollbackTargetFrom(persistedBoardCount);
    if (!target || currentStreet === "showdown") return null;
    if (streetRollbackPlan && "blocked" in streetRollbackPlan) {
      // submitting is transient noise (the strip's own `disabled` covers it) — hide
      // instead of flashing a disabled-reason tooltip mid-send.
      if (submitting) return null;
      return {
        label: ROLLBACK_STREET_LABELS[target],
        busy: false,
        disabledReason: streetRollbackPlan.blocked,
      };
    }
    return { label: ROLLBACK_STREET_LABELS[target], busy: false };
  }, [handStarted, isSummary, streetRollback, persistedBoardCount, currentStreet, streetRollbackPlan, submitting]);

  const handleUpdateCommunityCards = async () => {
    if (!handId || isReadOnly) return;
    if (streetRollbackRef.current) {
      toast.error("Đang hoàn tác vòng — chờ xong đã");
      return;
    }
    const cards = communityCards.filter((c): c is Card => c !== null);
    // Workflow v2 HARD-GATE: only in the matching enter_* state, count COMPLETE
    // (3/1/1), no duplicate, street must match.
    if (!isBoardEntryState(workflowState)) {
      toast.error("Chưa tới bước nhập bài board");
      return;
    }
    const need =
      currentStreet === "flop" || currentStreet === "turn" || currentStreet === "river"
        ? REQUIRED_BOARD_COUNT[currentStreet]
        : 0;
    if (cards.length < need) {
      toast.error(`Cần nhập đủ ${need} lá ${STREET_LABELS[currentStreet]}`);
      return;
    }
    if (new Set(cards).size !== cards.length) {
      toast.error("Có lá bài trùng nhau");
      return;
    }
    if (cards.length === 0) return;
    if (
      sentCommunityStreets.has(currentStreet) &&
      !confirm(`Bài ${STREET_LABELS[currentStreet]} đã được gửi. Ghi đè lại?`)
    )
      return;
    setSubmitting(true);
    markSync("sending", `Gửi ${STREET_LABELS[currentStreet]}`);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildUpdateCommunityCardsBody({ tournamentId, handId, communityCards: cards }),
      });
      if (error || data?.error) throw new Error(await readEdgeError(error, data));
      setSentCommunityStreets((prev) => new Set(prev).add(currentStreet));
      setPersistedBoardCount(cards.length);
      // C4: chips gather into the pot, then the street's cards hit the felt.
      playTrackerSoundOnce(playedSoundsRef.current, handId, currentStreet, "pot_collect");
      playTrackerSoundOnce(
        playedSoundsRef.current,
        handId,
        currentStreet,
        cards.length >= 5 ? "deal_river" : cards.length === 4 ? "deal_turn" : "deal_flop",
      );
      toast.success(`Đã gửi ${STREET_LABELS[currentStreet]} lên viewer (${cards.length} lá)`);
      markSync("sent", `${STREET_LABELS[currentStreet]} (${cards.length} lá)`);
    } catch (e: any) {
      toast.error(`Lỗi gửi bài, thử lại: ${e.message}`);
      markSync("error");
    } finally {
      setSubmitting(false);
    }
  };

  /** Applies only an authoritative atomic Voice Board receipt, never a draft. */
  const applyVoiceBoardReceipt = useCallback((receipt: VoiceBoardCommitReceipt) => {
    if (!handId || receipt.community_cards.length < 3 || receipt.community_cards.length > 5) return false;
    const cards = receipt.community_cards as Card[];
    const street = receipt.street as Street;
    setCommunityCards([
      cards[0] ?? null,
      cards[1] ?? null,
      cards[2] ?? null,
      cards[3] ?? null,
      cards[4] ?? null,
    ]);
    setPersistedBoardCount(cards.length);
    setSentCommunityStreets((previous) => new Set(previous).add(street));
    setPlayers((previous) => previous.map((player) => ({ ...player, current_bet: 0 })));
    playTrackerSoundOnce(playedSoundsRef.current, handId, street, "pot_collect");
    playTrackerSoundOnce(
      playedSoundsRef.current,
      handId,
      street,
      cards.length >= 5 ? "deal_river" : cards.length === 4 ? "deal_turn" : "deal_flop",
    );
    markSync("sent", `Voice Assist ${STREET_LABELS[street]} (${cards.length} lá)`);
    return true;
  }, [handId, markSync]);

  /** Mirrors a redacted server receipt for one seat only; it never writes or replaces other drafts. */
  const applyVoiceHoleCardsReceipt = useCallback((input: {
    receipt: VoiceHoleCardsCommitReceipt;
    playerId: string;
    entryNumber: number;
    cards: readonly [Card, Card];
  }) => {
    if (!handId || input.receipt.player_id !== input.playerId || input.receipt.entry_number !== input.entryNumber) {
      return false;
    }
    const target = players.find((player) => (
      player.player_id === input.playerId
      && player.entry_number === input.entryNumber
      && player.seat_number === input.receipt.seat_number
    ));
    if (!target) return false;
    const existing = playerHoleCards[input.playerId]?.filter((card): card is Card => card !== null) ?? [];
    if (existing.length > 0 && (existing.length !== 2 || existing[0] !== input.cards[0] || existing[1] !== input.cards[1])) {
      return false;
    }
    setPlayerHoleCards((previous) => ({ ...previous, [input.playerId]: [...input.cards] }));
    markSync("sent", `Voice Assist lật bài Ghế ${input.receipt.seat_number}`);
    return true;
  }, [handId, markSync, playerHoleCards, players]);

  /** Applies a completed canonical Finish receipt without sending a second record_hand request. */
  const applyVoiceFinishReceipt = useCallback(async (receipt: VoiceFinishCommitReceipt) => {
    if (!handId || receipt.hand_id !== handId) return false;
    if (FEATURES.floorDeferredTrackerMoveV1
      && availableTables.find((table) => table.id === tableId)?.tableSessionId) {
      setHandId(null);
      setHandStarted(false);
      resetHand({ loadNextHandNumber: false });
      await handleTableChange(tableId);
      setLastHandId(receipt.hand_id);
      markSync("sent", `Voice Assist đã lưu Hand #${Number(handNumber)}`);
      return true;
    }
    const { data: refreshedSeats, error } = await supabase
      .from("tournament_seats")
      .select("seat_number, player_id, is_active, chip_count")
      .eq("tournament_id", tournamentId)
      .eq("table_id", tableId)
      .order("seat_number");
    if (error || !refreshedSeats) return false;
    const displayOutcome = await ensureRecordedHandDisplayOutcome({
      tournamentId,
      handId: receipt.hand_id,
    });
    if (!displayOutcome.ok) {
      toast.warning("Hand đã lưu; outcome hiển thị chưa được server xác minh. Có thể kiểm tra lại trong Lịch sử & sửa hand.");
    }
    const activeRows = refreshedSeats.filter((seat) => seat.player_id && seat.is_active !== false);
    const activeNums = activeRows.map((seat) => seat.seat_number).sort((left, right) => left - right);
    const serverEndingStacks = Object.fromEntries(
      refreshedSeats
        .filter((seat) => seat.player_id)
        .map((seat) => [seat.player_id!, Number(seat.chip_count ?? 0)]),
    );
    playTrackerSoundOnce(playedSoundsRef.current, handId, "hand_end", "pot_collect");
    markSync("sent", `Voice Assist đã lưu Hand #${Number(handNumber)}`);
    setLastHandId(receipt.hand_id);
    const currentLineage = await readBlindLineage(receipt.hand_id);
    const nextSuggestion = nextButtonFromBlindLineage({
      maxSeats, occupiedSeats: activeNums,
      previousDealtSeats: currentLineage?.previousDealtSeats ?? [],
      previousButtonSeat: currentLineage?.previousButtonSeat ?? null,
      previousSbPosition: currentLineage?.previousSbPosition ?? null,
      previousBbSeat: currentLineage?.previousBbSeat ?? null,
    });
    if (nextSuggestion) setButtonSeat(nextSuggestion.buttonSeat);
    setButtonConfirmed(Boolean(nextSuggestion));
    setLastBlindLineage(currentLineage);
    setButtonOverridden(false);
    setPlayers((previous) => survivorsAfterHand(previous, activeNums, serverEndingStacks));
    setHandId(null);
    setHandStarted(false);
    resetHand();
    return true;
  }, [availableTables, handId, handNumber, handleTableChange, markSync, maxSeats, resetHand, tableId, tournamentId]);

  // B2 — all-in runout ONE-SCREEN: persist EVERY remaining board street in one
  // operator gesture. Sends the SAME cumulative update_community_cards payload as
  // handleUpdateCommunityCards, but staged (flop → turn → river, ~0.9s apart) so the
  // /live viewer still gets a street-by-street reveal instead of all cards at once.
  // Only meaningful during a runout (betting closed); the per-street panel stays the
  // fallback. Advances currentStreet as it goes, then to "showdown" so the workflow
  // lands on showdown_input. Gated by the caller on FEATURES.trackerRunoutOneScreen.
  const RUNOUT_STAGE_MS = 900;
  const handleRunoutDealAll = async () => {
    if (!handId || isReadOnly) return;
    if (streetRollbackRef.current) {
      toast.error("Đang hoàn tác vòng — chờ xong đã");
      return;
    }
    if (!isBoardEntryState(workflowState)) {
      toast.error("Chưa tới bước chia bài board");
      return;
    }
    // Every one of the 5 board slots must be filled before a one-shot runout.
    if (communityCards.some((c) => c === null)) {
      toast.error("Nhập đủ 5 lá bài chung trước khi chia hết");
      return;
    }
    const all = communityCards.filter((c): c is Card => c !== null);
    if (new Set(all).size !== all.length) {
      toast.error("Có lá bài trùng nhau");
      return;
    }
    // Stage only the street boundaries not already persisted (a runout can start on
    // the turn — flop already on the board — so [3,4,5] filtered by what's live).
    const stages: { count: number; street: Street }[] = [
      { count: 3, street: "flop" as Street },
      { count: 4, street: "turn" as Street },
      { count: 5, street: "river" as Street },
    ].filter((s) => s.count > persistedBoardCount);
    if (stages.length === 0) return;
    setSubmitting(true);
    try {
      for (let k = 0; k < stages.length; k++) {
        const { count, street } = stages[k];
        const slice = communityCards.slice(0, count).filter((c): c is Card => c !== null);
        markSync("sending", `Chia ${STREET_LABELS[street]}`);
        const { data, error } = await supabase.functions.invoke("tournament-live-update", {
          body: buildUpdateCommunityCardsBody({ tournamentId, handId, communityCards: slice }),
        });
        if (error || data?.error) throw new Error(await readEdgeError(error, data));
        setPersistedBoardCount(count);
        setSentCommunityStreets((prev) => new Set(prev).add(street));
        setCurrentStreet(street);
        setPlayers((prev) => prev.map((p) => ({ ...p, current_bet: 0 })));
        // C4: one pot-collect when the runout starts (bets were gathered once), then
        // a deal sound per staged street reveal.
        if (k === 0) playTrackerSoundOnce(playedSoundsRef.current, handId, street, "pot_collect");
        playTrackerSoundOnce(
          playedSoundsRef.current,
          handId,
          street,
          count >= 5 ? "deal_river" : count === 4 ? "deal_turn" : "deal_flop",
        );
        markSync("sent", `${STREET_LABELS[street]} (${count} lá)`);
        // Space the reveals so the viewer sees flop → turn → river, not all-at-once.
        if (k < stages.length - 1) await new Promise((r) => setTimeout(r, RUNOUT_STAGE_MS));
      }
      setCurrentStreet("showdown");
      toast.success("Đã chia hết bài — chuyển sang chấm kết quả");
    } catch (e: any) {
      toast.error(`Lỗi chia bài, thử lại: ${e.message}`);
      markSync("error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleShowHoleCards = async () => {
    if (!handId || isReadOnly) return;
    const generation = rosterGenerationRef.current;
    const scope = actionScopeRef.current;
    const loadToken = tableLoadGuardRef.current.capture(tableId);
    const current = () => rosterMountedRef.current && generation === rosterGenerationRef.current
      && scope === actionScopeRef.current && tableLoadGuardRef.current.isCurrent(loadToken);
    const cardsPayload = [];
    for (const [playerId, holeCards] of Object.entries(playerHoleCards)) {
      const filtered = holeCards.filter((c): c is Card => c !== null);
      if (filtered.length === 2) {
        const player = players.find((p) => p.player_id === playerId);
        cardsPayload.push({ player_id: playerId, entry_number: player?.entry_number || 1, hole_cards: filtered });
      }
    }
    if (cardsPayload.length === 0) {
      toast.error("Chưa nhập bài lỗ cho ai");
      return;
    }
    const loaded = loadedTableSessionRef.current;
    const sessionId = rosterContext?.tableSessionId
      ?? (loaded?.tournamentId === tournamentId && loaded.tableId === tableId ? loaded.sessionId : null);
    if (!sessionId) {
      toast.error("Chưa xác minh được phiên bàn để lật bài.");
      return;
    }
    const flightKey = JSON.stringify([user?.id, tournamentId, tournamentTableId ?? tableId,
      sessionId, rosterContext?.controlEpoch ?? null, handId]);
    const flight = manualCardsFlightsRef.current.get(flightKey) ?? createSingleFlightGuard();
    if (!flight.begin()) {
      toast.info("Đang chờ kết quả lật bài của hand này; không gửi thêm yêu cầu.");
      return;
    }
    manualCardsFlightsRef.current.set(flightKey, flight);
    manualCardsOwnsSubmittingRef.current = true;
    setSubmitting(true);
    markSync("sending", "Lật bài");
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildShowHoleCardsBody({ tournamentId, handId, playerHoleCards: cardsPayload }),
      });
      if (!current()) return;
      const verdict = data?.data;
      if (error || data?.error || data?.status !== "success" || verdict?.error
        || verdict?.status !== "success" || !Number.isInteger(verdict.entry_count)
        || verdict.entry_count !== cardsPayload.length) {
        throw new Error(typeof verdict?.error === "string" ? verdict.error : await readEdgeError(error, data));
      }
      holeCardsBroadcastRef.current = true; // persisted server-side → undo keeps revealDone
      toast.success("Hole cards revealed");
      markSync("sent", `Đã lật ${cardsPayload.length} tay bài`);
    } catch (e: any) {
      if (!current()) return;
      toast.error(e.message);
      markSync("error");
    } finally {
      flight.finish();
      const ownsFlight = manualCardsFlightsRef.current.get(flightKey) === flight;
      if (ownsFlight) manualCardsFlightsRef.current.delete(flightKey);
      if (current() && ownsFlight && manualCardsOwnsSubmittingRef.current) {
        manualCardsOwnsSubmittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  // P2-2: all-in runout reveal-first — broadcast the flipped hole cards to the
  // viewer (best-effort), then mark reveal done so the remaining board streets can
  // be entered. The physical flip has happened; the viewer broadcast is cosmetic,
  // so `revealDone` is set regardless of broadcast outcome. The final auto-settle
  // (settleShowdown) still enforces "all contenders revealed-or-mucked", so a
  // partial reveal here can never produce a phantom settlement.
  const handleRevealRunout = async () => {
    const generation = rosterGenerationRef.current;
    const scope = actionScopeRef.current;
    const loadToken = tableLoadGuardRef.current.capture(tableId);
    await handleShowHoleCards();
    if (!rosterMountedRef.current || generation !== rosterGenerationRef.current
      || scope !== actionScopeRef.current || !tableLoadGuardRef.current.isCurrent(loadToken)) return;
    setRevealDone(true);
  };

  // UAT wave 2 (Fix 1 escape): the operator has NO hole-card info (e.g. cards not
  // shown to the floor) — continue the runout WITHOUT broadcasting. Deliberately
  // does NOT call handleShowHoleCards (it errors on zero cards). The viewer keeps
  // face-down cards for this hand; settlement still requires revealed-or-mucked at
  // the Showdown step, so this can never produce a phantom settle.
  const handleSkipRevealRunout = () => {
    setRevealDone(true);
    toast.warning(
      "Tiếp tục không lật — bài sẽ không hiển thị trên viewer. Bạn vẫn phải chấm kết quả thủ công ở Showdown."
    );
  };

  const nextStreet = () => {
    const idx = STREET_ORDER.indexOf(currentStreet);
    if (idx < STREET_ORDER.length - 1) {
      setPlayers((prev) => prev.map((p) => ({ ...p, current_bet: 0 })));
      setCurrentStreet(STREET_ORDER[idx + 1]);
    }
  };

  const handleToggleWinner = (playerId: string) => {
    setSelectedWinners((prev) => (prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]));
  };
  const handleHoleCardChange = (playerId: string, ci: number, card: Card | null) => {
    setPlayerHoleCards((prev) => {
      const cur = prev[playerId] || [null, null];
      const upd = [...cur] as (Card | null)[];
      upd[ci] = card;
      return { ...prev, [playerId]: upd };
    });
  };
  // Guardrail 3 — muck = forfeit but the chips stay in the pot (dead money):
  // settleShowdown drops a mucked player from the rank but keeps their committed
  // chips as a pot contributor (they just can't win).
  const handleToggleMuck = (playerId: string) => {
    setMuckedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  // P2-1 auto-settle: rank revealed hands + pay each side-pot layer exactly.
  // settleShowdown returns null until every live contender has revealed or is mucked
  // → we tell the operator exactly what's missing instead of guessing (no phantom stacks).
  const handleAutoSettle = () => {
    const board = communityCards.filter((c): c is Card => c !== null);
    const settlement = settleShowdown(engineState.seats, playerHoleCards, board, muckedPlayerIds);
    if (!settlement) {
      toast.error("Chưa tự chấm được — cần đủ 5 lá board + 2 lá tẩy cho mỗi người còn bài (hoặc bấm Úp bài cho người không lật).");
      return;
    }
    const map: Record<string, number> = {};
    settlement.results.forEach((r) => {
      map[r.player_id] = r.ending_stack;
    });
    setShowdownLayers(settlement.layers);
    setEndingStacks(map);
    setEndingStacksManuallyEdited(false);
    toast.success("Đã tự chấm bài + chia pot theo từng layer");
  };

  const handleConfirmShowdownResult = () => {
    if (selectedWinners.length === 0) {
      toast.error("Chọn người thắng trước");
      return;
    }
    // Guardrail 2 — a whole-pot manual split re-introduces the side-pot imprecision
    // auto-settle fixes; WARN (don't block) when side pots exist.
    if (potBreakdown.sidePots.length > 0) {
      toast.warning("Hand có side pot — chia nguyên pot thủ công có thể sai. Nên bấm 'Tự chấm bài', hoặc kiểm tra từng stack.");
    }
    const map: Record<string, number> = {};
    settleSelectedWinners(engineState.seats, selectedWinners).forEach((r) => {
      map[r.player_id] = r.ending_stack;
    });
    setShowdownLayers([]);
    setEndingStacks(map);
    setEndingStacksManuallyEdited(true);
  };
  const handleEndingStackChange = (playerId: string, value: number) => {
    setEndingStacksManuallyEdited(true);
    setEndingStacks((prev) => ({ ...prev, [playerId]: value }));
  };

  const handleSubmitHand = async () => {
    if (!tableId || !handNumber) return;
    // Workflow v2 HARD-GATE: only submit from submit_ready.
    if (workflowState !== "submit_ready") {
      toast.error("Chưa thể gửi hand — cần hoàn tất đúng quy trình trước.");
      return;
    }
    // 🔴 P1-2 HARD-BLOCK (re-verify at the edge): never persist a phantom or
    // non-conserving result. `submit_ready` already requires reviewValid
    // (conservationOk + a winner), but re-check here so an EMPTY result (auto-settle
    // returned null and the operator never entered manually) or any Σ-mismatch can
    // NEVER reach record_hand.
    if (Object.keys(endingStacks).length === 0) {
      toast.error("Chưa có kết quả ván — bấm 'Tự chấm bài' hoặc chọn người thắng trước khi lưu.");
      return;
    }
    if (!conservationOk) {
      toast.error("Tổng chip vào ≠ ra — không thể lưu. Kiểm tra lại stack kết thúc / người thắng.");
      return;
    }
    if (endingStacksManuallyEdited && !confirm("Bạn đã chỉnh sửa stack kết thúc thủ công. Xác nhận lưu các số đã chỉnh?")) return;
    if (!handSubmitGuardRef.current.begin()) return;
    setSubmitting(true);
    markSync("sending", `Gửi Hand #${Number(handNumber)}`);
    const submittedHandId = handId;
    const applyRecordedHand = async (recordedHandId: string, recoveredAfterError = false) => {
      markSync("sending", `Đang xác minh hiển thị Hand #${Number(handNumber)}`);
      const displayOutcome = await ensureRecordedHandDisplayOutcome({
        tournamentId,
        handId: recordedHandId,
      });
      toast.success(recoveredAfterError
        ? "Máy chủ đã xác nhận hand được lưu dù kết nối báo lỗi"
        : "Hand recorded successfully");
      if (!displayOutcome.ok) {
        toast.warning("Hand đã lưu; outcome hiển thị chưa được server xác minh. Có thể kiểm tra lại trong Lịch sử & sửa hand.");
      }
      playTrackerSoundOnce(playedSoundsRef.current, recordedHandId, "hand_end", "pot_collect");
      markSync("sent", `Hand #${Number(handNumber)} đã lưu`);
      setLastHandId(recordedHandId);
      if (FEATURES.floorDeferredTrackerMoveV1
        && availableTables.find((table) => table.id === tableId)?.tableSessionId) {
        setHandId(null);
        setHandStarted(false);
        resetHand({ loadNextHandNumber: false });
        await handleTableChange(tableId);
        setLastHandId(recordedHandId);
        return;
      }
      const { data: refreshedSeats } = await supabase
        .from("tournament_seats")
        .select("seat_number, player_id, is_active")
        .eq("tournament_id", tournamentId)
        .eq("table_id", tableId)
        .eq("is_active", true)
        .order("seat_number");
      const activeNums = (refreshedSeats ?? [])
        .filter((s) => s.player_id && s.is_active !== false)
        .map((s) => s.seat_number)
        .sort((a, b) => a - b);
      const currentLineage = await readBlindLineage(recordedHandId);
      const nextSuggestion = nextButtonFromBlindLineage({
        maxSeats, occupiedSeats: activeNums,
        previousDealtSeats: currentLineage?.previousDealtSeats ?? [],
        previousButtonSeat: currentLineage?.previousButtonSeat ?? null,
        previousSbPosition: currentLineage?.previousSbPosition ?? null,
        previousBbSeat: currentLineage?.previousBbSeat ?? null,
      });
      if (nextSuggestion) setButtonSeat(nextSuggestion.buttonSeat);
      setButtonConfirmed(Boolean(nextSuggestion));
      setLastBlindLineage(currentLineage);
      setButtonOverridden(false);
      if (refreshedSeats) {
        setPlayers((prev) => survivorsAfterHand(prev, activeNums, endingStacks));
      }
      setHandId(null);
      setHandStarted(false);
      resetHand();
    };
    try {
      const edgePlayers: EdgePlayer[] = players.map((p) => ({
        player_id: p.player_id,
        entry_number: p.entry_number,
        seat_number: p.seat_number,
        starting_stack: p.starting_stack,
        current_stack: p.current_stack,
      }));
      // BUGFIX: derive the submitted side_pots from the SAME action stream the server
      // recomputes from (reconcileSidePots runs contributionsFromActions over the
      // payload's actions). The old source — players[].total_bet — could drift from the
      // actions (stale carryover) and trip "side_pots không khớp" in enforce mode.
      // `actions` is the CURRENT hand only (reset per hand); the on-felt potBreakdown
      // display memo is unchanged.
      const submitBreakdown = computePotBreakdown(
        contributionsFromActions(
          actions.map((a) => ({ player_id: a.player_id, action_type: a.action_type, action_amount: a.amount }))
        )
      );
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildRecordHandBody({
          tournamentId,
          tableId,
          handNumber,
          handTime: new Date().toISOString(),
          communityCards: communityCards.filter((c): c is Card => c !== null),
          potSize,
          players: edgePlayers,
          endingStacks,
          playerHoleCards,
          sidePots: toSidePotsJson(submitBreakdown),
          actions: actions.map((a) => ({
            player_id: a.player_id,
            action_type: a.action_type,
            amount: a.amount,
            action_order: a.action_order,
            street: a.street,
          })),
        }),
      });
      if (error || data?.error) throw new Error(await readEdgeError(error, data));
      const recordedHandId = data?.data?.hand_id ?? submittedHandId;
      if (!recordedHandId) throw new Error("Máy chủ không trả về mã hand đã lưu");
      await applyRecordedHand(recordedHandId);
    } catch (e: any) {
      const { data: completedHand } = submittedHandId
        ? await supabase
          .from("tournament_hands")
          .select("id, status, pot_size")
          .eq("id", submittedHandId)
          .eq("tournament_id", tournamentId)
          .eq("table_id", tournamentTableId ?? tableId)
          .eq("hand_number", Number(handNumber))
          .maybeSingle()
        : { data: null };
      if (isConfirmedCompletedHandReadback(completedHand, potSize)) {
        await applyRecordedHand(completedHand.id, true);
      } else {
        toast.error(e.message || "Failed to record hand");
        markSync("error");
      }
    } finally {
      handSubmitGuardRef.current.finish();
      setSubmitting(false);
    }
  };

  const handleVoid = async () => {
    const voidId = handId || lastHandId;
    if (!voidId) {
      toast.error("No hand to void");
      return;
    }
    if (streetRollbackRef.current) {
      toast.error("Đang hoàn tác vòng — chờ xong đã");
      return;
    }
    if (!confirm("CONFIRM VOID: Toàn bộ chip sẽ hoàn về trạng thái trước hand?")) return;
    if (!voidFlightRef.current.begin()) return;
    voidOwnsSubmittingRef.current = true;
    const generation = rosterGenerationRef.current;
    const scope = actionScopeRef.current;
    const loadToken = tableLoadGuardRef.current.capture(tableId);
    const current = () => rosterMountedRef.current && generation === rosterGenerationRef.current
      && scope === actionScopeRef.current && tableLoadGuardRef.current.isCurrent(loadToken);
    setSubmitting(true);
    try {
      const outcome = await voidHandOnServer(voidId);
      if (outcome === "stale") return;
      setSubmitting(false);
      voidOwnsSubmittingRef.current = false;
      toast.success("Hand VOIDED successfully");
      setLastHandId(null);
      setHandId(null);
      setHandStarted(false);
      // Void is the ONLY path that restores stacks: the server put every chip back to
      // the pre-hand state, so the felt mirrors it (see resetHand's restoreStacks note).
      resetHand({ restoreStacks: outcome === "confirmed" });
      if (outcome === "recovered") await handleTableChange(tableId);
    } catch (e: unknown) {
      if (current()) toast.error(e instanceof Error ? e.message : "Không xác minh được kết quả void hand");
    } finally {
      voidFlightRef.current.finish();
      if (current() && voidOwnsSubmittingRef.current) setSubmitting(false);
      voidOwnsSubmittingRef.current = false;
    }
  };

  // A5: always call the LATEST handleVoid, never one captured by an effect/toast
  // closure from an earlier render (same stale-closure class as the A1 blind fix).
  const handleVoidRef = useRef(handleVoid);
  handleVoidRef.current = handleVoid;

  // A3: tournament-wide leaderboard snapshot, fetched once Review is reached — purely
  // to compute `rankShifts` below. Best-effort: a failed/slow fetch just means the
  // strip stays empty; it never blocks or affects conservationOk/canSubmit.
  useEffect(() => {
    if (!FEATURES.trackerChipQuickEdit || !isSummary || !tournamentId) {
      setLeaderboardBefore(null);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("get_tournament_leaderboard", { p_tournament_id: tournamentId })
      .then(({ data }) => {
        if (cancelled) return;
        const lb = (data as any)?.players;
        if (Array.isArray(lb)) {
          setLeaderboardBefore(lb.map((p: any) => ({ player_id: p.player_id, chip_count: p.chip_count })));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isSummary, tournamentId]);

  // A3: seats whose projected RANK (not just stack) changes once this hand's
  // endingStacks are applied — the "sau ván này" strip. Pure math lives in
  // rankShift.ts (unit-tested there); ranks come from the same leaderboard ordering
  // LeaderboardPanel uses (chip_count desc).
  const rankShifts = useMemo(() => {
    if (!leaderboardBefore || !isSummary) return [];
    return computeRankShifts(leaderboardBefore, players, endingStacks);
  }, [leaderboardBefore, players, endingStacks, isSummary]);

  // ----- Engine auto-advance (local state only; viewer driven by persisted path) --
  useEffect(() => {
    if (!handStarted || isSummary || isReadOnly) return;
    // C2 defensive gate: never auto-advance (or auto-settle a fold-win) while the
    // rollback chain is mid-flight — transients between pops must not re-advance.
    if (streetRollback) return;
    if (currentStreet === "showdown") return;
    const winner = foldWinner(engineState.seats);
    if (winner && actions.length > 0) {
      const map: Record<string, number> = {};
      settleFoldWin(engineState.seats).forEach((r) => {
        map[r.player_id] = r.ending_stack;
      });
      setEndingStacks(map);
      setEndingStacksManuallyEdited(false);
      return;
    }
    const boardReady = currentStreet === "preflop" ? blindsConfirmed : sentCommunityStreets.has(currentStreet);
    const streetActed = actions.some(
      (a) => a.street === currentStreet && !["post_sb", "post_bb", "post_ante"].includes(a.action_type)
    );
    if (boardReady && isRoundComplete(engineState) && (streetActed || isRunout(engineState.seats))) {
      nextStreet();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handStarted, isSummary, isReadOnly, currentStreet, players, actions, engineState, blindsConfirmed, sentCommunityStreets, streetRollback]);

  return {
    // identity / status
    tournamentId,
    tableId,
    tournamentTableId,
    tableName,
    handNumber,
    handId,
    setHandNumber,
    availableTables,
    tableLoadState,
    tableLoadError,
    retryTableLoad,
    tableSelectionNotice,
    players,
    activePlayers,
    showdownOrderIds,
    submitting,
    isReadOnly,
    handStarted,
    orphanHand,
    lastHandId,
    // street / board / pot
    currentStreet,
    streetLabel: STREET_LABELS[currentStreet],
    actions,
    communityCards,
    setCommunityCards,
    usedCards,
    potSize,
    potBreakdown,
    bigBlind,
    positionsBySeat,
    // actor
    buttonSeat,
    buttonConfirmed,
    maxSeats,
    deadButtonSuggestion,
    engineActor,
    toActId,
    effectiveActorId,
    selectedActorId,
    actorPlayer,
    actorViewData,
    actorPos,
    betAmount,
    setBetAmount,
    needsPostSB,
    needsPostBB,
    // workflow
    workflowState,
    allInRunout,
    showBlindSetup,
    showBoardEntry,
    boardEntryStreetNow,
    showShowdownInput,
    showRunoutReveal,
    showActionStep,
    // sync
    syncPhase,
    syncLabel,
    actionSyncBlocked,
    reloadAfterActionUncertainty,
    // blind setup
    blindSbSeat,
    blindBbSeat,
    firstActorSeat,
    isHeadsUp,
    blindLevelSnapshot,
    blindLevelCanonical,
    blindLevelMissing,
    blindLevelChanged,
    sbAmount,
    setSbAmount,
    bbAmount,
    setBbAmount,
    liveLevelNumber,
    liveLevel,
    blindFetchedAt,
    refreshLiveLevel,
    handlePostBothBlinds,
    sbPosted,
    bbPosted,
    blindsConfirmed,
    deadSb: effectiveDeadSb,
    // showdown / review
    selectedWinners,
    muckedPlayerIds,
    showdownLayers,
    playerHoleCards,
    setPlayerHoleCards,
    isSummary,
    isReview,
    endingStacks,
    setEndingStacks,
    conservationOk,
    winnerDetermined,
    reviewValid,
    rankShifts,
    // undo
    canUndo: undoStack.length > 0,
    // helpers
    playerName,
    // handlers
    handlePickTable,
    handleTakeoverLock,
    backToTableMap,
    handleTableChange,
    handleStartHand,
    handleContinueOrphan,
    handleVoidOrphan,
    handleDockAction,
    handleVoiceAction,
    handlePostBlind,
    handleConfirmBlinds,
    handleToggleDeadSb,
    handleResetButton,
    handleSeatTap,
    handleSeatNumberTap,
    handleUndo,
    handleUpdateCommunityCards,
    applyVoiceBoardReceipt,
    applyVoiceHoleCardsReceipt,
    applyVoiceFinishReceipt,
    handleRunoutDealAll,
    // C2 (trackerStreetRollback)
    streetRollbackUi,
    handleStreetRollback,
    persistedBoardCount,
    handleShowHoleCards,
    handleRevealRunout,
    handleSkipRevealRunout,
    handleToggleWinner,
    handleToggleMuck,
    handleAutoSettle,
    handleHoleCardChange,
    handleConfirmShowdownResult,
    handleEndingStackChange,
    handleSubmitHand,
    handleVoid,
    handleChipQuickEdit,
    handleSetRosterSeat,
    handleSetSeatDisplay,
    avatarSupported,
    midHandEditSupported,
    resetHand,
  };
}

export type StandaloneHandInput = ReturnType<typeof useStandaloneHandInput>;
