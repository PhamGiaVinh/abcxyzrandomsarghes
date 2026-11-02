import { useTranslation } from "react-i18next";
import type { TvData } from "@/types/tv";
import { formatClock } from "@/lib/tv/format";

export function TvTimer({ data }: { data: TvData }) {
  const { t } = useTranslation();
  const terminal = data.status === 'finished' || data.status === 'cancelled';

  const isPaused =
    (data.status === "live" || data.status === "final_table") && !data.isRunning;

  let timerClass: string;
  if (isPaused) {
    timerClass = "animate-pulse text-amber-400";
  } else if (data.remainingSeconds <= 10) {
    timerClass = "animate-pulse text-red-500";
  } else if (data.remainingSeconds <= 60) {
    timerClass = "text-amber-400";
  } else {
    timerClass = "text-primary drop-shadow-[0_0_3vmin_hsl(var(--primary)/0.4)]";
  }

  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-[1vmin]">
      <div className="text-[3.5vmin] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        {terminal ? t(`tv.${data.status}`) : <>{t("tv.level")} {data.currentLevel?.levelNumber ?? "—"}</>}
      </div>
      <div
        className={`font-mono text-[clamp(4rem,26vmin,30rem)] font-bold leading-none tabular-nums ${timerClass}`}
      >
        {terminal ? '--:--' : formatClock(data.remainingSeconds)}
      </div>
      {isPaused ? (
        <div className="text-[2.4vmin] font-semibold uppercase tracking-widest text-amber-400">
          {t("tv.paused")}
        </div>
      ) : null}
    </div>
  );
}
