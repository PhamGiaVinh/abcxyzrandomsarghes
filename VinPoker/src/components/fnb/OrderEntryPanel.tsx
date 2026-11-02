import { useEffect, useMemo, useRef, useState } from "react";
import { useFnbMenu } from "@/hooks/useFnbMenu";
import { useFnbLinkTargets } from "@/hooks/useFnbLinkTargets";
import { formatVND } from "@/lib/format";
import { FEATURES } from "@/lib/featureFlags";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gift, Loader2, Plus, Minus, Receipt } from "lucide-react";

// A2 picker sentinels — Radix Select needs a non-empty item value, so "walk-in" / "no player" get
// their own tokens rather than "" (which Select reserves internally in some versions).
const WALKIN = "__walkin__";
const NO_PLAYER = "__none__";

export type NewOrder = {
  table_label: string | null;
  customer_name: string | null;
  note: string | null;
  client_request_id: string;
  // resolved lines: menu_item_id + qty drive the RPC; name/price drive the confirm dialog preview.
  items: { menu_item_id: string; qty: number; name_snapshot: string; unit_price_snapshot: number }[];
  subtotal_vnd: number;
  // A2 — soft links (reporting-only). Exactly one of {table_ref, table_label} is meaningful: a real
  // pick clears the free-text label; walk-in leaves table_ref null and keeps the free-text label.
  table_ref?: string | null;
  player_ref?: string | null;
};

/**
 * Counter cart builder (presentational — parent owns fnb_create_order via onSubmit). Category chips →
 * active menu tiles (tap to add) → cart with +/- steppers → optional table/customer → submit.
 * IDEMPOTENCY: one crypto.randomUUID() per cart (ref), reused on every submit attempt; parent bumps
 * `resetKey` ONLY after a successful create → the cart clears + a fresh crid is minted for the next
 * order. A failed create keeps the same crid (the retry is idempotent on fnb_orders UNIQUE).
 */
export function OrderEntryPanel({ clubId, submitting, resetKey, onSubmit, onSubmitComp }: {
  clubId: string; submitting: boolean; resetKey: number;
  onSubmit: (o: NewOrder) => void;
  onSubmitComp?: (o: NewOrder) => void;
}) {
  const { data, isLoading, isError: menuError, refetch: reloadMenu } = useFnbMenu(clubId);
  const cats = data?.categories ?? [];
  const items = useMemo(() => (data?.items ?? []).filter((m) => m.is_active), [data]);

  // A failed target read is not a verified empty list. Walk-in orders remain independent.
  const { data: linkTargets, isLoading: linksLoading, isError: linksError, refetch: reloadLinks } = useFnbLinkTargets(clubId);
  const tables = linkTargets?.tables ?? [];
  const players = linkTargets?.players ?? [];
  // A player can legitimately have multiple rows. Select a displayed location, never the first
  // player_id match. Indistinguishable/unknown locations cannot be safely auto-linked.
  const playerLocations = useMemo(() => {
    const rows = (linkTargets?.players ?? []).map(player => ({
      player, key: JSON.stringify([player.player_id, player.table_id, player.seat_number,
        player.seat_id ?? null, player.entry_id ?? null, player.table_session_id ?? null]),
    }));
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
    return rows.filter(row => counts.get(row.key) === 1 && row.player.table_id
      && (linkTargets?.tables ?? []).some(table => table.id === row.player.table_id));
  }, [linkTargets?.players, linkTargets?.tables]);
  const unresolvedLocations = players.length - playerLocations.length + (linkTargets?.unavailable_player_count ?? 0);
  const unresolvedTables = linkTargets?.unavailable_table_count ?? 0;

  const [activeCat, setActiveCat] = useState<string>("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [table, setTable] = useState("");
  const [customer, setCustomer] = useState("");
  const [tablePick, setTablePick] = useState<string>(WALKIN);
  const [playerPick, setPlayerPick] = useState<string>(NO_PLAYER);
  const crid = useRef<string>(crypto.randomUUID());

  // parent bumps resetKey after a successful create → clear cart + mint a new idempotency key.
  useEffect(() => {
    if (resetKey === 0) return;
    setCart({}); setTable(""); setCustomer(""); crid.current = crypto.randomUUID();
    setTablePick(WALKIN); setPlayerPick(NO_PLAYER);
  }, [resetKey]);

  // picking a seated player auto-fills their current table (the player IS at that table already).
  const pickPlayer = (locationKey: string) => {
    setPlayerPick(locationKey);
    if (locationKey === NO_PLAYER) return;
    const p = playerLocations.find(row => row.key === locationKey)?.player;
    if (p?.table_id) setTablePick(p.table_id);
  };

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const dec = (id: string) => setCart((c) => {
    const n = (c[id] ?? 0) - 1; const x = { ...c }; if (n <= 0) delete x[id]; else x[id] = n; return x;
  });

  const lines = useMemo(() => items.filter((m) => cart[m.id]), [items, cart]);
  const subtotal = lines.reduce((s, m) => s + m.price_vnd * cart[m.id], 0);
  const shown = activeCat === "all" ? items : items.filter((m) => m.category_id === activeCat);

  const hasRealTable = FEATURES.fnbTableLink && tablePick !== WALKIN;
  const hasRealPlayer = FEATURES.fnbTableLink && playerPick !== NO_PLAYER;
  const selectedPlayer = playerLocations.find(row => row.key === playerPick)?.player;
  const linksUnavailable = FEATURES.fnbTableLink && (linksLoading || linksError || !linkTargets);
  const invalidSelectedLink = (hasRealTable && (linksUnavailable || !tables.some(t => t.id === tablePick)))
    || (hasRealPlayer && (linksUnavailable || !selectedPlayer || selectedPlayer.table_id !== tablePick));

  const buildOrder = (): NewOrder => ({
    table_label: hasRealTable ? null : (table.trim() || null),
    customer_name: customer.trim() || null,
    note: null,
    client_request_id: crid.current,
    items: lines.map((m) => ({
      menu_item_id: m.id, qty: cart[m.id], name_snapshot: m.name, unit_price_snapshot: m.price_vnd,
    })),
    subtotal_vnd: subtotal,
    table_ref: hasRealTable ? tablePick : null,
    player_ref: hasRealPlayer ? selectedPlayer?.player_id ?? null : null,
  });

  const submit = () => { if (lines.length === 0 || submitting || invalidSelectedLink || isLoading || menuError || !data) return; onSubmit(buildOrder()); };
  const submitComp = () => { if (lines.length === 0 || submitting || invalidSelectedLink || isLoading || menuError || !data) return; onSubmitComp?.(buildOrder()); };

  if (isLoading) {
    return <Card className="p-5"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải thực đơn…</div></Card>;
  }
  if (menuError || !data) {
    return <Card role="alert" className="space-y-3 p-5"><p>Không tải được thực đơn. Chưa thể xác minh món và giá để tạo đơn.</p><Button variant="outline" onClick={()=>void reloadMenu()}>Thử tải lại thực đơn</Button></Card>;
  }
  if (items.length === 0) {
    return <Card className="p-5 text-sm text-muted-foreground">Chưa có món nào đang bán. Thêm món ở tab Quản trị → Thực đơn.</Card>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_320px]">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setActiveCat("all")}
            className={`text-xs px-3 py-1.5 rounded-lg border ${activeCat === "all" ? "bg-primary/10 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            Tất cả
          </button>
          {cats.filter((c) => c.is_active).map((c) => (
            <button key={c.id} onClick={() => setActiveCat(c.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${activeCat === c.id ? "bg-primary/10 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {shown.map((m) => (
            <button key={m.id} onClick={() => add(m.id)}
              className="text-left rounded-lg border border-border bg-card hover:border-primary/40 p-3 transition-colors">
              <div className="text-sm font-medium leading-tight">{m.name}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">{formatVND(m.price_vnd)}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4 flex flex-col">
        <div className="text-sm font-semibold mb-2">Đơn hàng</div>
        {FEATURES.fnbTableLink && (linksError ? (
          <div role="alert" className="mb-3 text-sm text-destructive">
            Không xác minh được danh sách bàn/người chơi. Khách lẻ không gắn bàn vẫn có thể tạo đơn.
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void reloadLinks()}>Thử tải lại bàn/người chơi</Button>
          </div>
        ) : linksUnavailable ? (
          <div role="status" className="mb-3 text-sm text-muted-foreground">Đang tải bàn/người chơi…</div>
        ) : invalidSelectedLink ? (
          <div role="alert" className="mb-3 text-sm text-destructive">Bàn/người chơi đã chọn không còn trong danh sách. Hãy chọn lại trước khi tạo đơn.</div>
        ) : null)}
        {FEATURES.fnbTableLink && !linksUnavailable && unresolvedLocations > 0 && (
          <div role="alert" className="mb-3 text-sm text-destructive">
            Không xác định duy nhất bàn/ghế của {unresolvedLocations} hàng người chơi. Các hàng này chưa thể gắn tự động; hãy xác minh tại Floor. Vẫn có thể chọn bàn hoặc nhập khách lẻ.
          </div>
        )}
        {FEATURES.fnbTableLink && !linksUnavailable && unresolvedTables > 0 && (
          <div role="alert" className="mb-3 text-sm text-destructive">
            Có {unresolvedTables} bàn chưa xác minh được phiên hoạt động. Hãy kiểm tra tại Floor trước khi gắn đơn vào các bàn này.
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <Label className="text-xs text-muted-foreground">Bàn</Label>
            {FEATURES.fnbTableLink ? (
              <>
                <Select value={tablePick} onValueChange={value => { setTablePick(value); setPlayerPick(NO_PLAYER); }} disabled={linksUnavailable}>
                  <SelectTrigger className="bg-card border-border text-foreground h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    <SelectItem value={WALKIN}>Khách lẻ / gõ tay</SelectItem>
                    {tables.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.table_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tablePick === WALKIN && (
                  <Input value={table} onChange={(e) => setTable(e.target.value)} placeholder="vd: Bàn 3"
                    className="bg-card border-border text-foreground h-8 mt-1" />
                )}
              </>
            ) : (
              <Input value={table} onChange={(e) => setTable(e.target.value)} placeholder="vd: Bàn 3"
                className="bg-card border-border text-foreground h-8" />
            )}
          </div>
          <div><Label className="text-xs text-muted-foreground">Khách</Label>
            <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="(tuỳ chọn)"
              className="bg-card border-border text-foreground h-8" /></div>
          {FEATURES.fnbTableLink && (players.length > 0 || hasRealPlayer) && (
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">Người chơi (đang ngồi)</Label>
              <Select value={playerPick} onValueChange={pickPlayer} disabled={linksUnavailable}>
                <SelectTrigger className="bg-card border-border text-foreground h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  <SelectItem value={NO_PLAYER}>— Không chọn —</SelectItem>
                  {playerLocations.map(({player: p, key}) => (
                    <SelectItem key={key} value={key}>
                      {p.name}{p.table_name ? ` · ${p.table_name}${p.seat_number ? ` #${p.seat_number}` : ""}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex-1 space-y-2 min-h-[60px]">
          {lines.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">Bấm món bên trái để thêm.</div>
          ) : lines.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{m.name}</div>
                <div className="text-[11px] text-muted-foreground font-mono">{formatVND(m.price_vnd)}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-6 w-6 border-border" onClick={() => dec(m.id)}><Minus className="w-3 h-3" /></Button>
                <span className="w-5 text-center text-sm font-mono">{cart[m.id]}</span>
                <Button size="icon" variant="outline" className="h-6 w-6 border-border" onClick={() => add(m.id)}><Plus className="w-3 h-3" /></Button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border mt-3 pt-3 space-y-2">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tổng cộng</span><span className="font-mono font-semibold">{formatVND(subtotal)}</span></div>
          <Button className="w-full bg-success hover:bg-success/90 text-success-foreground" disabled={lines.length === 0 || submitting || invalidSelectedLink} onClick={submit}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Receipt className="w-4 h-4 mr-1" />}
            Tạo đơn &amp; thu tiền
          </Button>
          {FEATURES.fnbComp && onSubmitComp && (
            <Button variant="outline" className="w-full border-border text-muted-foreground hover:text-foreground" disabled={lines.length === 0 || submitting || invalidSelectedLink} onClick={submitComp}>
              <Gift className="w-4 h-4 mr-1" /> Comp / Miễn phí
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
