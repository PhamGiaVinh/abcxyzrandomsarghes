import { useEffect, useRef, useState, type CSSProperties } from 'react';
import './trackerTable.css';

// Physical seats: seat 1 is dealer-left, seat 9 dealer-right. No occupied-seat compaction.
const portraitSeats = { 1: { l: 24, t: 90 }, 2: { l: 16, t: 69 }, 3: { l: 16, t: 33 }, 4: { l: 18, t: 15 }, 5: { l: 50, t: 8 }, 6: { l: 82, t: 15 }, 7: { l: 84, t: 33 }, 8: { l: 84, t: 69 }, 9: { l: 76, t: 90 } };
const landscapeSeats = { 1: { l: 34, t: 85 }, 2: { l: 12, t: 70 }, 3: { l: 12, t: 31 }, 4: { l: 30, t: 14 }, 5: { l: 50, t: 12 }, 6: { l: 70, t: 14 }, 7: { l: 88, t: 31 }, 8: { l: 88, t: 70 }, 9: { l: 66, t: 85 } };
export const TRACKER_TABLE_GEOMETRY = {
  portrait: { aspect: '5 / 8', seats: portraitSeats, centerTop: '48%', centerW: '76%', vSize: '0px', maxW: '560px' },
  landscape: { aspect: '1.9 / 1', seats: landscapeSeats, centerTop: '51%', centerW: '52%', vSize: '0px', maxW: '1200px' },
};
export function trackerBetPoint(point: { l: number; t: number }, portrait: boolean) {
  // Keep the upper and lower bets in the gaps beside their owner's pod.
  // A radial inset puts the stack directly on the player's name at iPad widths.
  if (!portrait) {
    if (point.t < 20) {
      if (point.l === 50) return { l: 59, t: 28 };
      return { l: point.l < 50 ? 34 : 66, t: 39 };
    }
    if (point.t > 80) return { l: point.l < 50 ? 23 : 77, t: 86 };
    return { l: point.l < 50 ? 24 : 76, t: point.t < 50 ? 40 : 62 };
  }
  if (point.t < 20) return { l: point.l === 50 ? 50 : point.l < 50 ? 33 : 67, t: point.l === 50 ? 24 : 27 };
  if (point.t < 50) return { l: point.l < 50 ? 32 : 68, t: 36 };
  if (point.t < 80) return { l: point.l < 50 ? 32 : 68, t: 65 };
  return { l: point.l < 50 ? 38 : 62, t: 77 };
}
export function trackerTableSizes(portrait: boolean) {
  const board = portrait ? 'clamp(32px,9.6cqi,42px)' : 'clamp(44px,5.2cqi,60px)';
  const hole = portrait ? 'clamp(25.6px,7.68cqi,33.6px)' : 'clamp(35.2px,4.16cqi,48px)';
  const avatar = portrait ? '32px' : 'clamp(40px,4.8cqi,48px)';
  return {
    board: { width: board, height: 'auto', aspectRatio: '5 / 7' } as CSSProperties,
    hole: { width: hole, height: 'auto', aspectRatio: '5 / 7' } as CSSProperties,
    // Cards sit over the avatar; reserve both complete faces with a small gap.
    pod: { width: `calc(${hole} * 2 + 8px)`, '--tracker-top-height': `calc(${hole} * 1.4)` } as CSSProperties,
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
