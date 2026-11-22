// PR-A — Tracker Racetrack Hand-Input UI: shared types (presentational only).
//
// ─── AMOUNT CONTRACT (consumed by PR-B — keep stable) ────────────────────────
//   ActionIntent.amount = the TOTAL chips this seat has committed on THIS street
//   AFTER the action (the "to" value), for: call / bet / raise / all_in.
//   It is 0 for fold / check.
//
//   Given  committed = chips already in this street, stack = chips behind,
//          toCall    = chips still needed to match the current bet:
//     fold / check : 0
//     call         : committed + toCall      (match up to the current street total)
//     bet (no bet) : the TOTAL typed in the pad
//     raise        : the TOTAL typed in the pad ("raise to", NOT the added amount)
//     all_in       : committed + stack       (everything that seat has this street)
//
//   The UI never decides pot / winner / stack / legality — it only emits this intent
//   upward. PR-B reads `amount` as the post-action street total for every betting action.
// ─────────────────────────────────────────────────────────────────────────────

import type { PotBreakdown } from '@/lib/tracker-poker/potEngine';
import type { ActorView } from '@/lib/tracker-poker/handFlow';

export type TrackerAction = 'fold' | 'call' | 'check' | 'raise' | 'bet' | 'all_in';

export interface ActionIntent {
  seatNumber: number; // physical seat 1..9 (anchors layout — never array index)
  action: TrackerAction;
  amount: number; // see AMOUNT CONTRACT above
}

export interface SeatVM {
  playerId?: string; // stable identity for ops-only sub-controls; never derived from display name
  seatNumber: number; // physical seat 1..9
  name: string;
  stack: number; // chips behind (NOT yet committed this street)
  position?: string; // display-only badge: UTG / BU / CO / SB / BB / ...
  committed?: number; // chips already committed this street
  isEmpty?: boolean;
  isFolded?: boolean;
  isAllIn?: boolean;
  lastAction?: string;
  // ─── RICH (optional; consumed only when TrackerRacetrackProps.rich) ──────────
  avatarUrl?: string | null; // player avatar; falls back to initials
  /** Operator-entered hole cards (display strings, e.g. '5♦'). Present only at
   *  showdown/reveal. Face-down backs render when absent; never leaks a value. */
  holeCards?: (string | null)[];
  isMucked?: boolean; // player mucked at showdown → keep cards face-down
}

export interface TrackerRacetrackProps {
  belowBoard?: import("react").ReactNode;
  appearance?: import('./tableAppearance').TableAppearance;
  blinds?: { sb: number; bb: number; ante: number; level?: number | null } | null;
  seats: SeatVM[];
  actingSeatNumber: number | null;
  dealerSeatNumber?: number | null; // optional "D" button puck
  boardCards: string[]; // display strings, e.g. '5♦', 'K♠'
  pot: number;
  bigBlind: number;
  /** Tap a seat (occupied OR empty) — used pre-hand to set the button incl. a dead button. */
  onSeatTap?: (seatNumber: number) => void;
  /** Opens the operational player analytics view without changing the acting seat. */
  onAnalyticsTap?: (seat: SeatVM) => void;
  // ─── RICH props (all optional; omitting them = byte-identical to today) ───────
  /** Master switch. Falsy ⇒ renders exactly as before (no card faces/backs,
   *  avatars, side pots, felt skin). The console sets this from FEATURES.trackerRacetrackRich. */
  rich?: boolean;
  /** Main + side pots (from the hook's existing computePotBreakdown). */
  potBreakdown?: PotBreakdown | null;
  /** The engine's SUGGESTED next actor. When it differs from actingSeatNumber
   *  (operator has tapped elsewhere) a subtle "máy gợi ý" cue marks it. */
  engineToActSeatNumber?: number | null;
  /** True only during showdown / runout-reveal — gates rendering hole-card FACES. */
  showHoleCards?: boolean;
  /** Pre-hand: show a "waiting for dealer" overlay. */
  waiting?: boolean;
  /** Use the portrait seat map + aspect (narrow screens). Default = landscape racetrack. */
  portrait?: boolean;
  /** liveBetChips: render each committed bet as a chip-DISC stack (ChipStack) instead of
   *  the plain text puck. Falsy ⇒ today's text puck (byte-identical). Set from FEATURES.liveBetChips. */
  betChips?: boolean;
  /** trackerFeltDealerFix: nudge bottom seats (1, 9) up + merge the "Tracker đứng đây" cue
   *  into the dealer block so the bottom-center cluster stops overlapping Ghế 1/9 and itself.
   *  Falsy ⇒ today's geometry (byte-identical). Set from FEATURES.trackerFeltDealerFix. */
  dealerFix?: boolean;
  /** trackerFeltV2 (rich only): bigger avatar (44px), 2-line full names, wider pods +
   *  extra anchor tuning so the taller pods still clear the oval. Falsy ⇒ today's pods
   *  (byte-identical). Set from FEATURES.trackerFeltV2. */
  feltV2?: boolean;
}

export interface ForcedAmountPadProps {
  stack: number; // acting seat's chips behind
  committedThisStreet: number; // acting seat's chips already in this street
  minTotal?: number; // soft hint for previews; supplied by the engine in live operation
  enforceMinimum?: boolean;
  onConfirm: (total: number) => void; // returns the TOTAL ("raise to")
  onCancel: () => void;
}

export interface ActionDockProps {
  actingSeat: SeatVM | null;
  view?: ActorView | null;
  disabled?: boolean;
  toCall: number; // chips the acting seat still needs to ADD to match
  bigBlind: number;
  onIntent: (intent: ActionIntent) => void;
  onUndo: () => void;
}
