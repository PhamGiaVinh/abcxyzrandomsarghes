import { useEffect, useRef, useState, type CSSProperties } from 'react';
import './trackerTable.css';

// Physical seats: seat 1 is dealer-left, seat 9 dealer-right. No occupied-seat compaction.
const portraitSeats = { 1: { l: 24, t: 90 }, 2: { l: 16, t: 69 }, 3: { l: 16, t: 33 }, 4: { l: 18, t: 15 }, 5: { l: 50, t: 8 }, 6: { l: 82, t: 15 }, 7: { l: 84, t: 33 }, 8: { l: 84, t: 69 }, 9: { l: 76, t: 90 } };
const landscapeSeats = {
  1: { l: 31, t: 88 }, 2: { l: 9, t: 69 }, 3: { l: 9, t: 32 },
  4: { l: 28, t: 12 }, 5: { l: 50, t: 10 }, 6: { l: 72, t: 12 },
  7: { l: 91, t: 32 }, 8: { l: 91, t: 69 }, 9: { l: 69, t: 88 },
};
export const TRACKER_TABLE_GEOMETRY = {
  portrait: { aspect: '5 / 8', seats: portraitSeats, centerTop: '48%', centerW: '76%', vSize: '0px', maxW: '560px' },
  landscape: { aspect: '1.9 / 1', seats: landscapeSeats, centerTop: '49%', centerW: '52%', vSize: '0px', maxW: '1200px' },
};
export function trackerBetPoint(point: { l: number; t: number }, portrait: boolean) {
  // Keep the upper and lower bets in the gaps beside their owner's pod.
  // A radial inset puts the stack directly on the player's name at iPad widths.
  if (!portrait) {
    if (point.t < 20) {
      // The middle top seat has its own centered lane. Move below the name
      // plate instead of shifting its chips into the neighbouring seat's lane.
      if (point.l === 50) return { l: 50, t: 31 };
      return { l: point.l < 50 ? 31 : 69, t: 28 };
    }
    if (point.t > 80) return { l: point.l < 50 ? 27 : 73, t: 70 };
    return { l: point.l < 50 ? 24 : 76, t: point.t < 50 ? 40 : 62 };
  }
  if (point.t < 20) return { l: point.l === 50 ? 50 : point.l < 50 ? 36 : 64, t: 24 };
  if (point.t < 50) return { l: point.l < 50 ? 37 : 63, t: 36 };
  if (point.t < 80) return { l: point.l < 50 ? 37 : 63, t: 65 };
  return { l: point.l < 50 ? 38 : 62, t: 77 };
}
export function trackerTableSizes(portrait: boolean) {
  const board = portrait ? 'clamp(32px,9.6cqi,42px)' : 'clamp(44px,5.2cqi,60px)';
  const hole = portrait ? 'clamp(25.6px,7.68cqi,33.6px)' : 'clamp(35.2px,4.16cqi,48px)';
  const avatar = portrait ? 'clamp(37px,11cqi,53px)' : 'clamp(52px,6.8cqi,79px)';
  return {
    board: { width: board, height: 'auto', aspectRatio: '5 / 7' } as CSSProperties,
    hole: { width: hole, height: 'auto', aspectRatio: '5 / 7' } as CSSProperties,
    pod: { '--tracker-avatar-size': avatar, width: portrait ? 'clamp(66px,21cqi,98px)' : 'clamp(90px,13.8cqi,154px)' } as CSSProperties,
    avatar: { width: avatar, height: avatar } as CSSProperties,
  };
}
export function useTrackerTableLayout(override?: boolean, measureParent = false) {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const element = measureParent ? ref.current?.parentElement : ref.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth) setNarrow(element.clientWidth < 640); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureParent]);
  return { ref, portrait: override ?? narrow };
}
