import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mapFnbError } from "@/lib/fnbErrors";
import { fnbOrderMutationOutcome, type FnbOrderMutationRpc } from "@/lib/fnbMutationOutcome";
import type { FnbOrder } from "@/hooks/useFnbOrders";

const ageMins = (paidAt: string | null): number =>
  paidAt ? Math.max(0, Math.floor((Date.now() - new Date(paidAt).getTime()) / 60000)) : 0;

/**
 * One PAID order on the Kitchen Display (F6). Shows table/customer + an age timer (colour escalates
 * the older it gets so the kitchen prioritises) + the line list. "✓ Xong" ships one line; "Tất cả
 * xong" ships the whole order via `fnb_mark_shipped` (live, mig …0003). Realtime refetch is the source
 * of truth — when every line ships the order flips to `shipped` and drops off the board.
 */
export function KitchenTicket({ order, onChanged, label }: { order: FnbOrder; onChanged: () => void; label?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  const ship = async (lineId: string | null) => {
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as unknown as FnbOrderMutationRpc)("fnb_mark_shipped", { p_order_id: order.id, p_line_id: lineId });
      const outcome = fnbOrderMutationOutcome(data, order.id);
      if (error || outcome.kind !== "confirmed") {
        toast.error(mapFnbError(error ?? (outcome.kind === "rejected" ? outcome.code : "FNB_MUTATION_UNKNOWN")));
        return;
      }
      onChanged();
    } catch {
      toast.error(mapFnbError("FNB_MUTATION_UNKNOWN"));
    } finally {
      setBusy(false);
    }
  };

  const mins = ageMins(order.paid_at);
  const ageColor = mins >= 15 ? "text-destructive" : mins >= 8 ? "text-warning" : "text-muted-foreground";
  const hasUnshipped = order.items.some((i) => i.line_status !== "shipped");

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:gap-[1vmin] sm:rounded-[1.4vmin] sm:p-[1.6vmin]">
      <div className="flex items-center justify-between gap-3 sm:gap-[1vmin]">
        <div className="min-w-0 break-words text-base font-bold leading-tight text-foreground sm:text-[max(1rem,2.4vmin)]">
          {label || order.table_label || "Khách lẻ"}{order.guest_seat ? ` · Ghế ${order.guest_seat}` : ""}
        </div>
        <div className={`flex shrink-0 items-center gap-1 text-xs tabular-nums sm:gap-[0.5vmin] sm:text-[max(0.75rem,1.8vmin)] ${ageColor}`}>
          <Clock className="h-4 w-4 sm:h-[1.8vmin] sm:w-[1.8vmin]" /> {mins}′
        </div>
      </div>
      {order.customer_name ? <div className="break-words text-sm text-muted-foreground sm:text-[max(0.875rem,1.6vmin)]">{order.customer_name}</div> : null}

      <div className="flex flex-col gap-2 sm:gap-[0.7vmin]">
        {order.items.map((it) => {
          const shipped = it.line_status === "shipped";
          return (
            <div key={it.id} className="flex items-center justify-between gap-3 sm:gap-[1vmin]">
              <div className={`min-w-0 flex-1 break-words text-sm sm:text-[max(0.875rem,2vmin)] ${shipped ? "text-muted-foreground/50 line-through" : "text-foreground"}`}>
                <span className="font-bold tabular-nums">{it.qty}×</span> {it.name_snapshot}
              </div>
              {shipped ? (
                <Check className="h-5 w-5 shrink-0 text-success/60 sm:h-[2vmin] sm:w-[2vmin]" />
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => ship(it.id)}
                  className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md border border-success/50 px-3 py-2 text-xs font-semibold text-success transition-colors hover:bg-success/15 disabled:opacity-50 sm:gap-[0.4vmin] sm:rounded-[0.8vmin] sm:px-[1.1vmin] sm:py-[0.5vmin] sm:text-[max(0.75rem,1.6vmin)]"
                >
                  <Check className="h-4 w-4 sm:h-[1.6vmin] sm:w-[1.6vmin]" /> Xong
                </button>
              )}
            </div>
          );
        })}
      </div>

      {hasUnshipped ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => ship(null)}
          className="mt-1 min-h-11 min-w-11 rounded-lg bg-success/15 px-3 py-2 text-sm font-semibold text-success transition-colors hover:bg-success/25 disabled:opacity-50 sm:mt-[0.4vmin] sm:rounded-[0.9vmin] sm:py-[0.9vmin] sm:text-[max(0.875rem,1.8vmin)]"
        >
          Tất cả xong
        </button>
      ) : null}
    </div>
  );
}
