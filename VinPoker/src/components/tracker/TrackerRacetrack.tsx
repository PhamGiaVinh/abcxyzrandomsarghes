import { TableLogo, TableBlinds } from './TableIdentity';
import { tableAppearanceStyle } from './tableAppearance';
// PR-A — Tracker Racetrack Hand-Input UI: the felt + 9 physical seats + board + pot.
// Presentational only; decides nothing about pot/winner/stack/legality.
//
// RICH MODE (opt-in via props.rich, set from FEATURES.trackerRacetrackRich): adds
// per-seat hole cards (face / face-down) + avatars, main+side-pot chips, a distinct
// "engine suggestion" cue, a pre-hand waiting overlay, a responsive portrait map, and
// the same black-table direction as the public viewer — all reusing existing pieces
// (PokerCard/CardBack, tokens, the liveHub.felt.* i18n keys). When rich is falsy the
// component renders byte-identical to the original racetrack.
import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  DEALER_ANCHOR,
  betPuckPosition,
  FELT,
  RICH_FELT,
  CARD_FACE,
  TRACKER_GEO,
  TRACKER_PORTRAIT_SEATS_FIX,
  PORTRAIT_FIX_ASPECT,
  PORTRAIT_FIX_MIN_H,
  formatChips,
  toBB,
  isRedCard,
} from './constants';
import { PokerCard, CardBack } from '@/components/cashier/tournament-live/PokerVisuals';
import { ChipStack } from '@/components/cashier/tournament-live/ChipStack';
import type { SeatVM, TrackerRacetrackProps } from './types';
import { useTrackerCardStyle } from './TrackerCardStyle';
import { TRACKER_TABLE_GEOMETRY, TRACKER_FELT_STYLE, trackerTableSizes, trackerBetPoint, useTrackerTableLayout } from './trackerTableLayout';
import { formatStack } from '@/components/cashier/tournament-live/handinput/format';

// App number identity (AppDigits-first per tailwind.config) — matches the rest of the app.
const NUM = 'font-display tabular-nums';

/** Narrow-viewport detection for the rich portrait seat map. Off when disabled / SSR / tests. */
function useIsPortrait(enabled: boolean) {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 640px)');
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [enabled]);
  return portrait;
}

function PositionBadge({ position }: { position?: string }) {
  if (!position) return null;
  const p = position.toUpperCase();
  const isBtn = p === 'BTN' || p === 'BU';
  const isBlind = p === 'SB' || p === 'BB';
  const cls = isBtn
    ? 'bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]'
    : isBlind
      ? 'bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]'
      : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]';
  return (
    <span className={`rounded px-1.5 py-px text-[8px] font-bold leading-none ${cls}`}>
      {position}
    </span>
  );
}

function CommunityCard({ card }: { card: string }) {
  if (!card) {
    return (
      <div
        className="flex h-[58px] w-[42px] items-center justify-center rounded-md text-sm"
        style={{ border: CARD_FACE.emptyBorder, color: CARD_FACE.emptyText }}
      >
        ?
      </div>
    );
  }
  return (
    <div
      className="font-display flex h-[58px] w-[42px] items-center justify-center rounded-md text-lg font-bold shadow-md"
      style={{ background: CARD_FACE.bg, color: isRedCard(card) ? CARD_FACE.red : CARD_FACE.text }}
    >
      {card}
    </div>
  );
}

/** Rich per-seat hole cards: face-down backs by default; faces only at showdown/reveal
 *  for revealed, non-mucked players (never leaks a value). */
function HoleCards({ seat, showFaces, cardStyle }: { seat: SeatVM; showFaces: boolean; cardStyle?: CSSProperties }) {
  if (seat.isFolded) return null;
  const cards = seat.holeCards ?? [];
  const revealed = showFaces && !seat.isMucked && cards.some(Boolean);
  return (
    <div className="mb-0.5 flex justify-center gap-0.5">
      {[0, 1].map((i) =>
        revealed ? (
          <PokerCard key={i} card={cards[i] ?? null} size="xs" muted={seat.isFolded} style={cardStyle} />
        ) : (
          <CardBack key={i} size="xs" muted={seat.isFolded} style={cardStyle} />
        ),
      )}
    </div>
  );
}

function SeatAvatar({ seat, feltV2 = false }: { seat: SeatVM; feltV2?: boolean }) {
  return (
    <div
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full border font-bold ${
        feltV2 ? 'h-11 w-11 text-xs' : 'h-8 w-8 text-[10px]'
      }`}
      style={{
        borderColor: 'hsl(var(--poker-gold) / 0.4)',
        background: 'linear-gradient(180deg,#151922,#030407)',
        color: 'hsl(var(--poker-gold))',
      }}
    >
      {seat.avatarUrl ? (
        <img src={seat.avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        (seat.name || '?').slice(0, 2).toUpperCase()
      )}
    </div>
  );
}

function Seat({
  seat,
  anchor,
  isActing,
  isDealerButton,
  isEngineSuggested,
  bigBlind,
  rich,
  showHoleCards,
  holeCardStyle,
  podStyle,
  feltV2 = false,
  unified = false,
  avatarStyle,
  isCurrentActor = false,
  t,
  onTap,
  onAnalyticsTap,
}: {
  seat: SeatVM;
  anchor: { left: number; top: number } | undefined;
  isActing: boolean;
  isDealerButton: boolean;
  isEngineSuggested: boolean;
  bigBlind: number;
  rich: boolean;
  showHoleCards: boolean;
  holeCardStyle?: CSSProperties;
  podStyle?: CSSProperties;
  feltV2?: boolean;
  unified?: boolean;
  avatarStyle?: CSSProperties;
  isCurrentActor?: boolean;
  t: TFunction;
  onTap?: () => void;
  onAnalyticsTap?: () => void;
}) {
  if (!anchor) return null;
  const seatLabel = t('liveHub.seat', 'Ghế {{n}}', { n: seat.seatNumber });

  if (unified) {
    return <div data-tracker-seat={seat.seatNumber} data-seat-selected={isActing} data-seat-acting={isCurrentActor}
      className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 ${seat.isFolded ? 'opacity-60' : ''}`}
      style={{ left: `${anchor.left}%`, top: `${anchor.top}%` }}
      {...(onTap ? { role: 'button', tabIndex: 0, 'aria-label': `${seatLabel} · ${seat.name || t('liveHub.felt.empty', 'trống')}`, 'aria-pressed': isActing,
        onClick: onTap, onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onTap(); } } } : {})}>
      <div className="tracker-seat" style={podStyle}>
        {seat.isEmpty ? <div className="tracker-seat-plate flex min-h-11 items-center justify-center gap-1 border-dashed text-[10px]">{seatLabel}{isDealerButton && <b className="rounded-full bg-amber-300 px-1 text-black">D</b>}</div> : <>
          <div className="tracker-seat-avatar">
            <div className="grid place-items-center overflow-hidden rounded-full border border-amber-200/40 bg-[#0a1712] text-[10px] font-bold text-amber-100" style={avatarStyle}>
              {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" className="h-full w-full object-cover" /> : seat.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="absolute -top-2 left-0 flex gap-0.5"><PositionBadge position={seat.position} />{isDealerButton && <b className="rounded-full bg-amber-300 px-1 text-[8px] text-black">D</b>}</div>
          </div>
          <div className="tracker-seat-cards"><HoleCards seat={seat} showFaces={showHoleCards} cardStyle={holeCardStyle} /></div>
          <div className="tracker-seat-plate" title={`${seat.name} · ${formatChips(seat.stack)} · ${toBB(seat.stack, bigBlind)} BB`}>
            <div className="tracker-seat-name">{seat.name}</div>
            <div className="tracker-seat-stack">{formatStack(seat.stack)}</div>
          </div>
          <div className="mt-0.5 text-[8px] text-amber-100/80">{seat.isAllIn ? 'ALL-IN' : seat.isFolded ? 'FOLD' : `${toBB(seat.stack, bigBlind)} BB`}</div>
          {onAnalyticsTap && <button type="button" aria-label={t('tracker.analytics.openForPlayer', 'Mở phân tích vận hành của {{name}}', { name: seat.name })}
            className="absolute left-0 top-0 z-20 h-11 w-11 rounded-full focus-visible:ring-2 focus-visible:ring-amber-200"
            onClick={event => { event.stopPropagation(); onAnalyticsTap(); }} onKeyDown={event => event.stopPropagation()} />}
        </>}
      </div>
    </div>;
  }

  // ── Empty seat (both modes; rich gets a gold-dashed treatment + keyboard a11y) ──
  if (seat.isEmpty) {
    if (rich) {
      const tapProps = onTap
        ? {
            role: 'button' as const,
            tabIndex: 0,
            'aria-label': seatLabel,
            onClick: onTap,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTap();
              }
            },
          }
        : {};
      return (
        <div
          {...tapProps}
          className={`absolute w-24 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashed px-2 py-3 text-center${onTap ? ' cursor-pointer' : ''}`}
          style={{
            left: `${anchor.left}%`,
            top: `${anchor.top}%`,
            ...podStyle,
            borderColor: 'hsl(var(--poker-gold) / 0.3)',
            background: 'rgba(0,0,0,0.25)',
          }}
        >
          <div className="tracker-display flex items-center justify-center gap-1 text-[10px] text-[hsl(var(--poker-gold)/0.75)]">
            {seatLabel}
            {isDealerButton && (
              <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[hsl(var(--poker-gold))] text-[7px] font-bold text-black">
                D
              </span>
            )}
          </div>
          <div className="tracker-display text-[10px] text-[hsl(var(--poker-gold)/0.5)]">
            {t('liveHub.felt.empty', 'trống')}
          </div>
        </div>
      );
    }
    return (
      <div
        {...(onTap ? { role: 'button' as const, tabIndex: 0, onClick: onTap } : {})}
        className={`absolute w-24 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/0.4)] px-2 py-3 text-center${onTap ? ' cursor-pointer' : ''}`}
        style={{ left: `${anchor.left}%`, top: `${anchor.top}%` }}
      >
        <div className={`flex items-center justify-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] ${NUM}`}>
          {seatLabel}
          {isDealerButton && (
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[hsl(var(--warning))] text-[7px] font-bold text-[hsl(var(--warning-foreground))]">
              D
            </span>
          )}
        </div>
        <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{t('liveHub.felt.empty', 'trống')}</div>
      </div>
    );
  }

  // ── Occupied seat ──────────────────────────────────────────────────────────────
  if (rich) {
    const tapProps = onTap
      ? {
          role: 'button' as const,
          tabIndex: 0,
          'aria-label': `${seatLabel} · ${seat.name}`,
          onClick: onTap,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTap();
            }
          },
        }
      : {};
    return (
      <div
        {...tapProps}
        className={`absolute w-28 -translate-x-1/2 -translate-y-1/2 rounded-xl border px-2 py-1.5 ${
          isActing ? 'z-20 border-[hsl(var(--primary))]' : 'z-10 border-[hsl(var(--poker-gold)/0.22)]'
        } ${seat.isFolded ? 'opacity-45' : ''}${onTap ? ' cursor-pointer' : ''}`}
        style={{
          left: `${anchor.left}%`,
          top: `${anchor.top}%`,
          ...podStyle,
          background: 'linear-gradient(180deg, rgba(13,16,22,0.97), rgba(3,4,7,0.97))',
          boxShadow: isActing
            ? '0 0 0 1.5px hsl(var(--primary)), 0 0 28px -6px hsl(var(--primary))'
            : undefined,
        }}
      >
        {isActing && (
          <span className="pointer-events-none absolute -inset-1 rounded-xl border-[1.5px] border-[hsl(var(--primary))] opacity-40 motion-safe:animate-ping" />
        )}
        {isEngineSuggested && (
          <span
            className="tracker-display pointer-events-none absolute -top-2 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white"
            style={{ background: 'hsl(var(--poker-accent))' }}
          >
            ▸ {t('liveHub.felt.engineHint', 'máy gợi ý')}
          </span>
        )}
        <HoleCards seat={seat} showFaces={showHoleCards} cardStyle={holeCardStyle} />
        <div className="flex items-center justify-between gap-1">
          <span className="tracker-num text-[10px] font-bold text-[hsl(var(--poker-gold)/0.8)]">{seatLabel}</span>
          <div className="flex items-center gap-1">
            {isDealerButton && (
              <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[hsl(var(--poker-gold))] text-[7px] font-bold text-black">
                D
              </span>
            )}
            <PositionBadge position={seat.position} />
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          {onAnalyticsTap ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onAnalyticsTap();
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left outline-none transition-colors hover:bg-emerald-300/5 focus-visible:ring-2 focus-visible:ring-emerald-300"
                aria-label={t('tracker.analytics.openForPlayer', 'Mở phân tích vận hành của {{name}}', { name: seat.name })}
              >
                <SeatAvatar seat={seat} feltV2={feltV2} />
                <span
                  className={`tracker-display min-w-0 text-xs font-semibold text-[hsl(var(--foreground))] ${
                    feltV2 ? 'line-clamp-2 break-words leading-tight' : 'truncate'
                  }`}
                >
                  {seat.name}
                </span>
              </button>
              <div className="tracker-num shrink-0 text-right text-sm font-bold leading-tight text-[hsl(var(--poker-stack))]">
                {formatChips(seat.stack)}
              </div>
            </>
          ) : (
            <>
              <SeatAvatar seat={seat} feltV2={feltV2} />
              <div className="min-w-0">
                {/* feltV2: FULL name on up to 2 lines; keep the stack line visible. */}
                <div
                  className={`tracker-display text-xs font-semibold text-[hsl(var(--foreground))] ${
                    feltV2 ? 'line-clamp-2 break-words leading-tight' : 'truncate'
                  }`}
                >
                  {seat.name}
                </div>
                <div className="tracker-num text-sm font-bold leading-tight text-[hsl(var(--poker-stack))]">
                  {formatChips(seat.stack)}
                </div>
              </div>
            </>
          )}
        </div>
        {seat.isAllIn ? (
          <div className="mt-0.5 inline-block rounded bg-[hsl(var(--destructive)/0.18)] px-1 text-[8px] font-bold text-[hsl(var(--destructive))]">
            ALL-IN
          </div>
        ) : seat.isFolded ? (
          <div className="tracker-display text-[9px] text-[hsl(var(--muted-foreground))]">FOLD</div>
        ) : (
          <div className="tracker-num text-[9px] text-[hsl(var(--poker-stack)/0.65)]">{toBB(seat.stack, bigBlind)} BB</div>
        )}
      </div>
    );
  }

  return (
    <div
      {...(onTap ? { role: 'button' as const, tabIndex: 0, onClick: onTap } : {})}
      className={`absolute w-24 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-[hsl(var(--card)/0.94)] px-2 py-1.5 ${
        isActing ? 'z-20 border-[hsl(var(--primary))]' : 'z-10 border-[hsl(var(--border))]'
      } ${seat.isFolded ? 'opacity-40 grayscale' : ''}${onTap ? ' cursor-pointer' : ''}`}
      style={{
        left: `${anchor.left}%`,
        top: `${anchor.top}%`,
        boxShadow: isActing
          ? '0 0 0 1.5px hsl(var(--primary)), 0 0 30px -6px hsl(var(--primary))'
          : undefined,
      }}
    >
      {isActing && (
        <span className="pointer-events-none absolute -inset-1 rounded-xl border-[1.5px] border-[hsl(var(--primary))] opacity-40 motion-safe:animate-ping" />
      )}
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[10px] font-bold text-[hsl(var(--foreground))] ${NUM}`}>
          {seatLabel}
        </span>
        <div className="flex items-center gap-1">
          {isDealerButton && (
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[hsl(var(--warning))] text-[7px] font-bold text-[hsl(var(--warning-foreground))]">
              D
            </span>
          )}
          <PositionBadge position={seat.position} />
        </div>
      </div>
      <div className="truncate text-xs font-semibold text-[hsl(var(--foreground))]">{seat.name}</div>
      <div className={`text-sm font-bold leading-tight text-[hsl(var(--primary))] ${NUM}`}>
        {formatChips(seat.stack)}
      </div>
      <div className={`text-[9px] text-[hsl(var(--primary)/0.6)] ${NUM}`}>
        {toBB(seat.stack, bigBlind)} BB
      </div>
      {seat.isAllIn ? (
        <div className="mt-0.5 inline-block rounded bg-[hsl(var(--destructive)/0.18)] px-1 text-[8px] font-bold text-[hsl(var(--destructive))]">
          ALL-IN
        </div>
      ) : seat.isFolded ? (
        <div className={`text-[9px] text-[hsl(var(--muted-foreground))] ${NUM}`}>FOLD</div>
      ) : null}
    </div>
  );
}

export function TrackerRacetrack({
  seats,
  actingSeatNumber,
  dealerSeatNumber,
  boardCards,
  belowBoard,
  pot,
  bigBlind,
  onSeatTap,
  onAnalyticsTap,
  rich = false,
  potBreakdown,
  engineToActSeatNumber,
  showHoleCards = false,
  waiting = false,
  portrait: portraitProp,
  betChips = false,
  dealerFix = false,
  feltV2 = false,
  appearance,
  blinds,
}: TrackerRacetrackProps) {
  const { t } = useTranslation();
  const unified = !!useTrackerCardStyle();
  const layout = useTrackerTableLayout(portraitProp, true);
  const detectedPortrait = useIsPortrait(!!rich);
  const portrait = unified ? layout.portrait : rich && (portraitProp ?? detectedPortrait);
  const sharedGeo = portrait ? TRACKER_TABLE_GEOMETRY.portrait : TRACKER_TABLE_GEOMETRY.landscape;
  const sharedSizes = trackerTableSizes(portrait);
  const geo = portrait ? TRACKER_GEO.portrait : TRACKER_GEO.landscape;
  const seatsMap = geo.seats;
  // feltV2 applies its pod growth on LANDSCAPE only — a 390px portrait oval physically
  // lacks room for nine 128px pods (measured: 6 pod-pod overlaps + dealer collisions),
  // so portrait keeps the v1 metrics (already overlap-free since the A1a tuning).
  const v2 = feltV2 && rich && !portrait;
  // The rich PORTRAIT felt with the dealer fix ON uses the de-crowded anchor map + a
  // taller oval (see below). Landscape and the flag-OFF path are unaffected.
  const portraitFix = portrait && dealerFix;
  // v2: the taller pods reach further down from the top row — drop the pot/board
  // center 4% so the pot label never sits under a pod (measured on /__dev/tracker).
  const centerTop = unified ? parseFloat(sharedGeo.centerTop) : rich ? geo.centerTop + (v2 ? 4 : 0) : 40;

  // trackerFeltDealerFix: felt-geometry corrections, all gated by the ONE flag.
  //  • RICH PORTRAIT (narrow viewport): the base TRACKER_PORTRAIT_SEATS + the old ±7
  //    nudges left the 9 rich pods overlapping at 390px (5 pod-pod overlaps + seats 1/9
  //    hitting the dealer block). Swap in the bespoke TRACKER_PORTRAIT_SEATS_FIX map,
  //    which pairs with the taller PORTRAIT_FIX_ASPECT oval (below) for a clean fit.
  //  • LANDSCAPE — unchanged, byte-identical:
  //    · Bottom seats 1 (dealer-left) / 9 (dealer-right) sit in the dealer station's lane
  //      → lift them up off it (~7% of the felt).
  //    · RICH top-row seats 4/5/6 carry face-down hole-card backs ABOVE the pod, which
  //      overflow the oval's top rim and get clipped → nudge the top row DOWN into the felt.
  // OFF path + every other seat: byte-identical.
  const seatAnchor = (n: number) => {
    if (unified) { const point = sharedGeo.seats[n as keyof typeof sharedGeo.seats]; return point ? { left: point.l, top: point.t } : undefined; }
    const a = seatsMap[n];
    // v2 (rich landscape): taller pods (44px avatar + 2-line name) need the SAME top-row
    // drop as dealerFix (the extra height covers the rim on its own) + a bit more bottom
    // lift off the dealer station; v2 works with OR without dealerFix (independence).
    if (!a || (!dealerFix && !v2)) return a;
    // Rich PORTRAIT + dealerFix: swap in the de-crowded portrait anchor map (#827). Reached
    // only when dealerFix is on (v2 is false in portrait, so the guard above needs dealerFix).
    if (portrait) return TRACKER_PORTRAIT_SEATS_FIX[n] ?? a;
    if (n === 1 || n === 9) return { left: a.left, top: a.top - (v2 ? 9 : 7) };
    if (rich && (n === 4 || n === 5 || n === 6)) {
      return { left: a.left, top: a.top + (n === 5 ? 7 : 5) };
    }
    // dealerFix-only nudges apply to 1/9 + rich 4/5/6 above; nothing else moves.
    return a;
  };

  // Show the engine's suggested seat ONLY when it differs from the seat being entered.
  const engineSuggestSeat =
    rich && engineToActSeatNumber != null && engineToActSeatNumber !== actingSeatNumber
      ? engineToActSeatNumber
      : null;
  const sidePots = rich && potBreakdown && potBreakdown.sidePots.length > 0 ? potBreakdown.pots : null;
  const boardCardStyle: CSSProperties | undefined = rich
    ? portrait
      ? { width: 'clamp(22px,8.4cqi,40px)', height: 'clamp(31px,11.8cqi,56px)' }
      : { width: 'clamp(26px,4.6cqi,48px)', height: 'clamp(36px,6.4cqi,66px)' }
    : undefined;
  const holeCardStyle: CSSProperties | undefined = rich
    ? portrait
      ? { width: 'clamp(15px,6.2cqi,26px)', height: 'clamp(21px,8.7cqi,36px)' }
      : { width: 'clamp(16px,3.0cqi,30px)', height: 'clamp(22px,4.2cqi,42px)' }
    : undefined;
  const podStyle: CSSProperties | undefined = rich
    ? v2
      ? { width: 'clamp(108px,14cqi,132px)' } // v2 is landscape-only (see above)
      : portrait
        ? { width: 'clamp(82px,24cqi,112px)' }
        : { width: 'clamp(92px,12cqi,112px)' }
    : undefined;

  return (
    <>
    <div
      ref={layout.ref}
      data-tracker-table={unified ? (portrait ? 'portrait' : 'landscape') : undefined}
      className={unified ? 'tracker-unified relative mx-auto my-4 w-full rounded-[9999px]' : `relative w-full rounded-[9999px] min-h-[360px] ${rich ? (portrait ? 'overflow-visible' : 'overflow-hidden') : 'overflow-hidden aspect-[13/6]'}`}
      style={unified ? { ...TRACKER_FELT_STYLE, ...tableAppearanceStyle(appearance), borderRadius: portrait ? '38% / 22%' : '28% / 42%', aspectRatio: sharedGeo.aspect, maxWidth: sharedGeo.maxW, containerType: 'inline-size' } : rich ? { ...RICH_FELT, aspectRatio: portraitFix ? PORTRAIT_FIX_ASPECT : geo.aspect, minHeight: portraitFix ? PORTRAIT_FIX_MIN_H : undefined, containerType: 'inline-size' } : FELT}
    >
      {/* Center: pot + board */}
      <div
        className="absolute w-[320px] -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ left: '50%', top: `${centerTop}%`, ...(unified ? { width: sharedGeo.centerW } : {}) }}
      >
        <div
          className={`text-[10px] uppercase tracking-[0.16em] ${
            rich ? 'tracker-display text-[hsl(var(--poker-gold)/0.7)]' : 'text-white/40'
          }`}
        >
          {unified && <TableLogo url={appearance?.logoUrl} />}
          {t('liveHub.felt.potTotal', 'Tổng Pot')}
        </div>
        <div
          className={
            rich
              ? 'tracker-num text-[27px] font-bold leading-tight text-[hsl(var(--poker-gold))]'
              : `text-[27px] font-bold leading-tight text-[hsl(var(--primary))] ${NUM}`
          }
          style={rich ? undefined : { textShadow: '0 0 22px hsl(var(--primary) / 0.3)' }}
        >
          {formatChips(pot)}
        </div>
        {sidePots && (
          <div className="mt-1.5 flex flex-wrap justify-center gap-1">
            {sidePots.map((p, i) => (
              <span
                key={i}
                className={`tracker-num rounded-full border bg-black/40 px-2 py-0.5 text-[10px] font-bold ${
                  i === 0
                    ? 'border-emerald-400/40 text-emerald-300'
                    : 'border-[hsl(var(--poker-gold)/0.4)] text-[hsl(var(--poker-gold))]'
                }`}
              >
                {i === 0 ? t('liveHub.felt.main', 'Main') : t('liveHub.felt.side', 'Side {{i}}', { i })}{' '}
                {formatChips(p.amount)}
                <span className="ml-1 font-normal opacity-60">({p.eligible_player_ids.length})</span>
              </span>
            ))}
          </div>
        )}
        {unified && <div><TableBlinds {...blinds} /></div>}
        <div data-testid="board-cards" className="mt-2.5 flex justify-center gap-1.5">
          {boardCards.map((card, i) =>
            rich || unified ? (
              <PokerCard key={i} card={card || null} size="md" style={unified ? sharedSizes.board : boardCardStyle} />
            ) : (
              <CommunityCard key={i} card={card} />
            ),
          )}
        </div>
      </div>

      {/* Committed-chip pucks (behind seats). liveBetChips → chip-DISC stack (ChipStack);
          else today's text puck (byte-identical — the OFF branch is untouched). */}
      {seats.map((seat) => {
        const anchor = seatAnchor(seat.seatNumber);
        if (!anchor || seat.isEmpty || seat.isFolded || !seat.committed) return null;
        const sharedPuck = trackerBetPoint({ l: anchor.left, t: anchor.top }, portrait);
        const puck = unified ? { left: sharedPuck.l, top: sharedPuck.t } : betPuckPosition(anchor);
        if (betChips) {
          return (
            <div
              key={`bet-${seat.seatNumber}`}
              data-tracker-bet={unified ? seat.seatNumber : undefined}
              title={formatChips(seat.committed)}
              className="absolute z-[4] -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${puck.left}%`, top: `${puck.top}%` }}
            >
              <ChipStack
                label={unified ? formatStack(seat.committed) : formatChips(seat.committed)}
                allIn={!!seat.isAllIn}
                sizeStyle={{ width: '15px', fontSize: '9px' }}
              />
            </div>
          );
        }
        return (
          <div
            key={`bet-${seat.seatNumber}`}
            data-tracker-bet={unified ? seat.seatNumber : undefined}
            className={`absolute z-[4] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-bold ${
              rich
                ? 'tracker-num border-[hsl(var(--poker-gold)/0.4)] bg-black/40 text-[hsl(var(--poker-gold))]'
                : `border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))] ${NUM}`
            }`}
            style={{ left: `${puck.left}%`, top: `${puck.top}%` }}
          >
            {unified ? formatStack(seat.committed) : formatChips(seat.committed)}
          </div>
        );
      })}

      {/* Seats */}
      {seats.map((seat) => (
        <Seat
          key={seat.seatNumber}
          seat={seat}
          anchor={seatAnchor(seat.seatNumber)}
          isActing={seat.seatNumber === actingSeatNumber}
          isDealerButton={seat.seatNumber === dealerSeatNumber}
          isEngineSuggested={seat.seatNumber === engineSuggestSeat}
          bigBlind={bigBlind}
          rich={rich}
          showHoleCards={showHoleCards}
          holeCardStyle={unified ? sharedSizes.hole : holeCardStyle}
          podStyle={unified ? sharedSizes.pod : podStyle}
          avatarStyle={sharedSizes.avatar}
          unified={unified}
          isCurrentActor={engineToActSeatNumber === seat.seatNumber}
          feltV2={v2}
          t={t}
          onTap={onSeatTap ? () => onSeatTap(seat.seatNumber) : undefined}
          onAnalyticsTap={onAnalyticsTap && seat.playerId ? () => onAnalyticsTap(seat) : undefined}
        />
      ))}

      {/* Human dealer station — fixed bottom-center */}
      <div
        className={`absolute z-[7] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-xl border px-3.5 py-1.5 ${
          rich
            ? 'border-[hsl(var(--poker-gold)/0.45)]'
            : 'border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--warning)/0.1)]'
        }`}
        style={{
          left: `${DEALER_ANCHOR.left}%`,
          top: `${unified ? 98 : DEALER_ANCHOR.top}%`,
          ...(unified ? { padding: '3px 6px', maxWidth: '24%' } : {}),
          background: rich ? 'hsl(var(--poker-gold) / 0.1)' : undefined,
        }}
      >
        <div className="leading-tight">
          <b
            className={`block text-xs font-bold tracking-[0.1em] ${
              rich ? 'tracker-display text-[hsl(var(--poker-gold))]' : 'text-[hsl(var(--warning))]'
            }`}
          >
            DEALER
          </b>
          <span className={`${unified ? 'hidden' : ''} text-[8px] text-[hsl(var(--muted-foreground))]`}>
            {t('liveHub.felt.dealerHere', 'người chia · cố định')}
          </span>
          {dealerFix && !unified && (
            <span
              className={`mt-0.5 block text-[8px] font-bold uppercase tracking-[0.14em] ${
                rich ? 'tracker-display text-[hsl(var(--poker-gold))]' : 'text-[hsl(var(--primary))]'
              }`}
            >
              ▲ {t('liveHub.felt.trackerHere', 'Tracker đứng đây')}
            </span>
          )}
        </div>
      </div>

      {/* Tracker cue — separate bottom element; merged into the dealer block above when
          dealerFix (else the two bottom-center elements overlap on a short felt). */}
      {!dealerFix && !unified && (
        <div className="absolute bottom-1.5 left-1/2 z-[7] -translate-x-1/2 text-center">
          <div className={`text-xs leading-none ${rich ? 'text-[hsl(var(--poker-gold))]' : 'text-[hsl(var(--primary))]'}`}>▲</div>
          <div
            className={`text-[8.5px] font-bold uppercase tracking-[0.14em] ${
              rich ? 'tracker-display text-[hsl(var(--poker-gold))]' : 'text-[hsl(var(--primary))]'
            }`}
          >
            {t('liveHub.felt.trackerHere', 'Tracker đứng đây')}
          </div>
        </div>
      )}

      {/* Pre-hand waiting overlay (rich) */}
      {rich && waiting && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="tracker-display rounded-lg bg-black/45 px-5 py-2.5 text-sm text-zinc-200 backdrop-blur-sm">
            {t('liveHub.felt.waiting', 'Chờ dealer bắt đầu hand...')}
          </div>
        </div>
      )}
    </div>
    {belowBoard}
    </>
  );
}
