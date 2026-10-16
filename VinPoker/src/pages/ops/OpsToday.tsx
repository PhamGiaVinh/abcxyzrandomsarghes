import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, LayoutGrid, AlertTriangle, Lock, Loader2, LogIn, Users, Trophy } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { useTournaments } from "@/hooks/useTournaments";
import {
  useDealerOperationalTables, useActiveAssignmentsWithTimeline, useCheckedInDealers,
  type DealerAssignment,
} from "@/hooks/useDealerSwing";
import type { Tournament } from "@/types/tournament";

/**
 * "Hôm nay" — cockpit mở đầu mobileOpsV2 — bản NỐI DỮ LIỆU THẬT (reads).
 * Hero = giải đang chạy thật (`useTournaments`); dải chỉ số bàn/dealer + "việc gấp" từ các hook
 * dealer-swing thật (`useDealerOperationalTables` / `useActiveAssignmentsWithTimeline` / `useCheckedInDealers`).
 * READ-ONLY: không nút thao tác tiền. Không fallback mock — trạng thái loading/empty rõ ràng.
 */
type Enriched = DealerAssignment & { isOverdue: boolean; minutesLeft: number | null };
const WD = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const LIVEISH: Tournament["status"][] = ["live", "final_table", "break"];

export default function OpsToday() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { loading: clubsLoading, user, clubs, operatorClubIds, error: clubsError } = useOperatorClubs();
  const scopedIds = operatorClubIds;
  const activeClub = scopedIds[0];

  const { data: tournaments } = useTournaments(activeClub, user?.id);
  const tablesQ = useDealerOperationalTables(scopedIds);
  const asgQ = useActiveAssignmentsWithTimeline(scopedIds);
  const rosterQ = useCheckedInDealers(scopedIds);

  const liveTour = useMemo(() => {
    const list = (tournaments ?? []) as unknown as Tournament[];
    return list.find((t) => LIVEISH.includes(t.status)) ?? null;
  }, [tournaments]);

  const assignments = useMemo(() => (asgQ.data ?? []) as Enriched[], [asgQ.data]);
  const counts = useMemo(() => {
    const active = (tablesQ.data ?? []).filter((t) => (t.status ?? "active") === "active");
    const staffedTableIds = new Set(assignments.map((a) => a.table_id));
    const staffed = active.filter((t) => staffedTableIds.has(t.id)).length;
    return {
      tables: active.length,
      staffed,
      missing: active.length - staffed,
      dealers: (rosterQ.data ?? []).length,
    };
  }, [tablesQ.data, assignments, rosterQ.data]);

  // "Việc gấp" thật: bàn quá giờ xoay + bàn thiếu dealer (từ dealer-swing).
  const urgent = useMemo(() => {
    const items: { id: string; subject: string; kind: "late" | "todo" }[] = [];
    for (const a of assignments) {
      if (a.isOverdue) items.push({ id: `ot-${a.id}`, subject: `${a.game_tables?.table_name ?? "Bàn"} quá giờ xoay dealer`, kind: "late" });
    }
    const staffedTableIds = new Set(assignments.map((a) => a.table_id));
    for (const t of (tablesQ.data ?? []).filter((x) => (x.status ?? "active") === "active")) {
      if (!staffedTableIds.has(t.id)) items.push({ id: `miss-${t.id}`, subject: `${t.table_name} chưa có dealer`, kind: "todo" });
    }
    return items;
  }, [assignments, tablesQ.data]);

  const now = new Date();
  const dateLabel = `${WD[now.getDay()]} · ${now.getDate()} tháng ${now.getMonth() + 1}`;

  // ---- guards (thứ tự chuẩn) ----
  if (clubsLoading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Kiểm tra đăng nhập." />;
  if (!user) return <Guard icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập để xem tình hình hôm nay." />;
  if (clubs === null) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Lấy câu lạc bộ." />;
  if (clubsError) return <Guard icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không tải được phạm vi CLB" sub="Không dùng dữ liệu thay thế. Hãy tải lại trang." />;
  if (!activeClub && !isAdmin) return <Guard icon={<Users className="h-8 w-8 text-amber-300" />} title="Chưa được phân công CLB" sub="Liên hệ quản trị để được gán quyền vận hành." />;
  if (tablesQ.error || asgQ.error || rosterQ.error) return (
    <div role="alert">
      <Guard icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không xác minh được tình hình sàn" sub="Dữ liệu bàn hoặc dealer chưa được xác minh. Không kết luận sàn đang ổn từ dữ liệu cũ." />
      <button className="ios-press-sm mt-3 rounded-full px-4 py-2 text-[#c9a86a]" onClick={() => { tablesQ.refetch(); asgQ.refetch(); rosterQ.refetch(); }}>Thử lại</button>
    </div>
  );
  if (tablesQ.loading || asgQ.loading || rosterQ.loading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang xác minh tình hình sàn…" sub="Đang tải bàn và dealer, chưa có số liệu xác nhận." />;

  return (
    <div className="ios-in space-y-6 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Hôm nay</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">{dateLabel}{clubs && clubs.length ? ` · ${clubs[0].name}` : ""}</p>
      </header>

      {/* LIVE hero — giải đang chạy thật */}
      {liveTour ? (
        <section className="ios-glow">
          <div className="ios-card overflow-hidden p-5">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="ios-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-emerald-300">{liveTour.status === "break" ? "Giải lao" : "Trực tiếp"}</span>
              {liveTour.players_remaining != null && <span className="ml-auto text-[13px] text-[#9b8e97]">Còn {liveTour.players_remaining}</span>}
            </div>
            <h2 className="mt-2 text-[19px] font-semibold text-[#f2ece6]">{liveTour.name}</h2>
            <div className="mt-3 flex items-end gap-3">
              <div className="leading-none">
                <div className="text-[11px] uppercase tracking-wider text-[#9b8e97]">Level</div>
                <div className="mt-1 font-mono text-[44px] font-bold leading-none text-[#c9a86a] [text-shadow:0_2px_16px_rgba(201,168,106,0.35)]">
                  {liveTour.current_level ?? "—"}
                </div>
              </div>
              <div className="mb-1 flex-1 text-[15px] text-[#c8bcc4]">
                <div className="font-mono text-[#f2ece6]">{liveTour.current_blinds ?? "—"}</div>
                {liveTour.average_stack != null && <div className="text-[13px] text-[#9b8e97]">TB {liveTour.average_stack.toLocaleString("vi-VN")}</div>}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2.5">
              <button onClick={() => navigate(`/ops/tables?tour=${liveTour.id}`)} className="ios-press ios-tinted flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-[15px] font-semibold">
                <LayoutGrid className="h-[18px] w-[18px]" /> Sơ đồ bàn
              </button>
              <button onClick={() => navigate(`/ops/tournaments/${liveTour.id}`)} className="ios-press ios-fill flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6]">
                <Trophy className="h-[18px] w-[18px] text-[#d8bc85]" /> Vào giải
              </button>
            </div>
            <div className="mt-2.5 flex items-center justify-center gap-1 text-[12px] text-[#7c7079]">
              <Lock className="h-3 w-3" /> Điều khiển đồng hồ trong "Vào giải" · sửa cấu trúc blind — trên máy tính
            </div>
          </div>
        </section>
      ) : (
        <section className="ios-card flex flex-col items-center gap-2 py-8 text-center">
          <Trophy className="h-7 w-7 text-[#9b8e97]" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Chưa có giải đang chạy</div>
          <button onClick={() => navigate("/ops/tournaments")} className="ios-press-sm mt-1 rounded-full bg-white/8 px-3.5 py-1.5 text-[13px] text-[#c9a86a]">Xem giải đấu</button>
        </section>
      )}

      {/* Dải chỉ số bàn/dealer — thật */}
      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Sàn</h3>
        <div className="ios-card grid grid-cols-4 divide-x divide-white/6 p-1">
          <Count v={counts.tables} label="Bàn mở" tone="text-emerald-300" />
          <Count v={counts.staffed} label="Có dealer" tone="text-sky-300" />
          <Count v={counts.missing} label="Thiếu" tone={counts.missing > 0 ? "text-rose-300" : "text-[#9b8e97]"} />
          <Count v={counts.dealers} label="Dealer" tone="text-[#d8bc85]" />
        </div>
      </section>

      {/* Cần xử lý — thật (bàn quá giờ / thiếu dealer) */}
      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Cần xử lý ({urgent.length})</h3>
          <button onClick={() => navigate("/dealer-swing")} className="ios-press-sm text-[14px] text-[#c9a86a]">Dealer Swing</button>
        </div>
        {urgent.length === 0 ? (
          <div className="ios-card py-6 text-center text-[14px] text-[#9b8e97]">Không có việc gấp — sàn đang ổn.</div>
        ) : (
          <div className="ios-group">
            {urgent.slice(0, 6).map((a) => (
              <button key={a.id} onClick={() => navigate("/dealer-swing")} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 text-left">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${a.kind === "late" ? "bg-rose-400/12 text-rose-300" : "bg-amber-400/12 text-amber-300"}`}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 truncate py-3.5 text-[15px] text-[#f2ece6]">{a.subject}</span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#5f545c]" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Count({ v, label, tone }: { v: number; label: string; tone: string }) {
  return (
    <div className="px-1 py-2.5 text-center">
      <div className={`font-mono text-[26px] font-semibold leading-none ${tone}`}>{v}</div>
      <div className="mt-1.5 text-[11px] text-[#9b8e97]">{label}</div>
    </div>
  );
}

function Guard({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1"><h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Hôm nay</h1></header>
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        {icon}
        <div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
        <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>
      </div>
    </div>
  );
}
