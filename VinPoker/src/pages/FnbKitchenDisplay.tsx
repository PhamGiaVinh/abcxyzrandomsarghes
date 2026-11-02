import { useState } from "react";
import { Navigate } from "react-router-dom";
import { RefreshCw, UtensilsCrossed } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { TvChrome } from "@/components/tv/TvChrome";
import { useFnbClubs } from "@/hooks/useFnbClubs";
import { FnbClubReadError } from "@/components/fnb/FnbClubReadError";
import { Button } from "@/components/ui/button";
import { useFnbKitchen } from "@/hooks/useFnbKitchen";
import { useFnbLinkTargets } from "@/hooks/useFnbLinkTargets";
import { KitchenTicket } from "@/components/fnb/KitchenTicket";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * F&B Kitchen Display (F6) — live PAID tickets, full-screen kiosk (chrome-less, like /tv).
 * Self-gates on fnbModule + fnbKitchen. Backend already live: `fnb_mark_shipped` + the
 * `fnb_orders`/`fnb_order_items` realtime publication. The board shows PAID-not-yet-shipped orders
 * FIFO; tapping done ships lines and the order drops off when fully shipped (via realtime).
 */
export default function FnbKitchenDisplay() {
  const { loading, clubs, error: clubError, reload: reloadClubs } = useFnbClubs();
  const [clubId, setClubId] = useState<string>("");
  const activeClub = clubs?.find(club => club.id === clubId)?.id ?? clubs?.[0]?.id;
  const { data: orders, isLoading: ordersLoading, isError: ordersError, refetch } = useFnbKitchen(activeClub);
  const { data: linkTargets } = useFnbLinkTargets(activeClub); // resolve real table names for guest orders (no-op unless fnbTableLink/guest on)
  const tableName = (ref: string | null | undefined) => (ref ? linkTargets?.tables.find((t) => t.id === ref)?.table_name ?? null : null);

  // Gate AFTER hooks (rules-of-hooks); FEATURES are module constants so the branch is stable.
  if (!FEATURES.fnbModule || !FEATURES.fnbKitchen) return <Navigate to="/" replace />;
  if (clubError) return <TvChrome><FnbClubReadError message={clubError} onRetry={reloadClubs} /></TvChrome>;

  const tickets = orders ?? [];

  return (
    <TvChrome>
      <div className="flex h-full min-h-screen w-full flex-col gap-3 p-3 sm:gap-[2vmin] sm:px-[3vmin] sm:py-[2vmin]">
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-[2vmin]">
          <div className="flex min-w-0 items-center gap-2 sm:gap-[1.4vmin]">
            <UtensilsCrossed className="h-5 w-5 shrink-0 text-primary sm:h-[3vmin] sm:w-[3vmin]" />
            <h1 className="text-lg font-bold leading-tight text-foreground sm:text-[max(1.125rem,3.2vmin)]">Bếp · Đơn đã thu</h1>
            <span className="rounded-full bg-primary/15 px-2 py-1 text-xs font-semibold tabular-nums text-primary sm:px-[1.4vmin] sm:py-[0.4vmin] sm:text-[max(0.75rem,1.8vmin)]">
              {loading || ordersLoading || ordersError ? "—" : tickets.length}
            </span>
          </div>
          {clubs && clubs.length > 1 ? (
            <Select value={activeClub ?? ""} onValueChange={setClubId}>
              <SelectTrigger className="min-h-11 w-full border-border bg-card text-sm text-foreground sm:w-[28vmin] sm:text-[max(0.875rem,1.8vmin)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <div className="min-w-0 break-words text-xs text-muted-foreground sm:text-[max(0.75rem,1.8vmin)]">{clubs?.[0]?.name ?? ""}</div>
          )}
        </div>

        {loading || (ordersLoading && tickets.length === 0) ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground sm:text-[max(0.875rem,2.4vmin)]">
            <RefreshCw className="mr-[1vmin] h-[2.4vmin] w-[2.4vmin] animate-spin" /> Đang tải…
          </div>
        ) : !activeClub ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground sm:text-[max(0.875rem,2.4vmin)]">
            Bạn chưa được gán vào câu lạc bộ F&amp;B nào.
          </div>
        ) : ordersError ? (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-[1.5vmin] text-center">
            <p className="text-sm text-destructive sm:text-[max(0.875rem,2.4vmin)]">Không tải được danh sách đơn bếp. Chưa thể xác minh trạng thái đơn; hãy tải lại trước khi đánh dấu hoàn tất.</p>
            <Button variant="outline" onClick={() => { void refetch(); }}>Thử tải lại đơn</Button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-[1.5vmin] text-muted-foreground">
            <UtensilsCrossed className="h-12 w-12 opacity-30 sm:h-[8vmin] sm:w-[8vmin]" />
            <div className="text-lg font-semibold sm:text-[max(1.125rem,3vmin)]">Chưa có đơn nào</div>
            <div className="text-sm sm:text-[max(0.875rem,1.8vmin)]">Đơn sẽ tự hiện khi quầy thu tiền.</div>
          </div>
        ) : (
          <div className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 sm:gap-[1.6vmin] lg:grid-cols-3 xl:grid-cols-4">
            {tickets.map((o) => <KitchenTicket key={o.id} order={o} onChanged={() => refetch()} label={tableName(o.table_ref)} />)}
          </div>
        )}
      </div>
    </TvChrome>
  );
}
