import {observeTrackerContextRead} from "@/lib/tournament/observeTrackerContextRead";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useFnbMenu } from "@/hooks/useFnbMenu";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { useFnbStockInIntent } from "@/hooks/useFnbStockInIntent";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PackagePlus } from "lucide-react";

const REASON_VI: Record<string, string> = {
  stock_in: "Nhập kho", sale: "Bán", cancel_return: "Hoàn (huỷ)", stocktake_adjust: "Kiểm kho", manual: "Thủ công",
};

type Movement = {
  id: string; ingredient_id: string; delta: number; reason: string;
  unit_cost: number | null; balance_after: number | null; created_at: string;
};

export function StockInForm({ clubId }: { clubId: string }) {
  const {user,session,loading}=useAuth();
  if(loading)return <Card role="status" className="p-5">Đang tải phiên nhập kho…</Card>;
  if(!user||!session?.access_token)return <Card role="alert" className="p-5">Đăng nhập để nhập kho.</Card>;
  return <ScopedStockInForm key={JSON.stringify([user.id,clubId,sessionReadEpoch(session),import.meta.env.VITE_SUPABASE_URL])} actorId={user.id} clubId={clubId}/>;
}

function ScopedStockInForm({actorId,clubId}:{actorId:string;clubId:string}) {
  const qc = useQueryClient();
  const { data, isLoading: menuLoading, isError: menuError, refetch: reloadMenu } = useFnbMenu(clubId);
  const ingredients = (data?.ingredients ?? []).filter((i) => i.is_active);
  const ingName = (id: string) => (data?.ingredients ?? []).find((i) => i.id === id)?.name ?? "—";

  const [ingredientId, setIngredientId] = useState<string>("");
  const [qtyPurchase, setQtyPurchase] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [movements, setMovements] = useState<Movement[] | null>(null);

  const [historyClub,setHistoryClub]=useState<string|null>(null),[historyErrorClub,setHistoryErrorClub]=useState<string|null>(null),[historyAttempt,setHistoryAttempt]=useState(0);
  const loadMovements=()=>{setHistoryClub(null);setHistoryAttempt(value=>value+1);};
  useEffect(()=>{
    let active=true;const controller=new AbortController();setHistoryClub(null);setHistoryErrorClub(null);
    void (async()=>{
      try{
        if(!clubId)throw new Error('stock_history_club_missing');
        const {data:rows,error}=await observeTrackerContextRead<{data:unknown;error:unknown}>((supabase as any).from('fnb_stock_movements').select('*').eq('club_id',clubId).order('created_at',{ascending:false}).limit(12).abortSignal(controller.signal));
        if(!active)return;
        if(error||!Array.isArray(rows))throw new Error('stock_history_unverified');
        const ids=new Set<string>();
        for(const value of rows as unknown[]){
          if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('stock_history_row_invalid');
          const row=value as Record<string,unknown>;
          if(typeof row.id!=='string'||!row.id.trim()||ids.has(row.id)||typeof row.ingredient_id!=='string'||!row.ingredient_id.trim()||typeof row.reason!=='string'
            ||typeof row.delta!=='number'||!Number.isFinite(row.delta)||row.balance_after!==null&&(typeof row.balance_after!=='number'||!Number.isFinite(row.balance_after)))throw new Error('stock_history_row_invalid');
          ids.add(row.id);
        }
        setMovements(rows as Movement[]);setHistoryClub(clubId);
      }catch{controller.abort();if(active)setHistoryErrorClub(clubId);}
      finally{controller.abort();}
    })();
    return()=>{active=false;controller.abort();};
  },[clubId,historyAttempt]);

  const intent=useFnbStockInIntent(actorId,clubId,async(_request,receipt)=>{
    setQtyPurchase("");setUnitCost("");loadMovements();
    toast.success(`Đã xác minh nhập kho. Tồn sau giao dịch: ${receipt.balanceAfter.toLocaleString("vi-VN")}`);
    await qc.invalidateQueries({queryKey:["fnb","menu",clubId]});
  });
  const shownIngredient=intent.pending?.payload.ingredient_id??ingredientId;
  const shownQty=intent.pending?String(intent.pending.payload.qty_purchase):qtyPurchase;
  const shownCost=intent.pending?String(intent.pending.payload.unit_cost_purchase):unitCost;
  const selected=ingredients.find(i=>i.id===shownIngredient);
  const saving=intent.busy;
  const draftLocked=saving||intent.blocked||!!intent.pending;
  const recovery=intent.pending ? <div role="alert" className="space-y-2 rounded-lg border border-warning/40 p-3 text-sm">
    <p>{intent.message??"Có lệnh nhập kho chưa được đối chiếu. Giữ mã gốc; chưa tạo lệnh mới."}</p>
    <p className="break-all text-xs">Mã lệnh: {intent.pending.requestId}</p>
    <p className="text-xs">Nguyên liệu: {ingName(shownIngredient)==="—"?shownIngredient:ingName(shownIngredient)} · Số lượng mua: {shownQty} · Giá 1 đơn vị mua: {shownCost}₫</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={saving||intent.blocked} onClick={()=>void intent.recover()}>Kiểm tra lệnh nhập kho</Button>
      <Button variant="outline" disabled={saving||intent.blocked||intent.readOnlyRecovery||menuLoading||menuError||!data} onClick={()=>void intent.retry()}>Gửi lại cùng mã nhập kho</Button>
    </div>
  </div> : intent.message ? <p role="alert" className="text-sm text-destructive">{intent.message}</p> : null;
  const submit=async()=>{
    if(menuLoading||menuError||!data||draftLocked)return;
    if(!selected){toast.error("Chọn nguyên liệu.");return;}
    const qty=Number(qtyPurchase),cost=Number(unitCost);
    if(!Number.isFinite(qty)||qty<=0){toast.error("Số lượng mua phải lớn hơn 0.");return;}
    if(unitCost.trim()===''||!Number.isFinite(cost)||cost<0){toast.error("Giá mua không hợp lệ.");return;}
    await intent.submit(crypto.randomUUID(),{ingredient_id:selected.id,qty_purchase:qty,unit_cost_purchase:cost});
  };

  if(menuLoading)return <Card role="status" className="p-5">Đang tải thực đơn…{recovery}</Card>;
  if(menuError||!data)return <Card role="alert" className="space-y-3 p-5"><p>Không tải được thực đơn. Chưa thể xác minh nguyên liệu để nhập kho.</p>{recovery}<Button variant="outline" onClick={()=>void reloadMenu()}>Thử tải lại thực đơn</Button></Card>;

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h3 className="font-semibold text-base">Nhập kho</h3>
        <p className="text-xs text-muted-foreground">Nhập theo đơn vị mua; hệ thống tự quy đổi &amp; tính giá vốn bình quân.</p>
      </div>

      {recovery}

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label>Nguyên liệu</Label>
          <Select value={shownIngredient} onValueChange={setIngredientId} disabled={draftLocked}>
            <SelectTrigger className="bg-card border-border text-foreground"><SelectValue placeholder="Chọn nguyên liệu" /></SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground">
              {ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="si-qty">Số lượng mua{selected?.purchase_unit ? ` (${selected.purchase_unit})` : selected ? ` (${selected.stock_unit})` : ""}</Label>
          <Input id="si-qty" type="number" step="any" value={shownQty} disabled={draftLocked}
            onChange={(e) => setQtyPurchase(e.target.value)} className="bg-card border-border text-foreground" />
        </div>
        <div>
          <Label htmlFor="si-cost">Giá 1 đơn vị mua (₫)</Label>
          <Input id="si-cost" type="number" step="any" value={shownCost} disabled={draftLocked}
            onChange={(e) => setUnitCost(e.target.value)} className="bg-card border-border text-foreground text-right font-mono" />
        </div>
      </div>

      {!intent.pending && selected && selected.purchase_unit && Number(qtyPurchase) > 0 && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          = {Number(qtyPurchase) * selected.units_per_purchase} {selected.stock_unit} vào kho.
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={draftLocked || !ingredientId}
          className="bg-success hover:bg-success/90 text-success-foreground">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <PackagePlus className="w-4 h-4 mr-1" />}
          Nhập kho
        </Button>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold text-muted-foreground">Lịch sử kho gần đây</div>
        {historyErrorClub===clubId ? (
          <div role="alert" className="space-y-3"><p>Không tải được lịch sử kho. Dữ liệu chưa được xác minh.</p><Button variant="outline" onClick={loadMovements}>Thử tải lại lịch sử kho</Button></div>
        ) : historyClub!==clubId||movements === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải…</div>
        ) : movements.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/20 py-6 text-center text-sm text-muted-foreground">Chưa có chuyển động kho.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nguyên liệu</TableHead>
                  <TableHead>Lý do</TableHead>
                  <TableHead className="text-right">Thay đổi</TableHead>
                  <TableHead className="text-right">Tồn sau</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{ingName(m.ingredient_id)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{REASON_VI[m.reason] ?? m.reason}</TableCell>
                    <TableCell className={`text-right font-mono ${m.delta >= 0 ? "text-success" : "text-destructive"}`}>
                      {m.delta >= 0 ? "+" : ""}{m.delta}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{m.balance_after ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Card>
  );
}
