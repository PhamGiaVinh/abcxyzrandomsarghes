import { Activity, Radio, RefreshCw, ShieldCheck, Users } from "lucide-react";
import type { TrackerReadModel } from "@/ops/tracker/trackerReadAdapter";

export function TrackerWorkspaceView({
  clubName,
  model,
  loading,
  errorCode,
  onRefresh,
}: {
  clubName: string;
  model: TrackerReadModel | null;
  loading: boolean;
  errorCode: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
            <Radio className="h-4 w-4" /> Tracker read surface
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em] text-white">Theo dõi giải & bàn</h1>
          <p className="mt-1 text-sm text-[#91a49b]">{clubName} · writer controls chưa được mount</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-sky-300/20 bg-sky-300/8 px-3 py-1 text-xs font-semibold text-sky-200">READ_ONLY</span>
          <button
            type="button"
            data-ops-action="tracker.refresh"
            onClick={onRefresh}
            disabled={loading}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#b9c8c0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
            aria-label="Làm mới Tracker"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-sky-300/15 bg-sky-300/8 px-4 py-3 text-sm leading-6 text-sky-100">
        <ShieldCheck className="mr-2 inline h-4 w-4" />
        Chỉ hiển thị snapshot server. Ghi hand, chip, settlement và điều khiển writer bị khóa tới khi concurrency UAT đạt.
      </div>

      {errorCode ? (
        <StateCard title="Không tải được Tracker" detail={errorCode} />
      ) : loading && !model ? (
        <StateCard title="Đang tải snapshot Tracker…" />
      ) : !model?.tournaments.length ? (
        <StateCard title="Không có giải đang vận hành trong CLB này." />
      ) : (
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          {model.tournaments.map((tournament) => (
            <article key={tournament.id} className="min-w-0 rounded-3xl border border-white/8 bg-[#07100c] p-4 sm:p-5">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-white">{tournament.name}</h2>
                  <p className="mt-1 text-xs text-[#91a49b]">
                    {tournament.startTime ? formatDateTime(tournament.startTime) : "Chưa có giờ bắt đầu"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-300/8 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
                  {tournament.status}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Metric icon={<Users className="h-4 w-4" />} label="Người chơi" value={String(tournament.currentPlayers)} />
                <Metric icon={<Activity className="h-4 w-4" />} label="Level" value={tournament.currentLevel == null ? "—" : String(tournament.currentLevel)} />
                <Metric icon={<Radio className="h-4 w-4" />} label="Bàn" value={String(tournament.tables.length)} />
              </div>
              <div className="mt-4 overflow-hidden rounded-2xl border border-white/7">
                {tournament.tables.length === 0 ? (
                  <p className="px-4 py-5 text-center text-sm text-[#91a49b]">Chưa có bàn.</p>
                ) : tournament.tables.map((table) => (
                  <div key={table.id} className="flex items-center gap-3 border-b border-white/7 px-4 py-3 last:border-b-0">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/6 font-mono text-sm font-semibold text-[#d8bc85]">
                      {table.number ?? "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-white">{table.name}</span>
                    <span className="shrink-0 font-mono text-xs text-[#91a49b]">{table.occupiedSeats}/{table.maxSeats}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      {model&&!loading&&!errorCode&&<p className="text-xs text-[#91a49b]" title="Thời điểm màn hình đọc xong, không phải thời điểm dữ liệu server thay đổi.">
        Đã đọc dữ liệu lúc <time aria-label="Thời điểm đọc snapshot" dateTime={model.loadedAt}>{new Date(model.loadedAt).toLocaleTimeString('vi-VN')}</time>
      </p>}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white/[0.035] px-3 py-3">
      <span className="flex items-center gap-1.5 text-[11px] text-[#91a49b]">{icon}{label}</span>
      <span className="mt-1 block truncate font-mono text-lg font-semibold text-white">{value}</span>
    </div>
  );
}

function StateCard({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-white/8 bg-[#07100c] px-5 text-center">
      <Radio className="h-8 w-8 text-[#91a49b]" />
      <p className="mt-3 font-semibold text-white">{title}</p>
      {detail && <p className="mt-1 font-mono text-xs text-rose-200">{detail}</p>}
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
