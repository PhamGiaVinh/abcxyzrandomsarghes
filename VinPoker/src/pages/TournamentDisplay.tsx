import { useEffect, type HTMLAttributes } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TvClockScreen } from "@/components/tv/TvClockScreen";
import { TvBreakScreen } from "@/components/tv/TvBreakScreen";
import { TvPayoutsScreen } from "@/components/tv/TvPayoutsScreen";
import { TvAnnouncementScreen } from "@/components/tv/TvAnnouncementScreen";
import { TvChrome } from "@/components/tv/TvChrome";
import { TvLevelSound } from "@/components/tv/TvLevelSound";
import { useTvDisplayState } from "@/lib/tv/useTvDisplayState";
import { selectTvScreen } from "@/lib/tv/selectTvScreen";
import { clearDisplayToken, storeDisplayToken } from "@/lib/tv/displayToken";

function CenterMessage({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-screen w-full flex-col items-center justify-center gap-[2vmin] px-[6vmin] text-center">
      <div className="text-[5vmin] font-bold text-foreground">{title}</div>
      {hint ? <div className="text-[2.4vmin] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/**
 * /display/:displayToken — paired kiosk route (PR C2).
 * Anonymous single read via get_tv_display_state; renders the same
 * TvClockScreen as /tv/:tournamentId. Invalid/expired/revoked tokens clear
 * the device token and return to the pairing screen.
 */
const TournamentDisplay = () => {
  const { displayToken } = useParams<{ displayToken: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { state, data, payload, offline } = useTvDisplayState(displayToken);

  // Direct kiosk links count as this device's identity too.
  useEffect(() => {
    if (state === "ready" || state === "standby") {
      if (displayToken) storeDisplayToken(displayToken);
    }
  }, [state, displayToken]);

  // Revoked/expired/invalid → forget the device token, back to pairing.
  // An unpaired token has no display to show either — pair screen owns it.
  useEffect(() => {
    if (state === "invalid" || state === "unpaired") {
      clearDisplayToken();
      navigate("/tv/pair", { replace: true });
    }
  }, [state, navigate]);

  useEffect(() => {
    const previous = document.title;
    document.title = data
      ? `${data.tournamentName} — TV`
      : payload?.display?.name
        ? `${payload.display.name} — VinPoker TV`
        : "VinPoker TV";
    return () => {
      document.title = previous;
    };
  }, [data?.tournamentName, payload?.display?.name]);

  return (
    <TvChrome
      wrapperProps={{ "data-display-id": payload?.display?.id } as HTMLAttributes<HTMLDivElement>}
      overlay={
        <>
          <TvLevelSound data={state === "ready" && selectTvScreen(payload?.display?.layout, !!data) === "clock" ? data : null} />
          {state === "ready" && offline ? (
            <span
              title={t("tv.offline")}
              className="absolute bottom-[1.5vmin] left-[1.5vmin] h-[1.2vmin] w-[1.2vmin] animate-pulse rounded-full bg-amber-500/80"
            />
          ) : null}
        </>
      }
    >
      {(() => {
        if (state !== "ready" && state !== "standby") {
          return state === "error" ? (
            <CenterMessage title={t("tv.loadError")} hint={t("tv.loadErrorHint")} />
          ) : (
            <CenterMessage title={t("tv.loading")} />
          );
        }
        // Operator-chosen layout (PR C3 dashboard) → screen variant (PR C4).
        const screen = selectTvScreen(payload?.display?.layout, !!data);
        switch (screen) {
          case "clock":
            return data ? <TvClockScreen data={data} /> : null;
          case "break":
            return data ? <TvBreakScreen data={data} /> : null;
          case "payouts":
            return data ? <TvPayoutsScreen data={data} /> : null;
          case "announcement":
            return (
              <TvAnnouncementScreen
                announcement={payload?.display?.announcement ?? null}
                clubName={payload?.display?.club_name ?? null}
                data={data}
              />
            );
          case "multi_placeholder":
            return <CenterMessage title={t("tv.multiBoard")} hint={t("tv.multiBoardSoon")} />;
          case "standby":
          default:
            return (
              <CenterMessage
                title={t("tv.displayStandby")}
                hint={
                  payload?.display?.name
                    ? `${payload.display.name} · ${t("tv.displayStandbyHint")}`
                    : t("tv.displayStandbyHint")
                }
              />
            );
        }
      })()}
    </TvChrome>
  );
};

export default TournamentDisplay;
