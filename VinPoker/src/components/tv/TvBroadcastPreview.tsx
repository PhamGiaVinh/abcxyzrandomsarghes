import { useLayoutEffect, useRef } from "react";
import type { TvData } from "@/types/tv";
import type { TvBrandingLayout } from "@/lib/tv/brandingLayout";
import { useTvStackRange } from "@/hooks/useTvStackRange";
import { TvBroadcastBoardView } from "./TvBroadcastBoardView";

export function TvBroadcastPreview({ data, onLayoutChange, live = false }: {
  data: TvData;
  live?: boolean;
  onLayoutChange: (next: TvBrandingLayout) => void;
}) {
  const range = useTvStackRange(live ? data.tournamentId : undefined, data.playersRemaining, data.totalChips);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!frame.current || !canvas.current) return;
    const outer = frame.current;
    const inner = canvas.current;
    const resize = () => { inner.style.transform = "scale(" + outer.clientWidth / 1920 + ")"; };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(outer);
    return () => observer.disconnect();
  }, []);
  return <div ref={frame} className="relative aspect-video overflow-hidden rounded-xl border">
    <div ref={canvas} className="tv-broadcast-preview absolute left-0 top-0">
      <TvBroadcastBoardView data={data} range={live ? range : undefined} onLayoutChange={onLayoutChange} />
    </div>
  </div>;
}
