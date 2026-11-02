// Completed-hand picker for replay mode. Reuses the same read-only query shape
// the live viewer / HandHistoryPanel already use (no new RPC, no backend
// change). On select it loads the full hand (actions + players + profiles) and
// hands a ReplayHand to the parent.

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, History } from "lucide-react";
import type { ReplayHand } from "@/lib/tracker-poker/replayEngine";
import { fetchHandPlayerDisplay, handPlayersHasSnapshot } from "@/lib/tracker-poker/handPlayerNames";
import { parseReplayPublicSettlement } from "@/lib/tracker-poker/replaySettlement";
import { replayTargetForHand, type ReplayTarget, type ReplayTargetState } from "./viewer-hub/replayTarget";
import { parsePublicTableHistoryPage } from "./viewer-hub/publicTableHistory";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

interface HandRow {
  id: string;
  table_id: string | null;
  hand_number: number;
  created_at: string;
  community_cards: string[] | null;
  button_seat: number | null;
  pot_size: number | null;
  tracker_big_blind?: number;
  tracker_small_blind?: number | null;
  tracker_bba?: number | null;
  tracker_level_number?: number | null;
  publicHistoryResult?: ReplayHand["publicHistoryResult"];
}

type PublicReplayPlayer = { playerId: string; seatNumber: number; name?: string | null; startingStack?: number | null; endingStack?: number | null; avatarUrl?: string | null; holeCards?: string[] };
type PublicReplayAction = { id: string; playerId: string; street?: string | null; actionType: string; amount?: number | null; order: number };
type PublicReplayPayload = { id?: string; handNumber?: number; buttonSeat?: number | null; board?: string[]; pot?: number | null; bigBlind?: number | null; smallBlind?: number | null; ante?: number | null; levelNumber?: number | null; players?: PublicReplayPlayer[]; actions?: PublicReplayAction[] };

interface HandSelectorProps {
  tournamentId: string;
  /** When set, only hands on this table are offered (never mix tables). */
  tableId: string | null;
  selectedHandId: string | null;
  /** Clear the previous replay frame before an async hand load begins. */
  onLoadStart?: (handId: string) => void;
  onSelectHand: (handId: string, hand: ReplayHand) => void;
  /** URL target. When supplied, this selector never substitutes another hand. */
  replayTarget?: ReplayTarget | null;
  /** Parent resolution protects table selection; selector renders its exact state. */
  replayTargetState?: ReplayTargetState;
  /** Replace a deep-linked target before loading a different hand. */
  onSelectReplayTarget?: (target: ReplayTarget) => void;
  onRetryReplayTarget?: () => void;
  /** Public viewer reads history/replay only through scoped RPCs. */
  spectator?: boolean;
}

const IDLE_REPLAY_TARGET_STATE: ReplayTargetState = { kind: "idle" };

export function HandSelector({
  tournamentId,
  tableId,
  selectedHandId,
  onLoadStart,
  onSelectHand,
  replayTarget = null,
  replayTargetState = IDLE_REPLAY_TARGET_STATE,
  onSelectReplayTarget,
  onRetryReplayTarget,
  spectator = false,
}: HandSelectorProps) {
  const [hands, setHands] = useState<HandRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingHand, setLoadingHand] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const listScope = JSON.stringify([tournamentId, tableId, spectator]);
  const handsScopeRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const loadScope = JSON.stringify([tournamentId, tableId, spectator, replayTarget?.handId ?? null, replayTarget?.tableId ?? null, replayTarget?.handNumber ?? null]);
  const loadScopeRef = useRef(loadScope);
  loadScopeRef.current = loadScope;
  const lastRequestedHandRef = useRef<{ row: HandRow; scope: string } | null>(null);
  const resolvingReplayTable = !tableId && !!replayTarget && replayTargetState.kind === "loading";

  useEffect(() => {
    let cancelled = false;
    handsScopeRef.current = null;
    setLoadingList(true);
    setListError(null);
    (async () => {
      if (spectator) {
        if (!tableId) {
          setHands([]);
          if (resolvingReplayTable) return;
          setListError("Chọn bàn để xem lịch sử hand.");
          setLoadingList(false);
          return;
        }
        const { data, error } = await observeTrackerContextRead(supabase.rpc("get_public_tournament_table_history_v2" as never, {
          p_tournament_id: tournamentId,
          p_tournament_table_id: tableId,
          p_limit: 50,
          p_before_created_at: null,
          p_before_id: null,
        } as never));
        if (cancelled) return;
        const page = error ? null : parsePublicTableHistoryPage(data, tournamentId, tableId);
        if (!page || page.access === "revoked") {
          setHands([]);
          setListError(error?.message || "Không thể tải lịch sử hand công khai.");
          setLoadingList(false);
          return;
        }
        handsScopeRef.current = listScope;
        setHands(page.items.map((hand) => ({
          id: hand.handId, table_id: tableId, hand_number: hand.handNumber ?? 0,
          created_at: hand.createdAt, community_cards: hand.board, button_seat: null,
          pot_size: hand.pot, tracker_big_blind: hand.bigBlind ?? undefined,
          tracker_small_blind: hand.smallBlind, tracker_bba: hand.ante,
          tracker_level_number: hand.levelNumber ?? undefined,
          publicHistoryResult: hand.result.status === "verified" ? hand.result : null,
        })));
        setLoadingList(false);
        return;
      }
      let q = supabase
        .from("tournament_hands")
        .select("id, hand_number, created_at, community_cards, button_seat, pot_size, tracker_big_blind, tracker_small_blind, tracker_bba, tracker_level_number, status, is_voided, table_id")
        .eq("tournament_id", tournamentId)
        .eq("is_voided", false)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(50);
      if (tableId) q = q.eq("table_id", tableId);
      const { data, error } = await observeTrackerContextRead(q);
      if (cancelled) return;
      if (error) {
        setHands([]);
        setListError(error.message || "Không thể tải lịch sử ván.");
        setLoadingList(false);
        return;
      }
      const rows = (data ?? [])
        .filter((h: any) => h.status !== "in_progress")
        .map((h: any) => ({
          id: h.id,
          table_id: h.table_id,
          hand_number: h.hand_number,
          created_at: h.created_at,
          community_cards: h.community_cards,
          button_seat: h.button_seat,
          pot_size: h.pot_size,
          tracker_big_blind: h.tracker_big_blind, tracker_small_blind: h.tracker_small_blind, tracker_bba: h.tracker_bba, tracker_level_number: h.tracker_level_number,
        }));
      handsScopeRef.current = listScope;
      setHands(rows);
      setLoadingList(false);
    })().catch(() => {
      if (cancelled) return;
      setHands([]);
      setListError("Không thể tải lịch sử hand. Hãy thử lại.");
      setLoadingList(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tournamentId, tableId, spectator, resolvingReplayTable, listAttempt, listScope]);

  const loadHand = useCallback(
    async (row: HandRow) => {
      lastRequestedHandRef.current = { row, scope: loadScope };
      const generation = ++loadGenerationRef.current;
      const isCurrentLoad = () => loadGenerationRef.current === generation && loadScopeRef.current === loadScope;
      onLoadStart?.(row.id);
      setLoadingHand(true);
      setLoadError(null);
      try {
        if (spectator) {
          if (!tableId) throw new Error("Chưa chọn bàn cho replay.");
          const [{ data: publicData, error: publicError }, { data: settlementData, error: settlementError }] = await observeTrackerContextRead(Promise.all([
            supabase.rpc("get_public_tournament_table_hand_v2" as never, {
              p_tournament_id: tournamentId, p_tournament_table_id: tableId, p_hand_id: row.id,
            } as never),
            supabase.rpc("get_public_tournament_settlement" as never, { p_hand_id: row.id } as never),
          ]));
          if (!isCurrentLoad()) return;
          const safe = (publicData ?? {}) as PublicReplayPayload;
          if (publicError || !safe.id) throw new Error(publicError?.message || "Hand không thuộc bàn hoặc không còn được công khai.");
          onSelectHand(row.id, {
            hand_id: safe.id,
            hand_number: safe.handNumber ?? row.hand_number,
            button_seat: safe.buttonSeat ?? row.button_seat ?? 1,
            community_cards: Array.isArray(safe.board) ? safe.board : [],
            stored_pot_size: safe.pot ?? row.pot_size,
            big_blind: safe.bigBlind ?? row.tracker_big_blind,
            small_blind: safe.smallBlind ?? row.tracker_small_blind,
            ante: safe.ante ?? row.tracker_bba,
            level_number: safe.levelNumber ?? row.tracker_level_number,
            players: Array.isArray(safe.players) ? safe.players.map((player) => ({
              player_id: player.playerId, seat_number: player.seatNumber,
              display_name: player.name || player.playerId?.slice(0, 6) || "Người chơi",
              starting_stack: player.startingStack ?? 0, ending_stack: player.endingStack ?? null,
              avatar_url: player.avatarUrl ?? null,
              hole_cards: Array.isArray(player.holeCards) && player.holeCards.length ? player.holeCards : undefined,
            })) : [],
            actions: Array.isArray(safe.actions) ? safe.actions.map((action) => ({
              action_id: action.id, player_id: action.playerId, street: action.street || "preflop",
              action_type: action.actionType, action_amount: action.amount ?? 0, action_order: action.order,
            })) : [],
            publicSettlement: settlementError ? null : parseReplayPublicSettlement(settlementData),
            publicHistoryResult: safe.id === row.id ? row.publicHistoryResult : null,
          });
          return;
        }
        // E1: prefer the per-hand snapshot (hand_players.player_name/avatar_url) when the
        // migration is applied; the columns are selected only if present (feature-detect).
        const snap = await observeTrackerContextRead(handPlayersHasSnapshot());
        const hpCols = snap
          ? "player_id, seat_number, starting_stack, ending_stack, hole_cards, player_name, avatar_url"
          : "player_id, seat_number, starting_stack, ending_stack, hole_cards";
        const [
          { data: actionData, error: actionError },
          { data: handPlayers, error: handPlayersError },
          { data: publicSettlementData, error: publicSettlementError },
        ] = await observeTrackerContextRead(Promise.all([
          supabase
            .from("hand_actions")
            .select("id, player_id, street, action_type, action_amount, action_order")
            .eq("hand_id", row.id)
            .order("action_order"),
          supabase.from("hand_players").select(hpCols).eq("hand_id", row.id),
          supabase.rpc("get_public_tournament_settlement" as never, { p_hand_id: row.id } as never),
        ]));
        if (!isCurrentLoad()) return;
        if (actionError || handPlayersError) {
          setLoadError(actionError?.message || handPlayersError?.message || "Không thể tải dữ liệu replay.");
          return;
        }

        // Fall back to the live tournament_seats roster ONLY for rows the snapshot didn't
        // capture (old hands) — the helper no-ops on an empty id list, so this is free
        // once every hand is snapshotted.
        const needIds = (handPlayers ?? []).filter((p: any) => !p.player_name).map((p: any) => p.player_id);
        const display = await observeTrackerContextRead(fetchHandPlayerDisplay(tournamentId, needIds));
        if (!isCurrentLoad()) return;

        const hand: ReplayHand = {
          hand_id: row.id,
          hand_number: row.hand_number,
          button_seat: row.button_seat || 1,
          community_cards: (row.community_cards as string[]) || [],
          stored_pot_size: row.pot_size,
          big_blind: row.tracker_big_blind, small_blind: row.tracker_small_blind, ante: row.tracker_bba, level_number: row.tracker_level_number,
          players: (handPlayers ?? []).map((p: any) => ({
            player_id: p.player_id,
            seat_number: p.seat_number,
            display_name: p.player_name || display.get(p.player_id)?.name || p.player_id.slice(0, 6),
            starting_stack: p.starting_stack ?? 0,
            ending_stack: p.ending_stack ?? null,
            avatar_url: p.avatar_url ?? display.get(p.player_id)?.avatar ?? null,
            hole_cards:
              p.hole_cards && (p.hole_cards as string[]).length > 0
                ? (p.hole_cards as string[])
                : undefined,
          })),
          actions: (actionData ?? []).map((a: any) => ({
            action_id: a.id,
            player_id: a.player_id,
            street: a.street || "preflop",
            action_type: a.action_type,
            action_amount: a.action_amount ?? 0,
            action_order: a.action_order,
          })),
          // Missing RPC, empty payload and malformed/private payload all degrade
          // to a normal replay with no winner treatment.
          publicSettlement: publicSettlementError
            ? null
            : parseReplayPublicSettlement(publicSettlementData),
        };
        onSelectHand(row.id, hand);
      } catch (cause) {
        if (!isCurrentLoad()) return;
        setLoadError(cause instanceof Error && cause.message !== "tracker_context_read_timeout" ? cause.message : "Không thể tải dữ liệu replay. Hãy thử lại.");
      } finally {
        if (isCurrentLoad()) setLoadingHand(false);
      }
    },
    [onLoadStart, onSelectHand, spectator, tableId, tournamentId, loadScope]
  );
  const loadHandRef = useRef(loadHand);
  loadHandRef.current = loadHand;

  useEffect(() => {
    if (!spectator || !tableId || !selectedHandId) return;
    let cancelled = false;
    let inFlight = false;
    const refreshSelectedHand = async () => {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      const loaded = lastRequestedHandRef.current;
      if (!loaded || loaded.row.id !== selectedHandId || loaded.scope !== loadScope) return;
      inFlight = true;
      try {
        const { data, error } = await observeTrackerContextRead(supabase.rpc("get_public_tournament_table_history_v2" as never, {
          p_tournament_id: tournamentId,
          p_tournament_table_id: tableId,
          p_limit: 50,
          p_before_created_at: null,
          p_before_id: null,
        } as never));
        if (cancelled) return;
        const page = error ? null : parsePublicTableHistoryPage(data, tournamentId, tableId);
        const latest = page?.access === "public" ? page.items.find((item) => item.handId === selectedHandId) : null;
        const nextResult = latest?.result.status === "verified" ? latest.result : null;
        const current = lastRequestedHandRef.current;
        if (!current || current.row.id !== selectedHandId || current.scope !== loadScope
          || JSON.stringify(current.row.publicHistoryResult ?? null) === JSON.stringify(nextResult)) return;
        const refreshedRow: HandRow = { ...current.row, publicHistoryResult: nextResult };
        setHands((previous) => previous.map((row) => row.id === selectedHandId ? refreshedRow : row));
        // The correction may also change board/actions. Clear the old Replay
        // immediately and load the complete exact hand again, including proof.
        void loadHandRef.current(refreshedRow);
      } catch {
        if (cancelled) return;
        const current = lastRequestedHandRef.current;
        if (!current || current.row.id !== selectedHandId || current.scope !== loadScope || !current.row.publicHistoryResult) return;
        const refreshedRow: HandRow = { ...current.row, publicHistoryResult: null };
        setHands((previous) => previous.map((row) => row.id === selectedHandId ? refreshedRow : row));
        void loadHandRef.current(refreshedRow);
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void refreshSelectedHand(); }, 15_000);
    const onFocus = () => { void refreshSelectedHand(); };
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [loadScope, selectedHandId, spectator, tableId, tournamentId]);

  useEffect(() => () => {
    loadGenerationRef.current += 1;
  }, []);

  // A target is never allowed to fall back to `hands[0]`. When it is outside the
  // first page, load the exact UUID in the same tournament scope instead.
  useEffect(() => {
    let cancelled = false;
    if (replayTarget) {
      if (replayTargetState.kind !== "resolved" || selectedHandId === replayTargetState.handId) return;
      // Resolve the current history page before falling back to a direct hand
      // lookup. Otherwise a fast deep-link resolver can discard the verified
      // result already present on the exact history row.
      if (loadingList || handsScopeRef.current !== listScope) return;
      const listed = hands.find((hand) => hand.id === replayTargetState.handId);
      if (listed) {
        void loadHand(listed);
        return;
      }

      setLoadError(null);
      void (async () => {
        if (spectator && tableId) {
          const { data, error } = await observeTrackerContextRead(supabase.rpc("get_public_tournament_table_hand_v2" as never, {
            p_tournament_id: tournamentId, p_tournament_table_id: tableId, p_hand_id: replayTargetState.handId,
          } as never));
          if (cancelled) return;
          const hand = data as PublicReplayPayload;
          if (error || !hand?.id) {
            setLoadError(error?.message || "Không tìm thấy hand được yêu cầu.");
            return;
          }
          void loadHand({ id: hand.id, table_id: tableId, hand_number: hand.handNumber ?? 0, created_at: "", community_cards: hand.board ?? [], button_seat: hand.buttonSeat ?? null, pot_size: hand.pot ?? null });
          return;
        }
        const { data, error } = await observeTrackerContextRead(supabase
          .from("tournament_hands")
          .select("id, table_id, hand_number, created_at, community_cards, button_seat, pot_size, tracker_big_blind, tracker_small_blind, tracker_bba, tracker_level_number, status, is_voided")
          .eq("tournament_id", tournamentId)
          .eq("id", replayTargetState.handId)
          .eq("is_voided", false)
          .maybeSingle());
        if (cancelled) return;
        if (error || !data || data.status === "in_progress") {
          setLoadError(error?.message || "Không tìm thấy hand được yêu cầu.");
          return;
        }
        void loadHand(data as HandRow);
      })().catch(() => {
        if (!cancelled) setLoadError("Không thể tải dữ liệu replay. Hãy thử lại.");
      });
      return () => { cancelled = true; };
    }

    if (handsScopeRef.current === listScope && hands.length > 0 && !selectedHandId) void loadHand(hands[0]);
    return () => { cancelled = true; };
  }, [hands, loadingList, listScope, loadHand, replayTarget, replayTargetState, selectedHandId, spectator, tableId, tournamentId, listAttempt]);

  const targetMessage: Record<Exclude<ReplayTargetState["kind"], "idle" | "resolved">, string> = {
    loading: "Đang tìm hand từ đường dẫn...",
    not_found: "Không tìm thấy hand trong giải này.",
    ambiguous: "Số hand cũ trùng ở nhiều bàn. Hãy mở link có handId.",
    mismatch: "Hand và table trong đường dẫn không khớp.",
    query_error: "Không thể truy vấn hand. Hãy thử lại.",
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <History className="w-3.5 h-3.5" /> Hand:
      </span>
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-xs min-w-[140px]"
        value={selectedHandId ?? ""}
        disabled={loadingList || handsScopeRef.current !== listScope || !!listError || hands.length === 0}
        onChange={(e) => {
          if (handsScopeRef.current !== listScope) return;
          const row = hands.find((h) => h.id === e.target.value);
          if (!row) return;
          if (replayTarget && onSelectReplayTarget) {
            onSelectReplayTarget(replayTargetForHand(row));
            return;
          }
          void loadHand(row);
        }}
      >
        {loadingList && <option value="">Đang tải...</option>}
        {!loadingList && listError && <option value="">Không tải được lịch sử hand</option>}
        {!loadingList && !listError && hands.length === 0 && <option value="">Chưa có hand đã xong</option>}
        {hands.map((h) => (
          <option key={h.id} value={h.id}>
            Hand #{h.hand_number}
          </option>
        ))}
      </select>
      {loadingHand && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />}
      {replayTargetState.kind !== "idle" && replayTargetState.kind !== "resolved" && (
        <p role="status" className="w-full text-xs text-warning">{targetMessage[replayTargetState.kind]}</p>
      )}
      {replayTargetState.kind==="query_error"&&onRetryReplayTarget&&<button type="button" onClick={onRetryReplayTarget} className="min-h-11 rounded-md border border-input px-3 text-xs">Thử tìm lại hand</button>}
      {listError && <p role="alert" className="w-full text-xs text-destructive">{listError}</p>}
      {listError && tableId && <button type="button" disabled={loadingList} onClick={() => setListAttempt((attempt) => attempt + 1)} className="min-h-11 rounded-md border border-input px-3 text-xs disabled:opacity-50">Thử tải lại lịch sử</button>}
      {loadError && <p role="alert" className="w-full text-xs text-destructive">{loadError}</p>}
      {loadError && tableId && <button type="button" disabled={loadingHand} onClick={() => {
        const requested = lastRequestedHandRef.current;
        if (requested?.scope === loadScope) void loadHand(requested.row);
        else setListAttempt((attempt) => attempt + 1);
      }} className="min-h-11 rounded-md border border-input px-3 text-xs disabled:opacity-50">Thử tải lại hand</button>}
    </div>
  );
}
