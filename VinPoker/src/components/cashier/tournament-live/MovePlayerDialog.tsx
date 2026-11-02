import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { createFloorTableControlV3Client, type FloorTournamentTableRoster, type FloorTableControlV3Rpc } from "@/lib/floorTableControlV3";
import { readPendingFloorMove, savePendingFloorMove, clearPendingFloorMove, type PendingFloorMove } from "@/lib/floorPendingMoveIntent";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowRightLeft, CheckCircle2, Loader2, ChevronUp, ChevronDown } from "lucide-react";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";

const REASON_PRESETS = ["Cân bàn", "Bàn đóng", "Yêu cầu người chơi", "Khác"] as const;
type ReasonPreset = (typeof REASON_PRESETS)[number];

interface TargetTable {
  id: string;
  tableSessionId: string;
  sessionRevision: number;
  controlEpoch: number;
  tableName: string;
  tableNumber: number | null;
  maxSeats: number;
  activeCount: number;
}

interface OccupiedSeat {
  seat_number: number;
  player_name: string | null;
  entry_id?: string | null;
  locked?: boolean;
}

type MoveResult = {
  ok: boolean;
  error?: string;
  already_there?: boolean;
  queued?: boolean;
  pending_move_id?: string;
  player_name?: string;
  to_table_number?: number | null;
  to_seat_number?: number;
  from_table_number?: number | null;
  from_seat_number?: number | null;
  receipt_code?: string;
  current_stack?: number | null;
  max_seats?: number;
};

function mapError(res: MoveResult | null, rawMessage?: string): string {
  const code = res?.error ?? rawMessage;
  switch (code) {
    case "entry_not_found": return "Không tìm thấy entry của người chơi.";
    case "entry_not_seated": return "Người chơi không còn ở trạng thái đang ngồi.";
    case "actor_not_allowed": return "Tài khoản của bạn không có quyền chuyển ghế cho CLB này.";
    case "no_active_seat": return "Người chơi không có ghế active — kiểm tra Table Draw.";
    case "invalid_destination_table": return "Bàn đích không hợp lệ hoặc đã đóng — tải lại danh sách bàn.";
    case "invalid_seat_number": return `Số ghế không hợp lệ${res?.max_seats ? ` (1–${res.max_seats})` : ""}.`;
    case "seat_occupied": return "Ghế vừa có người khác ngồi — sơ đồ đã được tải lại, chọn ghế khác.";
    default: return code ? `Chuyển ghế thất bại (${code}).` : "Chuyển ghế thất bại.";
  }
}

/**
 * Canonical entry/session move. The server owns seat, stack, reason audit and
 * printable ticket. Unknown outcomes retain the exact intent for explicit replay.
 */
export function MovePlayerDialog({
  actorId, open, onOpenChange, tournamentId,
  entryId, playerName, onMoved,
}: {
  actorId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tournamentId: string;
  entryId: string;
  playerName: string;
  /** Legacy caller hints; current source is always resolved from the canonical roster. */
  currentTournamentTableId: string | null;
  currentSeatNumber: number | null;
  onMoved: () => void;
}) {
  const supabase = useSupabaseClient();
  const readController = useRef<AbortController | null>(null);
  const canonical = useMemo(() => createFloorTableControlV3Client(
    (async (name, args) => {
      const query = supabase.rpc(name as never, args as never);
      return readController.current && ["get_floor_tournament_table_roster_v3", "get_floor_tournament_table_roster_v6", "get_floor_pending_tracker_moves_v1"].includes(name)
        ? query.abortSignal(readController.current.signal) : query;
    }) as FloorTableControlV3Rpc,
  ), [supabase]);
  const loadSequence = useRef(0);
  const scope = `${actorId ?? ""}:${tournamentId}:${entryId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const busy = useRef(false);
  const activeRun = useRef<object | null>(null);
  const currentOpen = useRef(open);
  currentOpen.current = open;
  const attempt = useRef<PendingFloorMove | null>(null);
  const [sourceContext, setSourceContext] = useState<FloorTournamentTableRoster | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [tournamentMeta, setTournamentMeta] = useState<{ name: string; start_time: string | null }>({ name: "Giải đấu", start_time: null });
  const [tables, setTables] = useState<TargetTable[] | null>(null);
  const [occupied, setOccupied] = useState<Record<string, OccupiedSeat[]>>({});
  const [targetTableId, setTargetTableId] = useState<string>("");
  const [targetSeat, setTargetSeat] = useState<number | null>(null);
  const [reasonPreset, setReasonPreset] = useState<ReasonPreset>("Cân bàn");
  const [reasonText, setReasonText] = useState("");
  const [phase, setPhase] = useState<"pick" | "confirm" | "moving" | "done">("pick");
  const [result, setResult] = useState<MoveResult | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const loadState = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setTables(null);
    setReadError(null);
    setSourceContext(null);
    setOccupied({});
    setTargetTableId("");
    setTargetSeat(null);
    if (!actorId) { setReadError("Bạn cần đăng nhập lại trước khi chuyển ghế."); return; }
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    try {
      const [roster, reservations, metadata] = await waitForManualPlayerResponse(Promise.all([
        canonical.getTournamentTableRoster(tournamentId),
        canonical.getPendingTrackerMoves(tournamentId),
        supabase.from("tournaments").select("name, start_time").eq("id", tournamentId).abortSignal(controller.signal).single(),
      ]), 10_000);
      if (sequence !== loadSequence.current || currentScope.current !== scope) return;
      if (roster.ok === false) throw new Error(roster.error);
      if (reservations.ok === false) throw new Error(reservations.error);
      if (metadata.error) throw new Error(metadata.error.message);
      const meta = metadata.data;
      if (!meta || typeof meta.name !== "string" || !meta.name.trim()
        || (meta.start_time !== null && (typeof meta.start_time !== "string" || !Number.isFinite(Date.parse(meta.start_time))))) {
        throw new Error("Không nhận được tên hoặc lịch giải hợp lệ.");
      }
      setTournamentMeta({ name: meta.name, start_time: meta.start_time });
      const occ: Record<string, OccupiedSeat[]> = {};
      const scopedRoster = roster.data.filter((table) => table.tournamentId === tournamentId);
      const sourceSeats = scopedRoster.flatMap((table) => table.seats
        .filter((seat) => seat.entryId === entryId && seat.integrityStatus === "valid")
        .map((seat) => ({ table, seat })));
      if (sourceSeats.length !== 1) throw new Error("Không xác minh được ghế nguồn của entry.");
      const source = sourceSeats[0].table;
      if (reservations.data.some((move) => move.entryId === entryId && move.status === "pending")) {
        throw new Error("Người chơi đang có yêu cầu chuyển ghế chờ xử lý.");
      }
      setSourceContext(source);
      const built = scopedRoster.map((table) => {
        occ[table.tournamentTableId] = [
          ...table.seats.map((seat) => ({ seat_number: seat.seatNumber, player_name: seat.displayName, entry_id: seat.entryId })),
          ...table.seatLocks.map((lock) => ({ seat_number: lock.seatNumber, player_name: "Ghế đang khóa", locked: true })),
          ...reservations.data.filter((move) => move.status === "pending" && move.destinationTournamentTableId === table.tournamentTableId)
            .map((move) => ({ seat_number: move.destinationSeatNumber, player_name: "Ghế đang giữ cho lượt chuyển", locked: true })),
        ];
        return { id: table.tournamentTableId, tableName: table.tableName, tableNumber: table.tableNumber,
          tableSessionId: table.tableSessionId, sessionRevision: table.sessionRevision, controlEpoch: table.controlEpoch,
          maxSeats: table.maxSeats, activeCount: table.seats.length };
      }).sort((a, b) => a.tableNumber - b.tableNumber);
      setOccupied(occ);
      setTables(built);
      if (built.length) setTargetTableId(attempt.current?.scope === scope
        ? attempt.current.intent.toTournamentTableId : source.tournamentTableId);
    } catch (cause) {
      if (sequence !== loadSequence.current || currentScope.current !== scope) return;
      const message = cause instanceof Error ? cause.message : "lỗi tải dữ liệu";
      setReadError(`Không xác minh được phiên bàn. Chưa thể chuyển ghế (${message === "MANUAL_PLAYER_OUTCOME_UNKNOWN" ? "quá 10 giây chưa nhận đủ dữ liệu" : message}).`);
    } finally {
      controller.abort();
      if (readController.current === controller) readController.current = null;
    }
  }, [canonical, supabase, scope, actorId, tournamentId, entryId]);

  useEffect(() => {
    activeRun.current = null;
    busy.current = false;
    if (attempt.current?.scope !== scope) attempt.current = null;
    setWriteError(null);
    if (!open) {
      loadSequence.current++;
      setPhase("pick"); setResult(null); setTables(null); setReceipt(null); setReceiptOpen(false);
      setTargetTableId(""); setTargetSeat(null);
      setReasonPreset("Cân bàn"); setReasonText("");
      return;
    }
    try {
      attempt.current = readPendingFloorMove(scope) ?? attempt.current;
      if (attempt.current && attempt.current.intent.entryId !== entryId) throw new Error("Mã đã lưu không thuộc entry này.");
    } catch (cause) {
      setReadError(cause instanceof Error ? cause.message : "Không đọc được mã yêu cầu đã lưu.");
      setTables(null); setPhase("pick");
      return;
    }
    if (attempt.current) setWriteError("Chưa xác minh kết quả yêu cầu trước. Xác nhận chỉ gửi lại đúng mã và payload đã lưu.");
    setPhase(attempt.current ? "confirm" : "pick"); setResult(null); setReceipt(null); setReceiptOpen(false);
    void loadState();
    return () => { loadSequence.current++; readController.current?.abort(); readController.current = null; activeRun.current = null; busy.current = false; };
  }, [open, loadState]);

  const targetTable = useMemo(
    () => (tables ?? []).find((t) => t.id === targetTableId) ?? null,
    [tables, targetTableId],
  );

  const occupantBySeat = useMemo(() => {
    const m = new Map<number, OccupiedSeat>();
    for (const o of occupied[targetTableId] ?? []) m.set(o.seat_number, o);
    return m;
  }, [occupied, targetTableId]);

  // Seats the operator may pick on the chosen table: free seats, plus the player's
  // OWN current seat (a no-op move). Occupied seats are skipped entirely so the
  // stepper never lands on one (owner 2026-06-16: hide occupied seats, don't warn).
  const selectableSeats = useMemo(() => {
    if (!targetTable) return [] as number[];
    const list: number[] = [];
    for (let n = 1; n <= targetTable.maxSeats; n++) {
      const occupant = occupantBySeat.get(n);
      if (!occupant || (!occupant.locked && occupant.entry_id === entryId)) list.push(n);
    }
    return list;
  }, [targetTable, occupantBySeat, entryId]);

  // When the target table changes, default the seat to the first selectable (free) one.
  // null = the table is full (no selectable seat) → "Tiếp tục" stays disabled.
  useEffect(() => {
    if (!targetTable) return;
    setTargetSeat(attempt.current?.scope === scope ? attempt.current.intent.toSeatNumber : selectableSeats[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTableId, tables]);

  const cycleTable = (dir: number) => {
    if (!tables || tables.length === 0) return;
    const i = Math.max(0, tables.findIndex((t) => t.id === targetTableId));
    const next = (i + dir + tables.length) % tables.length;
    setTargetTableId(tables[next].id);
  };
  const cycleSeat = (dir: number) => {
    if (selectableSeats.length === 0) return;
    const cur = targetSeat ?? selectableSeats[0];
    const i = selectableSeats.indexOf(cur);
    const base = i === -1 ? 0 : i;
    const next = (base + dir + selectableSeats.length) % selectableSeats.length;
    setTargetSeat(selectableSeats[next]);
  };
  // Occupant on the chosen seat that is NOT the player being moved (their own
  // current seat is fine = no-op move). Blocks "Tiếp tục" + warns.
  const seatOccupant = targetSeat != null ? occupantBySeat.get(targetSeat) : undefined;
  const isOwnSeat = !!seatOccupant && !seatOccupant.locked && seatOccupant.entry_id === entryId;
  const seatBlocked = !!seatOccupant && !isOwnSeat;

  const reason = reasonPreset === "Khác" ? reasonText.trim() : reasonPreset;
  const confirmationReason = attempt.current?.scope === scope ? attempt.current.intent.reason : reason;
  const confirmationSourceSeat = attempt.current?.scope === scope ? attempt.current.sourceSeat
    : sourceContext?.seats.find((seat) => seat.entryId === entryId)?.seatNumber;
  const confirmationTargetName = attempt.current?.scope === scope
    ? `Bàn ${attempt.current.toTableNumber ?? "?"}` : targetTable?.tableName;
  const confirmationTargetSeat = attempt.current?.scope === scope
    ? attempt.current.intent.toSeatNumber : targetSeat;

  const runMove = async () => {
    if (busy.current || !actorId || !open) return;
    if (!attempt.current) {
      const sourceSeat = sourceContext?.seats.find((seat) => seat.entryId === entryId);
      if (!sourceContext || !sourceSeat || !targetTable || targetSeat == null || seatBlocked || !reason || readError) return;
      attempt.current = { scope, operation: canonical.deferredTrackerMoveEnabled ? "move_player_seat_v5" : "move_player_seat_v4",
        intent: { entryId, fromTournamentTableId: sourceContext.tournamentTableId,
        fromTableSessionId: sourceContext.tableSessionId, toTournamentTableId: targetTable.id,
        toTableSessionId: targetTable.tableSessionId, toSeatNumber: targetSeat,
        expectedSourceRevision: sourceContext.sessionRevision, expectedDestinationRevision: targetTable.sessionRevision,
        expectedSourceEpoch: sourceContext.controlEpoch, expectedDestinationEpoch: targetTable.controlEpoch,
        reason, requestId: crypto.randomUUID() }, sourceSeat: sourceSeat.seatNumber, stack: sourceSeat.chipCount,
        fromTableNumber: sourceContext.tableNumber, toTableNumber: targetTable.tableNumber, meta: tournamentMeta };
    }
    const frozen = attempt.current;
    if (frozen.scope !== scope) return;
    const operation = {};
    activeRun.current = operation;
    busy.current = true;
    const isCurrent = () => activeRun.current === operation && currentScope.current === scope && currentOpen.current;
    setPhase("moving");
    setWriteError(null);
    try {
      savePendingFloorMove(frozen);
      const response = frozen.operation === "move_player_seat_v5"
        ? await canonical.movePlayerSeatOrQueueExact(frozen.intent)
        : await canonical.movePlayerSeatExact(frozen.intent);
      if (!isCurrent()) return;
      if (response.ok === false) {
        const definitive = ["STALE_STATE", "STALE_CONTROL_EPOCH", "actor_not_allowed", "entry_not_found", "entry_not_seated",
          "no_active_v3_seat", "table_session_mismatch", "table_session_not_active", "seat_occupied", "seat_locked",
          "table_has_active_hand", "destination_table_has_active_hand", "source_table_busy", "destination_hand_not_active",
          "pending_move_conflict", "invalid_seat_number", "tournament_not_open", "invalid_request"].includes(response.error);
        if (!definitive) throw new Error(response.error);
        clearPendingFloorMove(frozen);
        attempt.current = null;
        setWriteError(mapError(null, response.error));
        setPhase("pick");
        await loadState();
        return;
      }
      const raw = response.data;
      const intent = frozen.intent;
      const commonValid = raw.ok === true && raw.entry_id === intent.entryId
        && raw.reason === intent.reason.trim() && raw.request_id === intent.requestId;
      if (raw.queued === true) {
        const queuedValid = frozen.operation === "move_player_seat_v5" && commonValid && raw.already_there !== true
          && typeof raw.pending_move_id === "string" && !!raw.pending_move_id.trim()
          && raw.from_tournament_table_id === intent.fromTournamentTableId
          && raw.from_table_session_id === intent.fromTableSessionId
          && raw.to_tournament_table_id === intent.toTournamentTableId
          && raw.to_table_session_id === intent.toTableSessionId
          && raw.from_seat_number === frozen.sourceSeat && raw.to_seat_number === intent.toSeatNumber
          && raw.receipt_code == null;
        if (!queuedValid) throw new Error("Kết quả đặt chờ không khớp thao tác chuyển ghế.");
        clearPendingFloorMove(frozen);
        setResult(raw as MoveResult);
        setReceipt(null);
        setPhase("done");
        attempt.current = null;
        toast.success("Đã đặt chờ chuyển; người chơi giữ ghế hiện tại đến khi server áp dụng.");
        onMoved();
        return;
      }
      const unchanged = raw.already_there === true;
      const valid = commonValid && (unchanged
        ? intent.fromTournamentTableId === intent.toTournamentTableId && intent.fromTableSessionId === intent.toTableSessionId
          && raw.tournament_table_id === intent.fromTournamentTableId && raw.table_session_id === intent.fromTableSessionId
          && raw.seat_number === intent.toSeatNumber && frozen.sourceSeat === intent.toSeatNumber
          && raw.revision === intent.expectedSourceRevision
        : raw.from_tournament_table_id === intent.fromTournamentTableId && raw.from_table_session_id === intent.fromTableSessionId
          && raw.to_tournament_table_id === intent.toTournamentTableId && raw.to_table_session_id === intent.toTableSessionId
          && raw.from_seat_number === frozen.sourceSeat && raw.to_seat_number === intent.toSeatNumber
          && raw.from_table_number === frozen.fromTableNumber && raw.to_table_number === frozen.toTableNumber
          && raw.current_stack === frozen.stack && typeof raw.receipt_code === "string" && !!raw.receipt_code.trim()
          && typeof raw.player_name === "string" && !!raw.player_name.trim());
      if (!valid) throw new Error("Phiếu trả về không khớp thao tác chuyển ghế.");
      clearPendingFloorMove(frozen);
      const res = raw as MoveResult;
    setResult(res);
    if (res.receipt_code) {
      setReceipt({
        floorSeatContext: { actorId, tournamentId, entryId },
        tournamentName: frozen.meta.name,
        tournamentDate: frozen.meta.start_time,
        playerName: res.player_name ?? playerName,
        tableNumber: res.to_table_number ?? frozen.toTableNumber,
        seatNumber: res.to_seat_number ?? frozen.intent.toSeatNumber,
        receiptCode: res.receipt_code,
        startingStack: res.current_stack ?? null,
        qrValue: res.receipt_code,
      });
    }
    setPhase("done");
    attempt.current = null;
    toast.success(
      res.already_there
        ? "Người chơi đã ở đúng ghế này."
        : `Đã chuyển ${res.player_name ?? playerName} → Bàn ${res.to_table_number ?? "?"} · Ghế ${res.to_seat_number}`,
    );
    onMoved();
    } catch (cause) {
      if (!isCurrent()) return;
      setWriteError(`Chưa xác minh được kết quả chuyển ghế. Thử lại giữ nguyên mã yêu cầu (${cause instanceof Error ? cause.message : "lỗi kết nối"}).`);
      setPhase("confirm");
    } finally {
      if (isCurrent()) { activeRun.current = null; busy.current = false; }
    }
  };

  const close = (v: boolean) => {
    if (busy.current) return;
    onOpenChange(v);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={close}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto sm:mx-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-primary" /> Chuyển ghế — {playerName}
            </SheetTitle>
            <SheetDescription>
              Chuyển qua RPC có kiểm soát: phiếu cũ bị thay thế, phiếu mới được in, lý do được ghi vào lịch sử ghế.
            </SheetDescription>
          </SheetHeader>

          {writeError && <div role="alert" className="text-sm text-destructive">{writeError}</div>}
          {readError && <div className="space-y-2">
            <div role="alert" className="text-sm text-destructive">{readError}</div>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void loadState()}>Tải lại phiên bàn</Button>
          </div>}

          {phase === "pick" && (
            <div className="space-y-3">
              {readError ? null : tables === null ? (
                <Skeleton className="h-40" />
              ) : tables.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Không có bàn active để chuyển tới.</div>
              ) : (
                <>
                  {/* Kholdem-style number steppers: Bàn / Ghế */}
                  <div className="flex justify-center gap-8 py-2">
                    <div className="text-center">
                      <Label className="text-xs text-muted-foreground">Bàn</Label>
                      <Button type="button" variant="outline" aria-label="Bàn kế" className="mt-1 block h-10 w-16" onClick={() => cycleTable(1)} disabled={tables.length < 2}>
                        <ChevronUp className="mx-auto h-5 w-5" />
                      </Button>
                      <div className="py-1 text-3xl font-bold tabular-nums text-primary leading-tight">{targetTable?.tableNumber ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[80px]">{targetTable?.tableName} · {targetTable?.activeCount}/{targetTable?.maxSeats}</div>
                      <Button type="button" variant="outline" aria-label="Bàn trước" className="mt-1 block h-10 w-16" onClick={() => cycleTable(-1)} disabled={tables.length < 2}>
                        <ChevronDown className="mx-auto h-5 w-5" />
                      </Button>
                    </div>
                    <div className="text-center">
                      <Label className="text-xs text-muted-foreground">Ghế</Label>
                      <Button type="button" variant="outline" aria-label="Ghế kế" className="mt-1 block h-10 w-16" onClick={() => cycleSeat(1)} disabled={selectableSeats.length < 2}>
                        <ChevronUp className="mx-auto h-5 w-5" />
                      </Button>
                      <div className={`py-1 text-3xl font-bold tabular-nums leading-tight ${seatBlocked ? "text-destructive" : "text-primary"}`}>{targetSeat ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{targetSeat == null ? "hết ghế" : isOwnSeat ? "ghế hiện tại" : seatBlocked ? "đã có người" : "trống"}</div>
                      <Button type="button" variant="outline" aria-label="Ghế trước" className="mt-1 block h-10 w-16" onClick={() => cycleSeat(-1)} disabled={selectableSeats.length < 2}>
                        <ChevronDown className="mx-auto h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                  {targetSeat == null && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      {targetTable?.tableName ?? "Bàn"} đã đầy — chọn bàn khác.
                    </div>
                  )}
                  {/* Race fallback only: occupied seats are skipped, but if occupancy changed
                      after load the chosen seat can still be taken — keep the guard + warning. */}
                  {seatBlocked && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      Ghế {targetSeat} đã có {seatOccupant?.player_name || "người chơi khác"} — chọn ghế khác.
                    </div>
                  )}
                </>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">Lý do chuyển (bắt buộc — vào lịch sử)</Label>
                <Select value={reasonPreset} onValueChange={(v) => setReasonPreset(v as ReasonPreset)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REASON_PRESETS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                {reasonPreset === "Khác" && (
                  <Input value={reasonText} onChange={(e) => setReasonText(e.target.value)}
                    placeholder="Nhập lý do…" className="h-9" />
                )}
              </div>
            </div>
          )}

          {phase === "confirm" && confirmationTargetName && confirmationTargetSeat != null && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1 text-sm">
              <div className="font-medium">
                {playerName}: {confirmationSourceSeat != null ? `Ghế ${confirmationSourceSeat}` : "ghế đang xác minh"} → {confirmationTargetName} · Ghế {confirmationTargetSeat}
              </div>
              <div className="text-xs text-muted-foreground">Lý do: {confirmationReason}</div>
              <div className="text-xs text-muted-foreground">Server kiểm tra trước khi chuyển. Nếu bàn đích đang chơi ván, yêu cầu có thể được đặt chờ; chỉ có phiếu mới khi chuyển hoàn tất.</div>
            </div>
          )}

          {phase === "moving" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang chuyển ghế…
            </div>
          )}

          {phase === "done" && result && (
            <div className="rounded-md border border-emerald-600/40 bg-emerald-950/20 p-3 text-sm flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {result.queued
                ? "Đã đặt chờ chuyển. Người chơi vẫn ở ghế nguồn; chưa có phiếu mới cho đến khi chuyển hoàn tất."
                : result.already_there
                ? "Người chơi đã ở đúng ghế này — không có gì thay đổi."
                : <>Đã chuyển → Bàn {result.to_table_number ?? "?"} · Ghế {result.to_seat_number}. Phiếu mới: <span className="font-mono">{result.receipt_code}</span></>}
            </div>
          )}

          <SheetFooter className="mt-3 flex-row justify-end gap-2">
            {phase === "pick" && (
              <>
                <Button variant="outline" onClick={() => close(false)}>Quay lại</Button>
                <Button
                  disabled={!sourceContext || !!readError || !targetTable || targetSeat == null || !reason || seatBlocked}
                  onClick={() => setPhase("confirm")}
                >
                  Tiếp tục
                </Button>
              </>
            )}
            {phase === "confirm" && (
              <>
                <Button variant="outline" disabled={!!attempt.current} onClick={() => setPhase("pick")}>Sửa lại</Button>
                <Button onClick={runMove}>
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" /> Xác nhận chuyển
                </Button>
              </>
            )}
            {phase === "done" && (
              <>
                {receipt && !result?.already_there && (
                  <Button variant="outline" onClick={() => setReceiptOpen(true)}>Xem phiếu mới</Button>
                )}
                <Button onClick={() => close(false)}>Đóng</Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <SeatReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen}
        receipt={actorId && receipt?.floorSeatContext?.actorId === actorId ? receipt : null} />
    </>
  );
}
