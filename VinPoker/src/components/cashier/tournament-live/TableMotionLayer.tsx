import { playPokerLiveSound } from "@/lib/pokerLiveSound";
import { AwardChips } from "./ChipStack";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import type { TableMotionEvent } from "@/lib/tracker-poker/tableMotion";

type Point = { l: number; t: number };

interface TableMotionLayerProps {
  enabled: boolean;
  handKey: string | null;
  events: TableMotionEvent[];
  seatPositions: Record<number, Point>;
  potPosition: Point;
  aspectRatio: number;
  speed?: number;
  dealSound?: boolean;
}

function motionDuration(event: TableMotionEvent, speed: number): number {
  const safeSpeed = Math.max(0.5, Math.min(8, speed));
  const base = event.kind === "deal_hole"
    ? event.seatNumbers.length * 400 + 300
    : event.kind === "showdown_reveal"
      ? event.seatNumbers.length * 45 + 320
      : event.kind === "pot_award"
        ? event.awards.length * 80 + 420
        : event.kind === "board_reveal"
          ? event.cards.length * 45 + 300
          : 280;
  return Math.max(90, base / safeSpeed);
}

function deltaStyle(from: Point, to: Point, aspectRatio: number): CSSProperties {
  return {
    "--tm-dx": `${to.l - from.l}cqi`,
    "--tm-dy": `${(to.t - from.t) / aspectRatio}cqi`,
  } as CSSProperties;
}

function itemTiming(baseMs: number, delayMs: number, speed: number): CSSProperties {
  const safeSpeed = Math.max(0.5, Math.min(8, speed));
  return {
    animationDuration: `${Math.max(80, baseMs / safeSpeed)}ms`,
    animationDelay: `${delayMs / safeSpeed}ms`,
  };
}

export function TableMotionVisual({
  event,
  seatPositions,
  potPosition,
  aspectRatio,
  speed = 1,
  dealSound = false,
}: Omit<TableMotionLayerProps, "enabled" | "handKey" | "events"> & { event: TableMotionEvent }) {
  if (event.kind === "deal_hole") {
    return (
      <>
        {[0, 1].flatMap((round) => event.seatNumbers.map((seatNumber, seatIndex) => {
          const target = seatPositions[seatNumber];
          if (!target) return null;
          const delay = (round * event.seatNumbers.length + seatIndex) * 200;
          return (
            <span
              key={`${round}-${seatNumber}`}
              className="tracker-motion-card tracker-motion-deal"
              onAnimationStart={dealSound ? () => playPokerLiveSound("deal_one", { profile: "tracker", bypassStoredMute: true }) : undefined}
              style={{
                left: `${potPosition.l}%`,
                top: `${potPosition.t}%`,
                ...deltaStyle(potPosition, target, aspectRatio),
                ...itemTiming(260, delay, speed),
              }}
            />
          );
        }))}
      </>
    );
  }

  if (event.kind === "fold_muck") {
    const from = seatPositions[event.seatNumber];
    if (!from) return null;
    return (
      <>
        {[0, 1].map((card) => (
          <span
            key={card}
            className="tracker-motion-card tracker-motion-fold"
            style={{
              left: `${from.l}%`,
              top: `${from.t}%`,
              ...deltaStyle(from, potPosition, aspectRatio),
              ...itemTiming(240, card * 28, speed),
            }}
          />
        ))}
      </>
    );
  }

  if (event.kind === "board_reveal") {
    const source = { l: 50, t: 88 };
    return (
      <>
        {event.cards.map((card, index) => (
          <span
            key={`${card}-${index}`}
            className="tracker-motion-card tracker-motion-board"
            style={{
              left: `${source.l}%`,
              top: `${source.t}%`,
              ...deltaStyle(source, potPosition, aspectRatio),
              ...itemTiming(260, index * 45, speed),
            }}
          />
        ))}
      </>
    );
  }

  if (event.kind === "showdown_reveal") {
    return (
      <>
        {event.seatNumbers.map((seatNumber, index) => {
          const point = seatPositions[seatNumber];
          if (!point) return null;
          return (
            <span
              key={seatNumber}
              className="tracker-motion-showdown"
              style={{ left: `${point.l}%`, top: `${point.t}%`, ...itemTiming(300, index * 45, speed) }}
            />
          );
        })}
      </>
    );
  }

  return (
    <>
      {event.awards.flatMap((award, awardIndex) =>
        award.winnerSeatNumbers.flatMap((seatNumber, winnerIndex) => {
          const target = seatPositions[seatNumber];
          if (!target) return [];
          return [0, 1, 2].map((chip) => (
            <span
              key={`${award.potIndex}-${seatNumber}-${chip}`}
              className="tracker-motion-chip tracker-motion-award"
              style={{
                left: `${potPosition.l}%`,
                top: `${potPosition.t}%`,
                ...deltaStyle(potPosition, target, aspectRatio),
                ...itemTiming(280, awardIndex * 80 + winnerIndex * 35 + chip * 18, speed),
              }}
            ><AwardChips column={chip} /></span>
          ));
        }),
      )}
    </>
  );
}

export function TableMotionLayer({
  enabled,
  handKey,
  events,
  seatPositions,
  potPosition,
  aspectRatio,
  speed = 1,
  dealSound = false,
}: TableMotionLayerProps) {
  const [queue, setQueue] = useState<TableMotionEvent[]>([]);
  const [active, setActive] = useState<TableMotionEvent | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    setQueue([]);
    setActive(null);
    seen.current.clear();
  }, [handKey]);

  useEffect(() => {
    if (!enabled || !handKey) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const fresh = events.filter((event) => event.handId === handKey && !seen.current.has(event.id));
    fresh.forEach((event) => seen.current.add(event.id));
    if (!reduced && fresh.length > 0) setQueue((current) => [...current, ...fresh]);
  }, [enabled, events, handKey]);

  useEffect(() => {
    if (!enabled || active || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setActive(next);
  }, [active, enabled, queue]);

  useEffect(() => {
    if (!enabled || !active) return;
    const next = active;
    const timer = window.setTimeout(() => setActive((current) => current?.id === next.id ? null : current), motionDuration(next, speed));
    return () => window.clearTimeout(timer);
  }, [active, enabled, speed]);

  if (!enabled || !active) return null;
  return (
    <motion.div
      key={active.id}
      data-testid="table-motion-layer"
      data-motion-kind={active.kind}
      className="pointer-events-none absolute inset-0 z-[26] overflow-visible"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      aria-hidden="true"
    >
      <TableMotionVisual
        event={active}
        dealSound={dealSound}
        seatPositions={seatPositions}
        potPosition={potPosition}
        aspectRatio={aspectRatio}
        speed={speed}
      />
    </motion.div>
  );
}
