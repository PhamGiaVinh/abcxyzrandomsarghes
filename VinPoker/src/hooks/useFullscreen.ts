import { useCallback, useEffect, useState } from "react";

/**
 * Fullscreen state + controls for the whole document.
 * enter() must be called from a user gesture (browser requirement),
 * hence the tap prompt on the TV route instead of auto-entering.
 */
export function useFullscreen(): {
  isFullscreen: boolean;
  isSupported: boolean;
  enter: () => Promise<boolean>;
  exit: () => Promise<void>;
} {
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== "undefined" && document.fullscreenElement != null,
  );

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const enter = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
      return document.fullscreenElement != null;
    } catch {
      // Keep the user gesture retry available when the browser rejects.
      return false;
    }
  }, []);

  const exit = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Ignore.
    }
  }, []);

  return {
    isFullscreen,
    isSupported: typeof document !== "undefined" && document.fullscreenEnabled,
    enter,
    exit,
  };
}
