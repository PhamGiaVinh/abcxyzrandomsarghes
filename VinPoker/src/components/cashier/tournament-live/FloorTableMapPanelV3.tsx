import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Loader2, LockKeyhole, Plus, RadioTower, RefreshCw, RotateCcw, Shuffle, UnlockKeyhole, UserRoundMinus, UserRoundX, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FloorEntryPicker, type FloorEntrySelection } from "@/components/ops/shared/FloorEntryPicker";
import { FloorSeatRoster } from "@/components/ops/shared/FloorSeatRoster";
import { FloorTableRosterIndex } from "@/components/ops/shared/FloorTableRosterIndex";
import { FloorTableControlModeControl } from "@/components/ops/shared/FloorTableControlMode";
import { formatStack } from "@/lib/format";
import {
  createFloorTableControlV3Client,
  type FloorRestorableEntry,
  type FloorPendingTrackerMove,
  type FloorBreakPlan,
  type FloorTableControlV3Rpc,
  type FloorTableRosterSeat,
  type FloorSeatableEntry,
  type FloorTournamentTableRoster,
} from "@/lib/floorTableControlV3";
import type { Tournament } from "@/types/tournament";
import { OpenTableDialog } from "./OpenTableDialog";
import { FloorRedrawDialogV1 } from "./FloorRedrawDialogV1";
import { RestoreBustDialog } from "./RestoreBustDialog";
import { MovePlayerDialog } from "./MovePlayerDialog";
import { FEATURES } from "@/lib/featureFlags";
import { parseCanonicalCloseResult } from "./closeTableResponse";

type Mutation = () => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
type PendingTableAction = "close" | "break";

function v3ErrorMessage(error: string): string {
  switch (error) {
    case "STALE_STATE": return "Dữ liệu bàn vừa thay đổi. Hãy tải lại trước khi thao tác lại.";
    case "table_has_active_hand":
    case "player_in_active_hand": return "Bàn đang có ván chạy nên thao tác này đã bị chặn.";
    case "seat_occupied": return "Ghế này vừa được sử dụng. Hãy tải lại.";
    case "seat_locked": return "Ghế này đang khóa. Hãy mở khóa trước khi xếp người.";
    case "insufficient_capacity": return "Chưa đủ ghế trống ở các bàn có thể nhận người lúc này. Bàn đang có ván sẽ được bỏ qua; hãy thử lại sau ván hoặc mở thêm bàn.";
    case "redraw_required_for_capacity_or_locks": return "Giải đang dùng bàn 8-max hoặc có ghế khóa. Hãy dùng Redraw để server giữ đúng sức chứa và ghế khóa.";
    case "player_has_chips": return "Bàn Live Tracker chỉ cho phép loại khi chip bằng 0.";
    case "tracker_chip_state_mismatch": return "Chip trên Floor và Live Tracker chưa khớp. Hãy tải lại trước khi loại người chơi.";
    case "table_has_active_seats": return "Bàn vẫn còn người chơi. Hãy dùng “Đóng & chuyển người”.";
    case "no_destination_table":
    case "no_table_available": return "Chưa có bàn đích đủ ghế để chuyển toàn bộ người chơi.";
    case "entry_not_found": return "Không tìm thấy entry này trong giải. Hãy tải lại danh sách người chơi.";
    case "entry_not_active": return "Entry này không còn ở trạng thái có thể thao tác.";
    case "entry_not_free_sittable": return "Entry thủ công này chưa có đường xếp lại an toàn từ Waiting nên Free Sit đã bị chặn.";
    case "entry_already_seated": return "Người chơi này đã có ghế ở một bàn khác.";
    case "entry_not_seated":
    case "no_active_v3_seat": return "Người chơi không còn ở ghế này. Hãy tải lại roster.";
    case "entry_state_changed": return "Trạng thái người chơi vừa thay đổi. Hãy tải lại bàn rồi thử lại.";
    case "table_not_found": return "Không tìm thấy bàn trong giải này.";
    case "table_not_empty": return "Bàn vẫn còn người chơi. Hãy dùng “Đóng & chuyển người”.";
    case "table_session_not_active":
    case "table_session_mismatch": return "Phiên bàn đã đóng hoặc được mở lại. Hãy tải lại trước khi thao tác.";
    case "destination_table_has_active_hand": return "Bàn đích đang có ván chạy nên chưa thể chuyển người.";
    case "destination_hand_not_active": return "Ván Tracker vừa kết thúc. Hãy tải lại và chuyển người ngay.";
    case "pending_move_conflict": return "Người chơi hoặc ghế này đã có yêu cầu chuyển chờ xử lý. Hãy tải lại.";
    case "source_table_busy": return "Bàn nguồn đang có ván hoặc không ở chế độ Manual. Hãy kết thúc ván nguồn trước.";
    case "chip_state_mismatch": return "Chip ở ghế và hồ sơ giải chưa khớp. Hãy làm mới rồi kiểm tra trước khi chuyển.";
    case "seat_reserved_pending_move": return "Ghế đích đang được giữ cho một người chờ hết ván.";
    case "no_active_v3_tables": return "Giải chưa có bàn đích đang hoạt động.";
    case "tournament_not_open": return "Giải chưa mở hoặc đã kết thúc nên thao tác bị chặn.";
    case "actor_not_allowed": return "Tài khoản này không có quyền thao tác giải hoặc CLB này.";
    case "game_table_scope_mismatch": return "Bàn vật lý không thuộc cùng CLB với giải.";
    case "invalid_request": return "Yêu cầu thiếu thông tin hợp lệ. Hãy đóng màn hình và thử lại.";
    case "IDEMPOTENCY_CONFLICT": return "Yêu cầu này đã được dùng cho một thao tác khác. Hãy thử lại.";
    case "STALE_TRACKER_CONTEXT": return "Phiên Live Tracker đã đổi. Không thể dùng trạng thái cũ.";
    case "FLOOR_TABLE_CONTROL_V3_DISABLED": return "Table Control V3 chưa được mở cho môi trường này.";
    case "FLOOR_REDRAW_SEAT_LOCK_V1_DISABLED": return "Khóa ghế và redraw 8/9-max chưa được mở cho môi trường này.";
    default: return `Thao tác không thành công (${error}).`;
  }
}

/**
 * V3-only Floor map.  It never reads a legacy table_id or invokes an Edge
 * writer: all data and mutations pass through the fixed typed V3 adapter.
 */
type FloorPanelProps = { tournament: Tournament; refreshTrigger: number; actorId: string | null };

// Changing actor/tournament invalidates every open writer as well as the roster.
export function FloorTableMapPanelV3(props: FloorPanelProps) {
  return <ScopedFloorTableMapPanelV3 key={JSON.stringify([props.actorId, props.tournament.id])} {...props} />;
}

function ScopedFloorTableMapPanelV3({
  tournament,
  refreshTrigger,
  actorId,
}: {
  tournament: Tournament;
  refreshTrigger: number;
  actorId: string | null;
}) {
  const supabase = useSupabaseClient();
  const v3 = useMemo(() => createFloorTableControlV3Client(
    ((name, args) => (supabase.rpc as unknown as FloorTableControlV3Rpc)(name, args)),
  ), [supabase]);
  const [tables, setTables] = useState<FloorTournamentTableRoster[]>([]);
  const [seatableEntries, setSeatableEntries] = useState<FloorSeatableEntry[]>([]);
  const [restorableEntries, setRestorableEntries] = useState<FloorRestorableEntry[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<{ scope: string; entryId: string; name: string; destination: { tableId: string; seatNumber: number } } | null>(null);
  const [pendingMoves, setPendingMoves] = useState<FloorPendingTrackerMove[]>([]);
  const [secondaryLoadError, setSecondaryLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [openTable, setOpenTable] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedSeatNumber, setSelectedSeatNumber] = useState<number | null>(null);
  const [entrySelection, setEntrySelection] = useState<FloorEntrySelection | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{ scope: string; entryId: string; tableId: string; seatNumber: number; playerName: string } | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const [pendingBustSeat, setPendingBustSeat] = useState<FloorTableRosterSeat | null>(null);
  const [pendingFreeSitSeat, setPendingFreeSitSeat] = useState<FloorTableRosterSeat | null>(null);
  const [pendingTableAction, setPendingTableAction] = useState<PendingTableAction | null>(null);
  const [pendingActionScope, setPendingActionScope] = useState<string | null>(null);
  const [breakPlan, setBreakPlan] = useState<FloorBreakPlan | null>(null);
  const [breakPlanLoading, setBreakPlanLoading] = useState(false);
  const [breakPlanError, setBreakPlanError] = useState<string | null>(null);
  const [redrawOpen, setRedrawOpen] = useState(false);
  const [lockReason, setLockReason] = useState("Giữ ghế cho vận hành");

  const selectedTable = useMemo(
    () => tables.find((table) => table.tournamentTableId === selectedTableId) ?? null,
    [selectedTableId, tables],
  );
  const selectedSeat = useMemo(
    () => selectedTable?.seats.find((seat) => seat.seatNumber === selectedSeatNumber) ?? null,
    [selectedSeatNumber, selectedTable],
  );
  const selectedSeatLock = useMemo(
    () => selectedTable?.seatLocks.find((lock) => lock.seatNumber === selectedSeatNumber) ?? null,
    [selectedSeatNumber, selectedTable],
  );
  const emptySeatNumbers = useMemo(() => {
    if (!selectedTable) return [] as number[];
    const occupied = new Set(selectedTable.seats.map((seat) => seat.seatNumber));
    const locked = new Set(selectedTable.seatLocks.map((seatLock) => seatLock.seatNumber));
    return Array.from({ length: selectedTable.maxSeats }, (_, index) => index + 1)
      .filter((seat) => !occupied.has(seat) && !locked.has(seat));
  }, [selectedTable]);

  const readScope = `${actorId ?? ""}:${tournament.id}`;
  const selectedSessionScope = JSON.stringify([readScope, selectedTable?.tournamentTableId,
    selectedTable?.tableSessionId, selectedTable?.controlEpoch]);
  const selectedWriteScope = JSON.stringify([selectedSessionScope, selectedTable?.sessionRevision]);
  const selectedWriteScopeRef = useRef(selectedWriteScope);
  selectedWriteScopeRef.current = selectedWriteScope;
  const actionIsCurrent = pendingActionScope === selectedWriteScope && !loading && !loadError;
  const currentReadScope = useRef(readScope);
  currentReadScope.current = readScope;
  const readSequence = useRef(0);
  const load = useCallback(async (silent = false) => {
    const sequence = ++readSequence.current;
    const isCurrent = () => currentReadScope.current === readScope && readSequence.current === sequence;
    if (!v3.enabled) {
      setLoading(false);
      return false;
    }
    if (!silent) setLoading(true);
    try {
      const settled = await Promise.allSettled([
        v3.getTournamentTableRoster(tournament.id),
        v3.getSeatableEntries(tournament.id),
        v3.getRestorableEntries(tournament.id),
        v3.getPendingTrackerMoves(tournament.id),
      ]);
      if (!isCurrent()) return false;
      const failed = (error: string) => ({ ok: false as const, error });
      const roster = settled[0].status === "fulfilled" ? settled[0].value : failed("V3_ROSTER_NETWORK_FAILED");
      const entries = settled[1].status === "fulfilled" ? settled[1].value : failed("V3_SEATABLE_NETWORK_FAILED");
      const restorable = settled[2].status === "fulfilled" ? settled[2].value : failed("V3_RESTORABLE_NETWORK_FAILED");
      const pending = settled[3].status === "fulfilled" ? settled[3].value : failed("V3_PENDING_MOVES_NETWORK_FAILED");
      if (roster.ok === false) {
        if (!silent) setTables([]);
        const message = `Không tải được danh sách bàn: ${v3ErrorMessage(roster.error)}`;
        setLoadError(message);
        if (!silent) toast.error(message);
      } else {
        setTables(roster.data);
        setLoadError(null);
      }
      if (entries.ok) setSeatableEntries(entries.data);
      if (restorable.ok) setRestorableEntries(restorable.data);
      if (pending.ok) setPendingMoves(pending.data);
      const secondaryFailures = [entries, restorable, pending].filter((result) => !result.ok);
      setSecondaryLoadError(secondaryFailures.length > 0
        ? "Danh sách bàn vẫn hiển thị, nhưng một số thao tác phụ chưa tải được. Hãy thử lại."
        : null);
      return roster.ok;
    } catch {
      if (!isCurrent()) return false;
      if (!silent) {
        setTables([]);
        setSeatableEntries([]);
        setRestorableEntries([]);
        setPendingMoves([]);
      }
      const message = "Không thể kết nối để tải dữ liệu bàn. Hãy kiểm tra mạng và thử lại.";
      setLoadError(message);
      if (!silent) toast.error(message);
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [readScope, tournament.id, v3]);

  useEffect(() => {
    void load();
    return () => { ++readSequence.current; };
  }, [load, refreshTrigger]);

  useEffect(() => {
    if (!pendingMoves.some((move) => move.status === "pending")) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [load, pendingMoves]);

  useEffect(() => {
    if (!selectedTable) return;
    const current = selectedSeatNumber;
    if (current != null && (selectedTable.seats.some((seat) => seat.seatNumber === current)
      || selectedTable.seatLocks.some((lock) => lock.seatNumber === current)
      || emptySeatNumbers.includes(current))) return;
    setSelectedSeatNumber(null);
  }, [emptySeatNumbers, selectedSeatNumber, selectedTable]);

  useEffect(() => {
    setEntrySelection(null);
    setPendingBustSeat(null);
    setPendingFreeSitSeat(null);
    setPendingTableAction(null);
    setBreakPlan(null);
    setBreakPlanLoading(false);
    setBreakPlanError(null);
    setLockReason("Giữ ghế cho vận hành");
  }, [selectedSeatNumber, selectedTableId, selectedWriteScope]);

  useEffect(() => {
    setMoveTarget(null); setMoveOpen(false); setRestoreTarget(null);
  }, [selectedSessionScope]);

  const selectedTableSessionId = selectedTable?.tableSessionId ?? null;
  const selectedTableControlMode = selectedTable?.controlMode ?? null;

  useEffect(() => { setModeOpen(false); }, [selectedTableSessionId, selectedTableControlMode]);


  const run = async (successMessage: string | ((data: Record<string, unknown>) => string), mutation: Mutation): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      const result = await mutation();
      if (result.ok === false) {
        const message = v3ErrorMessage(result.error);
        setOperationError(message);
        toast.error(message);
        await load();
        return false;
      }
      setOperationError(null);
      toast.success(typeof successMessage === "function" ? successMessage(result.data) : successMessage);
      await load();
      return true;
    } catch {
      const message = "Mất kết nối khi thao tác. Chưa xác nhận thay đổi; hãy tải lại để kiểm tra trạng thái bàn.";
      setOperationError(message);
      toast.error(message);
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const selectedRosterSeats = useMemo(() => selectedTable?.seats.map((seat) => ({
    seatNumber: seat.seatNumber,
    playerName: seat.displayName,
    chipsLabel: formatStack(seat.chipCount),
    entryNumber: seat.entryNo,
    integrityStatus: seat.integrityStatus,
    playerId: seat.playerId,
  })) ?? [], [selectedTable]);

  const tableIndex = useMemo(() => tables.map((table) => ({
    id: table.tournamentTableId,
    tableNumber: table.tableNumber,
    tableName: table.tableName,
    occupiedSeatNumbers: table.seats.map((seat) => seat.seatNumber),
    maxSeats: table.maxSeats,
    status: table.seats.length > 0 ? "running" as const : "open" as const,
    controlMode: table.controlMode,
  })), [tables]);

  const seatAction = (seat: FloorTableRosterSeat | undefined) => {
    if (!seat || !selectedTable) return null;
    if (seat.integrityStatus !== "valid" || !seat.entryId) {
      return (
        <section className="rounded-xl border border-destructive/35 bg-destructive/10 p-3" role="alert">
          <p className="font-semibold text-destructive">Cần sửa dữ liệu ghế {seat.seatNumber}</p>
          <p className="mt-1 text-sm text-muted-foreground">{seat.integrityStatus === "invalid_participation"
            ? "Dữ liệu người chơi, phiên bàn hoặc chip chưa khớp. Các thao tác chuyển, rời ghế và loại được khóa để tránh nhầm người."
            : "Đang có người trên server nhưng thiếu hồ sơ dự giải. Các thao tác chuyển, rời ghế và loại được khóa để tránh nhầm người."}</p>
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">Mã người chơi: {seat.playerId}</p>
        </section>
      );
    }
    const trackerChipBlocked = selectedTable.controlMode === "tracker" && seat.chipCount !== 0;
    const pendingForEntry = pendingMoves.find((move) => move.entryId === seat.entryId && move.status === "pending");
    const staleForEntry = pendingMoves.find((move) => move.entryId === seat.entryId && move.status === "stale");
    const pendingDestination = tables.find((table) => table.tournamentTableId === pendingForEntry?.destinationTournamentTableId);
    return (
      <section className="min-w-0 space-y-3 rounded-xl border border-border bg-card/55 p-3" aria-label="Thao tác người chơi">
        <div className="min-w-0">
          <p className="break-all text-sm font-semibold text-foreground">{seat.displayName}</p>
          <p className="text-xs text-muted-foreground">Ghế {seat.seatNumber} · Entry {seat.entryNo} · {formatStack(seat.chipCount)} chip</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button data-ops-action="floor.player.open_move" className="min-h-12" disabled={!actorId || busy || Boolean(pendingForEntry)} aria-expanded={moveOpen && moveTarget?.scope === selectedSessionScope}
            onClick={() => { setMoveTarget({ scope: selectedSessionScope, entryId: seat.entryId, tableId: selectedTable.tournamentTableId,
              seatNumber: seat.seatNumber, playerName: seat.displayName }); setMoveOpen(true); }}>
            <ArrowRightLeft className="mr-2 h-4 w-4" /> Chuyển người
          </Button>
          {FEATURES.floorFreeSitV1 && (
            <Button data-ops-action="floor.player.open_free_sit" variant="outline" className="min-h-12" disabled={busy} onClick={() => { setPendingActionScope(selectedWriteScope); setPendingFreeSitSeat(seat); }}>
              <UserRoundMinus className="mr-2 h-4 w-4" /> Rời ghế
            </Button>
          )}
          <Button data-ops-action="floor.player.open_bust" variant="destructive" className="min-h-12" disabled={busy || trackerChipBlocked} onClick={() => { setPendingActionScope(selectedWriteScope); setPendingBustSeat(seat); }}>
            <UserRoundX className="mr-2 h-4 w-4" /> Loại khỏi giải
          </Button>
        </div>
        {pendingForEntry && (
          <div className="min-w-0 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm">
            <p className="font-medium">Chờ hết ván · Bàn {pendingDestination?.tableNumber ?? "—"} · Ghế {pendingForEntry.destinationSeatNumber}</p>
            <p className="mt-1 text-xs text-muted-foreground">Người chơi vẫn ở ghế hiện tại. Hệ thống sẽ chuyển sau ván Tracker.</p>
            <Button data-ops-action="floor.player.cancel_pending_move" variant="outline" className="mt-3 min-h-12 w-full" disabled={busy} onClick={() => void run("Đã hủy chuyển sau ván.", () => v3.cancelPendingTrackerMove(pendingForEntry.pendingMoveId))}>Hủy chuyển</Button>
          </div>
        )}
        {staleForEntry && !pendingForEntry && (
          <p role="status" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs">Yêu cầu chuyển trước không còn hợp lệ. Hãy tải lại và chọn ghế mới.</p>
        )}
        {trackerChipBlocked && (
          <p className="rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs leading-5 text-amber-100/90">
            Live Tracker chỉ cho loại khi chip đã về 0. Hãy hoàn tất chip ở Tracker rồi tải lại.
          </p>
        )}
      </section>
    );
  };

  if (!v3.enabled) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Floor Table Control V3 chưa được mở cho môi trường này.
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-3 sm:p-4" data-testid="floor-table-map-v3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Bàn đang sử dụng</h2>
          <p className="mt-1 text-xs text-muted-foreground">Mỗi bàn hiển thị một phiên đang hoạt động của giải này.</p>
        </div>
        <div className="flex gap-2">
          <Button data-ops-action="floor.tables.refresh" size="sm" variant="outline" className="min-h-12" disabled={loading || busy} onClick={() => void load()}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Làm mới</Button>
          <Button data-ops-action="floor.tables.open_table_dialog" size="sm" className="min-h-12" disabled={busy} onClick={() => setOpenTable(true)}><Plus className="mr-2 h-4 w-4" /> Mở bàn</Button>
          {FEATURES.floorRedrawSeatLockV1 && (
            <Button data-ops-action="floor.redraw.open" size="sm" variant="outline" className="min-h-12" disabled={busy || tables.length === 0} onClick={() => setRedrawOpen(true)}><Shuffle className="mr-2 h-4 w-4" /> Redraw</Button>
          )}
        </div>
      </div>

      {loadError && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{loadError}</p>}
      {secondaryLoadError && <p role="status" className="rounded-xl border border-amber-400/35 bg-amber-400/10 p-3 text-sm text-amber-100">{secondaryLoadError}</p>}
      {operationError && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{operationError}</p>}

      {loading ? (
        <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Đang tải danh sách bàn…</div>
      ) : tables.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Chưa có bàn đang hoạt động. Chọn “Mở bàn” để lấy một bàn vật lý còn trống.</div>
      ) : (
        <FloorTableRosterIndex tables={tableIndex} onOpen={(tableId) => {
          // The sheet may have been closed across a server-only mode transition.
          // Read once at entry; never require a failed write to discover new fences.
          void load(true).then((verified) => {
            if (verified) { setSelectedTableId(tableId); setSelectedSeatNumber(null); }
          });
        }} />
      )}

      <p className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/90">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        Live Tracker chỉ nhận thao tác khi đúng phiên bàn hiện tại. Floor không tự chuyển sang writer cũ nếu phiên đã thay đổi.
      </p>

      {actorId && moveTarget?.scope === selectedSessionScope && (
        <MovePlayerDialog actorId={actorId} open={moveOpen}
          onOpenChange={setMoveOpen} tournamentId={tournament.id} entryId={moveTarget.entryId}
          playerName={moveTarget.playerName} currentTournamentTableId={moveTarget.tableId}
          currentSeatNumber={moveTarget.seatNumber} onMoved={() => void load(true)} />
      )}
      <OpenTableDialog open={openTable} onOpenChange={setOpenTable} tournamentId={tournament.id} onDone={() => void load()} />
      <RestoreBustDialog actorId={actorId} tournamentId={tournament.id} target={restoreTarget?.scope === selectedSessionScope ? restoreTarget : null}
        onClose={() => setRestoreTarget(null)}
        onRestored={() => { setEntrySelection(null); toast.success("Đã khôi phục người chơi vào ghế."); void load(); }} />
      {FEATURES.floorRedrawSeatLockV1 && (
        <FloorRedrawDialogV1
          open={redrawOpen}
          onOpenChange={setRedrawOpen}
          tournamentId={tournament.id}
          tables={tables}
          client={v3}
          onApplied={async () => { await load(); }}
        />
      )}

      <Sheet open={selectedTable !== null} onOpenChange={(open) => { if (!open) setSelectedTableId(null); }}>
        <SheetContent
          side="right"
          closeLabel="Đóng danh sách bàn"
          closeButtonClassName="top-0"
          className="operations-typography h-[100dvh] w-full overflow-y-auto overscroll-contain pl-[max(1rem,calc(env(safe-area-inset-left)+0.5rem))] pr-[max(1rem,calc(env(safe-area-inset-right)+0.5rem))] pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-xl sm:p-6"
        >
          {selectedTable && (
            <>
              <SheetHeader className="pr-14 text-left">
                <SheetTitle>Bàn {selectedTable.tableNumber} · {selectedTable.seats.length}/{selectedTable.maxSeats}</SheetTitle>
                <SheetDescription className="sr-only">Danh sách ghế và thao tác của Bàn {selectedTable.tableNumber}</SheetDescription>
                <button
                  type="button"
                  data-ops-action="floor.tables.open_v3_control_mode"
                  className="inline-flex min-h-12 w-fit items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  aria-expanded={modeOpen}
                  aria-controls="floor-v3-mode-panel"
                  onClick={() => setModeOpen((open) => !open)}
                >
                  {selectedTable.controlMode === "tracker" ? <RadioTower className="h-4 w-4 text-sky-300" /> : <UsersRound className="h-4 w-4 text-emerald-300" />}
                  {selectedTable.controlMode === "tracker" ? "Live Tracker" : "Manual Floor"}
                  <span className="text-muted-foreground">· Đổi chế độ</span>
                </button>
                <details className="w-fit text-left text-xs text-muted-foreground">
                  <summary className="min-h-12 cursor-pointer content-center rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">Thông tin phiên bàn</summary>
                  <p className="font-mono">Revision {selectedTable.sessionRevision} · epoch {selectedTable.controlEpoch}</p>
                </details>
              </SheetHeader>
              <div className="mt-5 space-y-4">
                <FloorTableControlModeControl actorId={actorId}
                  key={JSON.stringify([actorId, tournament.id, selectedTable.tournamentTableId, selectedTable.tableSessionId])}
                  tournamentId={tournament.id}
                  table={{
                    tt_id: selectedTable.tournamentTableId, table_name: selectedTable.tableName,
                    table_session_id: selectedTable.tableSessionId,
                    floor_control_mode: selectedTable.controlMode,
                    floor_control_revision: selectedTable.sessionRevision,
                    control_epoch: selectedTable.controlEpoch,
                  }}
                  expanded={modeOpen}
                  disabledReason={busy || loading || loadError ? (loadError ?? "Đang xác minh dữ liệu bàn.") : null}
                  onChanged={() => load(true)}
                />

                <div className="space-y-4">
                  {selectedSeat ? seatAction(selectedSeat) : selectedSeatNumber != null && selectedSeatLock ? (
                    <section className="space-y-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
                      <div className="flex items-start gap-2">
                        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-amber-100">Ghế {selectedSeatNumber} đang khóa</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{selectedSeatLock.reason}</p>
                        </div>
                      </div>
                      <Button
                        data-ops-action="floor.seat.unlock"
                        variant="outline"
                        className="min-h-12 w-full"
                        disabled={busy}
                        onClick={() => void run("Đã mở khóa ghế.", () => v3.setSeatLock({
                          tournamentTableId: selectedTable.tournamentTableId,
                          seatNumber: selectedSeatNumber,
                          locked: false,
                          reason: "operator_unlock",
                          expectedRevision: selectedTable.sessionRevision,
                          requestId: crypto.randomUUID(),
                        }))}
                      >
                        <UnlockKeyhole className="mr-2 h-4 w-4" /> Mở khóa ghế
                      </Button>
                    </section>
                  ) : selectedSeatNumber != null && (
                    <section className="space-y-3 rounded-xl border border-border bg-card/55 p-3">
                      <p className="text-sm font-semibold">Ghế {selectedSeatNumber} đang trống</p>
                      <p className="text-xs text-muted-foreground">Danh sách chỉ gồm entry hợp lệ của giải. Chọn “Đã loại” để khôi phục.</p>
                      <FloorEntryPicker
                        seatableEntries={seatableEntries}
                        restorableEntries={restorableEntries}
                        value={entrySelection}
                        onChange={setEntrySelection}
                      />
                      {FEATURES.floorRedrawSeatLockV1 && (
                        <div className="space-y-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
                          <label className="grid gap-1 text-xs text-muted-foreground">
                            Lý do khóa ghế
                            <input
                              value={lockReason}
                              maxLength={200}
                              onChange={(event) => setLockReason(event.target.value)}
                              className="h-12 rounded-xl border border-white/10 bg-background px-3 text-base text-foreground"
                            />
                          </label>
                          <Button
                            data-ops-action="floor.seat.lock"
                            variant="outline"
                            className="min-h-12 w-full border-amber-400/30 text-amber-200"
                            disabled={busy || lockReason.trim().length < 2}
                            onClick={() => void run("Đã khóa ghế.", () => v3.setSeatLock({
                              tournamentTableId: selectedTable.tournamentTableId,
                              seatNumber: selectedSeatNumber,
                              locked: true,
                              reason: lockReason.trim(),
                              expectedRevision: selectedTable.sessionRevision,
                              requestId: crypto.randomUUID(),
                            }))}
                          >
                            <LockKeyhole className="mr-2 h-4 w-4" /> Khóa ghế này
                          </Button>
                        </div>
                      )}
                      {entrySelection?.kind === "restore" ? (
                        <Button
                          data-ops-action="floor.players.restore"
                          className="min-h-12 w-full"
                          disabled={busy}
                          onClick={() => setRestoreTarget({
                            scope: selectedSessionScope,
                            entryId: entrySelection.entryId,
                            name: restorableEntries.find((entry) => entry.entryId === entrySelection.entryId)?.displayName ?? "Người chơi",
                            destination: { tableId: selectedTable.tournamentTableId, seatNumber: selectedSeatNumber },
                          })}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" /> Khôi phục vào ghế này
                        </Button>
                      ) : (
                        <Button
                          data-ops-action="floor.tables.add_player"
                          className="min-h-12 w-full"
                          disabled={busy || !entrySelection}
                          onClick={() => {
                            if (!entrySelection) return;
                            void run("Đã thêm người vào ghế.", () => v3.assignEntryToSeat({
                              entryId: entrySelection.entryId,
                              tournamentTableId: selectedTable.tournamentTableId,
                              seatNumber: selectedSeatNumber,
                              expectedRevision: selectedTable.sessionRevision,
                              requestId: crypto.randomUUID(),
                            })).then((ok) => { if (ok) setEntrySelection(null); });
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4" /> Thêm vào ghế này
                        </Button>
                      )}
                    </section>
                  )}
                </div>

                <FloorSeatRoster
                  seats={selectedRosterSeats}
                  maxSeats={selectedTable.maxSeats}
                  seatLocks={selectedTable.seatLocks}
                  onSeatTap={(seatNumber) => setSelectedSeatNumber(seatNumber)}
                  onEmptySeatTap={(seatNumber) => setSelectedSeatNumber(seatNumber)}
                  onLockedSeatTap={FEATURES.floorRedrawSeatLockV1 ? (seatNumber) => setSelectedSeatNumber(seatNumber) : undefined}
                />

                <section className="grid gap-2 sm:grid-cols-2">
                  <Button data-ops-action="floor.tables.open_close_table" variant="outline" className="min-h-12" disabled={busy || selectedTable.seats.length !== 0} onClick={() => { setPendingActionScope(selectedWriteScope); setPendingTableAction("close"); }}>Đóng bàn trống</Button>
                  <Button
                    data-ops-action="floor.tables.open_break_v3"
                    variant="outline"
                    className="min-h-12"
                    disabled={busy || breakPlanLoading || selectedTable.seats.length === 0}
                    onClick={async () => {
                      const planScope = selectedWriteScope;
                      setPendingActionScope(planScope);
                      setPendingTableAction("break");
                      setBreakPlan(null);
                      setBreakPlanError(null);
                      if (!v3.redrawSeatLockEnabled) return;
                      setBreakPlanLoading(true);
                      try {
                        const plan = await v3.planBreakTable({
                          tournamentTableId: selectedTable.tournamentTableId,
                          expectedRevision: selectedTable.sessionRevision,
                          drawMode: "fill_lowest_table",
                        });
                        if (selectedWriteScopeRef.current !== planScope) return;
                        if (plan.ok === true) setBreakPlan(plan.data);
                        else setBreakPlanError(v3ErrorMessage(plan.error));
                      } catch {
                        if (selectedWriteScopeRef.current === planScope) setBreakPlanError("Mất kết nối khi lập phương án chuyển. Chưa có thay đổi nào được ghi.");
                      } finally {
                        if (selectedWriteScopeRef.current === planScope) setBreakPlanLoading(false);
                      }
                    }}
                  >Đóng & chuyển người</Button>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={pendingFreeSitSeat !== null && actionIsCurrent} onOpenChange={(open) => { if (!open) setPendingFreeSitSeat(null); }}>
        <AlertDialogContent className="operations-typography box-border max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-xl p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Cho người chơi rời ghế?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="min-w-0 space-y-3 text-left text-sm">
                <p>Người chơi vẫn trong giải, giữ nguyên chip và trở về danh sách chờ xếp ghế.</p>
                {selectedTable && pendingFreeSitSeat && (
                  <dl className="min-w-0 space-y-2 rounded-lg border border-border bg-card/55 p-3 text-sm text-foreground">
                    <div><dt className="text-xs text-muted-foreground">Người chơi</dt><dd className="break-all font-semibold">{pendingFreeSitSeat.displayName}</dd></div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1"><div><dt className="text-xs text-muted-foreground">Vị trí</dt><dd>Bàn {selectedTable.tableNumber} · Ghế {pendingFreeSitSeat.seatNumber}</dd></div><div><dt className="text-xs text-muted-foreground">Entry</dt><dd>{pendingFreeSitSeat.entryNo}</dd></div><div><dt className="text-xs text-muted-foreground">Chip giữ lại</dt><dd>{formatStack(pendingFreeSitSeat.chipCount)}</dd></div></div>
                  </dl>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-ops-action="floor.player.cancel_free_sit" className="min-h-12">Giữ ghế</AlertDialogCancel>
            <AlertDialogAction
              data-ops-action="floor.player.free_sit"
              className="min-h-12"
              disabled={busy || !selectedTable || !pendingFreeSitSeat}
              onClick={async (event) => {
                event.preventDefault();
                if (!actionIsCurrent || !selectedTable || !pendingFreeSitSeat) return;
                const seat = pendingFreeSitSeat;
                const ok = await run("Đã cho người chơi rời ghế; chip được giữ nguyên.", () => v3.freeSitPlayer({
                  entryId: seat.entryId,
                  expectedRevision: selectedTable.sessionRevision,
                  expectedControlEpoch: selectedTable.controlEpoch,
                  expectedChipCount: seat.chipCount,
                  requestId: crypto.randomUUID(),
                  reason: "floor_v3_operator_free_sit",
                }));
                if (ok) setPendingFreeSitSeat(null);
              }}
            >
              Xác nhận rời ghế
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingBustSeat !== null && actionIsCurrent} onOpenChange={(open) => { if (!open) setPendingBustSeat(null); }}>
        <AlertDialogContent className="operations-typography box-border max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-xl p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Loại người chơi khỏi giải?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="min-w-0 space-y-3 text-left text-sm">
                <p>Người chơi sẽ rời bàn và được ghi nhận đã bị loại. Không trả thưởng ở bước này.</p>
                {selectedTable && pendingBustSeat && (
                  <dl className="min-w-0 space-y-2 rounded-lg border border-border bg-card/55 p-3 text-sm text-foreground">
                    <div><dt className="text-xs text-muted-foreground">Người chơi</dt><dd className="break-all font-semibold">{pendingBustSeat.displayName}</dd></div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1"><div><dt className="text-xs text-muted-foreground">Vị trí</dt><dd>Bàn {selectedTable.tableNumber} · Ghế {pendingBustSeat.seatNumber}</dd></div><div><dt className="text-xs text-muted-foreground">Entry</dt><dd>{pendingBustSeat.entryNo}</dd></div><div><dt className="text-xs text-muted-foreground">Chip</dt><dd>{formatStack(pendingBustSeat.chipCount)}</dd></div></div>
                  </dl>
                )}
                {selectedTable?.controlMode === "manual" && (pendingBustSeat?.chipCount ?? 0) > 0 && (
                  <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-amber-100/90">Người chơi còn chip. Vui lòng kiểm tra trước khi loại.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-ops-action="floor.player.cancel_bust" className="min-h-12">Giữ người chơi</AlertDialogCancel>
            <AlertDialogAction
              data-ops-action="floor.player.bust"
              className="min-h-12 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy || !selectedTable || !pendingBustSeat}
              onClick={async (event) => {
                event.preventDefault();
                if (!actionIsCurrent || !selectedTable || !pendingBustSeat) return;
                const seat = pendingBustSeat;
                const ok = await run("Đã loại người chơi khỏi giải.", () => v3.bustPlayer({
                  entryId: seat.entryId,
                  expectedRevision: selectedTable.sessionRevision,
                  expectedControlEpoch: selectedTable.controlEpoch,
                  expectedChipCount: seat.chipCount,
                  requestId: crypto.randomUUID(),
                  reason: "floor_v3_operator_bust",
                }));
                if (ok) setPendingBustSeat(null);
              }}
            >
              Xác nhận loại
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingTableAction !== null && actionIsCurrent} onOpenChange={(open) => { if (!open) setPendingTableAction(null); }}>
        <AlertDialogContent className="operations-typography box-border max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-xl p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingTableAction === "break" ? "Đóng và chuyển toàn bộ người chơi?" : "Đóng bàn trống?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTableAction === "break"
                ? `Kiểm tra vị trí mới của từng người trước khi xác nhận.`
                : `Đóng Bàn ${selectedTable?.tableNumber ?? ""} để giải khác có thể sử dụng?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingTableAction === "break" && (
            <div className="min-w-0 space-y-2" aria-live="polite">
              {v3.redrawSeatLockEnabled ? (
                <>
                  {breakPlanLoading && <p className="text-sm text-muted-foreground">Đang lập phương án chuyển…</p>}
                  {breakPlan?.moves.map((move) => (
                    <div key={move.entryId} className="grid min-w-0 grid-cols-[1fr_auto] gap-3 rounded-lg border border-border p-3 text-sm">
                      <span className="min-w-0 truncate">{move.playerName} · Ghế {move.sourceSeatNumber}</span>
                      <span className="text-right font-medium">Bàn {move.destinationTableNumber} · Ghế {move.destinationSeatNumber}<br/><small className="text-muted-foreground">{move.transferMode === "after_current_hand" ? "Chuyển sau ván" : "Chuyển ngay"}</small></span>
                    </div>
                  ))}
                  {breakPlanError && <p role="alert" className="text-sm text-destructive">{breakPlanError}</p>}
                  {breakPlan?.blockers?.map((blocker) => (
                    <p key={`${blocker.sourceSeatNumber}:${blocker.reason}`} role="alert" className="text-sm text-destructive">
                      {blocker.playerName} · Ghế {blocker.sourceSeatNumber}: {blocker.reason === "missing_entry" ? "Chưa xác định lượt đăng ký. Cần sửa dữ liệu trước khi chuyển." : "Chưa có ghế đích phù hợp; kiểm tra sức chứa, ghế khóa và chuyển ghế đang chờ."}
                    </p>
                  ))}
                  {breakPlan && !breakPlan.complete && <p role="alert" className="text-sm text-destructive">Chưa có phương án đầy đủ. Bàn sẽ không bị đóng.</p>}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Hệ thống sẽ kiểm tra sức chứa và chuyển người trước khi đóng bàn.</p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-ops-action="floor.tables.cancel_close_table" className="min-h-12">Huỷ</AlertDialogCancel>
            {pendingTableAction === "break" ? (
              <AlertDialogAction
                data-ops-action="floor.tables.break_v3"
                className="min-h-12"
                disabled={busy || !selectedTable || (v3.redrawSeatLockEnabled && !breakPlan?.complete)}
                 onClick={async (event) => {
                   event.preventDefault();
                   if (!actionIsCurrent || !selectedTable) return;
                   const ok = await run((data) => data.break_pending === true
                     ? "Đã lưu yêu cầu chuyển người. Bàn còn mở đến khi các lượt chuyển hoàn tất."
                     : "Đã đóng và chuyển người chơi.", async () => {
                     const result = await v3.breakTournamentTable({
                     tournamentTableId: selectedTable.tournamentTableId,
                     expectedRevision: selectedTable.sessionRevision,
                     requestId: crypto.randomUUID(),
                     drawMode: "fill_lowest_table",
                     planHash: breakPlan?.planHash,
                     });
                     if (result.ok === false || !v3.redrawSeatLockEnabled) return result;
                     const receipt = parseCanonicalCloseResult(result.data, {
                       tournamentTableId: selectedTable.tournamentTableId,
                       tableSessionId: selectedTable.tableSessionId,
                       activeSeatCount: selectedTable.seats.length,
                     });
                     return receipt.kind === "error" ? { ok: false as const, error: receipt.code } : result;
                   });
                   if (ok) setPendingTableAction(null);
                 }}
              >
                Xác nhận đóng & chuyển
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                data-ops-action="floor.tables.close_table"
                className="min-h-12"
                disabled={busy || !selectedTable}
                 onClick={async (event) => {
                   event.preventDefault();
                   if (!actionIsCurrent || !selectedTable) return;
                   const ok = await run("Đã đóng bàn và giải phóng bàn vật lý.", async () => {
                     const result = await v3.closeTournamentTable({
                     tournamentTableId: selectedTable.tournamentTableId,
                     expectedRevision: selectedTable.sessionRevision,
                     requestId: crypto.randomUUID(),
                     });
                     if (result.ok === false) return result;
                     const receipt = parseCanonicalCloseResult(result.data, {
                       tournamentTableId: selectedTable.tournamentTableId,
                       tableSessionId: selectedTable.tableSessionId,
                       activeSeatCount: 0,
                     });
                     return receipt.kind === "closed" ? result
                       : { ok: false as const, error: receipt.kind === "error" ? receipt.code : "invalid_response" };
                   });
                   if (ok) setPendingTableAction(null);
                 }}
              >
                Xác nhận đóng bàn
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
