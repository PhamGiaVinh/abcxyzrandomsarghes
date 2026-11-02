import { Coffee, RefreshCw, ShieldCheck, Table2, Timer, Users } from "lucide-react";
import type { DealerControlReadModel } from "@/ops/dealer-control/dealerControlReadAdapter";

export function DealerControlWorkspaceView({
  clubName,
  model,
  loading,
  errorCode,
  onRefresh,
}: {
  clubName: string;
  model: DealerControlReadModel | null;
  loading: boolean;
  errorCode: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#d8bc85]">
            <Timer className="h-4 w-4" /> Dealer Control read surface
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em] text-white">Dealer Swing</h1>
          <p className="mt-1 text-sm text-[#91a49b]">{clubName} · chỉ theo dõi ca và bàn</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-sky-300/20 bg-sky-300/8 px-3 py-1 text-xs font-semibold text-sky-200">READ_ONLY</span>
          <button
            type="button"
            data-ops-action="dealer-control.refresh"
            onClick={onRefresh}
            disabled={loading}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#b9c8c0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
            aria-label="Làm mới Dealer Swing"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-sky-300/15 bg-sky-300/8 px-4 py-3 text-sm leading-6 text-sky-100">
        <ShieldCheck className="mr-2 inline h-4 w-4" />
        Không mount gán dealer, swing, nghỉ, checkout, đóng tour, Telegram hoặc payroll. Không có owner-preview bypass khi flag OFF.
      </div>

      {errorCode ? (
        <StateCard title="Không tải được Dealer Swing" detail={errorCode} />
      ) : loading && !model ? (
        <StateCard title="Đang tải snapshot Dealer Swing…" />
      ) : !model ? null : (
        <>
          {!loading&&<p className="text-xs text-[#91a49b]" title="Thời điểm client hoàn tất đọc, không phải thời điểm dữ liệu được sửa trên máy chủ.">
            Đã đọc dữ liệu lúc <time dateTime={model.loadedAt}>{new Date(model.loadedAt).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</time> (UTC+7)
          </p>}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Metric icon={<Users className="h-4 w-4" />} label="Trong ca" value={model.checkedIn} />
            <Metric icon={<ShieldCheck className="h-4 w-4" />} label="Sẵn sàng" value={model.available} />
            <Metric icon={<Table2 className="h-4 w-4" />} label="Đang bàn" value={model.assigned} />
            <Metric icon={<Coffee className="h-4 w-4" />} label="Đang nghỉ" value={model.onBreak} />
          </div>
          <div className="overflow-hidden rounded-3xl border border-white/8 bg-[#07100c]">
            <p className="border-b border-white/7 px-4 py-3 text-xs leading-5 text-[#91a49b]">
              Bàn đang mở: {model.tables.filter((table) => table.status === "in_use").length} · Bàn sẵn sàng: {model.tables.filter((table) => table.status === "available").length} · Cần sửa dữ liệu: {model.tables.filter((table) => table.status === "repair_required" || table.status === "preflight_required").length}
            </p>
            {model.tables.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-[#91a49b]">Không có bàn đang hoạt động.</p>
            ) : [...model.tables].sort((a, b) => tablePriority(a.status) - tablePriority(b.status)).map((table) => (
              <article key={table.id} data-ops-table-id={table.id} className="grid min-w-0 gap-2 border-b border-white/7 px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold text-white">{table.name}</span>
                    {table.needsReplacement && <span className="shrink-0 rounded-full bg-rose-300/10 px-2 py-0.5 text-[10px] font-semibold text-rose-200">CẦN ĐỔI</span>}
                  </div>
                  <p className="mt-1 truncate text-sm text-[#91a49b]">
                    {table.dealerName ?? "Chưa có dealer"}{table.dealerTier ? ` · Tier ${table.dealerTier}` : ""}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-[#b9c8c0]">{table.status === "repair_required" || table.status === "preflight_required" ? "Cần sửa dữ liệu" : table.status === "in_use" ? "Đang mở" : table.status === "available" ? "Sẵn sàng" : table.status}</span>
                  <span className="font-mono text-xs text-[#d8bc85]">{table.swingDueAt ? formatTime(table.swingDueAt) : "—"}</span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/7 bg-[#07100c] px-4 py-3">
      <span className="flex items-center gap-1.5 text-[11px] text-[#91a49b]">{icon}{label}</span>
      <span className="mt-1 block font-mono text-xl font-semibold text-white">{value}</span>
    </div>
  );
}

function StateCard({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-white/8 bg-[#07100c] px-5 text-center">
      <Timer className="h-8 w-8 text-[#91a49b]" />
      <p className="mt-3 font-semibold text-white">{title}</p>
      {detail && <p className="mt-1 font-mono text-xs text-rose-200">{detail}</p>}
    </div>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function tablePriority(status: string): number {
  return status === "in_use" ? 0 : status === "available" ? 1 : 2;
}
