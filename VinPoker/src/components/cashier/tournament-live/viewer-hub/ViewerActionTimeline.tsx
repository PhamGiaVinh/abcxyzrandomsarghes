import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useViewerAmountUnit } from "@/components/tracker/viewerAmountUnit";
import { formatViewerAmount } from "@/lib/tracker-poker/viewerAmounts";
import type { ViewerActionItem, ViewerStreet } from "./viewerTypes";

const STREET_ORDER: ViewerStreet[] = ["preflop", "flop", "turn", "river", "showdown"];
const STREET_LABEL: Record<ViewerStreet, string> = {
  preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River", showdown: "Showdown",
};
const ACTION_LABEL: Record<string, string> = {
  post_sb: "SB", post_bb: "BB", post_ante: "BBA", check: "Check", call: "Call",
  bet: "Bet", raise: "Raise", all_in: "All-in", fold: "Fold",
};

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

export function ViewerActionTimeline({ actions, bigBlind }: { actions: ViewerActionItem[]; bigBlind: number }) {
  const unit = useViewerAmountUnit();
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;

  return (
    <section className="rounded-xl border border-border/45 bg-background/25" aria-label="Lịch sử hành động">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-xs font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-expanded={open}>
        <span>Lịch sử hành động <span className="font-medium text-muted-foreground">({actions.length})</span></span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="border-t border-border/40 px-2 pb-2">
          {STREET_ORDER.map((street) => {
            const rows = actions.filter((action) => action.street === street);
            if (rows.length === 0) return null;
            return (
              <div key={street} className="pt-2">
                <div className="px-1 pb-1 text-[9px] font-black uppercase tracking-[0.16em] text-[hsl(var(--poker-gold))]">{STREET_LABEL[street]}</div>
                <div className="space-y-1">
                  {rows.map((action) => (
                    <div key={action.actionId} className="grid min-h-11 grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-card/45 px-2 py-1.5">
                      <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg border border-border/60 bg-secondary text-[9px] font-bold text-muted-foreground">
                        {action.avatarUrl ? <img src={action.avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : initials(action.playerName)}
                      </span>
                      <span className="min-w-0"><span className="block truncate text-[11px] font-bold text-foreground">{action.playerName}</span><span className="block text-[9px] text-muted-foreground">{action.seatNumber > 0 ? `Ghế ${action.seatNumber}` : ""}</span></span>
                      <span className="text-right"><span className="block text-[11px] font-bold text-foreground">{ACTION_LABEL[action.actionType] || action.actionType.split("_").join(" ")}{action.amount > 0 ? ` ${formatViewerAmount(action.amount, bigBlind, unit)}` : ""}</span><span className="tracker-num block text-[9px] text-muted-foreground">Pot {formatViewerAmount(action.potAfter, bigBlind, unit)}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
