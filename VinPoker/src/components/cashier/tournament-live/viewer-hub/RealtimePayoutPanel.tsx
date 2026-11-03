import { Crown, Loader2, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PublicFreshness, PublicPayoutRow } from "./publicSnapshotTypes";

export function RealtimePayoutPanel({ rows, freshness, loading, published }: { rows: PublicPayoutRow[]; freshness?: PublicFreshness; loading: boolean; published: boolean }) {
  const { t } = useTranslation();
  if (loading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!published || rows.length === 0) return <div className="rounded-2xl border border-border/55 bg-card/45 py-12 text-center text-sm text-muted-foreground">Chưa công bố cơ cấu</div>;
  const champion = freshness?.state === "current"
    ? rows.find((row) => row.fromPlace === 1 && row.toPlace === 1 && row.resultStatus === "official" && row.playerName?.trim())
    : undefined;
  return (
    <section className="overflow-hidden rounded-2xl border border-border/55 bg-card/55" aria-label="Cơ cấu giải thưởng">
      <header className="flex min-h-14 items-center gap-2 border-b border-amber-300/20 px-4"><Trophy className="h-5 w-5 text-amber-300" /><h3 className="text-sm font-extrabold uppercase tracking-wider text-amber-200">Giải thưởng</h3></header>
      {freshness?.state !== "current" && <p className="border-b border-border/40 px-4 py-2 text-xs text-amber-400">Dữ liệu giải thưởng đang cập nhật</p>}
      {champion && <div className="flex items-center gap-3 border-b border-amber-300/20 bg-amber-400/10 p-4">
        <Crown className="h-8 w-8 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">{t("liveHub.prizes.champion", "Nhà vô địch")}</p>
          <p className="break-words text-xl font-bold [overflow-wrap:anywhere]">{champion.playerName}</p>
          <p className="tracker-num mt-1 text-lg font-bold text-amber-200">{new Intl.NumberFormat("vi-VN").format(champion.amountPerPlayer)} đ</p>
        </div>
      </div>}
      <div className="grid min-h-11 grid-cols-[3.5rem_minmax(0,1fr)_auto] gap-2 items-center bg-card/70 px-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:px-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><span>Hạng</span><span>Người chơi</span><span>Giải mỗi người</span></div>
      <div className="divide-y divide-border/35">
        {rows.map((row) => <div key={`${row.fromPlace}:${row.toPlace}`} className={`grid min-h-[60px] grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-2 px-3 text-sm sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:px-4 ${row.fromPlace === 1 ? "bg-amber-400/10" : ""}`}>
          <span className="inline-flex items-center gap-1 font-bold">{row.fromPlace <= 3 && <Trophy className="h-3.5 w-3.5 text-amber-400" />}{row.fromPlace === row.toPlace ? `#${row.fromPlace}` : `#${row.fromPlace}–${row.toPlace}`}</span>
          <span className="flex min-w-0 items-center gap-2 font-semibold text-foreground">{row.resultStatus === "official" && row.avatarUrl && <img src={row.avatarUrl} alt="" className="hidden h-8 w-8 rounded-full object-cover sm:block" />}<span className="truncate">{row.resultStatus === "official" ? row.playerName || "—" : "—"}</span></span>
          <span className={`tracker-num whitespace-nowrap text-xs font-extrabold sm:text-sm ${row.fromPlace <= 3 ? "text-amber-200" : "text-foreground"}`}>{new Intl.NumberFormat("vi-VN").format(row.amountPerPlayer)}</span>
        </div>)}
      </div>
    </section>
  );
}
