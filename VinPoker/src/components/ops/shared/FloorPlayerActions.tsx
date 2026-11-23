import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MovePlayerDialog } from "@/components/cashier/tournament-live/MovePlayerDialog";
import { toast } from "sonner";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { ClubPlayerPortrait } from "@/components/players/ClubPlayerPortrait";
import { PlayerActionSheets } from "@/components/ops/shared/PlayerActionSheets";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";
import { fetchCurrentFloorSeatTicketWithClient } from "@/components/tournament/seat/floorSeatTicketCore";
import { type MapSeat } from "@/components/ops/shared/floorAdapter";
import type { MockSeat } from "@/components/ops/mock/opsData";
import type { UseFloorSeats } from "@/components/ops/shared/useFloorSeats";
import { preflightFloorSeatEntry } from "@/components/ops/shared/floorSeatEntryPreflight";
import { floorOpsErrorMessage, floorOpsFunctionErrorCode } from "@/lib/floorOpsErrors";
import { findFloorTableControlRow } from "@/lib/floorTableControlMode";

type UnappliedFloorRpcResult = { data: unknown; error: { message?: string; code?: string } | null };
/**
 * FloorPlayerActions — host DÙNG CHUNG cho luồng thao tác người chơi trên floor (màn Bàn + cockpit).
 * Giữ TOÀN BỘ state ghi + handler money-path (Sửa chip / Loại / Chuyển / Phiếu) + render
 * PlayerActionSheets + SeatReceiptDialog ở MỘT NƠI DUY NHẤT — được lift NGUYÊN VĂN từ OpsTables
 * (chỉ đổi nguồn biến: playerReal→target.real, tourId/user/floor.reload/selectedTour → props).
 *
 * Chỉ nhận target là GHẾ ĐANG NGỒI (đang chơi, có `MapSeat` thật). Người đã busted KHÔNG có ghế
 * active → hiển thị read-only ở danh sách, KHÔNG đưa vào đây (tránh sửa chip "hồi sinh"/move fail).
 */
export interface FloorSeatTarget {
  seat: MockSeat;   // presentational (PlayerActionSheets)
  tableNo: number;
  real: MapSeat;    // identity ghế THẬT để ghi update_seats / move / receipt
}

export function FloorPlayerActions({
  actorId, tournamentId, tournamentName, tournamentDate, floor, target, onClose,
}: {
  actorId: string | null;
  tournamentId: string | null;
  tournamentName: string;
  tournamentDate: string | null;
  floor: UseFloorSeats;
  target: FloorSeatTarget | null;
  onClose: () => void;
}) {
  const supabase = useSupabaseClient();
  const [moveEntry, setMoveEntry] = useState<{ scope: string; entryId: string; playerName: string; tableId: string; seatNumber: number } | null>(null);
  // Keep committed-result dialogs across ordinary roster revisions, but never
  // carry a writer or late lookup into a reopened/reassigned incarnation.
  const intentTable = findFloorTableControlRow(floor.tables, target?.real.table_id ?? moveEntry?.tableId);
  const moveScope = JSON.stringify([actorId, tournamentId, intentTable?.tt_id,
    intentTable?.table_session_id, intentTable?.control_epoch]);
  const currentMoveScope = useRef(moveScope);
  currentMoveScope.current = moveScope;
  const moveRun = useRef<object | null>(null);
  const receiptRun = useRef<object | null>(null);
  const bustInfoRun = useRef<object | null>(null);
  const bustWriteRun = useRef<object | null>(null);
  useEffect(() => () => { moveRun.current = null; receiptRun.current = null;
    bustInfoRun.current = null; bustWriteRun.current = null; }, [moveScope]);
  const untypedFloorRpc = useMemo(
    () => supabase.rpc.bind(supabase) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<UnappliedFloorRpcResult>,
    [supabase],
  );
  const real = target?.real ?? null;
  const readOnlyRef = useRef(floor.readOnlyReason);
  readOnlyRef.current = floor.readOnlyReason;
  const bustTable = useMemo(
    () => findFloorTableControlRow(floor.tables, real?.table_id),
    [floor.tables, real?.table_id],
  );
  const chipEditDisabledReason = !real
    ? null
    : !bustTable
      ? "Không xác minh được chế độ bàn. Hãy tải lại trước khi sửa chip."
      : bustTable.floor_control_mode === "tracker"
        ? "Bàn Live Tracker do Tracker quản lý chip."
        : null;
  const [bustInfo, setBustInfo] = useState<{ loading: boolean; place: number | null; prize: number | null } | null>(null);
  const [receiptData, setReceiptData] = useState<SeatReceiptData | null>(null);
  const receiptDataScope = useRef<string | null>(null);
  useEffect(() => { setMoveEntry(null); setReceiptData(null); setBustInfo(null); }, [moveScope]);

  const verifyActiveEntry = useCallback(async (): Promise<boolean> => {
    if (!real || !tournamentId) {
      toast.error("Thiếu dữ liệu ghế — mở lại người chơi.");
      return false;
    }
    try {
      const { data, error } = await supabase.from("tournament_seats")
        .select("id, entry_id, is_active")
        .eq("id", real.seat_id)
        .eq("tournament_id", tournamentId)
        .maybeSingle();
      if (error) {
        toast.error("Không kiểm tra được lượt đăng ký của ghế. Hãy tải lại trước khi thao tác.");
        return false;
      }
      const result = preflightFloorSeatEntry(data);
      if (result.ok === false) {
        toast.error(floorOpsErrorMessage(result.error, "Không thể xác minh lượt đăng ký của ghế."));
        return false;
      }
      return true;
    } catch {
      toast.error("Không kiểm tra được lượt đăng ký của ghế. Hãy tải lại trước khi thao tác.");
      return false;
    }
  }, [real, supabase, tournamentId]);

  // Sửa chip qua Edge với compare-and-set theo chip hiện tại; không cập nhật lạc hậu ở client.
  const saveChip = useCallback(async (newChip: number): Promise<boolean> => {
    if (readOnlyRef.current) { toast.error(readOnlyRef.current); return false; }
    if (!real || !tournamentId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    if (!bustTable) {
      toast.error("Không xác minh được chế độ bàn. Hãy tải lại trước khi sửa chip.");
      return false;
    }
    if (bustTable.floor_control_mode === "tracker") {
      toast.error("Bàn Live Tracker do Tracker quản lý chip.");
      return false;
    }
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId,
          action: "update_seats",
          seats: [{
            seat_id: real.seat_id, player_id: real.player_id, entry_number: real.entry_number,
            table_id: real.table_id, seat_number: real.seat_number,
            expected_chip_count: real.chip_count ?? 0, chip_count: newChip,
            is_active: true, player_name: real.player_name,
          }],
        },
      });
      const code = await floorOpsFunctionErrorCode(data, error);
      if (code) { toast.error(floorOpsErrorMessage(code, "Sửa chip thất bại")); return false; }
      toast.success(`Đã cập nhật chip ${real.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Sửa chip thất bại");
      return false;
    }
  }, [real, tournamentId, floor, bustTable, supabase]);

  // Loại qua Edge/RPC nguyên tử, audit-only: luồng này không gọi payout dù một
  // feature flag khác có thay đổi trong tương lai.
  const openBust = useCallback(async (): Promise<boolean> => {
    if (readOnlyRef.current) return false;
    const operation = {}; bustInfoRun.current = operation;
    const isCurrent = () => currentMoveScope.current === moveScope
      && bustInfoRun.current === operation && !readOnlyRef.current;
    if (!real || !tournamentId) return false;
    if (!bustTable) {
      toast.error("Không xác minh được chế độ bàn. Hãy tải lại trước khi loại.");
      return false;
    }
    if (bustTable.floor_control_mode === "tracker" && real.chip_count > 0) {
      toast.error("Bàn Live Tracker chỉ cho phép loại khi chip đã về 0.");
      return false;
    }
    if (!await verifyActiveEntry()) return false;
    if (!isCurrent()) return false;
    setBustInfo({ loading: true, place: null, prize: null });
    try {
      const [seatsRes, prizeRes] = await Promise.all([
        supabase.functions.invoke("tournament-live-draw", { body: { tournament_id: tournamentId, action: "get_seats" } }),
        supabase.from("tournament_prizes").select("position, amount").eq("tournament_id", tournamentId),
      ]);
      if (!isCurrent()) return false;
      const active = (((seatsRes.data as { data?: MapSeat[] } | null)?.data ?? []) as MapSeat[]).filter((x) => x.is_active).length;
      const place = active > 0 ? active : null;
      const prize = place != null ? (((prizeRes.data ?? []) as { position: number; amount: number }[]).find((p) => p.position === place)?.amount ?? null) : null;
      setBustInfo({ loading: false, place, prize });
      return true;
    } catch {
      if (!isCurrent()) return false;
      setBustInfo({ loading: false, place: null, prize: null });
      return true;
    }
  }, [real, tournamentId, bustTable, supabase, verifyActiveEntry, moveScope]);
  const bustPlayer = useCallback(async (): Promise<boolean> => {
    if (readOnlyRef.current) { toast.error(readOnlyRef.current); return false; }
    if (!real || !tournamentId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    const operation = {}; bustWriteRun.current = operation;
    const isCurrent = () => currentMoveScope.current === moveScope && bustWriteRun.current === operation;
    try {
      if (!await verifyActiveEntry()) return false;
      if (!isCurrent()) return false;
      if (readOnlyRef.current) { toast.error(readOnlyRef.current); return false; }
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId, action: "update_seats",
          seats: [{
            seat_id: real.seat_id, player_id: real.player_id, entry_number: real.entry_number,
            table_id: real.table_id, seat_number: real.seat_number,
            expected_chip_count: real.chip_count ?? 0, chip_count: real.chip_count ?? 0,
            is_active: false, player_name: real.player_name,
          }],
        },
      });
      if (!isCurrent()) return false;
      const code = await floorOpsFunctionErrorCode(data, error);
      if (!isCurrent()) return false;
      if (code) { toast.error(floorOpsErrorMessage(code, "Loại thất bại")); return false; }
      toast.success(`Đã loại ${real.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) { if (isCurrent()) toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Loại thất bại"); return false; }
  }, [real, tournamentId, floor, supabase, verifyActiveEntry, moveScope]);

  // Handoff only: canonical dialog re-reads authoritative source/destination before writing.
  const openMove = useCallback(async (): Promise<void> => {
    if (!real || !tournamentId || !actorId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return; }
    const operation = {};
    moveRun.current = operation;
    const scope = moveScope;
    try {
      const { data: seatRow, error: seErr } = await supabase.from("tournament_seats")
        .select("id, entry_id, is_active").eq("id", real.seat_id)
        .eq("tournament_id", tournamentId).eq("player_id", real.player_id)
        .eq("entry_number", real.entry_number).eq("is_active", true).maybeSingle();
      if (currentMoveScope.current !== scope || moveRun.current !== operation) return;
      if (seErr || !seatRow?.entry_id || seatRow.id !== real.seat_id || !seatRow.is_active) {
        toast.error("Không xác minh được lượt đăng ký đang ngồi. Hãy tải lại trước khi chuyển."); return;
      }
      setMoveEntry({ scope, entryId: seatRow.entry_id, playerName: real.player_name || "Người chơi", tableId: real.table_id, seatNumber: real.seat_number });
    } catch {
      if (currentMoveScope.current === scope && moveRun.current === operation)
        toast.error("Không tải được lượt đăng ký. Hãy thử lại trước khi chuyển.");
    }
  }, [real, tournamentId, actorId, moveScope, supabase]);

  // Locate one existing current code through the scoped RPC; reader44
  // then authorizes and proves exact seat incarnation + immutable audited stack.
  // Never invent a code or adopt the live chip snapshot as a ticket.
  const openReceipt = useCallback(async () => {
    const r = target?.real;
    if (!r || !tournamentId || !actorId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return; }
    const operation = {}; receiptRun.current = operation;
    const scope = moveScope;
    setReceiptData(null);
    try {
      const { data: seat, error: seatError } = await supabase.from("tournament_seats")
        .select("id, entry_id, is_active").eq("id", r.seat_id).eq("tournament_id", tournamentId)
        .eq("player_id", r.player_id).eq("entry_number", r.entry_number).eq("is_active", true).maybeSingle();
      if (currentMoveScope.current !== scope || receiptRun.current !== operation) return;
      if (seatError || !seat?.entry_id || seat.id !== r.seat_id || !seat.is_active)
        throw new Error("Không xác minh được lượt đăng ký đang ngồi.");
      const verified = await fetchCurrentFloorSeatTicketWithClient(supabase,
        { actorId, tournamentId, entryId: seat.entry_id }, r.seat_id);
      if (currentMoveScope.current === scope && receiptRun.current === operation) {
        receiptDataScope.current = scope;
        setReceiptData(verified);
      }
    } catch (error) {
      if (currentMoveScope.current === scope && receiptRun.current === operation)
        toast.error(error instanceof Error ? error.message : "Không xác minh được phiếu hiện hành.");
    }
  }, [supabase, target, tournamentId, actorId, moveScope]);

  if (floor.readOnlyReason) return target ? <div role="alert" className="mt-2 text-sm">
    {floor.readOnlyReason} <button type="button" onClick={onClose}>Đóng</button>
  </div> : null;

  return (
    <>
      <PlayerActionSheets
        key={moveScope}
        target={target ? { seat: target.seat, tableNo: target.tableNo, chipCount: target.real.chip_count } : null}
        onClose={() => { setBustInfo(null); onClose(); }}
        onSaveChip={saveChip}
        onBustPlayer={bustPlayer}
        onOpenBust={openBust}
        bustInfo={bustInfo}
        moveTargets={[]}
        onOpenMove={openMove}
        onOpenReceipt={openReceipt}
        portraitEditor={real && tournamentId && actorId ? <ClubPlayerPortrait
          key={JSON.stringify([actorId, tournamentId, real.seat_id, real.player_id])} client={supabase}
          target={{ kind: "seat", tour: tournamentId, seat: real.seat_id, player: real.player_id }}
          name={real.player_name || "người chơi"} /> : undefined}
        infoLive
        bustControlMode={bustTable?.floor_control_mode ?? null}
        chipEditDisabledReason={chipEditDisabledReason}
      />
      <SeatReceiptDialog open={receiptDataScope.current === moveScope && !!actorId && receiptData?.floorSeatContext?.actorId === actorId && receiptData?.floorSeatContext?.tournamentId === tournamentId}
        onOpenChange={(v) => { if (!v) { receiptRun.current = null; setReceiptData(null); } }}
        receipt={receiptDataScope.current === moveScope && actorId && receiptData?.floorSeatContext?.actorId === actorId && receiptData?.floorSeatContext?.tournamentId === tournamentId ? receiptData : null} />
      {moveEntry?.scope === moveScope && tournamentId && <MovePlayerDialog
        actorId={actorId}
        open onOpenChange={(open) => { if (!open) setMoveEntry(null); }}
        tournamentId={tournamentId} entryId={moveEntry.entryId} playerName={moveEntry.playerName}
        currentTournamentTableId={moveEntry.tableId} currentSeatNumber={moveEntry.seatNumber}
        onMoved={() => floor.reload()} />}
    </>
  );
}
