# Agent Handoff: Premium CSS-only Pseudo-3D Poker Table Visual

**Session:** 3D Poker Visual Design Session (SESSION 5)
**Branch:** `agent/3d-poker-visual` (from `origin/main`)
**Status:** Implemented. Frontend-only visual prototype; not wired into any route or runtime.

> **What this is NOT.** This is a **CSS-only pseudo-3D poker table visual prototype** — the "3D" is a
> CSS gradient / shadow / transform illusion. The `3D` suffix in the file names is a visual style
> label only. This is **NOT a real 3D game, NOT WebGL, NOT a game engine, NOT gameplay**. There is
> **no RNG, no fairness, no wallet/betting, no security, and no game state**. It renders mock view
> models only. No DB / RPC / migration / Edge / backend change exists. Integration with real game
> state is future work.

## 1. Visual goal

A premium casino-style table the app can reuse later for the Live Tracker, Tournament Live view, the
future Game Engine UI, and a player-facing client. Deep red felt, gold/champagne brass rim, dark
casino-room background, soft layered shadows, center pot/chip + community-card area, dealer button,
and player seats around an oval. Mobile-first, dark, props-driven, and not hardcoded to one
screenshot. Red felt is used here intentionally — the global app theme stays PokerVN/Stitch dark
neon-green, and red felt is permitted **only inside poker-table visual components** (this is one).

## 2. Component list (all NEW, under `src/components/poker-visual/`)

- `PokerCard3D.tsx` — one playing card (face-up / face-down / empty). Pure Tailwind, renders standalone.
- `PokerSeat3D.tsx` — one player pod (avatar, name, stack, hole cards, dealer chip, status badge).
- `PokerTable3D.tsx` — the table: felt + rim, seat layout keyed by `seatNumber`, center group, the
  single scoped `<style>` block, variants and sizes.
- `PokerTable3DPreview.tsx` — local developer preview with 5 mock scenarios (default export, **unrouted**).

Type-dependency direction is strictly one-way (no cycles): `PokerCard3D` → `PokerSeat3D` →
`PokerTable3D` → `PokerTable3DPreview`. There is intentionally **no `index.ts` barrel** — import by
direct path.

## 3. Props contracts (verbatim)

```ts
// PokerCard3D.tsx
export interface PokerCardViewModel {
  rank?: string;
  suit?: "hearts" | "diamonds" | "clubs" | "spades";
  faceDown?: boolean;
}

// PokerSeat3D.tsx
export interface PokerSeatViewModel {
  seatNumber: number;
  playerName?: string;
  stack?: number;
  avatarUrl?: string;
  status?: "empty" | "active" | "folded" | "all_in" | "winner" | "sitting_out";
  cards?: PokerCardViewModel[];
}

// PokerTable3D.tsx
export interface PokerTable3DProps {
  seats: PokerSeatViewModel[];
  communityCards?: PokerCardViewModel[];
  potAmount?: number;
  dealerSeatNumber?: number;
  activeSeatNumber?: number;
  winnerSeatNumbers?: number[];
  maxSeats?: 2 | 6 | 9 | 10;        // default 9
  tableLabel?: string;              // default "VINPOKER"
  variant?: "casino-red" | "dark-red" | "minimal";   // default "casino-red"
  size?: "mobile" | "desktop" | "responsive";         // default "responsive"
  className?: string;
}
```

These are **UI view models only** — they are not connected to live game state.

### Security invariant (critical for the future Game Engine)

> **`PokerTable3D` / `PokerCard3D` are dumb renderers. They must never infer or reveal hidden cards.
> The caller must pass `faceDown: true` for cards that should be hidden.**

`PokerCard3D` enforces this at the leaf: when `faceDown` is true it renders the card back and does
**not** place `rank`/`suit` in the DOM at all (not in text, not in `aria-label`). When the real
server/game-engine path is wired in, the server decides which cards are visible to which viewer and
sets `faceDown` accordingly; the renderer never decides visibility on its own.

## 4. Seat positioning rules

- Seats are placed by **`seatNumber`, never array index**. The table builds
  `seatMap = new Map(seats.map(s => [s.seatNumber, s]))` and, for each slot `s` in `0..maxSeats-1`,
  renders seat number `s+1` from `seatMap.get(s+1)`. A seat with `seatNumber: 7` always lands in
  slot 7's coordinate regardless of its position in the array.
- **Orientation:** seat 1 = bottom-center (hero), proceeding clockwise — the standard poker-client
  convention. To reuse this top-anchored (e.g. an operator tracker view), flip/rotate the
  `SEAT_LAYOUTS` map; the math is isolated in `PokerTable3D.tsx`.
- Coordinates come from a static `SEAT_LAYOUTS: Record<2|6|9|10, {left,top}[]>` (percent of the table
  box). A formula fallback (`angle = 90 + slot·360/maxSeats`, `left = 50 + 44·cos`, `top = 50 + 40·sin`,
  clamped to `left∈[8,92]`, `top∈[7,93]`) covers any off-spec `maxSeats`. Each pod is centered with
  `translate(-50%, -50%)`.
- **Sparse arrays / missing seats:** any slot whose seat number is absent renders a muted-glass
  "empty" placeholder at the same fixed coordinate, so the ring always looks complete.

### Duplicate `seatNumber`

A duplicate `seatNumber` is **invalid upstream data**. The renderer's `Map` is last-wins purely to
avoid double-rendering — there is intentionally no extra de-dupe logic in this prototype. A future
tracker/engine adapter should **validate and log duplicates before** passing data to `PokerTable3D`.

## 5. Supported states (all mock/demo)

Empty table · 2 / 6 / 9 / 10-max · active turn (`activeSeatNumber`) · folded (dimmed) · all-in
(red ring + `ALL-IN` badge) · winner (`winnerSeatNumbers`, gold halo + `WIN`) · sitting-out (`OUT`) ·
dealer button (`D` chip) · community cards · pot pill with chip stack. **Effective-status
precedence:** `winner > all_in > folded > sitting_out > active > seated > empty`. States never rely
on color alone — each carries a text badge.

## 6. Mobile behavior

`size="responsive"` (default) and `size="mobile"` use compact pods (xs cards, `formatBuyInShort`
short stacks like "1.8M"), `size="desktop"` uses larger pods + full `formatStack`. The table box is
width-capped (`min(94vw, 560px)` responsive, `420px` mobile, `760px` desktop) with `aspect-ratio
16/11`. No horizontal scroll: outer wrapper is `overflow-hidden` with generous padding, names
`truncate` with a `title`, edge seats are clamped within `[8,92]%` and centered so they stay inside.

## 7. Accessibility notes

- `PokerCard3D` has an `aria-label` ("A of spades" / "face-down card" / "empty card slot").
- `PokerSeat3D` is a `role="group"` with an `aria-label` summarizing seat number, player name,
  effective status, and stack (e.g. "Seat 3, Trang, all-in, 0"). Names also carry a `title`.
- `PokerTable3D` wrapper is a `role="group"` whose `aria-label` summarizes table label, seat count,
  active seat, dealer seat, and pot.
- All status meaning is conveyed by **text badges** (`ACTIVE`/`ALL-IN`/`FOLD`/`WIN`/`OUT`, dealer
  `D`), never color alone.
- Animations respect `prefers-reduced-motion` (see below); the static gold/red rings remain visible
  with motion disabled, so state is never animation-dependent.

## 8. Performance notes

- Pure CSS — no three.js / WebGL / canvas, **no new dependencies**, no JS layout measurement
  (no `ResizeObserver`), no continuous JS work. Responsive sizing is driven by CSS only.
- A single component-scoped `<style>` block (rendered once by `PokerTable3D`, all classes `pv-`
  prefixed) holds the felt radial gradients, brass rim box-shadows, and three subtle `@keyframes`
  (active pulse, winner halo, card reveal). `PokerCard3D`/`PokerSeat3D` are otherwise pure Tailwind.
- The only continuous animations are the active-seat pulse and winner halo (1.7s, opacity/shadow
  only). A `@media (prefers-reduced-motion: reduce)` rule disables every `pv-*` animation.
- **No `tailwind.config.ts` / `index.css` edits** — all colors are arbitrary values or default
  Tailwind palettes, and all keyframes live in the scoped `<style>` (not in the Tailwind config).

## 9. How to integrate later with Tracker (Phase 2 — proposal only)

Write a thin **adapter** that maps existing Live Tracker seat rows → `PokerSeatViewModel[]` /
`communityCards` / `potAmount` and renders `<PokerTable3D … />` read-only. **Zero backend change** —
it consumes the data the tracker already loads. The adapter should validate/log duplicate seat
numbers and decide card visibility (operator/public view) before rendering. Build the adapter as a
spec/handoff first, implement in a separate session.

## 10. How to integrate later with Game Engine (Phase 3 — proposal only)

Map authoritative engine state → `PokerSeatViewModel` / `PokerCardViewModel`. **The Game Engine
remains the source of truth.** The server decides each viewer's visible cards and sets `faceDown`
per the security invariant above; the renderer animates whatever it is given and never infers
hidden cards. Hole cards for other players must arrive as `{ faceDown: true }`.

## 11. How to integrate later with Seat Assignment (proposal only)

Seat Assignment already owns physical seat numbers; because `PokerTable3D` positions by
`seatNumber`, an assignment view can pass its seats directly (sparse arrays are fine — open seats
render as placeholders). This is display-only; seat-assignment writes stay in their own module.

## 12. Future 3D / Three.js proposal (Phase 5 — not now)

CSS pseudo-3D is the correct MVP: fast, light, dependency-free, easy to make responsive and to
merge. Evaluate Three.js / React Three Fiber only **after** performance testing and design approval,
and only once a real game-state model exists — at that point true 3D + physical chip/card/dealing
animation becomes worthwhile. Until then CSS 3D remains the safe baseline.

## 13. Out-of-scope list

Backend / DB / RPC / Edge / migrations; game / betting / RNG / fairness / wallet / security logic;
WebGL / Three.js; a real 3D game runtime or state; routing / layout / dashboard edits (`App.tsx`,
`Layout.tsx`, `CashierDashboard.tsx`, `TournamentLiveView.tsx`); `index.ts` barrel;
`tailwind.config.ts` / `index.css`; the untracked `PokerVisuals.tsx` / `pokerLiveSound.ts`; new
dependencies; wiring into any existing screen. **No scope creep** — do not attach this component to
an existing screen in this session.

## Local preview only

`PokerTable3DPreview` is intentionally **not routed**. To view it, temporarily import it into a
scratch local page/route on your machine and run the dev server — **do not commit any `App.tsx` /
router / `Layout.tsx` change**. The committed diff must contain only the 5 files of this session.

## 14. Rollback notes

Fully self-contained and additive — 4 new components + this doc, all new files, nothing else
touched. To roll back: delete `src/components/poker-visual/` and
`docs/agent-handoffs/three-d-poker-visual.md` (or revert the single feature commit). No imports
elsewhere reference these files, so removal cannot break the app. No DB / migration / Edge / config
changes to undo. No runtime or deploy impact.

## Verification

- `npx tsc --noEmit` — pass
- `npm run build` (vite build) — pass
- Diff proof: `git diff --name-only main...HEAD` lists only the 5 allowed files.

(See the session report for exact output.)
