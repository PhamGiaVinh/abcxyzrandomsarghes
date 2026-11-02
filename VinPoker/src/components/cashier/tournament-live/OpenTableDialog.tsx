import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { FloorTableNumberPicker } from "@/components/ops/shared/FloorTableNumberPicker";
import { FloorTableModePicker } from "@/components/ops/shared/FloorTableModePicker";
import {
  FIXED_FLOOR_TABLE_SEATS,
  type FloorTableCatalogRow,
} from "@/components/ops/shared/floorTablePresentation";
import type { FloorTableControlMode } from "@/lib/floorTableControlMode";
import { FEATURES } from "@/lib/featureFlags";
import {
  createFloorTableControlV3Client,
  type FloorTableControlV3Rpc,
} from "@/lib/floorTableControlV3";

function mapError(code?: string): string {
  switch (code) {
    case "unauthorized": return "Bạn cần đăng nhập lại.";
    case "actor_not_allowed": return "Không có quyền mở bàn cho CLB này.";
    case "tournament_not_open": return "Giải đã kết thúc hoặc đã huỷ.";
    case "table_number_taken": return "Số bàn này đang mở. Hãy tải lại danh sách và chọn số khác.";
    case "invalid_table_number": return "Chỉ được chọn số bàn từ 1 đến 100.";
    case "invalid_floor_control_mode": return "Chế độ kiểm soát bàn không hợp lệ.";
    case "table_has_active_seats": return "Bàn đã đóng vẫn còn ghế hoạt động nên chưa thể mở lại.";
    case "game_table_in_use": return "Bàn vật lý này đang được một giải khác sử dụng.";
    case "game_table_not_available": return "Bàn này đang bảo trì hoặc không sẵn sàng.";
    case "table_preflight_required": return "Bàn chưa qua kiểm tra V3 nên chưa thể mở.";
    case "FLOOR_TABLE_CONTROL_V3_DISABLED": return "Table Control V3 hiện chưa được mở cho môi trường này.";
    case "table_mode_apply_failed": return "Không thể xác nhận chế độ của bàn. Không có bàn mới nào được mở.";
    default: return "Mở bàn thất bại. Hãy tải lại và thử lại.";
  }
}

interface OpenTableResult {
  ok?: boolean;
  error?: string;
  table_number?: number;
  reopened?: boolean;
  floor_control_mode?: FloorTableControlMode;
}

/**
 * Responsive Floor table opener. The picker is a read-only preflight over the
 * 1–100 catalog; floor_open_tournament_table_v2 revalidates the number, fixed
 * nine-seat layout, authorization and control mode in one database transaction.
 */
export function OpenTableDialog({
  open,
  onOpenChange,
  tournamentId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  tournamentId: string;
  onDone: () => void;
}) {
  const supabase = useSupabaseClient();
  const [catalog, setCatalog] = useState<FloorTableCatalogRow[]>([]);
  const [unconfiguredTables, setUnconfiguredTables] = useState<string[]>([]);
  const [repairTables, setRepairTables] = useState<string[]>([]);
  const [v3GameTableIdByNumber, setV3GameTableIdByNumber] = useState<Record<number, string>>({});
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [controlMode, setControlMode] = useState<FloorTableControlMode>("manual");
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const requestSequence = useRef(0);
  const tableControlV3 = useMemo(
    () => createFloorTableControlV3Client(
      ((name, args) => (
        supabase.rpc as unknown as FloorTableControlV3Rpc
      )(name, args)),
    ),
    [supabase],
  );

  const loadCatalog = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoadingCatalog(true);
    setCatalogError(null);
    setUnconfiguredTables([]);
    setRepairTables([]);
    try {
      if (tableControlV3.enabled) {
        if (tableControlV3.redrawSeatLockEnabled) {
          const inventory = await tableControlV3.getTournamentTableInventory(tournamentId);
          if (sequence !== requestSequence.current) return;
          if (inventory.ok === false) {
            setCatalog([]);
            setV3GameTableIdByNumber({});
            setCatalogError(inventory.error === "actor_not_allowed" || inventory.error.includes("access_denied")
              ? "Tài khoản này không có quyền xem kho bàn của giải."
              : inventory.error.includes("NETWORK")
                ? "Mất kết nối khi tải kho bàn. Hãy kiểm tra mạng và thử lại."
                : "Không tải được kho bàn. Hãy tải lại; nếu lỗi còn tiếp diễn, dữ liệu phiên bàn cần được kiểm tra.");
            return;
          }
          const tableIds: Record<number, string> = {};
          for (const item of inventory.data) if (item.tableNumber != null) tableIds[item.tableNumber] = item.gameTableId;
          setV3GameTableIdByNumber(tableIds);
          const repairs = inventory.data.filter((item) => item.availabilityStatus === "repair_required");
          setUnconfiguredTables([
            ...inventory.data.filter((item) => item.tableNumber == null).map((item) => item.tableName || "Bàn chưa chuẩn hóa"),
          ]);
          setRepairTables(repairs.map((item) => `Bàn ${item.tableNumber ?? "?"}`));
          setCatalog(inventory.data.map((item) => ({
            table_number: item.tableNumber,
            status: item.availabilityStatus === "current_tournament" ? "active" : null,
            availability_status: item.availabilityStatus === "current_tournament" ? "in_use" : item.availabilityStatus,
            session_type: item.availabilityStatus === "current_tournament" ? "tournament" : null,
            operational_status: item.operationalStatus,
          })));
          return;
        }
        const { data: tournament, error: tournamentError } = await supabase
          .from("tournaments")
          .select("club_id")
          .eq("id", tournamentId)
          .single();
        if (sequence !== requestSequence.current) return;
        if (tournamentError || !tournament?.club_id) {
          setCatalog([]);
          setV3GameTableIdByNumber({});
          setCatalogError("Không xác định được CLB của giải. Không thể mở bàn V3.");
          return;
        }
        const inventory = await tableControlV3.getClubTableInventory(tournament.club_id);
        if (sequence !== requestSequence.current) return;
        if (!inventory.ok) {
          setCatalog([]);
          setV3GameTableIdByNumber({});
          setCatalogError("Không tải được kho bàn vật lý V3. Không thể mở bàn cho tới khi tải lại thành công.");
          return;
        }
        const tableIds: Record<number, string> = {};
        for (const item of inventory.data) if (item.tableNumber != null) tableIds[item.tableNumber] = item.gameTableId;
        setV3GameTableIdByNumber(tableIds);
        setUnconfiguredTables(inventory.data.filter((item) => item.tableNumber == null).map((item) => item.tableName || "Bàn chưa chuẩn hóa"));
        setCatalog(inventory.data.map((item) => ({
          table_number: item.tableNumber,
          status: item.tournamentTableStatus,
          availability_status: item.availabilityStatus,
          session_type: item.sessionType,
          operational_status: item.operationalStatus,
        })));
        return;
      }
      const { data, error } = await supabase
        .from("tournament_tables")
        .select("table_number, status")
        .eq("tournament_id", tournamentId);
      if (sequence !== requestSequence.current) return;
      if (error) {
        setCatalog([]);
        setCatalogError("Không tải được danh sách số bàn. Không thể mở bàn cho tới khi tải lại thành công.");
        return;
      }
      setV3GameTableIdByNumber({});
      setCatalog((data ?? []) as FloorTableCatalogRow[]);
    } catch {
      if (sequence !== requestSequence.current) return;
      setCatalog([]);
      setCatalogError("Mất kết nối khi tải số bàn. Hãy kiểm tra mạng và thử lại.");
    } finally {
      if (sequence === requestSequence.current) setLoadingCatalog(false);
    }
  }, [supabase, tableControlV3, tournamentId]);

  useEffect(() => {
    if (!open) {
      requestSequence.current += 1;
      return;
    }
    setSelectedNumber(null);
    setControlMode("manual");
    void loadCatalog();
  }, [loadCatalog, open]);

  const submit = async () => {
    if (selectedNumber == null || loadingCatalog || catalogError || submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    try {
      if (tableControlV3.enabled) {
        const gameTableId = v3GameTableIdByNumber[selectedNumber];
        if (!gameTableId) {
          toast.error("Bàn vật lý này chưa được khai báo hoặc không sẵn sàng.");
          return;
        }
        const result = await tableControlV3.openTournamentTable({
          tournamentId,
          gameTableId,
          controlMode,
          requestId: crypto.randomUUID(),
        });
        if (result.ok === false) {
          toast.error(mapError(result.error));
          await loadCatalog();
          return;
        }
        const modeLabel = controlMode === "tracker" ? "Live Tracker" : "Manual Floor";
        toast.success(`Đã mở Bàn ${selectedNumber} · ${modeLabel} · 9 ghế`);
        onDone();
        onOpenChange(false);
        return;
      }

      // Legacy behavior remains intact until the owner-gated V3 rollout.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy RPC has generated types pending.
      const { data, error } = await (supabase.rpc as any)("floor_open_tournament_table_v2", {
        p_tournament_id: tournamentId,
        p_table_number: selectedNumber,
        p_control_mode: controlMode,
      });
      const result = (data ?? null) as OpenTableResult | null;
      if (error || !result?.ok) {
        toast.error(mapError(result?.error));
        await loadCatalog();
        return;
      }

      const modeLabel = result.floor_control_mode === "tracker" ? "Live Tracker" : "Manual Floor";
      toast.success(
        result.reopened
          ? `Đã mở lại Bàn ${result.table_number} · ${modeLabel} · 9 ghế`
          : `Đã mở Bàn ${result.table_number} · ${modeLabel} · 9 ghế`,
      );
      onDone();
      onOpenChange(false);
    } catch {
      toast.error("Không thể xác nhận kết quả mở bàn. Hãy tải lại sơ đồ trước khi thử tiếp.");
      await loadCatalog();
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
      <DialogContent className="h-[100dvh] w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-0 bg-[#0d0913] p-0 sm:h-[90vh] sm:w-[calc(100vw-2rem)] sm:max-w-5xl sm:rounded-3xl sm:border sm:border-white/10">
        <DialogHeader className="border-b border-white/8 px-4 pb-4 pt-5 text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-xl text-[#f2ece6]">
            <ExternalLink className="h-5 w-5 text-[#c9a86a]" />
            Mở bàn
          </DialogTitle>
          <DialogDescription className="max-w-2xl text-sm leading-5 text-[#9b8e97]">
            Chọn số bàn và nguồn kiểm soát chip. Tất cả bàn mới dùng cố định 9 ghế; server sẽ kiểm tra lại trước khi mở.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {catalogError ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-400/8 px-4 text-center">
              <AlertTriangle className="h-7 w-7 text-rose-300" />
              <p className="mt-2 max-w-md text-sm leading-6 text-rose-100">{catalogError}</p>
              <Button data-ops-action="floor.tables.reload_catalog" type="button" variant="outline" className="mt-4" onClick={() => void loadCatalog()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Tải lại
              </Button>
            </div>
          ) : loadingCatalog ? (
            <div className="flex min-h-48 flex-col items-center justify-center text-sm text-[#9b8e97]">
              <Loader2 className="mb-3 h-7 w-7 animate-spin text-[#c9a86a]" />
              Đang tải trạng thái 100 số bàn…
            </div>
          ) : (
            <div className="space-y-4">
              {unconfiguredTables.length > 0 && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-sm text-amber-100">
                  <p role="status">{unconfiguredTables.length} bàn cũ chưa có số chuẩn. Các bàn này không thể chọn; cần đối soát trước khi đưa vào kho bàn V3.</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer rounded-sm py-1 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Xem {unconfiguredTables.length} bàn cần đối soát</summary>
                    <ul className="mt-2 max-h-48 list-inside list-disc overflow-y-auto break-words">
                      {unconfiguredTables.map((name,index)=><li key={`${name}:${index}`}>{name}</li>)}
                    </ul>
                  </details>
                </div>
              )}
              {repairTables.length > 0 && (
                <p role="status" className="rounded-xl border border-rose-400/30 bg-rose-400/8 px-3 py-3 text-sm text-rose-100">
                  {repairTables.join(", ")} đang có phiên bàn cần sửa nên tạm khóa. Các bàn khác vẫn có thể mở bình thường.
                </p>
              )}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]">
              <div className="order-2 lg:order-1">
              <FloorTableNumberPicker
                rows={catalog}
                value={selectedNumber}
                onChange={setSelectedNumber}
                disabled={busy}
                missingState={tableControlV3.enabled ? "unavailable" : "available"}
                listedOnly={tableControlV3.redrawSeatLockEnabled}
                />
              </div>

              <section className="order-1 lg:order-2 lg:sticky lg:top-0 lg:self-start" aria-labelledby="floor-open-mode-heading">
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#c9a86a]" />
                    <div>
                      <h3 id="floor-open-mode-heading" className="text-sm font-semibold text-[#f2ece6]">
                        Loại bàn
                      </h3>
                      <p className="mt-0.5 text-xs leading-5 text-[#9b8e97]">
                        Chọn nguồn có quyền cập nhật chip trước khi bàn được mở.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <FloorTableModePicker
                      value={controlMode}
                      onChange={setControlMode}
                      disabled={busy || tableControlV3.enabled}
                    />
                    {tableControlV3.enabled && (
                      <p className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs leading-5 text-amber-100/90">
                        Preview V3 chỉ mở Manual Floor cho tới khi Tracker runtime chuyển toàn bộ writer sang fencing tuple V3. Không có fallback sang contract Tracker cũ.
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/7 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-primary/80">
                    Xác nhận
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-3">
                    <span className="text-sm text-muted-foreground">Số bàn</span>
                    <span className="font-mono text-2xl font-bold text-foreground">
                      {selectedNumber ?? "—"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Số ghế</span>
                    <span className="font-mono text-foreground">{FIXED_FLOOR_TABLE_SEATS}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Kiểm soát chip</span>
                    <span className="font-medium text-foreground">
                      {controlMode === "tracker" ? "Live Tracker" : "Manual Floor"}
                    </span>
                  </div>
                </div>
              </section>
            </div>
            </div>
          )}
        </div>

        <div className="border-t border-white/8 bg-[#0d0913]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6 sm:pb-4">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button data-ops-action="floor.tables.cancel_open_table" type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Huỷ
            </Button>
            <Button
              data-ops-action="floor.tables.open_table"
              data-testid="floor-open-table-confirm"
              type="button"
              onClick={() => void submit()}
              disabled={busy || loadingCatalog || Boolean(catalogError) || selectedNumber == null}
              className="min-h-11 sm:min-w-48"
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {busy
                ? "Đang mở…"
                : selectedNumber == null
                  ? "Chọn số bàn"
                  : `Mở Bàn ${selectedNumber}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
