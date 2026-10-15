import { useState, useEffect, useCallback, useRef } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, History, RefreshCw, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { isRedCard, displayCard } from "@/components/shared/CardSlotPicker";
import { toast } from "sonner";
import { FEATURES, isTrackerAtomicResettleAvailable } from "@/lib/featureFlags";
import { HandEditPanel } from "./HandEditPanel";
import { FloorHandActionReview } from "./FloorHandActionReview";
import { HistoricalSettlementDisplayControl } from "./HistoricalSettlementDisplayControl";
import { HistoricalSettlementBatchControl } from "./HistoricalSettlementBatchControl";
import type { HistoricalSettlementBatchCandidate } from "@/lib/tracker-poker/historicalSettlementBatch";
import { buildEditCompletedHandArgs, type HandEditPatch } from "./handEditDiff";
import {
  fetchHandPlayerDisplayForClient,
  handPlayersHasSnapshotForClient,
} from "@/lib/tracker-poker/handPlayerNamesClient";
import { createHandHistoryLoadGuard } from "./handHistoryLoadGuard";
import {
  runClientResettle,
  buildServerSettlementEdit,
  buildApplyResettleArgs,
  resettleHandEndStacks,
  checkExpectedHandEndStacks,
  resettleChipChanges,
  type ExpectedHandEndStack,
  type ResettleHandRow,
} from "./resettleApply";
import type { EditedTargetHand, ResettleBlock, ResettleForwardResult, ResettleOk } from "@/lib/tracker-poker/resettleForward";

const LEGACY_CORRECTION_WRITES_ENABLED = false;
const SERVER_CORRECTION_PREVIEW_ENABLED = true;

/** Read ALL rows of a query in pages (PostgREST caps a single select, commonly at 1000).
 *  A money-path replay must NEVER run on a silently-truncated chain, so callers page with a
 *  UNIQUE total order (else a non-unique order can skip/dupe rows at page boundaries). */
type PagedError = { message: string };
type PagedQuery<T> = PromiseLike<{ data: T[] | null; error: PagedError | null }>;

function asPagedQuery<T>(query: unknown): PagedQuery<T> {
  return query as PagedQuery<T>;
}

async function pageAll<T>(
  makeQuery: (from: number, to: number) => PagedQuery<T>,
): Promise<{ data: T[]; error: PagedError | null }> {
  const PAGE = 1000;
  let from = 0;
  const acc: T[] = [];
  for (;;) {
    const { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) return { data: [], error };
    const rows = data || [];
    acc.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return { data: acc, error: null };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

interface HandRecord {
  id: string;
  table_id: string | null;
  hand_number: number;
  hand_time: string;
  community_cards: string[];
  pot_size: number | null;
  status: string;
  is_voided: boolean;
  created_at: string;
  button_seat?: number;
  players: {
    player_id: string;
    display_name: string;
    seat_number: number;
    starting_stack: number;
    ending_stack: number;
    is_eliminated: boolean;
    hole_cards: string[];
    entry_number: number;
  }[];
  actions: {
    street: string;
    display_name: string;
    seat_number: number;
    action_type: string;
    action_amount: number;
    action_order: number;
    id: string;
    player_id: string;
    entry_number: number;
  }[];
}

type HandQueryRow = {
  id: string;
  hand_number: number;
  hand_time: string | null;
  community_cards: unknown;
  pot_size: number | null;
  status: string | null;
  is_voided: boolean | null;
  created_at: string;
  table_id: string | null;
  button_seat: number | null;
};

type HandPlayerQueryRow = {
  id: string;
  hand_id: string;
  player_id: string;
  entry_number: number | null;
  seat_number: number;
  starting_stack: number;
  ending_stack: number | null;
  is_eliminated: boolean | null;
  hole_cards: unknown;
  player_name?: string | null;
};

type HandActionQueryRow = {
  id: string;
  hand_id: string;
  player_id: string;
  entry_number: number | null;
  street: string | null;
  action_type: string;
  action_amount: number | null;
  action_order: number;
};

type HistoryCompletionStatus = "missing_blind" | "missing_outcome" | "stale" | "pending" | "needs_attention";

export type HandHistorySelection = {
  tableId: string | null;
  handId: string | null;
};

export type HandHistoryPanelProps = {
  tournamentId: string;
  initialTableId?: string | null;
  initialHandId?: string | null;
  initialActionId?: string | null;
  onSelectionChange?: (selection: HandHistorySelection) => void;
  workspaceMode?: boolean;
  enableHistoricalBatchControls?: boolean;
};

type TrackerTableOption = {
  id: string;
  physicalId: string | null;
  name: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const STREET_ORDER = ["preflop", "flop", "turn", "river", "showdown"];
const STREET_LABELS: Record<string, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

function formatStack(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

function formatActionLabel(a: HandRecord["actions"][0]): string {
  const t = a.action_type;
  if (t === "fold") return "Fold";
  if (t === "check") return "Check";
  if (t === "call") return `Call ${formatStack(a.action_amount)}`;
  if (t === "bet") return `Bet ${formatStack(a.action_amount)}`;
  if (t === "raise") return `Raise ${formatStack(a.action_amount)}`;
  if (t === "all_in") return `All-In ${formatStack(a.action_amount)}`;
  if (t === "post_sb") return `SB ${formatStack(a.action_amount)}`;
  if (t === "post_bb") return `BB ${formatStack(a.action_amount)}`;
  if (t === "post_ante") return `Ante ${formatStack(a.action_amount)}`;
  return `${t} ${formatStack(a.action_amount)}`;
}

export function HandHistoryWorkspace({
  tournamentId,
  initialTableId = null,
  initialHandId = null,
  initialActionId = null,
  onSelectionChange,
  workspaceMode = false,
  enableHistoricalBatchControls = false,
}: HandHistoryPanelProps) {
  const supabase = useSupabaseClient();
  const [hands, setHands] = useState<HandRecord[]>([]);
  const [completionStatusByHand, setCompletionStatusByHand] = useState<Map<string, HistoryCompletionStatus>>(new Map());
  const [completionFilter, setCompletionFilter] = useState<"all" | HistoryCompletionStatus>("all");
  const [completionStatusError, setCompletionStatusError] = useState(false);
  const [selectedHandId, setSelectedHandId] = useState<string | null>(initialHandId);
  const [showHandPicker, setShowHandPicker] = useState(!workspaceMode || !initialHandId);
  const [editActionOrder, setEditActionOrder] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  // F2 — completed-hand editor (flag trackerHandHistoryEdit). editSupported degrades to
  // false on a 42883 (RPC not applied) so the button hides honestly.
  const [editMode, setEditMode] = useState(false);
  const [editSupported, setEditSupported] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string>(initialTableId || "all");
  const [tables, setTables] = useState<TrackerTableOption[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [tablesReload, setTablesReload] = useState(0);
  const loadGuardRef = useRef<ReturnType<typeof createHandHistoryLoadGuard> | null>(null);
  if (!loadGuardRef.current) loadGuardRef.current = createHandHistoryLoadGuard();
  // Đợt G3 — resettle-forward (chips). resettleSupported degrades to false on a 42883
  // (apply RPC not applied) so the flow shows "chưa áp dụng" instead of crashing.
  const [resettleSupported, setResettleSupported] = useState(true);
  const [resettleBusy, setResettleBusy] = useState(false);
  const [resettleView, setResettleView] = useState<{
    result: ResettleForwardResult;
    entryByPlayer: Map<string, number>;
    entryByHandPlayer: Map<string, number>;
    patch: HandEditPatch;
    reason: string;
    targetHandId: string;
    // Kept so a manual-winner re-run can re-invoke the engine without re-fetching.
    targetRow: ResettleHandRow;
    laterRows: ResettleHandRow[];
    editedTarget: EditedTargetHand;
    expectedEndingStacks: ExpectedHandEndStack[];
    serverPreview: {
      sourceRevision: number;
      sourceChainHash: string;
      outcomeHash: string;
      scope: string;
    };
    idempotencyKey: string;
  } | null>(null);

  useEffect(() => {
    setSelectedTableId(initialTableId || "all");
    setSelectedHandId(initialHandId);
    setShowHandPicker(!workspaceMode || !initialHandId);
    setEditMode(false);
    setResettleView(null);
  }, [initialHandId, initialTableId, tournamentId, workspaceMode]);

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    setTables((current) => current.length ? [] : current);
    setTablesLoading(true);
    setTablesError(null);
    void (async () => {
      try {
        const { data: v2Data, error: v2Error } = await supabase.rpc(
          "list_tracker_tables_v2" as never,
          { p_tournament_id: tournamentId } as never,
        );
        if (cancelled) return;
        const v2 = record(v2Data as unknown);
        if (!v2Error && v2?.ok === true && Array.isArray(v2.tables)) {
          const options = v2.tables.flatMap((item): TrackerTableOption[] => {
            const row = record(item);
            const id = textValue(row?.tournament_table_id);
            if (!id) return [];
            return [{
              id,
              physicalId: textValue(row?.physical_table_id),
              name: textValue(row?.table_name) ?? "Bàn chưa đặt tên",
            }];
          });
          setTables(options);
          setSelectedTableId((current) => options.find((table) => table.physicalId === current)?.id ?? current);
          return;
        }

        // Compatibility only: a transport/authority failure is not an absent RPC.
        if (!v2Error || !["PGRST202", "42883"].includes(v2Error.code)) {
          throw new Error(v2Error?.message ?? textValue(v2?.error) ?? "Dữ liệu danh sách bàn không hợp lệ");
        }
        const { data: legacyData, error: legacyError } = await supabase.rpc("get_tournament_tables", { p_tournament_id: tournamentId });
        if (cancelled) return;
        if (legacyError || !Array.isArray(legacyData)) {
          throw new Error(legacyError?.message ?? "Dữ liệu danh sách bàn không hợp lệ");
        }
        const options = legacyData.flatMap((item): TrackerTableOption[] => {
          const row = record(item);
          const physicalId = textValue(row?.table_id);
          if (!physicalId) return [];
          return [{ id: physicalId, physicalId, name: textValue(row?.table_name) ?? "Bàn chưa đặt tên" }];
        });
        setTables(options);
      } catch (error) {
        if (!cancelled) {
          setTablesError(error instanceof Error ? error.message : "Không tải được danh sách bàn");
        }
      } finally {
        if (!cancelled) setTablesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, tablesReload, tournamentId]);

  const loadHands = useCallback(async () => {
    if (!tournamentId) return;
    const request = loadGuardRef.current!.begin();
    const isCurrentLoad = () => loadGuardRef.current!.isCurrent(request);
    setLoading(true);
    setLoadError(null);
    setCompletionStatusByHand(new Map());
    setCompletionStatusError(false);

    try {
      const { data: handRows, error } = await pageAll<HandQueryRow>((from, to) => {
        let query = supabase
          .from("tournament_hands")
          .select("id, hand_number, hand_time, community_cards, pot_size, status, is_voided, created_at, table_id, button_seat")
          .eq("tournament_id", tournamentId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
        if (selectedTableId !== "all") {
          const selectedTable = tables.find((table) => table.id === selectedTableId || table.physicalId === selectedTableId);
          const tableIds = [...new Set([selectedTableId, selectedTable?.id, selectedTable?.physicalId].filter((id): id is string => !!id))];
          query = tableIds.length === 1 ? query.eq("table_id", tableIds[0]) : query.in("table_id", tableIds);
        }
        return asPagedQuery<HandQueryRow>(query);
      });
      if (!isCurrentLoad()) return;
      if (error || !handRows) {
        setLoadError(error?.message ?? "Không tải được dữ liệu");
        setHands([]);
        setLoading(false);
        return;
      }

      const handIds = handRows.map((hand) => hand.id);
      if (handIds.length === 0) {
        setHands([]);
        setLoading(false);
        return;
      }

      // E1: prefer the per-hand snapshot (hand_players.player_name) when the migration is
      // applied; the column is selected only if present (feature-detect). Fall back to the
      // tournament_seats roster only for old rows the snapshot didn't capture.
      const snap = await handPlayersHasSnapshotForClient(supabase);
      if (!isCurrentLoad()) return;
      const baseHpCols = "id, hand_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, hole_cards";
      const playerRows: HandPlayerQueryRow[] = [];
      const actionRows: HandActionQueryRow[] = [];
      for (const handIdBatch of chunkArray(handIds, 80)) {
        const [playersRes, actionsRes] = await Promise.all([
          pageAll<HandPlayerQueryRow>((from, to) => asPagedQuery<HandPlayerQueryRow>(supabase
            .from("hand_players")
            .select(snap ? `${baseHpCols}, player_name` : baseHpCols)
            .in("hand_id", handIdBatch)
            .order("hand_id", { ascending: true })
            .order("player_id", { ascending: true })
            .order("entry_number", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to))),
          pageAll<HandActionQueryRow>((from, to) => asPagedQuery<HandActionQueryRow>(supabase
            .from("hand_actions")
            .select("id, hand_id, player_id, entry_number, street, action_type, action_amount, action_order")
            .in("hand_id", handIdBatch)
            .order("hand_id", { ascending: true })
            .order("action_order", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to))),
        ]);
        if (!isCurrentLoad()) return;
        const historyError = playersRes.error || actionsRes.error;
        if (historyError) {
          setLoadError(historyError.message || "Không tải được chi tiết hand");
          setHands([]);
          setLoading(false);
          return;
        }
        playerRows.push(...playersRes.data);
        actionRows.push(...actionsRes.data);
      }

      const needIds = playerRows.filter((player) => !player.player_name).map((player) => player.player_id);
      const display = await fetchHandPlayerDisplayForClient(supabase, tournamentId, needIds);
      if (!isCurrentLoad()) return;
      const identityMap = new Map<string, { name: string; seat: number }>();
      const playerIdentityKey = (handId: string, playerId: string, entryNumber: number | null | undefined) => `${handId}:${playerId}:${entryNumber ?? 1}`;
      playerRows.forEach((player) => {
        identityMap.set(playerIdentityKey(player.hand_id, player.player_id, player.entry_number), {
          name: player.player_name || display.get(player.player_id)?.name || `Người chơi ghế ${player.seat_number}`,
          seat: player.seat_number,
        });
      });

      const playerMap = new Map<string, HandRecord["players"]>();
      playerRows.forEach((player) => {
        if (!playerMap.has(player.hand_id)) playerMap.set(player.hand_id, []);
        const identity = identityMap.get(playerIdentityKey(player.hand_id, player.player_id, player.entry_number));
        playerMap.get(player.hand_id)!.push({
          player_id: player.player_id,
          display_name: identity?.name || `Người chơi ghế ${player.seat_number}`,
          seat_number: player.seat_number,
          starting_stack: player.starting_stack,
          ending_stack: player.ending_stack ?? 0,
          is_eliminated: !!player.is_eliminated,
          hole_cards: stringArray(player.hole_cards),
          entry_number: player.entry_number ?? 1,
        });
      });

      const actionMap = new Map<string, HandRecord["actions"]>();
      actionRows.forEach((action) => {
        if (!actionMap.has(action.hand_id)) actionMap.set(action.hand_id, []);
        const identity = identityMap.get(playerIdentityKey(action.hand_id, action.player_id, action.entry_number))
          ?? [...identityMap.entries()].find(([key]) => key.startsWith(`${action.hand_id}:${action.player_id}:`))?.[1];
        actionMap.get(action.hand_id)!.push({
          id: action.id,
          street: action.street || "preflop",
          display_name: identity?.name || "Người chơi",
          seat_number: identity?.seat ?? 0,
          action_type: action.action_type,
          action_amount: action.action_amount ?? 0,
          action_order: action.action_order,
          player_id: action.player_id,
          entry_number: action.entry_number ?? 1,
        });
      });

      const handRecords: HandRecord[] = handRows.map((hand) => ({
        id: hand.id,
        table_id: hand.table_id ?? null,
        hand_number: hand.hand_number,
        hand_time: hand.hand_time ?? hand.created_at,
        community_cards: stringArray(hand.community_cards),
        pot_size: hand.pot_size ?? null,
        status: hand.status || "completed",
        is_voided: hand.is_voided || false,
        created_at: hand.created_at,
        button_seat: hand.button_seat ?? undefined,
        players: playerMap.get(hand.id) || [],
        actions: actionMap.get(hand.id) || [],
      }));

      setHands(handRecords);
      if (FEATURES.trackerHistoryCompletionWorker) {
        try {
          const { data: queueStatus, error: queueStatusError } = await supabase.rpc(
            "get_tracker_historical_display_queue_status" as never,
            { p_tournament_id: tournamentId } as never,
          );
          if (isCurrentLoad()) {
            const rows = Array.isArray(queueStatus) ? queueStatus as Array<Record<string, unknown>> : [];
            const validStatuses = new Set<HistoryCompletionStatus>(["missing_blind", "missing_outcome", "stale", "pending", "needs_attention"]);
            setCompletionStatusByHand(new Map(rows.flatMap((row) =>
              typeof row.hand_id === "string" && validStatuses.has(row.queue_status as HistoryCompletionStatus)
                ? [[row.hand_id, row.queue_status as HistoryCompletionStatus] as const]
                : [])));
            setCompletionStatusError(!!queueStatusError);
          }
        } catch {
          if (!isCurrentLoad()) return;
          setCompletionStatusByHand(new Map());
          setCompletionStatusError(true);
        }
      } else {
        setCompletionStatusByHand(new Map());
        setCompletionStatusError(false);
      }
      // Queue status can finish after another tournament/table load has already won.
      if (!isCurrentLoad()) return;
      setSelectedHandId((current) => current && handRecords.some((hand) => hand.id === current) ? current : null);
    } catch (error) {
      if (!isCurrentLoad()) return;
      setLoadError(error instanceof Error ? error.message : "Không tải được dữ liệu");
      setHands([]);
      setCompletionStatusByHand(new Map());
      setCompletionStatusError(false);
    } finally {
      if (isCurrentLoad()) setLoading(false);
    }
  }, [selectedTableId, supabase, tables, tournamentId]);

  useEffect(() => {
    void loadHands();
    return () => loadGuardRef.current?.invalidate();
  }, [loadHands]);
  useEffect(() => { setEditMode(false); setResettleView(null); }, [selectedHandId]);

  const handleSaveEdit = async (patch: HandEditPatch, reason: string) => {
    if (!LEGACY_CORRECTION_WRITES_ENABLED) {
      toast.error("Chức năng ghi sửa hand đang tạm khóa. Bản nháp chưa được lưu.");
      return;
    }
    const hand = hands.find((h) => h.id === selectedHandId);
    if (!hand) return;
    setSavingEdit(true);
    try {
      const args = buildEditCompletedHandArgs({ tournamentId, handId: hand.id, reason, patch });
      const { data, error } = await supabase.rpc("edit_completed_hand" as any, args as any);
      if (error) {
        if ((error as any).code === "42883") {
          setEditSupported(false);
          toast.error("Tính năng sửa hand chưa được áp dụng trên máy chủ.");
        } else {
          toast.error("Lỗi khi lưu: " + error.message);
        }
        return;
      }
      if (data && (data as any).ok === false) {
        toast.error("Không lưu được: " + (data as any).error);
        return;
      }
      toast.success("Đã lưu chỉnh sửa hand.");
      setEditMode(false);
      loadHands();
    } finally {
      setSavingEdit(false);
    }
  };

  // Đợt G3 — run the resettle engine over the full forward chain and preview the result.
  const handleResettle = async (
    editedTarget: EditedTargetHand,
    patch: HandEditPatch,
    reason: string,
    _summary: string[],
    expectedEndingStacks: ExpectedHandEndStack[],
  ) => {
    const target = hands.find((h) => h.id === selectedHandId);
    if (!target) return;
    setResettleBusy(true);
    setResettleView(null);
    try {
      // Full forward chain: target + every later completed, non-voided hand in the
      // tournament, chronological. The engine needs the WHOLE chain so its final stacks
      // equal the live chip counts (conservation) for players it doesn't move. All three
      // reads are PAGED with unique total orders — a silently-truncated chain would corrupt
      // the replay + the all-in-cap divergence guard and let conserved-but-wrong chips slip.
      const handsRes = await pageAll<any>((from, to) =>
        supabase
          .from("tournament_hands")
          .select("id, hand_number, table_id, button_seat, created_at")
          .eq("tournament_id", tournamentId)
          .eq("status", "completed")
          .eq("is_voided", false)
          .gte("created_at", target.created_at)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
      if (handsRes.error) {
        toast.error("Không tải được chuỗi ván để tính lại: " + (handsRes.error.message ?? ""));
        return;
      }
      const handRows = handsRes.data;
      const ids = handRows.map((h: any) => h.id);
      if (ids.length === 0) {
        toast.error("Không tìm thấy ván nào để tính lại.");
        return;
      }
      const [pRes, aRes] = await Promise.all([
        pageAll<any>((from, to) =>
          supabase
            .from("hand_players")
            .select("hand_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated")
            .in("hand_id", ids)
            .order("hand_id", { ascending: true })
            .order("player_id", { ascending: true })
            .order("entry_number", { ascending: true })
            .range(from, to),
        ),
        pageAll<any>((from, to) =>
          supabase
            .from("hand_actions")
            .select("hand_id, player_id, street, action_type, action_amount, action_order")
            .in("hand_id", ids)
            .order("hand_id", { ascending: true })
            .order("action_order", { ascending: true })
            .range(from, to),
        ),
      ]);
      if (pRes.error || aRes.error) {
        toast.error("Không tải được chi tiết ván để tính lại: " + ((pRes.error || aRes.error)?.message ?? ""));
        return;
      }
      const playersByHand = new Map<string, any[]>();
      pRes.data.forEach((p: any) => {
        if (!playersByHand.has(p.hand_id)) playersByHand.set(p.hand_id, []);
        playersByHand.get(p.hand_id)!.push(p);
      });
      const actionsByHand = new Map<string, any[]>();
      aRes.data.forEach((a: any) => {
        if (!actionsByHand.has(a.hand_id)) actionsByHand.set(a.hand_id, []);
        actionsByHand.get(a.hand_id)!.push(a);
      });
      // Completeness: every completed hand in the chain must have its player rows, else the
      // carry is missing data → refuse rather than move chips on a partial chain.
      const missing = handRows.filter((h: any) => (playersByHand.get(h.id) || []).length === 0);
      if (missing.length > 0) {
        toast.error(`Dữ liệu ván không đầy đủ (thiếu người chơi ở ${missing.length} ván) — không thể tính lại an toàn.`);
        return;
      }
      const toRow = (h: any): ResettleHandRow => ({
        id: h.id,
        hand_number: h.hand_number,
        table_id: h.table_id,
        button_seat: h.button_seat ?? 0,
        created_at: h.created_at,
        players: (playersByHand.get(h.id) || []).map((p: any) => ({
          player_id: p.player_id,
          entry_number: p.entry_number ?? 1,
          seat_number: p.seat_number,
          starting_stack: p.starting_stack ?? 0,
          ending_stack: p.ending_stack ?? 0,
          is_eliminated: !!p.is_eliminated,
        })),
        actions: (actionsByHand.get(h.id) || []).map((a: any) => ({
          player_id: a.player_id,
          street: a.street || "preflop",
          action_type: a.action_type,
          action_amount: a.action_amount ?? 0,
          action_order: a.action_order,
        })),
      });
      const targetRaw = handRows.find((h: any) => h.id === target.id);
      if (!targetRaw) {
        toast.error("Không tìm thấy ván gốc trong chuỗi để tính lại.");
        return;
      }
      const targetRow = toRow(targetRaw);
      const laterRows = handRows.filter((h: any) => h.id !== target.id).map(toRow);
      const { result, entryByPlayer, entryByHandPlayer } = runClientResettle({
        target: targetRow,
        later: laterRows,
        editedTarget,
      });
      if (!result.ok) {
        setResettleView({
          result, entryByPlayer, entryByHandPlayer, patch, reason,
          targetHandId: target.id, targetRow, laterRows, editedTarget,
          expectedEndingStacks,
          serverPreview: { sourceRevision: 0, sourceChainHash: "", outcomeHash: "", scope: "blocked" },
          idempotencyKey: crypto.randomUUID(),
        });
        return;
      }
      const serverEdit = buildServerSettlementEdit(patch);
      if (Object.keys(serverEdit).length === 0) {
        toast.error("Chưa có action, Board hoặc bài để máy chủ xem trước.");
        return;
      }
      const { data: previewData, error: previewError } = await supabase.functions.invoke("tournament-live-resettle-commit", {
        body: {
          mode: "preview",
          tournament_id: tournamentId,
          hand_id: target.id,
          correction_reason: reason,
          edit: serverEdit,
          expected_target_ending_stacks: expectedEndingStacks,
        },
      });
      const preview = record(previewData);
      if (previewError || preview?.ok !== true || preview.status !== "preview"
        || preview.draft_status !== "READY_TO_APPLY"
        || typeof preview.source_revision !== "number"
        || typeof preview.source_chain_hash !== "string"
        || typeof preview.outcome_hash !== "string") {
        toast.error(textValue(preview?.code) ?? previewError?.message ?? "Máy chủ chưa chấp nhận bản xem trước.");
        return;
      }
      setResettleView({
        result,
        entryByPlayer,
        entryByHandPlayer,
        patch,
        reason,
        targetHandId: target.id,
        targetRow,
        laterRows,
        editedTarget,
        expectedEndingStacks,
        serverPreview: {
          sourceRevision: preview.source_revision,
          sourceChainHash: preview.source_chain_hash,
          outcomeHash: preview.outcome_hash,
          scope: textValue(preview.scope) ?? "latest_completed_hand_only",
        },
        idempotencyKey: crypto.randomUUID(),
      });
    } finally {
      setResettleBusy(false);
    }
  };

  // Legacy fallback keeps the old two-step path. When the explicit atomic
  // capability is available, the dedicated Edge writer recomputes actions and
  // ending stacks server-side before one transaction commits anything.
  const handleResettleConfirm = async () => {
    if (!resettleView || !resettleView.result.ok) return;
    const rv = resettleView;
    const ok = rv.result as ResettleOk;
    const changes = resettleChipChanges(ok);
    setResettleBusy(true);
    try {
      const targetStackCheck = checkExpectedHandEndStacks(
        resettleHandEndStacks(ok, rv.targetHandId, rv.targetRow.players),
        rv.expectedEndingStacks,
      );
      if (!targetStackCheck.matchesEngine) {
        toast.error("Stack thực tế chưa khớp kết quả engine. Hãy sửa action/bài/người thắng rồi tính lại; chưa có chip nào được đổi.");
        return;
      }
      if (FEATURES.trackerAtomicResettle) {
        if (!isTrackerAtomicResettleAvailable()) {
          toast.error("Tính lại chip nguyên tử chưa sẵn sàng trên máy chủ. Không có thay đổi nào được gửi; hãy chờ owner xác nhận DB và Edge đã áp dụng.");
          return;
        }
        if (
          (rv.editedTarget.manualWinnerIds?.length ?? 0) > 0
          || (rv.editedTarget.muckedPlayerIds?.length ?? 0) > 0
        ) {
          toast.error("Đường sửa nguyên tử không nhận người thắng hoặc muck chọn tay. Hãy sửa action, Board và bài đã table để máy chủ tự tính; nếu không đủ dữ liệu, hãy hoàn tác ván rồi nhập lại.");
          return;
        }
        const serverEdit = buildServerSettlementEdit(rv.patch);
        if (Object.keys(serverEdit).length === 0) {
          toast.error("Chưa có action, Board hoặc bài để máy chủ tính lại. Không thể đổi chip chỉ từ stack hoặc người thắng chọn tay.");
          return;
        }
        const { data, error } = await supabase.functions.invoke("tournament-live-resettle-commit", {
          body: {
            mode: "commit",
            tournament_id: tournamentId,
            hand_id: rv.targetHandId,
            correction_reason: rv.reason,
            edit: serverEdit,
            expected_target_ending_stacks: rv.expectedEndingStacks,
            idempotency_key: rv.idempotencyKey,
            expected_source_revision: rv.serverPreview.sourceRevision,
            expected_source_chain_hash: rv.serverPreview.sourceChainHash,
            expected_outcome_hash: rv.serverPreview.outcomeHash,
          },
        });
        if (error || (data as any)?.ok === false) {
          toast.error((data as any)?.message || error?.message || "Không thể sửa hand và tính lại chip nguyên tử.");
          return;
        }
        toast.success("Đã sửa hand và tính lại chip theo receipt máy chủ.");
        setResettleView(null);
        setEditMode(false);
        loadHands();
        return;
      }
      // Guard 1 — a bust flip (alive<->busted) is NOT a chip re-attribution; the RPC would
      // refuse it AFTER the display edit already committed. Detect it up front and route to
      // void so we never leave display-edited-but-chips-unchanged on this path.
      if (changes.some((c) => (c.before === 0) !== (c.after === 0))) {
        toast.error("Có người chơi đổi trạng thái loại/còn sống — hãy dùng 'Hoàn tác ván' (void) rồi nhập lại, không dùng tính lại chip.");
        return;
      }
      // Guard 2 — FRESHNESS: the preview was computed from a snapshot. Re-fetch the changed
      // players' LIVE chips and require each to still equal the engine baseline. This closes
      // the preview->confirm race where an intra-subset (net-zero) chip move would satisfy the
      // RPC's subset-SUM guard yet silently erase that move (confirmed HIGH finding).
      const changedIds = [...new Set(changes.map((c) => c.player_id))];
      const { data: liveRows, error: liveErr } = await supabase
        .from("tournament_chip_counts")
        .select("player_id, entry_number, chip_count")
        .eq("tournament_id", tournamentId)
        .in("player_id", changedIds);
      if (liveErr) {
        toast.error("Không kiểm tra được chip hiện tại: " + liveErr.message);
        return;
      }
      const liveMap = new Map<string, number>();
      (liveRows || []).forEach((r: any) => liveMap.set(`${r.player_id}:${r.entry_number}`, r.chip_count));
      const drifted = changes.some((c) => {
        const entry = rv.entryByPlayer.get(c.player_id) ?? 1;
        return liveMap.get(`${c.player_id}:${entry}`) !== c.before;
      });
      if (drifted) {
        toast.error("Chip hiện tại khác lúc xem trước (có ván mới, nạp thêm chip, hoặc chỉnh tay). Bấm 'Sửa & tính lại chip' lại — nếu vẫn báo thế này thì chip đã đổi NGOÀI ván bài, phải chỉnh tay hoặc void, không tính lại tự động được.");
        setResettleView(null);
        loadHands();
        return;
      }

      const editArgs = buildEditCompletedHandArgs({ tournamentId, handId: rv.targetHandId, reason: rv.reason, patch: rv.patch });
      const { data: editData, error: editErr } = await supabase.rpc("edit_completed_hand" as any, editArgs as any);
      if (editErr) {
        if ((editErr as any).code === "42883") {
          setEditSupported(false);
          toast.error("Tính năng sửa hand chưa được áp dụng trên máy chủ.");
        } else {
          toast.error("Lỗi khi lưu hiển thị: " + editErr.message);
        }
        return;
      }
      if (editData && (editData as any).ok === false) {
        toast.error("Không lưu được hiển thị: " + (editData as any).error);
        return;
      }
      // 2) Chip re-attribution. If this fails AFTER the display edit committed, reload so the
      // panel reflects the saved display + unchanged chips (honest, never silently stale).
      const applyArgs = buildApplyResettleArgs({
        tournamentId,
        targetHandId: rv.targetHandId,
        reason: rv.reason,
        result: ok,
        entryByPlayer: rv.entryByPlayer,
        entryByHandPlayer: rv.entryByHandPlayer,
      });
      const { data: applyData, error: applyErr } = await supabase.rpc("apply_resettle_forward" as any, applyArgs as any);
      if (applyErr) {
        if ((applyErr as any).code === "42883") {
          setResettleSupported(false);
          toast.error("Tính lại chip chưa được áp dụng trên máy chủ.");
        } else {
          toast.error("Đã lưu hiển thị nhưng CHƯA đổi chip (lỗi: " + applyErr.message + "). Chip giữ nguyên.");
        }
        setResettleView(null);
        loadHands();
        return;
      }
      const res = applyData as any;
      if (res && res.ok === false) {
        if (res.error === "elimination_change_use_void") {
          toast.error("Đây là thay đổi loại/còn sống ở ván mới nhất — hãy dùng 'Hoàn tác ván' (void) rồi nhập lại, không dùng tính lại chip.");
        } else if (res.error === "stale_state" || res.error === "not_conserved") {
          toast.error("Chip khác lúc xem trước — CHƯA đổi chip (đã lưu hiển thị). Bấm 'Sửa & tính lại chip' lại; nếu vẫn thế thì chip đã đổi NGOÀI ván bài (nạp thêm/chỉnh tay) — chỉnh tay hoặc void.");
        } else {
          toast.error("Đã lưu hiển thị nhưng CHƯA đổi chip (lý do: " + res.error + ").");
        }
        setResettleView(null);
        loadHands();
        return;
      }
      toast.success(`Đã tính lại chip — ${res?.changed_players ?? 0} người đổi chip.`);
      setResettleView(null);
      setEditMode(false);
      loadHands();
    } finally {
      setResettleBusy(false);
    }
  };

  const selectedHand = hands.find((h) => h.id === selectedHandId);
  const tableNameById = new Map(tables.flatMap((table) => [
    [table.id, table.name] as const,
    ...(table.physicalId ? [[table.physicalId, table.name] as const] : []),
  ]));
  const settlementCandidates: HistoricalSettlementBatchCandidate[] = hands
    .filter((hand) => hand.status === "completed" && !hand.is_voided)
    .map((hand) => ({
      handId: hand.id,
      handNumber: hand.hand_number,
      tableId: hand.table_id,
      tableName: hand.table_id ? tableNameById.get(hand.table_id) ?? null : null,
    }));
  const visibleHands = hands.filter((hand) => completionFilter === "all"
    || completionStatusByHand.get(hand.id) === completionFilter);
  const completionStatusLabel: Record<HistoryCompletionStatus, string> = {
    missing_blind: "Thiếu blind đóng băng",
    missing_outcome: "Thiếu kết quả xác minh",
    stale: "Kết quả cũ",
    pending: "Đang xác minh",
    needs_attention: "Cần kiểm tra",
  };

  const selectHand = (handId: string) => {
    setSelectedHandId(handId);
    setShowHandPicker(false);
    setEditMode(false);
    setEditActionOrder(null);
    setResettleView(null);
    onSelectionChange?.({
      tableId: selectedTableId === "all" ? null : selectedTableId,
      handId,
    });
  };

  const selectTable = (tableId: string) => {
    setSelectedTableId(tableId);
    setSelectedHandId(null);
    setEditActionOrder(null);
    onSelectionChange?.({ tableId: tableId === "all" ? null : tableId, handId: null });
  };

  return (
    <div className="space-y-3">
      {FEATURES.trackerHistoricalSettlementDisplay && enableHistoricalBatchControls && settlementCandidates.length > 0 && (
        <HistoricalSettlementBatchControl
          tournamentId={tournamentId}
          candidates={settlementCandidates}
          onSelectHand={selectHand}
          onCommitted={() => { void loadHands(); }}
        />
      )}

      {workspaceMode && selectedHandId && (
        <Button type="button" variant="outline" className="min-h-11 w-full xl:hidden" onClick={() => setShowHandPicker((current) => !current)}>
          {showHandPicker ? "Ẩn danh sách hand" : "Chọn hand khác"}
        </Button>
      )}
      <div className={`grid min-w-0 grid-cols-1 gap-3 ${workspaceMode ? "xl:grid-cols-[320px_minmax(0,1fr)]" : "lg:grid-cols-[280px_minmax(0,1fr)]"}`}>
      <div className={`min-w-0 space-y-2 ${workspaceMode && selectedHandId && !showHandPicker ? "hidden xl:block" : ""}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-emerald-300" /> Lịch sử hand</div>
          <Button size="sm" variant="outline" onClick={loadHands} disabled={loading} className="min-h-11 text-xs">
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Đang tải" : "Làm mới"}
          </Button>
        </div>

        <select
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={selectedTableId}
          onChange={(event) => selectTable(event.target.value)}
          aria-label="Lọc lịch sử theo bàn"
          disabled={tablesLoading || !!tablesError}
        >
          <option value="all">Tất cả bàn</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {tablesLoading && <p role="status" className="text-xs text-muted-foreground">Đang tải danh sách bàn…</p>}
        {tablesError && (
          <div role="alert" className="space-y-2 text-xs text-destructive">
            <p>Không tải được danh sách bàn: {tablesError}</p>
            <Button size="sm" variant="outline" onClick={() => setTablesReload((current) => current + 1)} disabled={tablesLoading}>
              Tải lại danh sách bàn
            </Button>
          </div>
        )}

        {FEATURES.trackerHistoryCompletionWorker && (
          <>
            <select
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={completionFilter}
              onChange={(event) => setCompletionFilter(event.target.value as typeof completionFilter)}
              aria-label="Lọc lịch sử theo trạng thái xác minh"
            >
              <option value="all">Mọi trạng thái xác minh</option>
              {(Object.entries(completionStatusLabel) as Array<[HistoryCompletionStatus, string]>).map(([status, label]) => (
                <option key={status} value={status}>{label}</option>
              ))}
            </select>
            {completionStatusError && <p role="status" className="text-xs text-amber-300">Không tải được trạng thái hàng đợi xác minh.</p>}
          </>
        )}

        {loadError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1 break-all">Không tải được lịch sử hand: {loadError}</span>
            <Button size="sm" variant="outline" onClick={loadHands} disabled={loading} className="h-6 text-[11px] shrink-0">
              Thử lại
            </Button>
          </div>
        )}

        <div className="space-y-1 pr-1 xl:max-h-[600px] xl:overflow-y-auto">
          {visibleHands.length === 0 && !loading && !loadError && (
            <div className="py-8 text-center text-xs italic text-muted-foreground">
              {completionFilter === "all" ? "Chưa có hand nào được ghi" : "Không có hand phù hợp bộ lọc"}
            </div>
          )}
          {visibleHands.map((hand) => (
            <button
              key={hand.id}
              onClick={() => selectHand(hand.id)}
              className={`min-h-14 w-full rounded-lg border p-2.5 text-left text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                selectedHandId === hand.id
                  ? "border-emerald-500/50 bg-emerald-950/20"
                  : "border-border/30 bg-card hover:border-border/60"
              } ${hand.is_voided ? "opacity-50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className={`font-semibold ${hand.is_voided ? "line-through" : ""}`}>
                  #{hand.hand_number}
                </span>
                <div className="flex items-center gap-1.5">
                  {hand.is_voided && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">VOID</span>
                  )}
                  {FEATURES.trackerHistoryCompletionWorker && completionStatusByHand.get(hand.id) && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${completionStatusByHand.get(hand.id) === "needs_attention" || completionStatusByHand.get(hand.id) === "missing_blind" ? "bg-red-500/20 text-red-300" : "bg-amber-500/15 text-amber-200"}`}>
                      {completionStatusLabel[completionStatusByHand.get(hand.id)!]}
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    hand.status === "completed" ? "bg-emerald-500/20 text-emerald-400" :
                    hand.status === "in_progress" ? "bg-amber-500/20 text-amber-400" :
                    "bg-red-500/20 text-red-400"
                  }`}>
                    {hand.status === "completed" ? "Hoàn tất" : hand.status === "in_progress" ? "Đang nhập" : hand.status}
                  </span>
                </div>
              </div>
              <div className="text-muted-foreground mt-0.5">
                {hand.community_cards.length > 0 && (
                  <span className="font-mono">{hand.community_cards.map(displayCard).join(" ")}</span>
                )}
                {hand.pot_size !== null && <span className="ml-1.5 text-emerald-400">Pot {formatStack(hand.pot_size)}</span>}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(hand.hand_time || hand.created_at).toLocaleTimeString()}
                {" · "}
                {hand.players.length} người chơi
                {hand.players.filter((p) => p.is_eliminated).length > 0 && (
                  <span className="text-red-400 ml-1">
                    · {hand.players.filter((p) => p.is_eliminated).length} bị loại
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        {selectedHand ? (
          <>
            <div className="flex flex-col gap-3 rounded-lg border border-border/30 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-base font-bold">
                  Hand #{selectedHand.hand_number}
                </div>
                {selectedHand.is_voided && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">VOIDED</span>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                  selectedHand.status === "completed" ? "bg-emerald-500/20 text-emerald-400" :
                  selectedHand.status === "in_progress" ? "bg-amber-500/20 text-amber-400" :
                  "bg-red-500/20 text-red-400"
                }`}>
                  {selectedHand.status === "completed" ? "Hoàn tất" : selectedHand.status === "in_progress" ? "Đang nhập" : selectedHand.status}
                </span>
                {selectedHand.button_seat && (
                  <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-500/20 text-amber-400">
                    BTN S{selectedHand.button_seat}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild type="button" variant="outline" size="sm" className="min-h-11">
                  <Link to={`/live/${tournamentId}?tab=hands&handId=${selectedHand.id}${selectedHand.table_id ? `&tableId=${selectedHand.table_id}` : ""}`}>
                    <ExternalLink className="mr-2 h-4 w-4" /> Xem replay
                  </Link>
                </Button>
                {FEATURES.trackerHandHistoryEdit && editSupported && !editMode &&
                  selectedHand.status === "completed" && !selectedHand.is_voided && (
                    <Button
                      type="button"
                      onClick={() => setEditMode(true)}
                      className="min-h-11 bg-emerald-400 font-semibold text-emerald-950 hover:bg-emerald-300"
                    >
                      <Wrench className="mr-2 h-4 w-4" /> Xem bản nháp sửa hand
                    </Button>
                  )}
                <div className="w-full text-xs text-muted-foreground sm:w-auto">
                  {new Date(selectedHand.hand_time || selectedHand.created_at).toLocaleString()}
                </div>
              </div>
            </div>

            {workspaceMode && !editMode && (
              <FloorHandActionReview
                key={selectedHand.id}
                handNumber={selectedHand.hand_number}
                tableName={tables.find((table) => table.id === selectedHand.table_id)?.name ?? "Bàn đã chọn"}
                potSize={selectedHand.pot_size}
                buttonSeat={selectedHand.button_seat}
                seats={selectedHand.players.map((player) => ({ seat_number: player.seat_number, display_name: player.display_name }))}
                actions={selectedHand.actions}
                initialActionId={initialActionId}
                canEdit={FEATURES.trackerHandHistoryEdit && editSupported && selectedHand.status === "completed" && !selectedHand.is_voided}
                isVoided={selectedHand.is_voided}
                onEditAction={(order) => { setEditActionOrder(order); setEditMode(true); }}
              />
            )}

            {selectedHand.status === "in_progress" && !selectedHand.is_voided && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-100">
                Hand đang chạy: mở đúng bàn để dùng Undo hoặc thao tác Tracker canonical. Workspace này không ghi đè action hay chip đã có trong hand đang chơi; sau khi kết thúc hand, Floor có thể mở lại tại đây để kiểm tra và tính lại toàn bộ chuỗi.
              </div>
            )}

            {FEATURES.trackerHistoricalSettlementDisplay && !editMode &&
              selectedHand.status === "completed" && !selectedHand.is_voided && (
                <HistoricalSettlementDisplayControl
                  tournamentId={tournamentId}
                  handId={selectedHand.id}
                  handNumber={selectedHand.hand_number}
                  onVerified={() => { void loadHands(); }}
                />
              )}

            {editMode ? (
              <>
              <HandEditPanel
                initialActionOrder={editActionOrder}
                board={selectedHand.community_cards}
                potSize={selectedHand.pot_size}
                players={selectedHand.players.map((p) => ({
                  player_id: p.player_id,
                  entry_number: p.entry_number,
                  display_name: p.display_name,
                  seat_number: p.seat_number,
                  starting_stack: p.starting_stack,
                  ending_stack: p.ending_stack,
                  hole_cards: p.hole_cards || [],
                }))}
                actions={selectedHand.actions.map((a) => ({
                  player_id: a.player_id,
                  entry_number: a.entry_number,
                  street: a.street,
                  action_type: a.action_type,
                  action_amount: a.action_amount,
                  action_order: a.action_order,
                }))}
                buttonSeat={selectedHand.button_seat ?? 0}
                saving={savingEdit || resettleBusy}
                writesEnabled={LEGACY_CORRECTION_WRITES_ENABLED}
                onCancel={() => { setEditMode(false); setResettleView(null); }}
                onSave={handleSaveEdit}
                resettleEnabled={SERVER_CORRECTION_PREVIEW_ENABLED && FEATURES.trackerResettleForward && resettleSupported}
                onResettle={handleResettle}
                onEditChange={() => setResettleView(null)}
              />
              {SERVER_CORRECTION_PREVIEW_ENABLED && resettleView && (
                <ResettlePreview
                  view={resettleView}
                  busy={resettleBusy}
                  players={selectedHand.players.map((p) => ({
                    player_id: p.player_id,
                    display_name: p.display_name,
                    ending_stack: p.ending_stack,
                  }))}
                  onConfirm={handleResettleConfirm}
                  onClose={() => setResettleView(null)}
                />
              )}
              </>
            ) : (
            <>
            {selectedHand.community_cards.length > 0 && (
              <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-br from-emerald-950/50 to-emerald-900/30 border border-emerald-700/30">
                {selectedHand.community_cards.map((card, i) => (
                  <div key={i} className={`w-12 h-[68px] rounded-lg border-2 flex items-center justify-center text-lg font-bold shadow-lg ${
                    isRedCard(card) ? "border-red-400/40 bg-red-950/40 text-red-400" : "border-white/30 bg-white/10 text-white"
                  }`}>
                    {displayCard(card)}
                  </div>
                ))}
                {selectedHand.pot_size !== null && (
                  <div className="ml-3 text-lg">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest block">Pot</span>
                    <span className="text-emerald-400 font-bold font-mono">{formatStack(selectedHand.pot_size)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {selectedHand.players.map((p) => (
                <div key={`${p.player_id}-${p.entry_number}`} className={`p-2 rounded-lg border text-xs ${
                  p.is_eliminated
                    ? "border-red-500/30 bg-red-950/10"
                    : "border-border/30 bg-card"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">{p.display_name}</span>
                    <span className="text-[10px] text-muted-foreground">S{p.seat_number}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-muted-foreground">
                      {formatStack(p.starting_stack)}
                      <span className="mx-0.5">→</span>
                      <span className={p.ending_stack === 0 ? "text-red-400 font-bold" : "text-emerald-400"}>
                        {formatStack(p.ending_stack ?? 0)}
                      </span>
                    </span>
                    {p.is_eliminated && <span className="text-[10px] text-red-400 font-bold">OUT</span>}
                  </div>
                  {p.hole_cards && p.hole_cards.length === 2 && (
                    <div className="flex gap-0.5 mt-0.5">
                      {p.hole_cards.map((card: string, ci: number) => (
                        <span key={ci} className={`text-[11px] font-bold ${isRedCard(card) ? 'text-red-400' : 'text-white'}`}>
                          {displayCard(card)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {!workspaceMode && <div className="bg-card border border-border/30 rounded-lg p-2.5 shadow-sm">
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-2 pb-2 border-b border-border/20">
                Action Log
              </div>
              <div className="overflow-y-auto max-h-[300px] space-y-0.5 pr-1">
                {selectedHand.actions.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-4 italic">No actions recorded</div>
                )}
                {STREET_ORDER.filter((s) => selectedHand.actions.some((a) => a.street === s)).map((street) => (
                  <div key={street} className="mb-2">
                    <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">
                      {STREET_LABELS[street]}
                    </div>
                    {selectedHand.actions.filter((a) => a.street === street).map((action, idx) => (
                      <div key={idx} className="flex justify-between py-1 px-1.5 border-b border-border/10 last:border-0 text-xs">
                        <span className="text-muted-foreground">{action.display_name}</span>
                        <span className={`font-semibold ${action.action_amount > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                          {formatActionLabel(action)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>}
            </>
            )}
          </>
        ) : (
          <Card className="p-10 text-center">
            <div className="text-sm text-muted-foreground">Chọn một hand để xem chi tiết hoặc chỉnh sửa</div>
          </Card>
        )}
      </div>
      </div>
    </div>
  );
}

// Đợt G3 — chip-change preview shown after "Sửa & tính lại chip". Prop-driven so the
// money-path parent owns the RPC calls; this only renders the engine's decision + the
// per-player current→new chips, or the engine's Vietnamese block reason.
export function ResettlePreview({
  view,
  busy,
  players,
  onConfirm,
  onClose,
}: {
  view: { result: ResettleForwardResult; targetHandId?: string; expectedEndingStacks?: ExpectedHandEndStack[] };
  busy: boolean;
  players: { player_id: string; display_name: string; ending_stack: number }[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const nameOf = (pid: string) => players.find((p) => p.player_id === pid)?.display_name ?? "Người chơi";
  const result = view.result;
  const blocked = !result.ok ? result as ResettleBlock : null;
  const needsManual = blocked?.reason === "needs_manual_winner";

  if (blocked) {
    return (
      <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/20 space-y-1.5">
        <div className="text-xs font-bold text-amber-300">Không thể tự tính lại chip</div>
        <div className="text-xs text-foreground/90">{blocked.message}</div>
        {blocked.hand_number != null && (
          <div className="text-[11px] text-muted-foreground">Ván lệch: #{blocked.hand_number}</div>
        )}
        {blocked.affected_player_ids.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            Người liên quan: {blocked.affected_player_ids.map(nameOf).join(", ")}
          </div>
        )}
        {needsManual && (
          <div className="rounded-md border border-amber-500/40 bg-background/35 p-2 text-[11px] leading-snug text-amber-100">
            Ván này chưa có đủ dữ liệu để server xác minh người thắng, side pot và tiền hoàn. Hãy bổ sung bài đã lộ/muck, hành động hoặc stack còn thiếu; VinPoker sẽ không cho client tự chia pot.
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground border border-border rounded px-2 py-1 hover:text-foreground mt-1"
        >
          {needsManual ? "Bổ sung dữ liệu & tính lại" : "Đóng xem trước"}
        </button>
      </div>
    );
  }

  const ok = result as ResettleOk;
  const changes = resettleChipChanges(ok);
  const noChange = changes.length === 0;
  const unchangedRows = players.map((player) => ({
    player_id: player.player_id,
    before: player.ending_stack,
    after: player.ending_stack,
  }));
  const unchangedTotal = unchangedRows.reduce((sum, player) => sum + player.before, 0);
  const targetStacks = view.targetHandId
    ? resettleHandEndStacks(ok, view.targetHandId, players)
    : { rows: unchangedRows, beforeTotal: unchangedTotal, afterTotal: unchangedTotal, conserved: true };
  const expectedStacks = view.expectedEndingStacks ?? targetStacks.rows.map((player) => ({
    player_id: player.player_id,
    entry_number: 1,
    ending_stack: player.after,
  }));
  const stackCheck = checkExpectedHandEndStacks(targetStacks, expectedStacks);
  return (
    <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-950/20 space-y-2">
      <div className="text-xs font-bold text-emerald-300">Xem trước — tính lại chip</div>
      <div className="text-[11px] text-muted-foreground">
        Người thắng ván này:{" "}
        <span className="text-foreground font-medium">{ok.targetWinnerIds.map(nameOf).join(", ") || "(không có)"}</span>
      </div>
      <div className="rounded-lg border border-emerald-500/25 bg-background/35 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="font-semibold text-foreground">Stack cuối hand (engine tính lại)</span>
          <span className={targetStacks.conserved && stackCheck.matchesEngine ? "text-emerald-300" : "text-rose-300"}>
            {targetStacks.conserved && stackCheck.matchesEngine ? "Khớp stack Floor và bảo toàn chip" : "Chưa khớp stack Floor — không thể xác nhận"}
          </span>
        </div>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {stackCheck.rows.map((player) => (
            <div key={player.player_id} className={`flex items-center justify-between gap-3 rounded border px-2 py-1.5 text-[11px] ${player.matches ? "border-border/40" : "border-rose-500/50 bg-rose-950/20"}`}>
              <span className="min-w-0 truncate text-muted-foreground">{nameOf(player.player_id)}</span>
              <span className="shrink-0 font-mono">
                {formatStack(player.before)} <span className="text-muted-foreground">→</span>{" "}
                <strong className={player.after === 0 ? "text-rose-300" : "text-emerald-300"}>{formatStack(player.after)}</strong>
                <span className={player.matches ? "ml-1 text-muted-foreground" : "ml-1 text-rose-300"}>/ thực tế {formatStack(player.expected)}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Tổng: {formatStack(targetStacks.beforeTotal)} → {formatStack(targetStacks.afterTotal)}; Floor nhập {formatStack(stackCheck.expectedTotal)}. Stack là kết quả từ action/winner server xác minh, không ghi tay.
        </p>
      </div>
      {noChange ? (
        <div className="text-[11px] text-muted-foreground">
          Không có thay đổi chip — dùng “Chỉ lưu hiển thị” nếu chỉ muốn sửa lá/hành động.
        </div>
      ) : (
        <div className="space-y-0.5">
          {changes.map((c) => (
            <div key={c.player_id} className="flex justify-between text-[11px]">
              <span className="text-muted-foreground truncate mr-2">{nameOf(c.player_id)}</span>
              <span className="font-mono whitespace-nowrap">
                {formatStack(c.before)}
                <span className="mx-0.5">→</span>
                <span className={c.after === 0 ? "text-red-400 font-bold" : "text-emerald-400"}>{formatStack(c.after)}</span>
                <span className={`ml-1 ${c.delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  ({c.delta >= 0 ? "+" : ""}
                  {formatStack(c.delta)})
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground leading-snug">{ok.summary}</div>
      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          disabled={busy || noChange || !targetStacks.conserved || !stackCheck.matchesEngine}
          onClick={onConfirm}
          className="text-xs font-semibold text-amber-100 border border-amber-500/60 bg-amber-500/15 rounded-lg px-3 py-1.5 hover:bg-amber-500/25 disabled:opacity-40"
        >
          {busy ? "Đang áp dụng…" : "Xác nhận đổi chip"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:text-foreground disabled:opacity-40"
        >
          Huỷ xem trước
        </button>
      </div>
      <div className="text-[10px] text-amber-300/80">Sẽ lưu hiển thị (lá/hành động) rồi dời chip. Không thay đổi ai bị loại.</div>
    </div>
  );
}
