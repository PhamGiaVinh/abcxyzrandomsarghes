import { useTranslation } from "react-i18next";
import type { TvData } from "@/types/tv";
import { formatVndCompact } from "@/lib/tv/format";

export function TvTicker({ data }: { data: TvData }) {
  const { t } = useTranslation();

  if (data.prizes.length === 0 && !data.sponsorText) {
    return <div className="h-[8vh] shrink-0 border-t border-border/60" />;
  }

  return (
    <div className="min-h-[8vh] shrink-0 border-t border-border/60 px-[3vmin] py-[1vmin]">
      <div className="flex items-center gap-[3vmin] overflow-hidden">
      {data.prizes.length > 0 ? (
        <>
          <span className="shrink-0 text-[1.8vmin] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("tv.rankAwards")}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-[2.5vmin] overflow-hidden whitespace-nowrap">
            {data.prizes.map((prize) => (
              <span key={prize.position} className="text-[2.2vmin] tabular-nums text-foreground">
                <span className="font-semibold text-primary">{prize.position}.</span>{" "}
                {formatVndCompact(prize.amount)}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="min-w-0 flex-1" />
      )}
      {data.sponsorText ? (
        <span className="shrink-0 text-[1.8vmin] text-muted-foreground">{data.sponsorText}</span>
      ) : null}
      </div>
      {data.prizes.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t("tv.rankAwardsHint")}</p>}
    </div>
  );
}
