// Board Entry gate for Tracker Engine Mode (Street Gate). Shown INSTEAD of the
// ActionDock after a betting round closes: the operator must enter the next
// street's cards and "Gửi" (persist) before that street's action can begin.
//
// It only enters cards + calls the parent's existing persist (onSubmit →
// handleUpdateCommunityCards → update_community_cards). It NEVER decides viewer
// state — the viewer sees the board only from persisted
// tournament_hands.community_cards.

import { CardSlotPicker, type Card } from "@/components/shared/CardSlotPicker";

type BoardStreet = "flop" | "turn" | "river";

const STREET_SLOTS: Record<BoardStreet, number[]> = { flop: [0, 1, 2], turn: [3], river: [4] };
const STREET_VI: Record<BoardStreet, string> = { flop: "Flop", turn: "Turn", river: "River" };
const HELPER: Record<BoardStreet, string> = {
  flop: "Preflop đã hoàn tất. Nhập 3 lá flop để chuyển sang vòng Flop.",
  turn: "Vòng Flop đã hoàn tất. Nhập Turn để tiếp tục.",
  river: "Vòng Turn đã hoàn tất. Nhập River để tiếp tục.",
};

interface BoardEntryPanelProps {
  street: BoardStreet;
  /** The fixed 5-slot community-card array from the parent. */
  communityCards: (Card | null)[];
  usedCards: Set<Card>;
  onCardChange: (slotIndex: number, card: Card | null) => void;
  /** Persist via the existing handleUpdateCommunityCards path. */
  onSubmit: () => void;
  submitting?: boolean;
  /** Betting is closed after an all-in; the covering player may retain chips. */
  allInRunout?: boolean;
}

export function BoardEntryPanel({
  street,
  communityCards,
  usedCards,
  onCardChange,
  onSubmit,
  submitting,
  allInRunout,
}: BoardEntryPanelProps) {
  const slots = STREET_SLOTS[street];
  const allFilled = slots.every((i) => communityCards[i] != null);

  return (
    <div className="space-y-3 rounded-2xl border border-emerald-500/40 bg-card p-3.5">
      <h3 className="text-sm font-bold uppercase tracking-wide text-emerald-300">Nhập {STREET_VI[street]}</h3>
      <div className="text-[11px] text-muted-foreground">{HELPER[street]}</div>

      {allInRunout && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          Runout sau all-in: Nhập từng street để cập nhật viewer.
        </div>
      )}

      <div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-700/30 bg-gradient-to-br from-emerald-950/50 to-emerald-900/30 p-3 shadow-inner">
        {slots.map((i) => (
          <CardSlotPicker key={i} value={communityCards[i]} used={usedCards} onChange={(c) => onCardChange(i, c)} />
        ))}
      </div>

      <button
        type="button"
        disabled={submitting || !allFilled}
        onClick={onSubmit}
        className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition active:scale-[0.99] disabled:opacity-40"
      >
        Gửi {STREET_VI[street]}
      </button>
    </div>
  );
}
