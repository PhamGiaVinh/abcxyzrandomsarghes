import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Search, Plus, Shuffle, PauseCircle, XCircle, Loader2, LogIn, Users, Trophy, RefreshCw, AlertTriangle,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import { useTournaments } from "@/hooks/useTournaments";
import { useFloorSeats } from "@/components/ops/shared/useFloorSeats";
import { FloorPlayerActions, type FloorSeatTarget } from "@/components/ops/shared/FloorPlayerActions";
import { FloorTableControlModeControl } from "@/components/ops/shared/FloorTableControlMode";
import { FloorSeatRoster } from "@/components/ops/shared/FloorSeatRoster";
import { FloorTableRosterIndex } from "@/components/ops/shared/FloorTableRosterIndex";
import { FIXED_FLOOR_TABLE_SEATS } from "@/components/ops/shared/floorTablePresentation";
import { CloseTableDialog } from "@/components/cashier/tournament-live/CloseTableDialog";
import { OpenTableDialog } from "@/components/cashier/tournament-live/OpenTableDialog";
import { AddPlayerDialog } from "@/components/cashier/tournament-live/AddPlayerDialog";
import { FloorTableMapPanelV3 } from "@/components/cashier/tournament-live/FloorTableMapPanelV3";
import {
  toMockTable, toMockSeat,
  type MapTable,
} from "@/components/ops/shared/floorAdapter";
import type { MockSeat, MockTable } from "@/components/ops/mock/opsData";
import type { Tournament } from "@/types/tournament";
import { resolveOpsTablesTournamentId } from "@/pages/ops/opsTablesTournamentSelection";

/**
 * Bàn (mobileOpsV2) — bản NỐI DỮ LIỆU THẬT (reads). Ghế/người gắn theo GIẢI:
 * bàn từ `tournament_tables`, ghế/người/chip từ Edge `tournament-live-draw {action:"get_seats"}`
 * (đúng nguồn desktop FloorTableMapPanel), realtime tournament_seats + tournament_chip_counts.
 *
 * P0 (review owner): KHÔNG BAO GIỜ fallback mock khi live lỗi (error state riêng) · stale-guard
 * requestSeq khi đổi giải nhanh · selector không tự nhảy khỏi giải user đã chọn · thao tác chưa
 * đạt runtime gate bị disabled, không toast giả thành công · status bàn copy verbatim desktop qua
 * floorAdapter (có vitest). P1: >1 CLB → chọn từ Ops Control Deck; realtime debounce 200ms; chip 0 ≠ null;
 * 3 empty state phân biệt; không sửa shared components (adapter lo).
 */

const LIVEISH_PRIMARY: Tournament["status"][] = ["live", "break", "final_table"];
const LIVEISH_FALLBACK: Tournament["status"][] = ["registering", "drawing"];

interface TableVM { mock: MockTable; name: string; seats: MockSeat[]; raw: MapTable }

type CloseDrawMode = "redraw_balanced" | "fill_lowest_table";
/** Copy VERBATIM từ RedrawLauncherDialog.mapError. */
function redrawError(res: { error?: string; need?: number; have?: number } | null, raw?: string): string {
  const code = res?.error ?? raw;
  switch (code) {
    case "unauthorized": return "Bạn cần đăng nhập lại.";
    case "actor_not_allowed": return "Không có quyền bốc lại cho CLB này.";
    case "tournament_not_open": return "Giải đã kết thúc/huỷ.";
    case "invalid_mode": return "Chế độ không hợp lệ.";
    case "manual_requires_entry_ids": return "Hãy chọn ít nhất 1 người chơi.";
    case "no_target_tables": return "Không có bàn đích hợp lệ.";
    case "insufficient_capacity": return `Không đủ ghế trống (cần ${res?.need ?? "?"}, có ${res?.have ?? "?"}) — mở thêm bàn / tăng số bàn đích.`;
    default: return code ? `Bốc lại thất bại (${code})` : "Bốc lại thất bại";
  }
}
// 3 chế độ tự động (thủ công = máy tính, cần chọn từng người). Draw mode dùng chung CloseDrawMode.
type RedrawMode = "final_table" | "itm" | "table_count_threshold";
interface RedrawResult {
  ok?: boolean; error?: string; need?: number; have?: number; moved_count?: number;
  moves?: { player_name?: string; to_table_number?: number | null }[];
  tables_to_close?: { table_number?: number }[];
}

export default function OpsTables({ tournamentId }: { tournamentId?: string }) {
  return FEATURES.floorTableControlV3
    ? <OpsTablesV3 tournamentId={tournamentId} />
    : <OpsTablesLegacy tournamentId={tournamentId} />;
}

function OpsTablesV3({ tournamentId }: { tournamentId?: string }) {
  const { user } = useOpsAuth();
  const {
    loading: clubsLoading,
    clubs,
    floorClubIds: scopedIds,
    isSuperAdmin,
    scopeError,
    metadataError,
  } = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const clubId = selectedClubId && (isSuperAdmin || scopedIds.includes(selectedClubId))
    ? selectedClubId
    : null;
  const { data: tournaments, isLoading: tournamentsLoading, error: tournamentsError } = useTournaments(clubId ?? undefined);
  const tourOptions = useMemo(() => {
    const list = (tournaments ?? []) as unknown as Tournament[];
    const primary = list.filter((tournament) => LIVEISH_PRIMARY.includes(tournament.status));
    const base = primary.length > 0
      ? primary
      : list.filter((tournament) => LIVEISH_FALLBACK.includes(tournament.status));
    const requested = tournamentId ? list.find((tournament) => tournament.id === tournamentId) : null;
    return requested && !base.some((tournament) => tournament.id === requested.id)
      ? [requested, ...base]
      : base;
  }, [tournamentId, tournaments]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(tournamentId ?? null);

  useEffect(() => {
    if (tournamentId) {
      setSelectedTournamentId(tourOptions.some((tournament) => tournament.id === tournamentId) ? tournamentId : null);
      return;
    }
    setSelectedTournamentId((current) => (
      current && tourOptions.some((tournament) => tournament.id === current)
        ? current
        : tourOptions[0]?.id ?? null
    ));
  }, [tourOptions, tournamentId]);

  const selectedTournament = tourOptions.find((tournament) => tournament.id === selectedTournamentId) ?? null;
  const selectedClubName = clubId
    ? clubs?.find((club) => club.id === clubId)?.name ?? `CLB ${clubId.slice(0, 4)}…`
    : "CLB";

  if (clubsLoading || tournamentsLoading) {
    return (
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-[#c9a86a]" />
        <div className="text-[13px] text-[#9b8e97]">Đang tải kho bàn chung…</div>
      </div>
    );
  }

  if (scopeError || !clubId) {
    return (
      <div className="ios-card flex flex-col items-center gap-2 py-10 text-center">
        <AlertTriangle className="h-7 w-7 text-rose-300" />
        <div className="text-[15px] font-semibold text-[#f2ece6]">Không tải được phạm vi Floor</div>
        <div className="max-w-[300px] text-[12px] text-[#9b8e97]">{scopeError ?? "Hãy chọn đúng CLB trong thanh Đổi không gian."}</div>
      </div>
    );
  }

  if (tournamentsError) {
    return (
      <div className="ios-card flex flex-col items-center gap-2 py-10 text-center">
        <AlertTriangle className="h-7 w-7 text-rose-300" />
        <div className="text-[15px] font-semibold text-[#f2ece6]">Không tải được danh sách giải</div>
        <div className="max-w-[300px] text-[12px] text-[#9b8e97]">Dữ liệu V3 đã khóa để không hiển thị nhầm CLB.</div>
      </div>
    );
  }

  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Bàn</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">{selectedTournament?.name ?? selectedClubName} · kho bàn/session V3</p>
      </header>
      {metadataError && <div className="rounded-xl bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300/90">{metadataError}</div>}
      {!tournamentId && tourOptions.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-1" aria-label="Chọn giải">
          {tourOptions.map((tournament) => (
            <button
              key={tournament.id}
              type="button"
              data-ops-action="floor.tables.select_tournament"
              onClick={() => setSelectedTournamentId(tournament.id)}
              className={cn(
                "min-h-11 shrink-0 rounded-full px-3 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300",
                selectedTournamentId === tournament.id ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]",
              )}
            >
              {tournament.name}
            </button>
          ))}
        </div>
      )}
      {selectedTournament ? (
        <FloorTableMapPanelV3 actorId={user?.id ?? null} tournament={selectedTournament} refreshTrigger={0} />
      ) : (
        <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
          <Trophy className="h-7 w-7 text-amber-300" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Chưa có giải đang vận hành</div>
          <div className="max-w-[280px] text-[12px] text-[#9b8e97]">Mở giải trước, sau đó bàn vật lý sẽ được chiếm bằng một session V3 duy nhất.</div>
        </div>
      )}
    </div>
  );
}

function OpsTablesLegacy({ tournamentId }: { tournamentId?: string }) {
  const navigate = useNavigate();
  const supabase = useSupabaseClient();
  const { user } = useOpsAuth();
  const {
    loading: clubsLoading,
    clubs,
    floorClubIds: scopedIds,
    isSuperAdmin,
    scopeError,
    metadataError,
  } = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();

  // Club authority is resolved by OpsModuleGate and remains in the URL. This
  // page never picks the first Floor club as a fallback.
  const clubId = selectedClubId && (isSuperAdmin || scopedIds.includes(selectedClubId))
    ? selectedClubId
    : null;

  const { data: tournaments, isLoading: toursLoading } = useTournaments(clubId ?? undefined);

  // Deep-link giải: ?tour=<id> khi vào từ cockpit/Hôm nay ("Mở màn Bàn"). Đọc MỘT LẦN (ref) để
  // URL đổi về sau không tự chọn lại → không đè lựa chọn thủ công của người dùng.
  const [searchParams] = useSearchParams();
  const deepLinkTourIdRef = useRef<string | null>(tournamentId ?? searchParams.get("tour"));

  const tourOptions = useMemo(() => {
    const list = (tournaments ?? []) as unknown as Tournament[];
    const primary = list.filter((t) => LIVEISH_PRIMARY.includes(t.status));
    const base = primary.length > 0 ? primary : list.filter((t) => LIVEISH_FALLBACK.includes(t.status));
    // Giải được deep-link phải chọn được ngay cả khi chưa live (VD giải "test" upcoming): thêm vào đầu.
    const deep = deepLinkTourIdRef.current;
    if (deep && !base.some((t) => t.id === deep)) {
      const match = list.find((t) => t.id === deep);
      if (match) return [match, ...base];
    }
    return base;
  }, [tournaments]);

  // P0-3: auto-select CHỈ khi chưa chọn hoặc giải đã chọn biến mất — không clobber lựa chọn user.
  // Seed từ deep-link (nếu có) thay cho null; giải này nằm trong tourOptions nên guard không đè.
  // The URL value is an untrusted candidate. Data hooks stay disabled until
  // the scoped tournament list proves the tournament belongs to this CLB.
  const [tourId, setTourId] = useState<string | null>(null);
  useEffect(() => {
    setTourId((currentTournamentId) => {
      if (tournamentId) {
        return tourOptions.some((tournament) => tournament.id === tournamentId)
          ? tournamentId
          : null;
      }
      const candidate = deepLinkTourIdRef.current;
      if (
        currentTournamentId == null
        && candidate
        && tourOptions.some((tournament) => tournament.id === candidate)
      ) {
        return candidate;
      }
      return resolveOpsTablesTournamentId({
        currentTournamentId,
        tournamentOptions: tourOptions,
        selectedClubId: clubId,
        operatorClubsLoading: clubsLoading,
        tournamentsLoading: toursLoading,
      });
    });
  }, [tourOptions, clubId, clubsLoading, tournamentId, toursLoading]);

  const selectedTour = tourOptions.find((t) => t.id === tourId) ?? null;
  const onBreak = selectedTour?.status === "break";
  const floor = useFloorSeats(selectedTour?.id ?? null);

  const [openNo, setOpenNo] = useState<number | null>(null);
  const [searchOn, setSearchOn] = useState(false);
  const [query, setQuery] = useState("");

  const vms = useMemo<TableVM[]>(() => floor.tables.map((t, i) => {
    const seats = floor.seatsByTable[t.table_id] ?? [];
    return { mock: toMockTable(t, seats.length, onBreak, 1000 + i), name: t.table_name, seats: seats.map(toMockSeat), raw: t };
  }), [floor.tables, floor.seatsByTable, onBreak]);

  const visible = useMemo(() => {
    if (!query.trim()) return vms;
    const q = query.trim().toLowerCase();
    return vms.filter((v) => v.name.toLowerCase().includes(q) || String(v.mock.tableNo) === q
      || v.seats.some((s) => (s.name ?? "").toLowerCase().includes(q)));
  }, [vms, query]);

  const byNo = useMemo(() => new Map(vms.map((v) => [v.mock.tableNo, v])), [vms]);
  const openVM = openNo != null ? byNo.get(openNo) ?? null : null;

  // Tap 1 ghế → mở luồng thao tác người chơi (Sửa chip/Loại/Chuyển/Phiếu/Thông tin). Logic + sheets
  // dùng CHUNG ở FloorPlayerActions. Chỉ ghế đang ngồi (có MapSeat thật) mới mở.
  const [seatTarget, setSeatTarget] = useState<FloorSeatTarget | null>(null);
  const openPlayer = (s: MockSeat) => {
    const vm = openVM;
    const tableNo = vm?.mock.tableNo ?? 0;
    const real = vm ? (floor.seatsByTable[vm.raw.table_id] ?? []).find((x) => x.seat_number === s.seat) ?? null : null;
    setOpenNo(null);
    if (!real) return;
    requestAnimationFrame(() => setSeatTarget({ seat: s, tableNo, real }));
  };

  const ADD_LIVE = FEATURES.floorTableOps && !floor.readOnlyReason;
  const [addTable, setAddTable] = useState<{ vm: TableVM; tourId: string; actorId: string; seat?: number } | null>(null);
  const openAdd = (vm: TableVM, seat?: number) => {
    if (!tourId || !user?.id || floor.readOnlyReason) return;
    setOpenNo(null);
    setAddTable({ vm, tourId, actorId: user.id, seat });
  };
  const addCurrentTable = floor.tables.find((row) => row.tt_id === addTable?.vm.raw.tt_id
    && row.table_session_id === addTable.vm.raw.table_session_id);

  // ── Floor-A3: Mở bàn → shared responsive picker + atomic v2 RPC ──
  const [openTableOpen, setOpenTableOpen] = useState(false);

  // Canonical dialog owns preview, exact-session commit and durable reconciliation.
  const [closeTable, setCloseTable] = useState<{ table: TableVM; tourId: string; actorId: string } | null>(null);

  // ── Floor-A4: Bốc lại → redraw_tournament, 2 bước preview→confirm (gate floorTableOps) ──
  const [redrawOpen, setRedrawOpen] = useState(false);
  const [redrawMode, setRedrawMode] = useState<RedrawMode>("final_table");
  const [redrawDraw, setRedrawDraw] = useState<CloseDrawMode>("redraw_balanced");
  const [redrawTarget, setRedrawTarget] = useState("");
  const [redrawPhase, setRedrawPhase] = useState<"config" | "preview">("config");
  const [redrawPreview, setRedrawPreview] = useState<RedrawResult | null>(null);
  const [redrawBusy, setRedrawBusy] = useState(false);
  const redrawBusyRef = useRef(false);
  const openRedraw = () => { setRedrawMode("final_table"); setRedrawDraw("redraw_balanced"); setRedrawTarget(""); setRedrawPhase("config"); setRedrawPreview(null); setRedrawOpen(true); };
  const callRedraw = useCallback(async (dryRun: boolean): Promise<RedrawResult | null> => {
    if (floor.readOnlyReason) { toast.error(floor.readOnlyReason); return null; }
    const { data, error } = await supabase.rpc("redraw_tournament", {
      p_tournament_id: tourId,
      p_mode: redrawMode,
      p_eligible_entry_ids: null,          // 3 chế độ auto — không dùng manual
      p_target_table_count: redrawMode === "table_count_threshold" && redrawTarget.trim() ? Number(redrawTarget) : null,
      p_draw_mode: redrawDraw,
      p_dry_run: dryRun,
    });
    if (error) { toast.error(redrawError(null, error.message)); return null; }
    return (data ?? null) as RedrawResult | null;
  }, [supabase, tourId, redrawMode, redrawTarget, redrawDraw, floor.readOnlyReason]);
  const runRedrawPreview = useCallback(async () => {
    if (redrawMode === "table_count_threshold" && !redrawTarget.trim()) { toast.error("Nhập số bàn đích."); return; }
    if (redrawBusyRef.current) return;
    redrawBusyRef.current = true; setRedrawBusy(true);
    try {
      const r = await callRedraw(true);   // dry_run — KHÔNG ghi
      if (!r) return;
      if (!r.ok) { toast.error(redrawError(r)); return; }
      setRedrawPreview(r); setRedrawPhase("preview");
    } catch (e) { toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Xem trước thất bại"); }
    finally { redrawBusyRef.current = false; setRedrawBusy(false); }
  }, [redrawMode, redrawTarget, callRedraw]);
  const runRedrawConfirm = useCallback(async () => {
    if (redrawBusyRef.current) return;
    redrawBusyRef.current = true; setRedrawBusy(true);
    try {
      const r = await callRedraw(false);  // ghi thật
      if (!r) return;
      if (!r.ok) { toast.error(redrawError(r)); return; }
      toast.success(`Đã bốc lại ${r.moved_count ?? r.moves?.length ?? 0} người`);
      setRedrawOpen(false);
      floor.reload();
    } catch (e) { toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Bốc lại thất bại"); }
    finally { redrawBusyRef.current = false; setRedrawBusy(false); }
  }, [callRedraw, floor]);

  // ---- guards (thứ tự chuẩn: auth → login → clubs → quyền → data) ----
  if (clubsLoading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Kiểm tra đăng nhập." />;
  if (!user) return <Guard icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập tài khoản Floor để xem sơ đồ bàn thật." />;
  if (scopeError) return <Guard icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không tải được phạm vi CLB" sub="Không dùng dữ liệu thay thế. Hãy tải lại trang." />;
  if (!clubId) return <Guard icon={<Users className="h-8 w-8 text-amber-300" />} title="Chưa chọn đúng CLB" sub="Quay lại Đổi không gian và chọn CLB thuộc phạm vi Floor." />;

  const selectedClubName = clubId
    ? clubs?.find((club) => club.id === clubId)?.name ?? `CLB ${clubId.slice(0, 4)}…`
    : "CLB";

  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Bàn</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">{selectedTour ? selectedTour.name : selectedClubName} · chạm 1 bàn để thao tác</p>
      </header>
      {metadataError && <div className="rounded-xl bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300/90">{metadataError}</div>}

      {/* P0-3: pill chọn giải (ẩn nếu chỉ 1) */}
      {!tournamentId && tourOptions.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-1">
          {tourOptions.map((t) => (
            <button key={t.id} data-ops-action="floor.tables.select_tournament" onClick={() => setTourId(t.id)}
              className={cn("ios-press-sm shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium", tourId === t.id ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {searchOn && (
        <div className="ios-fill flex items-center gap-2 rounded-2xl px-4 py-3">
          <Search className="h-[18px] w-[18px] text-[#9b8e97]" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Số bàn / tên người chơi…"
            className="flex-1 bg-transparent text-[15px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
        </div>
      )}

      {/* ---- vùng dữ liệu: loading → error → empty② → empty③ → grid (KHÔNG BAO GIỜ mock) ---- */}
      {floor.repairWarnings?.length ? <div role="alert" className="ios-card p-3 text-sm text-amber-200">
        <p>Cần sửa dữ liệu — chỉ xem, chưa cho thao tác.</p>
        <ul>{floor.repairWarnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>
      </div> : null}
      {toursLoading || (floor.loading && vms.length === 0) ? (
        <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#c9a86a]" />
          <div className="text-[13px] text-[#9b8e97]">Đang tải sơ đồ bàn…</div>
        </div>
      ) : floor.error ? (
        <div className="ios-card flex flex-col items-center gap-2 py-10 text-center">
          <AlertTriangle className="h-7 w-7 text-rose-300" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Không tải được sơ đồ bàn</div>
          <div className="max-w-[280px] text-[12px] text-[#9b8e97]">{floor.error}</div>
          <button data-ops-action="floor.tables.refresh" onClick={() => floor.reload()} className="ios-press-sm mt-1 flex items-center gap-1.5 rounded-full bg-white/8 px-3.5 py-1.5 text-[13px] text-[#f2ece6]">
            <RefreshCw className="h-3.5 w-3.5" /> Thử lại
          </button>
        </div>
      ) : !selectedTour ? (
        <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
          <Trophy className="h-7 w-7 text-amber-300" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Chưa có giải đang chạy</div>
          <div className="max-w-[260px] text-[12px] text-[#9b8e97]">Sơ đồ bàn hiển thị theo giải. Mở giải ở tab Giải đấu trước.</div>
        </div>
      ) : vms.length === 0 ? (
        <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
          <Users className="h-7 w-7 text-[#9b8e97]" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Giải này chưa có bàn/ghế</div>
          <div className="max-w-[260px] text-[12px] text-[#9b8e97]">Bàn sẽ hiện khi giải được gắn bàn và bốc chỗ.</div>
        </div>
      ) : (
        <FloorTableRosterIndex
          tables={visible.map((table) => ({
            id: table.raw.tt_id,
            tableNumber: table.raw.table_number,
            tableName: table.name,
            occupiedSeatNumbers: table.seats.map((seat) => seat.seat),
            maxSeats: table.mock.max,
            status: table.mock.status,
            controlMode: table.raw.floor_control_mode,
          }))}
          onOpen={(tableId) => {
            const table = vms.find((candidate) => candidate.raw.tt_id === tableId);
            if (table) setOpenNo(table.mock.tableNo);
          }}
        />
      )}

      {/* hàng nút đáy — thumb zone (hành động: đang nối) */}
      <div className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <button data-ops-action="floor.tables.toggle_search" onClick={() => { setSearchOn((v) => !v); if (searchOn) setQuery(""); }} className="ios-press ios-fill grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-[#f2ece6]">
          <Search className="h-5 w-5" />
        </button>
        {/* Cờ OFF: giữ NHÃN THẬT + disabled (trước đây 2 nút cạnh nhau cùng chữ "Cần bật cờ"
            → nhìn như UI lỗi/trùng); 1 dòng hint chung bên dưới thay chữ trên từng nút. */}
        <button data-ops-action="floor.tables.open_table_dialog" onClick={() => (ADD_LIVE ? setOpenTableOpen(true) : undefined)} disabled={!ADD_LIVE}
          data-testid="floor-open-table-dialog"
          aria-disabled={!ADD_LIVE} title={ADD_LIVE ? undefined : "Cần bật cờ floorTableOps"}
          className={cn("ios-press ios-fill flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl text-[15px] font-medium text-[#f2ece6]", !ADD_LIVE && "opacity-50")}>
          <Plus className="h-[18px] w-[18px]" /> Bàn
        </button>
        <button
          type="button"
          data-ops-action="floor.tables.open_players"
          data-testid="floor-open-players"
          disabled={!tourId}
          onClick={() => { if (tourId && clubId) navigate(`/ops/floor/tournaments/${tourId}/players?club=${encodeURIComponent(clubId)}`); }}
          className="ios-press ios-fill flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-2xl px-2 text-[14px] font-medium text-[#f2ece6] disabled:opacity-50"
        >
          <Users className="h-[18px] w-[18px] shrink-0" /> <span className="truncate">Người chơi</span>
        </button>
        <button data-ops-action="floor.tables.open_redraw" onClick={() => { if (ADD_LIVE) openRedraw(); }} disabled={!ADD_LIVE}
          aria-disabled={!ADD_LIVE} title={ADD_LIVE ? undefined : "Cần bật cờ floorTableOps"}
          className={cn("ios-press ios-fill col-span-3 flex h-11 items-center justify-center gap-1.5 rounded-2xl text-[14px] font-medium text-[#f2ece6]", !ADD_LIVE && "opacity-50")}>
          <Shuffle className="h-[18px] w-[18px]" /> Bốc lại
        </button>
      </div>
      {!ADD_LIVE && <p className="px-1 text-center text-[11px] text-[#7c7079]">Các thao tác bàn đang tạm khóa. Cần bật floorTableOps.</p>}

      {/* B2 — sheet bàn: ghế + người thật */}
      <Sheet open={openVM !== null} onOpenChange={(v) => { if (!v) setOpenNo(null); }}>
        <SheetContent side="bottom" className="h-[100dvh] max-h-none overflow-y-auto rounded-none border-none bg-[#0d0913] pb-[max(2rem,env(safe-area-inset-bottom))] sm:h-auto sm:max-h-[88vh] sm:rounded-t-[22px]">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">{openVM?.name}</SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-center font-mono text-[13px] text-[#9b8e97]">
            {openVM?.seats.filter((seat) => seat.seat >= 1 && seat.seat <= FIXED_FLOOR_TABLE_SEATS).length ?? 0}/{FIXED_FLOOR_TABLE_SEATS} ghế{onBreak ? " · đang giải lao" : ""}
          </div>

          {openVM && (
            <FloorSeatRoster
              className="mt-4"
              seats={openVM.seats.map((seat) => ({
                seatNumber: seat.seat,
                playerName: seat.name ?? "Người chơi",
                chipsLabel: seat.chip ?? "—",
                entryNumber: seat.entryNo,
                integrityStatus: (floor.seatsByTable[openVM.raw.table_id] ?? []).find((row) => row.seat_number === seat.seat)?.integrity_status,
              }))}
              onSeatTap={floor.readOnlyReason ? undefined : (seatNumber) => {
                const seat = openVM.seats.find((candidate) => candidate.seat === seatNumber);
                if (seat) openPlayer(seat);
              }}
              onEmptySeatTap={ADD_LIVE
                ? (seatNumber) => openAdd(openVM, seatNumber)
                : undefined}
            />
          )}

          {openVM && tourId && (
            <FloorTableControlModeControl actorId={user?.id ?? null}
              tournamentId={tourId}
              table={openVM.raw}
              onChanged={floor.reload}
              disabledReason={floor.readOnlyReason}
            />
          )}

          <div className="mt-3 grid grid-cols-3 gap-2">
            {/* Floor-A1: LIVE (floorTableOps). Cờ OFF → disable "Cần bật cờ" y desktop, 0 gọi RPC. */}
            <button data-ops-action="floor.tables.open_add_player" onClick={() => (ADD_LIVE ? openVM && openAdd(openVM) : undefined)} disabled={!ADD_LIVE}
              aria-disabled={!ADD_LIVE} title={ADD_LIVE ? undefined : "Cần bật cờ floorTableOps"}
              className={cn("ios-press ios-tinted flex items-center justify-center gap-1 rounded-2xl py-3 text-[13px] font-semibold", !ADD_LIVE && "opacity-50")}>
              <Plus className="h-4 w-4" /> Thêm người
            </button>
            {/* "Tạm dừng" không có ở mức 1 bàn (server chỉ pause CẢ GIẢI) → mở đồng hồ giải ở cockpit
                (nơi có Tạm dừng/Tiếp tục/chỉnh giờ), không giả lập pause-per-table. */}
            <button data-ops-action="floor.tables.open_clock" onClick={() => { if (!tourId || !clubId) return; setOpenNo(null); navigate(`/ops/floor/tournaments/${tourId}/clock?club=${encodeURIComponent(clubId)}`); }}
              className="ios-press ios-fill flex items-center justify-center gap-1 rounded-2xl py-3 text-[13px] font-medium text-amber-300">
              <PauseCircle className="h-4 w-4" /> Đồng hồ
            </button>
            <button data-ops-action="floor.tables.open_close_table" onClick={() => { if (!ADD_LIVE || !openVM || !tourId || !user?.id) return; setCloseTable({ table: openVM, tourId, actorId: user.id }); setOpenNo(null); }}
              disabled={!ADD_LIVE} aria-disabled={!ADD_LIVE} title={ADD_LIVE ? undefined : "Cần bật cờ floorTableOps"}
              className={cn("ios-press flex items-center justify-center gap-1 rounded-2xl bg-rose-500/12 py-3 text-[13px] font-semibold text-rose-300", !ADD_LIVE && "opacity-50")}>
              <XCircle className="h-4 w-4" /> Đóng bàn
            </button>
          </div>
          <button
            type="button"
            data-ops-action="floor.tables.open_players_from_table"
            data-testid="floor-table-open-players"
            disabled={!tourId}
            onClick={() => {
              if (!tourId) return;
              setOpenNo(null);
              if (clubId) navigate(`/ops/floor/tournaments/${tourId}/players?club=${encodeURIComponent(clubId)}`);
            }}
            className="ios-press ios-fill mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-3 py-3 text-[14px] font-semibold text-[#f2ece6] disabled:opacity-50"
          >
            <Users className="h-4 w-4" /> Người chơi — đang chơi / đã loại
          </button>
          {!ADD_LIVE && <p className="mt-2 text-center text-[11px] text-[#7c7079]">Các thao tác bàn đang tạm khóa. Cần bật floorTableOps.</p>}
        </SheetContent>
      </Sheet>

      {addTable && addTable.tourId === selectedTour?.id && addTable.actorId === user?.id && (
        <AddPlayerDialog open onOpenChange={(open) => { if (!open) setAddTable(null); }} actorId={user.id}
          tournamentId={selectedTour.id} tournamentName={selectedTour.name} tournamentDate={null}
          tableTtId={addTable.vm.raw.tt_id} tableSessionId={addTable.vm.raw.table_session_id ?? null}
          expectedRevision={addCurrentTable?.floor_control_revision ?? null} expectedControlEpoch={addCurrentTable?.control_epoch ?? null}
          contextReady={!!addCurrentTable && !floor.readOnlyReason} maxSeats={addCurrentTable?.max_seats ?? 0}
          defaultSeatNumber={addTable.seat}
          occupiedSeats={(addCurrentTable ? floor.seatsByTable[addCurrentTable.table_id] ?? [] : []).map((s) => s.seat_number)}
          onDone={floor.reload} />
      )}

      {tourId && !floor.readOnlyReason && (
        <OpenTableDialog
          open={openTableOpen}
          onOpenChange={setOpenTableOpen}
          tournamentId={tourId}
          onDone={floor.reload}
        />
      )}

      {!floor.readOnlyReason && closeTable && selectedTour && closeTable.tourId === selectedTour.id && closeTable.actorId === user?.id && (
        <CloseTableDialog open onOpenChange={(open) => { if (!open) setCloseTable(null); }}
          actorId={user.id} tournamentId={selectedTour.id} tournamentName={selectedTour.name}
          tournamentDate={(selectedTour as Tournament & { start_time?: string | null }).start_time ?? null}
          tableTtId={closeTable.table.raw.tt_id} tableNumber={closeTable.table.raw.table_number}
          occupiedCount={closeTable.table.seats.length} onDone={floor.reload} />
      )}

      {/* Floor-A4 — Bốc lại: config (chế độ + cách chia) → XEM TRƯỚC (dry_run) → xác nhận (ghi) */}
      <Sheet open={redrawOpen && !floor.readOnlyReason} onOpenChange={(v) => { if (!v && !redrawBusy) setRedrawOpen(false); }}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Bốc lại bàn</SheetTitle></SheetHeader>

          {redrawPhase === "config" ? (
            <div className="mt-3 space-y-3">
              <div>
                <div className="px-1 text-[12px] text-[#9b8e97]">Kiểu bốc lại</div>
                <div className="mt-1.5 space-y-1.5">
                  {([["final_table", "Bốc bàn chung kết (final table)"], ["itm", "Bốc khi vào tiền (ITM)"], ["table_count_threshold", "Gom về số bàn đích"]] as [RedrawMode, string][]).map(([m, label]) => (
                    <button key={m} data-ops-action="floor.tables.select_redraw_mode" onClick={() => setRedrawMode(m)}
                      className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[14px]", redrawMode === m ? "bg-[#c9a86a]/15 text-[#f2ece6] ring-1 ring-[#c9a86a]/40" : "ios-fill text-[#9b8e97]")}>
                      <span className={cn("grid h-4 w-4 place-items-center rounded-full border", redrawMode === m ? "border-[#c9a86a] bg-[#c9a86a]" : "border-white/25")} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {redrawMode === "table_count_threshold" && (
                <div>
                  <label className="px-1 text-[12px] text-[#9b8e97]">Số bàn đích</label>
                  <input inputMode="numeric" value={redrawTarget} onChange={(e) => setRedrawTarget(e.target.value.replace(/[^0-9]/g, ""))} placeholder="VD: 4"
                    className="ios-fill mt-1 w-full rounded-xl px-3 py-2.5 text-center font-mono text-[16px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
                </div>
              )}
              <div>
                <div className="px-1 text-[12px] text-[#9b8e97]">Cách chia ghế</div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {([["redraw_balanced", "Ngẫu nhiên, ưu tiên bàn ít"], ["fill_lowest_table", "Lấp bàn số nhỏ trước"]] as [CloseDrawMode, string][]).map(([m, label]) => (
                    <button key={m} data-ops-action="floor.tables.select_draw_mode" onClick={() => setRedrawDraw(m)}
                      className={cn("ios-press-sm rounded-xl px-2 py-2.5 text-center text-[12.5px]", redrawDraw === m ? "bg-[#c9a86a] text-[#241A08] font-semibold" : "ios-fill text-[#9b8e97]")}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-white/5 px-3 py-2 text-[11px] text-[#7c7079]">Chọn người thủ công (Thủ công) — làm trên máy tính.</div>
              <button data-ops-action="floor.tables.preview_redraw" disabled={redrawBusy} onClick={runRedrawPreview}
                className="ios-press ios-primary flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold disabled:opacity-40">
                {redrawBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {redrawBusy ? "Đang tính…" : "Xem trước"}
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="ios-card p-3.5">
                <div className="text-[13px] text-[#9b8e97]">Kế hoạch (chưa ghi) — <b className="text-[#f2ece6]">{redrawPreview?.moves?.length ?? 0}</b> người chuyển{(redrawPreview?.tables_to_close?.length ?? 0) > 0 ? `, đóng ${redrawPreview?.tables_to_close?.length} bàn` : ""}</div>
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                  {(redrawPreview?.moves ?? []).slice(0, 60).map((m, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-white/6 py-1 text-[13px] last:border-0">
                      <span className="truncate text-[#f2ece6]">{m.player_name ?? "—"}</span>
                      <span className="font-mono text-[#9b8e97]">→ Bàn {m.to_table_number ?? "?"}</span>
                    </div>
                  ))}
                  {(redrawPreview?.moves?.length ?? 0) === 0 && <div className="py-3 text-center text-[13px] text-[#9b8e97]">Không có người cần chuyển.</div>}
                </div>
              </div>
              <div className="flex gap-2">
                <button data-ops-action="floor.tables.back_redraw" disabled={redrawBusy} onClick={() => setRedrawPhase("config")} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6] disabled:opacity-40">Quay lại</button>
                <button data-ops-action="floor.tables.confirm_redraw" disabled={redrawBusy} onClick={runRedrawConfirm} className="ios-press flex-[2] flex items-center justify-center gap-2 rounded-2xl bg-rose-500/90 py-3 text-[15px] font-bold text-white disabled:opacity-40">
                  {redrawBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />} {redrawBusy ? "Đang bốc…" : `Xác nhận bốc lại ${redrawPreview?.moves?.length ?? 0} người`}
                </button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* S7 — tap người: luồng thao tác + phiếu dùng CHUNG (FloorPlayerActions). */}
      <FloorPlayerActions
        actorId={user?.id ?? null}
        tournamentId={tourId}
        tournamentName={selectedTour?.name ?? ""}
        tournamentDate={(selectedTour as (Tournament & { start_time?: string | null }) | null)?.start_time ?? null}
        floor={floor}
        target={seatTarget}
        onClose={() => setSeatTarget(null)}
      />
    </div>
  );
}

function Guard({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Bàn</h1>
      </header>
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        {icon}
        <div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
        <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>
      </div>
    </div>
  );
}
