import { useEffect, type HTMLAttributes } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TvClockScreen } from "@/components/tv/TvClockScreen";
import { TvChrome } from "@/components/tv/TvChrome";
import { TvLevelSound } from "@/components/tv/TvLevelSound";
import { useMockTvData } from "@/lib/tv/mockTvData";
import { useTournamentTvData } from "@/hooks/useTournamentTvData";
import { useTournamentRedrawTv } from "@/hooks/useTournamentRedrawTv";
import { TvRedrawScreen } from "@/components/tv/TvRedrawScreen";
import { FEATURES } from "@/lib/featureFlags";

function TvStatusScreen({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-screen w-full flex-col items-center justify-center gap-[2vmin] px-[6vmin] text-center">
      <div className="text-[5vmin] font-bold text-foreground">{title}</div>
      {hint ? <div className="text-[2.4vmin] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/**
 * TV projection route — renders outside Layout (no app chrome).
 * PR B: real read-only data via useTournamentTvData; ?mock=1 keeps the
 * self-ticking demo (never shown for real tournament IDs without the flag).
 * No operator controls live here. Kiosk shell shared via TvChrome (PR C2).
 */
const TournamentTv = () => {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();

  const isMock = searchParams.get("mock") === "1";
  const redrawSceneRequested = searchParams.get("scene") === "redraw";
  const mockData = useMockTvData(isMock);
  const live = useTournamentTvData(tournamentId, { enabled: !isMock });
  const data = isMock ? mockData : live.data;
  const redraw = useTournamentRedrawTv(tournamentId, FEATURES.floorRedrawSeatLockV1 && !isMock);
  const redrawActive = (redraw.state === "ready" || redraw.state === "stale") && redraw.data !== null;

  const pageTournamentName = redrawActive ? redraw.data?.tournamentName : data?.tournamentName;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = pageTournamentName ? `${pageTournamentName} — TV` : "VinPoker TV";
    return () => {
      document.title = previousTitle;
    };
  }, [pageTournamentName]);

  const showScreen = isMock || (live.state === "ready" && data);

  return (
    <TvChrome
      wrapperProps={{ "data-tournament-id": tournamentId } as HTMLAttributes<HTMLDivElement>}
      overlay={
        <>
          <TvLevelSound data={showScreen && !redrawActive ? data : null} />
          {isMock ? (
            <span className="absolute right-[1.5vmin] top-[11vh] rounded border border-amber-500/50 bg-amber-500/15 px-[1.2vmin] py-[0.4vmin] text-[1.6vmin] font-bold uppercase tracking-widest text-amber-400">
              {t("tv.demo")}
            </span>
          ) : null}
          {!isMock && live.state === "ready" && live.realtimeStatus === "offline" ? (
            <span
              title={t("tv.offline")}
              className="absolute bottom-[1.5vmin] left-[1.5vmin] h-[1.2vmin] w-[1.2vmin] animate-pulse rounded-full bg-amber-500/80"
            />
          ) : null}
          {redrawActive && redraw.state === "stale" ? (
            <span className="absolute right-[1.5vmin] top-[1.5vmin] rounded-full border border-amber-400/40 bg-amber-400/15 px-[1.2vmin] py-[0.5vmin] text-[1.4vmin] font-bold text-amber-200">
              Connection delayed · keeping the last confirmed redraw
            </span>
          ) : null}
        </>
      }
    >
      {redrawActive && redraw.data ? (
        <TvRedrawScreen tournamentName={redraw.data.tournamentName} batch={redraw.data} />
      ) : FEATURES.floorRedrawSeatLockV1 && redraw.state === "loading" ? (
        <TvStatusScreen title="Loading tournament display…" />
      ) : redrawSceneRequested && redraw.state === "error" && !showScreen ? (
        <TvStatusScreen title="Could not load the redraw display" hint="The TV will not recreate movements locally." />
      ) : showScreen && data ? (
        <TvClockScreen data={data} />
      ) : live.state === "loading" ? (
        <TvStatusScreen title={t("tv.loading")} />
      ) : live.state === "auth_required" ? (
        <TvStatusScreen title={t("tv.authRequired")} hint={t("tv.authRequiredHint")} />
      ) : live.state === "not_found" ? (
        <TvStatusScreen title={t("tv.notFound")} hint={t("tv.notFoundHint")} />
      ) : (
        <TvStatusScreen title={t("tv.loadError")} hint={t("tv.loadErrorHint")} />
      )}
    </TvChrome>
  );
};

export default TournamentTv;
