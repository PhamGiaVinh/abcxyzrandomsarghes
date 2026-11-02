import { useTranslation } from "react-i18next";
import type { TvData } from "@/types/tv";
import { TvHeader } from "./TvHeader";
import { TvStatsBar } from "./TvStatsBar";
import { formatClock, formatVndCompact } from "@/lib/tv/format";
import { FEATURES } from "@/lib/featureFlags";
import { groupPayoutRows } from "@/lib/tv/payoutBands";
import { getDisplayableSatelliteRows } from "@/lib/satellitePayout";

/**
 * Full-screen payout structure (tv_displays.layout = 'payouts').
 * Shows the prize ladder large enough to read across the room, with a small
 * level/clock line so the floor never loses the time.
 */
export function TvPayoutsScreen({ data }: { data: TvData }) {
  const { t } = useTranslation();
  // PR-5 (gated by FEATURES.tvPayoutBandedDisplay): collapse a LIVE_STANDARD run's equal-amount
  // bands (e.g. ranks 10-12) into one "10–12" row instead of 3 duplicate rows, and show more of
  // the ladder. While OFF, behavior is byte-identical to before (first 12 ranks, one row each).
  const banded = FEATURES.tvPayoutBandedDisplay;
  const grouped = banded ? groupPayoutRows(data.prizes, 15) : null;
  const prizes = grouped ? grouped.rows : data.prizes.slice(0, 12).map((p) => ({ label: `${p.position}`, amount: p.amount }));

  // Satellite (nhập tay): giải vé trả ghế + tiền bubble (bubble nằm trong rows) — không qua engine.
  // ĐỊNH NGHĨA displayable dùng CHUNG với cockpit (getDisplayableSatelliteRows) — 2 màn không lệch.
  // Khi có satellite → bảng vé THAY ladder tiền; payload trắng/dở dang ⇒ null ⇒ ladder như cũ.
  const satRows = getDisplayableSatelliteRows(data.satellitePayout, FEATURES.payoutSatelliteManual);

  return (
    <div className="flex h-full min-h-screen w-full flex-col bg-background text-foreground">
      <TvHeader data={data} />
      <main className="flex flex-col items-center justify-center gap-[2.6vmin] px-[4vmin] py-[2vmin] lg:min-h-0 lg:flex-1">
        <div className="text-[3.2vmin] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
          {satRows ? "🎟️ Satellite" : t("tv.rankAwards")}
        </div>
        {data.currentLevel ? (
          <div className="text-[2.2vmin] tabular-nums text-muted-foreground">
            {t("tv.level")} {data.currentLevel.levelNumber} · {formatClock(data.remainingSeconds)}
          </div>
        ) : null}
        {satRows ? (
          <div className="grid w-full max-w-[150vmin] grid-cols-1 gap-x-[6vmin] gap-y-[1.6vmin] sm:grid-cols-2 lg:grid-cols-3">
            {satRows.map((r, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-[2vmin] border-b border-border/40 pb-[0.8vmin]"
              >
                <span className="text-[3.4vmin] font-bold tabular-nums text-primary">{r.label}</span>
                <span className="text-[3.6vmin] font-bold">{r.prize}</span>
              </div>
            ))}
          </div>
        ) : prizes.length > 0 ? (
          <div className="grid w-full max-w-[150vmin] grid-cols-1 gap-x-[6vmin] gap-y-[1.6vmin] sm:grid-cols-2 lg:grid-cols-3">
            {prizes.map((prize) => (
              <div
                key={prize.label}
                className="flex items-baseline justify-between gap-[2vmin] border-b border-border/40 pb-[0.8vmin]"
              >
                <span className="text-[3.4vmin] font-bold tabular-nums text-primary">
                  {prize.label}.
                </span>
                <span className="text-[4vmin] font-bold tabular-nums">
                  {formatVndCompact(prize.amount)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[2.6vmin] text-muted-foreground">{t("tv.noPayouts")}</div>
        )}
        {!satRows && banded && grouped && grouped.truncatedCount > 0 ? (
          <div className="text-[2vmin] text-muted-foreground">+{grouped.truncatedCount} hạng khác</div>
        ) : null}
        {!satRows && prizes.length > 0 && <p className="text-sm text-center text-muted-foreground">{t("tv.rankAwardsHint")}</p>}
        {/* Dòng pool tiền ẨN khi satellite: số VND ngay dưới các dòng "1 vé" trên màn công cộng
            mâu thuẫn với cơ cấu vé vừa tuyên bố. Giải tiền bình thường giữ nguyên. */}
        {!satRows && data.prizePool != null ? (
          <div className="text-[2.8vmin] tabular-nums text-muted-foreground">
            {t("tv.prizePool")}:{" "}
            <span className="font-bold text-foreground">{formatVndCompact(data.prizePool)}</span>
            {data.guarantee != null ? ` · GTD ${formatVndCompact(data.guarantee)}` : ""}
          </div>
        ) : null}
      </main>
      <TvStatsBar data={data} />
    </div>
  );
}
