import { PokerTable3D } from "./PokerTable3D";
import type { PokerCardViewModel } from "./PokerCard3D";
import type { PokerSeatViewModel } from "./PokerSeat3D";

/**
 * PokerTable3DPreview — local developer preview of the CSS-only pseudo-3D poker
 * table. Five mock scenarios, no backend, no game logic.
 *
 * LOCAL PREVIEW ONLY — this component is intentionally NOT routed. To view it,
 * temporarily import it into a scratch local page/route on your machine. Do NOT
 * commit any App.tsx / router / Layout.tsx change.
 */

// ── Mock helpers (visual only — not a deck, no RNG) ──
const c = (rank: string, suit: PokerCardViewModel["suit"]): PokerCardViewModel => ({ rank, suit });
const back = (): PokerCardViewModel => ({ faceDown: true });

const NINE_MAX: PokerSeatViewModel[] = [
  { seatNumber: 1, playerName: "Bảo (Hero)", stack: 1_850_000, status: "active", cards: [c("A", "spades"), c("K", "spades")] },
  { seatNumber: 2, playerName: "Minh", stack: 920_000, cards: [back(), back()] },
  { seatNumber: 3, playerName: "Trang", stack: 0, status: "all_in", cards: [back(), back()] },
  { seatNumber: 4, playerName: "Hùng Nguyễn", stack: 3_400_000, status: "folded" },
  { seatNumber: 5, playerName: "Lan", stack: 1_200_000, cards: [back(), back()] },
  { seatNumber: 6, playerName: "Đức", stack: 640_000, status: "sitting_out" },
  { seatNumber: 7, playerName: "Khoa", stack: 2_100_000, cards: [back(), back()] },
  { seatNumber: 8, playerName: "An", stack: 75_000, cards: [back(), back()] },
  { seatNumber: 9, playerName: "Vy", stack: 5_300_000, status: "folded" },
];

// Sparse: seats 3 and 5 intentionally missing → empty placeholders at those slots.
const SIX_MAX_SPARSE: PokerSeatViewModel[] = [
  { seatNumber: 1, playerName: "Hero", stack: 540_000, status: "active", cards: [c("Q", "hearts"), c("Q", "diamonds")] },
  { seatNumber: 2, playerName: "Phong", stack: 1_010_000, cards: [back(), back()] },
  { seatNumber: 4, playerName: "Mai", stack: 260_000, status: "all_in", cards: [back(), back()] },
  { seatNumber: 6, playerName: "Tú", stack: 880_000, cards: [back(), back()] },
];

const SHOWDOWN: PokerSeatViewModel[] = [
  { seatNumber: 1, playerName: "Bảo", stack: 0, status: "all_in", cards: [c("A", "hearts"), c("A", "clubs")] },
  { seatNumber: 3, playerName: "Trang", stack: 4_200_000, status: "winner", cards: [c("K", "diamonds"), c("K", "spades")] },
  { seatNumber: 5, playerName: "Lan", stack: 1_500_000, status: "folded" },
  { seatNumber: 7, playerName: "Khoa", stack: 980_000, status: "folded" },
];

function Scenario({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-amber-100">{title}</h2>
        {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export default function PokerTable3DPreview() {
  return (
    <div className="min-h-screen bg-[#070608] px-4 py-8 text-foreground">
      <div className="mx-auto max-w-5xl space-y-12">
        <header className="space-y-1">
          <h1 className="text-2xl font-black tracking-tight text-amber-200">PokerTable3D — Visual Prototype</h1>
          <p className="text-sm text-zinc-400">
            CSS-only pseudo-3D casino table. Not a game engine, not WebGL, no gameplay/RNG/wallet logic — mock data only.
          </p>
        </header>

        <Scenario title="1 · 9-max active hand" subtitle="Active turn, dealer button, flop + turn, mixed statuses, large pot.">
          <PokerTable3D
            seats={NINE_MAX}
            maxSeats={9}
            tableLabel="VINPOKER"
            activeSeatNumber={1}
            dealerSeatNumber={6}
            communityCards={[c("10", "hearts"), c("J", "spades"), c("Q", "clubs"), c("2", "diamonds")]}
            potAmount={2_450_000}
          />
        </Scenario>

        <Scenario title="2 · 6-max short-handed" subtitle="Sparse seats [1,2,4,6] → seats 3 & 5 render as empty placeholders.">
          <PokerTable3D
            seats={SIX_MAX_SPARSE}
            maxSeats={6}
            tableLabel="6-MAX"
            activeSeatNumber={1}
            dealerSeatNumber={2}
            communityCards={[c("A", "diamonds"), c("7", "clubs"), c("3", "hearts")]}
            potAmount={180_000}
          />
        </Scenario>

        <Scenario title="3 · Winner showdown" subtitle="Winner halo on seat 3, hole cards face-up, full river.">
          <PokerTable3D
            seats={SHOWDOWN}
            maxSeats={9}
            tableLabel="SHOWDOWN"
            dealerSeatNumber={1}
            winnerSeatNumbers={[3]}
            communityCards={[c("K", "hearts"), c("9", "spades"), c("4", "clubs"), c("Q", "diamonds"), c("2", "hearts")]}
            potAmount={8_400_000}
          />
        </Scenario>

        <Scenario title="4 · Empty table" subtitle="No players → nine muted-glass placeholders, pot hidden.">
          <PokerTable3D seats={[]} maxSeats={9} tableLabel="OPEN TABLE" />
        </Scenario>

        <Scenario title="5 · Mobile compact" subtitle='size="mobile", variant="dark-red", inside a 390px frame (no horizontal scroll).'>
          <div className="mx-auto w-full max-w-[390px] rounded-2xl border border-white/10 p-2">
            <PokerTable3D
              seats={NINE_MAX}
              maxSeats={9}
              size="mobile"
              variant="dark-red"
              tableLabel="VINPOKER"
              activeSeatNumber={1}
              dealerSeatNumber={6}
              communityCards={[c("10", "hearts"), c("J", "spades"), c("Q", "clubs")]}
              potAmount={2_450_000}
            />
          </div>
        </Scenario>
      </div>
    </div>
  );
}
