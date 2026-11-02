import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useFullscreen } from "@/hooks/useFullscreen";

const CURSOR_IDLE_MS = 3000;

/**
 * Shared kiosk shell for all TV routes: wake lock, one-tap fullscreen prompt
 * (browser user-gesture requirement), idle cursor hide. Extracted from the
 * PR A TournamentTv page so /tv/pair and /display/:token behave identically.
 */
export function TvChrome({
  children,
  overlay,
  wrapperProps,
}: {
  children: ReactNode;
  /** Absolutely-positioned extras (badges, offline dot) rendered above children. */
  overlay?: ReactNode;
  wrapperProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  useWakeLock();
  const { isFullscreen, isSupported, enter } = useFullscreen();
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [fullscreenFailed, setFullscreenFailed] = useState(false);
  const [cursorIdle, setCursorIdle] = useState(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const reset = () => {
      setCursorIdle(false);
      clearTimeout(timeout);
      timeout = setTimeout(() => setCursorIdle(true), CURSOR_IDLE_MS);
    };
    reset();
    window.addEventListener("mousemove", reset);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", reset);
    };
  }, []);

  const showFullscreenPrompt = isSupported && !isFullscreen && !promptDismissed;

  return (
    <div
      {...wrapperProps}
      className={`relative h-screen w-screen overflow-y-auto bg-background lg:overflow-hidden ${cursorIdle ? "cursor-none" : ""} ${wrapperProps?.className ?? ""}`}
    >
      {children}
      {overlay}
      {showFullscreenPrompt ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-[2.5vmin] bg-background/80 backdrop-blur-sm">
          <button
            type="button"
            onClick={async () => {
              setFullscreenFailed(false);
              const entered = await enter();
              if (!entered) setFullscreenFailed(true);
            }}
            className="rounded-full border border-primary/60 bg-primary/10 px-[3vmin] py-[1.4vmin] text-[2.6vmin] font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            {t("tv.fullscreenPrompt")}
          </button>
          {fullscreenFailed ? (
            <p role="alert" className="max-w-[80vw] text-center text-[1.8vmin] text-foreground">
              {t("tv.fullscreenFailed")}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => setPromptDismissed(true)}
            className="text-[1.8vmin] text-muted-foreground underline underline-offset-4"
          >
            {t("tv.fullscreenSkip")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
