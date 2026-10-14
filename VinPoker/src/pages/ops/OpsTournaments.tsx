import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronRight, Plus, Play, Activity, Edit, Trophy, History, Minus,
  Loader2, LogIn, AlertTriangle,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useTournaments } from "@/hooks/useTournaments";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import {
  createTournament,
  mutationError,
  updateTournament,
  updateTournamentLive,
} from "@/ops/opsMutations";
import type { Tournament } from "@/types/tournament";
import { FloorVoiceAlertInbox } from "@/components/floor/FloorVoiceAlertInbox";
import { FEATURES } from "@/lib/featureFlags";

/**
 * Giải đấu (mobileOpsV2) — bản NỐI DỮ LIỆU THẬT (reads danh sách A1).
 * Danh sách giải đọc từ `useTournaments(clubId)` (đúng hook desktop dùng), ngữ cảnh CLB qua `useOperatorClubs()`.
 * Ghi chú: mọi thao tác ghi ở sheet đi qua RPC/RLS hiện có; không fallback mock và không tự apply migration.
 */
type StatusKey = "running" | "break" | "upcoming" | "closed";
const STATUS_CHIP: Record<StatusKey, string> = {
  running: "bg-emerald-400/12 text-emerald-300",
  break: "bg-amber-400/12 text-amber-300",
  upcoming: "bg-amber-400/12 text-amber-300",
  closed: "bg-white/6 text-[#9b8e97]",
};

interface TVM {
  id: string; name: string; statusKey: StatusKey; statusLabel: string;
  time: string; buyIn: string; entries: number; level: number | null; blinds: string | null;
}

const vnd = (n: number) => n.toLocaleString("vi-VN");
function toVM(t: Tournament): TVM {
  const a = t as unknown as Record<string, unknown>;
  const active = a.status === "active";
  const running = active || t.status === "live" || t.status === "final_table";
  const isBreak = t.status === "break";
  const upcoming = t.status === "upcoming" || t.status === "registering" || t.status === "drawing";
  const statusKey: StatusKey = running ? "running" : isBreak ? "break" : upcoming ? "upcoming" : "closed";
  const statusLabel = active ? "Đang hoạt động" : running ? "Đang chơi" : isBreak ? "Giải lao" : upcoming ? "Sắp diễn ra" : t.status === "cancelled" ? "Đã huỷ" : "Đã kết thúc";
  const time = typeof a.start_time === "string" ? new Date(a.start_time).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—";
  const buyIn = typeof a.buy_in === "number" ? vnd(a.buy_in) : "—";
  const entries = t.players_remaining ?? (typeof a.current_players === "number" ? a.current_players : 0);
  return { id: t.id, name: t.name, statusKey, statusLabel, time, buyIn, entries, level: t.current_level, blinds: t.current_blinds };
}

type SubSheet = "none" | "actions" | "create" | "form" | "updateLive";
const LIVE_STATUS_OPTIONS = [
  { value: "live", label: "Đang chơi" },
  { value: "break", label: "Giải lao" },
  { value: "final_table", label: "Final" },
] as const;

export default function OpsTournaments() {
  const navigate = useNavigate();
  const client = useSupabaseClient();
  const queryClient = useQueryClient();
  const { user } = useOpsAuth();
  const {
    loading: clubsLoading,
    clubs,
    floorClubIds: scopedIds,
    scope,
    isSuperAdmin,
    scopeError,
    metadataError,
  } = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const activeClub = selectedClubId && (isSuperAdmin || scopedIds.includes(selectedClubId))
    ? selectedClubId
    : undefined;
  const hasOwnerAccess = isSuperAdmin || scope.some(
    (row) => row.club_id === activeClub && row.can_owner,
  );
  const { data: tournaments, isLoading: tourLoading, isError: tourReadError, refetch: retryTours } = useTournaments(activeClub);

  const [filter, setFilter] = useState<"live" | "today" | "all">("live");
  const [sel, setSel] = useState<TVM | null>(null);
  const [sub, setSub] = useState<SubSheet>("none");
  const [livePlayers, setLivePlayers] = useState(42);
  const [liveLevel, setLiveLevel] = useState(8);
  const [liveStatus, setLiveStatus] = useState("live");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "Daily Turbo tối",
    startTime: "",
    buyIn: "1000000",
    startingStack: "30000",
    minutesPerLevel: "20",
    lateRegCloseLevel: "6",
  });

  const allVMs = useMemo(() => (tournaments ?? []).map((t) => toVM(t as unknown as Tournament)), [tournaments]);
  const rows = useMemo(() => {
    if (filter === "live") return allVMs.filter((r) => r.statusKey === "running" || r.statusKey === "break");
    return allVMs;
  }, [allVMs, filter]);
  const FILTERS: { key: "live" | "today" | "all"; label: string }[] = [
    { key: "live", label: "Đang chơi" }, { key: "today", label: "Hôm nay" }, { key: "all", label: `Tất cả (${allVMs.length})` },
  ];

  const openActions = (r: TVM) => { setSel(r); setSub("actions"); };
  const go = (next: SubSheet) => { setSub("none"); requestAnimationFrame(() => setSub(next)); };
  const closeAll = () => { setSub("none"); setSel(null); };
  useEffect(() => {
    if (!sel) return;
    const source = tournaments?.find((t) => t.id === sel.id) as (Tournament & {
      start_time?: string | null;
      buy_in?: number | null;
      starting_stack?: number | null;
      minutes_per_level?: number | null;
      late_reg_close_level?: number | null;
    }) | undefined;
    setForm({
      name: sel.name,
      startTime: source?.start_time?.slice(0, 16) ?? "",
      buyIn: String(source?.buy_in ?? 1000000),
      startingStack: String(source?.starting_stack ?? 30000),
      minutesPerLevel: String(source?.minutes_per_level ?? 20),
      lateRegCloseLevel: String(source?.late_reg_close_level ?? 6),
    });
    setLivePlayers(sel.entries);
    setLiveLevel(sel.level ?? 1);
    const sourceStatus = source?.status ?? "live";
    setLiveStatus(LIVE_STATUS_OPTIONS.find((option) => option.value === sourceStatus)?.label ?? (sourceStatus === "completed" ? "Final" : sourceStatus));
  }, [sel, tournaments]);

  const refreshTournaments = () => {
    void queryClient.invalidateQueries({ queryKey: ["tournaments", activeClub] });
  };

  const runMutation = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(success);
      refreshTournaments();
      closeAll();
    } catch (error) {
      toast.error(mutationError(error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitForm = () => {
    if (sel && !hasOwnerAccess) {
      toast.error("Chỉ chủ CLB được sửa giải.");
      return;
    }
    const fields = Array.from(document.querySelectorAll<HTMLInputElement>("[data-ops-field]"));
    const name = (fields[0]?.value ?? form.name).trim();
    const rawStart = fields[1]?.value ?? form.startTime;
    const parsedStart = /^\d{2}:\d{2}$/.test(rawStart)
      ? (() => { const d = new Date(); const [hours, minutes] = rawStart.split(":").map(Number); d.setHours(hours, minutes, 0, 0); return d; })()
      : new Date(rawStart);
    const startTime = Number.isNaN(parsedStart.getTime()) ? new Date().toISOString() : parsedStart.toISOString();
    const numeric = (value: string | undefined, fallback: string) => {
      const parsed = Number((value ?? fallback).replace(/[^\d-]/g, ""));
      return Number.isFinite(parsed) ? parsed : Number(fallback);
    };
    const buyIn = numeric(fields[3]?.value, form.buyIn);
    const startingStack = numeric(fields[4]?.value, form.startingStack);
    const minutesPerLevel = Number(form.minutesPerLevel);
    const lateRegCloseLevel = Number(form.lateRegCloseLevel);
    if (!name || !Number.isFinite(buyIn) || buyIn < 0 || !Number.isFinite(startingStack) || startingStack <= 0 || minutesPerLevel <= 0) {
      toast.error("Kiểm tra tên giải, buy-in, stack và thời lượng blind.");
      return;
    }
    void runMutation(
      () => sel
        ? updateTournament(client, sel.id, { name, startTime, buyIn, startingStack, minutesPerLevel, lateRegCloseLevel })
        : createTournament(client, { clubId: activeClub!, name, startTime, buyIn, startingStack, minutesPerLevel, lateRegCloseLevel }),
      sel ? "Đã lưu thông tin giải." : "Đã tạo giải.",
    );
  };

  const submitLive = () => {
    if (!sel) return;
    const normalizedStatus = LIVE_STATUS_OPTIONS.find((option) => option.label === liveStatus)?.value ?? liveStatus;
    if (!LIVE_STATUS_OPTIONS.some((option) => option.value === normalizedStatus)) {
      toast.error("Trạng thái live không hợp lệ; dùng Chốt giải để kết thúc.");
      return;
    }
    void runMutation(
      () => updateTournamentLive(client, {
        tournamentId: sel.id,
        status: normalizedStatus,
        playersRemaining: livePlayers,
        level: liveLevel,
        blinds: liveLevel > 0 ? "2.000 / 4.000 · ante 4.000" : null,
      }),
      "Đã cập nhật trạng thái live.",
    );
  };

  const done = () => {
    if (sub === "form") return submitForm();
    if (sub === "updateLive") return submitLive();
  };

  // ---- guards (ordered: auth → login → clubs → permission → data) ----
  if (clubsLoading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Kiểm tra đăng nhập." />;
  if (!user) return <Guard icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập để xem giải đấu của câu lạc bộ." />;
  if (scopeError) return <Guard icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không tải được phạm vi CLB" sub="Không dùng dữ liệu thay thế. Hãy tải lại trang." />;
  if (!activeClub) return <Guard icon={<Trophy className="h-8 w-8 text-amber-300" />} title="Chưa có câu lạc bộ" sub="Chưa được phân công CLB nào để xem giải." />;
  if (tourLoading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải giải…" sub="Lấy danh sách giải đấu." />;
  if (tourReadError) return <div role="alert">
    <Guard icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không tải được danh sách giải" sub="Chưa xác minh được dữ liệu. Không coi lỗi tải là danh sách rỗng." />
    <div className="flex justify-center"><button type="button" onClick={() => void retryTours()} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm text-[#f2ece6]">Thử lại</button></div>
  </div>;

  const clubName = clubs.find((club) => club.id === activeClub)?.name ?? "CLB";

  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Giải đấu</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">{clubName} · chạm 1 giải để thao tác</p>
      </header>

      {FEATURES.trackerVoiceInput && (
        <FloorVoiceAlertInbox
          tournaments={allVMs}
          onSelect={(id, alertId) => navigate(`/ops/floor/tournaments/${id}/tables?club=${encodeURIComponent(activeClub)}&alert=${encodeURIComponent(alertId)}`)}
        />
      )}

      {metadataError && <div className="rounded-xl bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300/90">{metadataError}</div>}
      <div className="rounded-xl bg-emerald-400/8 px-3 py-2 text-[12px] text-emerald-300/90">
        Dữ liệu thật. Máy chủ phải xác nhận mọi thao tác ghi; lỗi quyền hoặc thiếu RPC sẽ giữ nguyên dữ liệu.
      </div>
      <div className="hidden rounded-xl bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300/90">
        Danh sách <b>thật</b>. Nút trong sheet (cập nhật live / chốt / xoá) đang được nối — sẽ bật sau UAT.
      </div>

      <div className="flex gap-1.5 px-1">
        {FILTERS.map((f) => (
          <button key={f.key} data-ops-action="floor.tournaments.filter" onClick={() => setFilter(f.key)}
            className={cn("ios-press-sm rounded-full px-3 py-1.5 text-[13px] font-medium", filter === f.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="ios-card py-10 text-center text-[14px] text-[#9b8e97]">{filter === "live" ? "Không có giải nào đang chơi." : "Chưa có giải nào."}</div>
      ) : (
        <div className="ios-group">
          {rows.map((r) => (
            <button key={r.id} data-ops-action="floor.tournaments.open_actions" onClick={() => openActions(r)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[16px] font-semibold", r.statusKey === "closed" ? "text-[#9b8e97]" : "text-[#f2ece6]")}>{r.name}</span>
                <span className="mt-0.5 block font-mono text-[12px] text-[#9b8e97]">
                  {r.time} · buy-in {r.buyIn}{r.entries ? ` · ${r.entries} người` : ""}
                </span>
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_CHIP[r.statusKey])}>{r.statusLabel}</span>
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#5f545c]" />
            </button>
          ))}
        </div>
      )}

      <button data-ops-action="floor.tournaments.create_open" onClick={() => { setSel(null); setSub("create"); }} disabled={!hasOwnerAccess} title={!hasOwnerAccess ? "Chỉ owner được tạo giải" : undefined} className="ios-press ios-primary flex w-full items-center justify-center gap-1.5 rounded-2xl py-3.5 text-[16px] font-bold disabled:opacity-40">
        <Plus className="h-5 w-5" /> Tạo giải
      </button>

      {/* A2 — sheet thao tác giải */}
      <Sheet open={sub === "actions"} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">
              {sel?.name}
              <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold", sel ? STATUS_CHIP[sel.statusKey] : "")}>{sel?.statusLabel}</span>
            </SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-center font-mono text-[13px] text-[#9b8e97]">
            {sel?.time} · {sel?.entries ?? 0} người{sel?.level ? ` · L${sel.level} · ${sel.blinds}` : ""}
          </div>
          <div className="mt-4 space-y-1.5">
            <button data-ops-action="floor.tournaments.enter_workspace" onClick={() => { const id = sel?.id; closeAll(); navigate(`/ops/floor/tournaments/${id}/tables?club=${encodeURIComponent(activeClub!)}`); }}
              className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
              <Play className="h-5 w-5 shrink-0" />
              <span className="text-[15px] font-bold">Vào giải (vận hành)</span>
            </button>
            <Row icon={<Activity className="h-5 w-5 text-emerald-300" />} label="Cập nhật live — người / level / blind" onTap={() => go("updateLive")} />
            <Row icon={<Edit className="h-5 w-5 text-[#9b8e97]" />} label="Sửa thông tin giải" onTap={() => go("form")} />
            <Row icon={<Trophy className="h-5 w-5 text-[#d8bc85]" />} label="Cơ cấu thưởng" onTap={() => { const id = sel?.id; closeAll(); navigate(`/ops/floor/tournaments/${id}/payout?club=${encodeURIComponent(activeClub!)}`); }} />
            <Row icon={<History className="h-5 w-5 text-[#9b8e97]" />} label="TV & màn hình" onTap={() => { const id = sel?.id; closeAll(); navigate(`/ops/floor/tournaments/${id}/screens?club=${encodeURIComponent(activeClub!)}`); }} />
          </div>
        </SheetContent>
      </Sheet>

      {/* tạo giải — 2 lựa chọn */}
      <Sheet open={sub === "create"} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Tạo giải</SheetTitle></SheetHeader>
          <div className="mt-3 space-y-1.5">
            <Row icon={<Plus className="h-5 w-5 text-[#d8bc85]" />} label="Tạo mới — điền 5 ô" onTap={() => go("form")} />
          </div>
        </SheetContent>
      </Sheet>

      {/* N1 — form tạo/sửa giải */}
      <Sheet open={sub === "form"} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <SheetContent key={`form-${sel?.id ?? "new"}`} side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">{sel ? "Sửa thông tin giải" : "Tạo giải mới"}</SheetTitle></SheetHeader>
          <div className="mt-3 space-y-2.5">
            <Field label="Tên giải" value={sel?.name ?? "Daily Turbo tối"} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Giờ bắt đầu" value={sel?.time ?? "21:00"} mono />
              <Field label="Ngày" value="07/07" mono />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Buy-in" value="1.000.000" mono />
              <Field label="Stack" value="30.000" mono />
            </div>
            <Field label="Cấu trúc blind" value="Turbo 20 phút — mẫu có sẵn ▾" muted />
          </div>
          <button data-ops-action="floor.tournaments.save" onClick={() => done()} className="ios-press ios-primary mt-4 w-full rounded-2xl py-3 text-[15px] font-bold">
            {sel ? "Lưu thay đổi" : "Tạo giải"}
          </button>
        </SheetContent>
      </Sheet>

      {/* N3 — cập nhật live: bấm ± thay vì gõ */}
      <Sheet open={sub === "updateLive"} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Cập nhật live — {sel?.name}</SheetTitle></SheetHeader>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stepper label="Người còn" value={livePlayers} onDec={() => setLivePlayers((v) => Math.max(0, v - 1))} onInc={() => setLivePlayers((v) => v + 1)} />
            <Stepper label="Level" value={liveLevel} onDec={() => setLiveLevel((v) => Math.max(1, v - 1))} onInc={() => setLiveLevel((v) => v + 1)} />
          </div>
          <div className="mt-2.5">
            <div className="px-1 text-[12px] text-[#9b8e97]">Blind (tự theo level {liveLevel})</div>
            <div className="ios-fill mt-1 rounded-xl py-2.5 text-center font-mono text-[15px] text-[#f2ece6]">2.000 / 4.000 · ante 4.000</div>
          </div>
          <div className="mt-2.5 px-1 text-[12px] text-[#9b8e97]">Trạng thái</div>
          <div className="mt-1 flex flex-wrap gap-1.5 px-1">
            {["Đang chơi", "Giải lao", "Final"].map((st) => (
              <button key={st} data-ops-action="floor.tournaments.select_live_status" onClick={() => setLiveStatus(st)}
                className={cn("ios-press-sm rounded-full px-3 py-1.5 text-[13px] font-medium", liveStatus === st ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-[#9b8e97]")}>
                {st}
              </button>
            ))}
          </div>
          <button data-ops-action="floor.tournaments.update_live" onClick={() => done()} className="ios-press ios-primary mt-4 w-full rounded-2xl py-3 text-[15px] font-bold">Lưu cập nhật</button>
          <div className="mt-2 text-center text-[12px] text-[#7c7079]">đồng hồ và TV cập nhật theo ngay</div>
        </SheetContent>
      </Sheet>

    </div>
  );
}

function Guard({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Giải đấu</h1>
      </header>
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        {icon}
        <div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
        <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>
      </div>
    </div>
  );
}

function Row({ icon, label, onTap }: { icon: React.ReactNode; label: React.ReactNode; onTap: () => void }) {
  return (
    <button data-ops-action="floor.tournaments.sheet_navigation" onClick={onTap} className="ios-press ios-fill flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
      {icon}
      <span className="text-[15px] text-[#f2ece6]">{label}</span>
    </button>
  );
}

function Field({ label, value, mono, muted }: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <div>
      <div className="px-1 text-[12px] text-[#9b8e97]">{label}</div>
      <input
        data-ops-field={label}
        defaultValue={value}
        readOnly={muted}
        className={cn("ios-fill mt-1 w-full rounded-xl px-3 py-2.5 text-[15px] outline-none", mono && "font-mono text-center", muted ? "text-[#9b8e97]" : "text-[#f2ece6]")}
      />
    </div>
  );
}

function Stepper({ label, value, onDec, onInc }: { label: string; value: number; onDec: () => void; onInc: () => void }) {
  return (
    <div className="ios-fill rounded-xl px-2 py-2 text-center">
      <div className="text-[11px] text-[#9b8e97]">{label}</div>
      <div className="mt-1 flex items-center justify-center gap-3">
        <button data-ops-action="floor.tournaments.stepper" onClick={onDec} className="ios-press-sm grid h-8 w-8 place-items-center rounded-lg bg-white/6 text-[#f2ece6]"><Minus className="h-4 w-4" /></button>
        <span className="min-w-[2.5rem] font-mono text-[20px] font-semibold text-[#f2ece6]">{value}</span>
        <button data-ops-action="floor.tournaments.stepper" onClick={onInc} className="ios-press-sm grid h-8 w-8 place-items-center rounded-lg bg-white/6 text-[#f2ece6]"><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
