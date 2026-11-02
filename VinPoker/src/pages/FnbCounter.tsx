import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FEATURES } from "@/lib/featureFlags";
import { formatVND } from "@/lib/format";
import { mapFnbError } from "@/lib/fnbErrors";
import { fnbOrderMutationOutcome, type FnbOrderMutationRpc } from "@/lib/fnbMutationOutcome";
import { useFnbCreateIntent } from "@/hooks/useFnbCreateIntent";
import { fnbShiftBackend } from "@/lib/fnbShiftIntent";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import type { FnbCreatePayload } from "@/lib/fnbCreateIntent";
import { useAuth } from "@/hooks/useAuth";
import { useFnbClubs } from "@/hooks/useFnbClubs";
import { FnbClubReadError } from "@/components/fnb/FnbClubReadError";
import { useFnbOrders, type FnbOrder } from "@/hooks/useFnbOrders";
import { useFnbLinkTargets, type FnbLinkTargets } from "@/hooks/useFnbLinkTargets";
import { OrderEntryPanel, type NewOrder } from "@/components/fnb/OrderEntryPanel";
import { FnbConfirmPaymentDialog, type PayableOrder } from "@/components/fnb/FnbConfirmPaymentDialog";
import { ShiftReconciliationPanel } from "@/components/fnb/ShiftReconciliationPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Wallet, X } from "lucide-react";

/**
 * F&B counter (/fnb) — flow B: build a cart → create a PENDING order → take payment (fnb_mark_paid).
 * Gate FEATURES.fnbModule && fnbCounter (dark). Pay/cancel buttons gate on the cashier facet for
 * affordance; the server re-enforces. mark_paid can throw RECIPE_REQUIRED / INSUFFICIENT_STOCK — the
 * tx aborts and the order stays PENDING (retryable in "Chờ thanh toán"). Untyped fnb_* client.
 */
export default function FnbCounter() {
  if (!FEATURES.fnbModule || !FEATURES.fnbCounter) return <Navigate to="/" replace />;
  return <FnbCounterInner />;
}

function FnbCounterInner() {
  const { user, session, loading: authLoading, isClubOwner, isAdmin, isFnb, isFnbCashier } = useAuth();
  const { clubs, error: clubError, reload: reloadClubs } = useFnbClubs();
  const [clubId, setClubId] = useState("");

  const isOperator = isFnb || isClubOwner || isAdmin;
  const canPay = isFnbCashier || isClubOwner || isAdmin; // affordance only — server re-checks

  if (clubError) return <FnbClubReadError message={clubError} onRetry={reloadClubs} />;
  if (authLoading || clubs === null) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-6 space-y-3">
        <Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!isOperator) {
    return <div className="container mx-auto max-w-5xl px-4 py-6"><Card><CardContent className="py-6 text-sm text-muted-foreground">Khu vực quầy F&amp;B chỉ dành cho nhân viên F&amp;B.</CardContent></Card></div>;
  }
  if (clubs.length === 0) {
    return <div className="container mx-auto max-w-5xl px-4 py-6"><Card><CardContent className="py-6 text-sm text-muted-foreground">Bạn chưa được gán vào câu lạc bộ F&amp;B nào.</CardContent></Card></div>;
  }

  const activeClub = clubs.find(club => club.id === clubId)?.id ?? clubs[0].id;
  let backend='invalid';try{backend=fnbShiftBackend(import.meta.env.VITE_SUPABASE_URL);}catch{/* Mutation hook fails closed. */}
  return <FnbCounterScope key={`${user?.id ?? "anonymous"}:${sessionReadEpoch(session)}:${backend}:${activeClub}`} clubs={clubs}
    actorId={user?.id ?? ''} activeClub={activeClub} setClubId={setClubId} canPay={canPay} />;
}

function FnbCounterScope({clubs,actorId,activeClub,setClubId,canPay}: {
  clubs: {id:string;name?:string|null}[];actorId:string;activeClub:string;setClubId:(id:string)=>void;canPay:boolean;
}) {
  const qc = useQueryClient();
  const current = useRef(true);
  useEffect(() => { current.current=true; return () => { current.current=false; }; }, []);
  const [resetKey, setResetKey] = useState(0);
  const [payOrder, setPayOrder] = useState<PayableOrder | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [compOpen, setCompOpen] = useState(false);
  const [compOrder, setCompOrder] = useState<NewOrder | null>(null);
  const [compReason, setCompReason] = useState("");
  const submittedRequest = useRef<string|null>(null);
  const clearOwnDraft=(requestId:string)=>{
    if(submittedRequest.current!==requestId)return;
    submittedRequest.current=null;
    setResetKey(k=>k+1);setCompOpen(false);setCompOrder(null);setCompReason('');
  };
  const invalidate = () => qc.invalidateQueries({ queryKey: ["fnb", "orders", activeClub] });
  const journal=useFnbCreateIntent(actorId,activeClub,async(intent,order,resumed)=>{
    clearOwnDraft(intent.requestId);
    await invalidate();if(!current.current)return;
    if(intent.operation==='comp')toast.success(resumed?'Đã đối chiếu đơn COMP. Hãy xem trạng thái hiện tại; không ghi COMP lần nữa.':'Đã ghi COMP — kho đã trừ.');
    else if(resumed)toast.success('Đã đối chiếu đơn. Mở Chờ thanh toán để tải trạng thái và số tiền hiện tại trước khi thu.');
  },intent=>{
    clearOwnDraft(intent.requestId);
    toast.success('Đã hủy yêu cầu chưa ghi. Yêu cầu đến muộn không thể tạo đơn.');
  });
  const creating=journal.busy,comping=journal.busy;
  const payload=(o:NewOrder,operation:'order'|'comp'):FnbCreatePayload=>({source:'counter',table:o.table_label,customer:o.customer_name,note:o.note,
    lines:o.items.map(it=>({menu_item_id:it.menu_item_id,qty:it.qty})),
    ...(operation==='order'?{table_ref:FEATURES.fnbTableLink?o.table_ref??null:null,player_ref:FEATURES.fnbTableLink?o.player_ref??null:null}:{reason:compReason.trim()||null})});

  const createOrder = async (o: NewOrder) => {
    if(journal.busy||journal.pending||journal.blocked)return;
    submittedRequest.current=o.client_request_id;
    const result=await journal.submit('order',o.client_request_id,payload(o,'order'));
    if(!result||!current.current||result.resumed||result.order.status!=='pending')return;
    if(result.order.subtotal_vnd!==o.subtotal_vnd){toast.error('Giá tại máy chủ đã thay đổi. Mở Chờ thanh toán để tải lại đơn trước khi thu.');return;}
    setPayOrder({
      id: result.order.id,
      table_label: o.table_label,
      customer_name: o.customer_name,
      subtotal_vnd: result.order.subtotal_vnd,
      items: o.items.map((it) => ({ name_snapshot: it.name_snapshot, qty: it.qty, unit_price_snapshot: it.unit_price_snapshot })),
    });
    setPayOpen(true);
  };

  const doPay = async () => {
    if (!payOrder) return;
    setPaying(true);
    try {
      const { data, error } = await (supabase.rpc as unknown as FnbOrderMutationRpc)("fnb_mark_paid", { p_order_id: payOrder.id });
      if (!current.current) return;
      if (error) { toast.error(mapFnbError(error)); return; }
      const outcome = fnbOrderMutationOutcome(data, payOrder.id);
      if (outcome.kind !== "confirmed") {
        toast.error(mapFnbError(outcome.kind === "rejected" ? outcome.code : "FNB_MUTATION_UNKNOWN"));
        return;
      }
      toast.success(outcome.idempotent ? "Đơn này đã thu tiền trước đó." : "Đã thu tiền — đơn xuống bếp.");
      setPayOpen(false); setPayOrder(null);
    } catch {
      if (current.current) toast.error(mapFnbError("FNB_MUTATION_UNKNOWN"));
    } finally {
      setPaying(false);
      void invalidate();
    }
  };

  const handleCompClick = (o: NewOrder) => {
    setCompOrder(o); setCompReason(""); setCompOpen(true);
  };

  const doComp = async () => {
    if (!compOrder||journal.busy||journal.pending||journal.blocked) return;
    const draft=compOrder;setCompOpen(false);
    submittedRequest.current=draft.client_request_id;
    await journal.submit('comp',draft.client_request_id,payload(draft,'comp'));
  };

  const payPending = (ord: FnbOrder) => {
    setPayOrder({ id: ord.id, table_label: ord.table_label, customer_name: ord.customer_name, subtotal_vnd: ord.subtotal_vnd, items: ord.items });
    setPayOpen(true);
  };

  const cancel = async (id: string, reason: string) => {
    setBusyId(id);
    try {
      const { data, error } = await (supabase.rpc as unknown as FnbOrderMutationRpc)("fnb_cancel_order", { p_order_id: id, p_reason: reason });
      if (!current.current) return;
      if (error) { toast.error(mapFnbError(error)); return; }
      const outcome = fnbOrderMutationOutcome(data, id);
      if (outcome.kind !== "confirmed") {
        toast.error(mapFnbError(outcome.kind === "rejected" ? outcome.code : "FNB_MUTATION_UNKNOWN"));
        return;
      }
      toast.success(outcome.idempotent ? "Đơn đã được huỷ trước đó." : "Đã huỷ đơn.");
    } catch {
      if (current.current) toast.error(mapFnbError("FNB_MUTATION_UNKNOWN"));
    } finally {
      setBusyId(null);
      void invalidate();
    }
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" /> F&amp;B · Quầy thu ngân</h1>
          <p className="text-xs text-muted-foreground">Gọi món = trả trước. Tạo đơn → thu tiền → đơn xuống bếp.</p>
        </div>
        {clubs.length > 1 && (
          <div className="w-full max-w-xs">
            <Label className="mb-1 block text-xs text-muted-foreground">Câu lạc bộ</Label>
            <Select value={activeClub} onValueChange={setClubId}>
              <SelectTrigger className="bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground">
                {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {!canPay && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          Bạn không có vai trò Thu ngân — có thể tạo đơn nhưng nút thu tiền/huỷ bị khoá (chủ CLB cấp quyền ở Quản trị → Nhân sự).
        </div>
      )}
      {(journal.pending||journal.message)&&<Card role="alert" className="p-4 space-y-2 text-sm">
        <p>{journal.message??'Yêu cầu tạo đơn chưa được xác minh. Không tạo mã mới.'}</p>
        {journal.pending&&<><p>Mã {journal.pending.operation==='comp'?'COMP':'đơn'}: {journal.pending.requestId}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={journal.busy||journal.blocked} onClick={()=>void journal.recover()}>Đối chiếu đơn</Button>
            <Button variant="outline" disabled={journal.busy||journal.blocked||journal.readOnlyRecovery} onClick={()=>void journal.retry()}>Gửi lại cùng mã đơn</Button>
            <Button variant="outline" disabled={journal.busy||journal.blocked||journal.readOnlyRecovery} onClick={()=>void journal.cancel()}>Hủy yêu cầu chưa ghi</Button>
          </div></>}
        {journal.pending&&<p className="text-xs text-muted-foreground">Hủy chỉ ngăn yêu cầu chưa ghi. Nếu đơn đã được ghi, hệ thống sẽ đối chiếu đơn đó, không hoàn tác hoặc tự thu tiền.</p>}
      </Card>}

      <Tabs defaultValue="new" className="w-full">
        <TabsList>
          <TabsTrigger value="new">Tạo đơn</TabsTrigger>
          <TabsTrigger value="pending">Chờ thanh toán</TabsTrigger>
          <TabsTrigger value="paid">Đã thu</TabsTrigger>
          {FEATURES.fnbShifts && <TabsTrigger value="shift">Chốt ca</TabsTrigger>}
        </TabsList>

        <TabsContent value="new" className="mt-4">
          <fieldset disabled={journal.blocked||journal.busy||!!journal.pending} className="min-w-0">
            <OrderEntryPanel clubId={activeClub} submitting={creating||journal.blocked||!!journal.pending} resetKey={resetKey} onSubmit={createOrder} onSubmitComp={canPay ? handleCompClick : undefined} />
          </fieldset>
        </TabsContent>

        <TabsContent value="pending" className="mt-4">
          <OrdersTab clubId={activeClub} status="pending" emptyText="Không có đơn chờ thanh toán.">
            {(o) => (
              <>
                <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" disabled={!canPay || busyId === o.id} onClick={() => cancel(o.id, "Huỷ tại quầy")}>
                  <X className="w-3.5 h-3.5 mr-1" /> Huỷ
                </Button>
                <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground" disabled={!canPay || busyId === o.id} onClick={() => payPending(o)}>
                  <Wallet className="w-3.5 h-3.5 mr-1" /> Thu tiền
                </Button>
              </>
            )}
          </OrdersTab>
        </TabsContent>

        <TabsContent value="paid" className="mt-4">
          <OrdersTab clubId={activeClub} status="paid" emptyText="Chưa có đơn đã thu.">
            {(o) => (
              <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" disabled={!canPay || busyId === o.id} onClick={() => cancel(o.id, "Hoàn tại quầy")}>
                {busyId === o.id ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <X className="w-3.5 h-3.5 mr-1" />} Huỷ / Hoàn
              </Button>
            )}
          </OrdersTab>
        </TabsContent>

        {FEATURES.fnbShifts && (
          <TabsContent value="shift" className="mt-4">
            <ShiftReconciliationPanel clubId={activeClub} canClose={canPay} />
          </TabsContent>
        )}
      </Tabs>

      <FnbConfirmPaymentDialog order={payOrder} open={payOpen} onOpenChange={setPayOpen} confirming={paying} onConfirm={doPay} />

      {FEATURES.fnbComp && (
        <Dialog open={compOpen} onOpenChange={setCompOpen}>
          <DialogContent className="bg-card border-border text-foreground max-w-sm">
            <DialogHeader>
              <DialogTitle>Comp / Miễn phí</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-sm text-muted-foreground">
              Xác nhận miễn phí đơn này — tiền không thu, nhưng nguyên liệu vẫn trừ kho và COGS được ghi nhận.
            </DialogDescription>
            {compOrder && (
              <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2 leading-relaxed">
                {compOrder.items.map((it) => `${it.qty}× ${it.name_snapshot}`).join(" · ")}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Lý do (tuỳ chọn)</Label>
              <Input value={compReason} onChange={(e) => setCompReason(e.target.value)}
                placeholder="vd: Khách VIP, Sự kiện…"
                className="bg-card border-border text-foreground" />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="border-border" onClick={() => setCompOpen(false)}>Huỷ bỏ</Button>
              <Button disabled={comping} onClick={doComp}>
                {comping && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Xác nhận COMP
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// A2 — prefer a resolved REAL table/player name over the free-text fallback when a ref is present
// (a ref may point at a table/player no longer in `linkTargets`, e.g. the tournament ended — falls
// back to the free-text label in that case, never shows a blank).
function orderDisplayLabel(o: FnbOrder, linkTargets: FnbLinkTargets | undefined): string {
  const tableName = o.table_ref ? linkTargets?.tables.find((t) => t.id === o.table_ref)?.table_name : undefined;
  const playerName = o.player_ref ? linkTargets?.players.find((p) => p.player_id === o.player_ref)?.name : undefined;
  const place = tableName ?? (o.table_label ? `Bàn ${o.table_label}` : "Khách lẻ");
  const who = playerName ?? o.customer_name;
  return who ? `${place} · ${who}` : place;
}

function OrdersTab({ clubId, status, emptyText, children }: {
  clubId: string; status: "pending" | "paid"; emptyText: string;
  children: (o: FnbOrder) => React.ReactNode;
}) {
  const { data, isLoading, isError, refetch } = useFnbOrders(clubId, [status]);
  const { data: linkTargets } = useFnbLinkTargets(clubId);
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (isError) return <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-4">
    <p className="text-sm text-destructive">Không tải được danh sách đơn tại quầy. Chưa thể xác minh trạng thái đơn; hãy tải lại trước khi thu hoặc hoàn tiền.</p>
    <Button variant="outline" onClick={() => { void refetch(); }}>Thử tải lại đơn</Button>
  </div>;
  const orders = data ?? [];
  if (orders.length === 0) {
    return <div className="rounded-lg border border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {orders.map((o) => (
        <Card key={o.id} className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold truncate">{orderDisplayLabel(o, linkTargets)}</div>
            <div className="font-mono font-semibold shrink-0">{formatVND(o.subtotal_vnd)}</div>
          </div>
          <div className="text-xs text-muted-foreground">
            {o.items.map((it) => `${it.qty}× ${it.name_snapshot}`).join(", ") || "—"}
          </div>
          <div className="flex gap-2 justify-end pt-1">{children(o)}</div>
        </Card>
      ))}
    </div>
  );
}
