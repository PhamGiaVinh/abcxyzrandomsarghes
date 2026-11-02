import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { mapFnbError } from "@/lib/fnbErrors";
import { useFnbMenu, type FnbIngredient } from "@/hooks/useFnbMenu";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableFooter, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, AlertTriangle } from "lucide-react";

const isLow = (i: FnbIngredient) => i.is_active && i.on_hand <= i.low_stock_threshold;

export function IngredientManager({ clubId }: { clubId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, isFetching, refetch } = useFnbMenu(clubId);
  const menuUnavailable=isLoading||isError||!data;
  const [editing, setEditing] = useState<FnbIngredient | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["fnb", "menu", clubId] });
  const ingredients = data?.ingredients ?? [];
  const lowCount = ingredients.filter(isLow).length;
  // C1: total money tied up in stock = Σ(on_hand × avg_unit_cost). Display-only.
  const totalValue = ingredients.reduce((s, i) => s + i.on_hand * i.avg_unit_cost, 0);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-base">Nguyên liệu</h3>
          <p className="text-xs text-muted-foreground">
            Tồn kho &amp; giá vốn chỉ thay đổi qua <span className="font-medium">Nhập kho</span> / <span className="font-medium">Kiểm kho</span> — không sửa trực tiếp ở đây.
          </p>
        </div>
        <Button size="sm" disabled={menuUnavailable} onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Thêm nguyên liệu
        </Button>
      </div>

      {!menuUnavailable && lowCount > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-center gap-2 text-xs text-warning">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {lowCount} nguyên liệu dưới ngưỡng cảnh báo.
        </div>
      )}

      {isError||!data&&!isLoading ? (
        <div role="alert" className="space-y-3"><p>Không tải được thực đơn. Dữ liệu chưa được xác minh.</p><Button variant="outline" onClick={()=>void refetch()}>Thử tải lại thực đơn</Button></div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang tải…
        </div>
      ) : ingredients.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
          Chưa có nguyên liệu. Bấm “Thêm nguyên liệu” để bắt đầu.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nguyên liệu</TableHead>
                <TableHead>Đơn vị</TableHead>
                <TableHead className="text-right">Tồn kho</TableHead>
                <TableHead className="text-right">Giá vốn TB</TableHead>
                <TableHead className="text-right">Giá trị tồn</TableHead>
                <TableHead className="text-center w-24">Ngưỡng</TableHead>
                <TableHead className="text-right w-12">—</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ingredients.map((i) => (
                <TableRow key={i.id} className={isLow(i) ? "bg-warning/5" : undefined}>
                  <TableCell className="font-medium">
                    {i.name}
                    {!i.is_active && <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">tắt</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {i.stock_unit}{i.purchase_unit ? ` · mua theo ${i.purchase_unit} (×${i.units_per_purchase})` : ""}
                  </TableCell>
                  {/* on_hand + avg_unit_cost are READ-ONLY (move only via the ledger RPCs). */}
                  <TableCell className="text-right font-mono">
                    <span className={isLow(i) ? "text-warning font-semibold" : ""}>{i.on_hand}</span> <span className="text-muted-foreground text-xs">{i.stock_unit}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{formatVND(Math.round(i.avg_unit_cost))}</TableCell>
                  <TableCell className="text-right font-mono">{formatVND(Math.round(i.on_hand * i.avg_unit_cost))}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{i.low_stock_threshold}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" disabled={menuUnavailable} onClick={() => { setEditing(i); setOpen(true); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="text-right text-xs text-muted-foreground">Tổng giá trị kho</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatVND(Math.round(totalValue))}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      <IngredientDialog clubId={clubId} open={open} onOpenChange={setOpen} editing={editing} onSaved={refresh} readUnavailable={menuUnavailable} readPending={isLoading||isFetching} onReadRetry={()=>void refetch()} />
    </Card>
  );
}

function IngredientDialog({
  clubId, open, onOpenChange, editing, onSaved, readUnavailable, readPending, onReadRetry,
}: {
  clubId: string; open: boolean; onOpenChange: (v: boolean) => void;
  editing: FnbIngredient | null; onSaved: () => void; readUnavailable: boolean; readPending: boolean; onReadRetry: () => void;
}) {
  const [name, setName] = useState("");
  const [stockUnit, setStockUnit] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState("");
  const [unitsPerPurchase, setUnitsPerPurchase] = useState("1");
  const [threshold, setThreshold] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const key = `${open}:${editing?.id ?? "new"}`;
  const [syncedKey, setSyncedKey] = useState("");
  if (open && key !== syncedKey) {
    setSyncedKey(key);
    setName(editing?.name ?? "");
    setStockUnit(editing?.stock_unit ?? "");
    setPurchaseUnit(editing?.purchase_unit ?? "");
    setUnitsPerPurchase(String(editing?.units_per_purchase ?? 1));
    setThreshold(String(editing?.low_stock_threshold ?? 0));
    setIsActive(editing?.is_active ?? true);
  }

  const save = async () => {
    if(readUnavailable||saving)return;
    if (!name.trim()) { toast.error("Vui lòng nhập tên nguyên liệu."); return; }
    if (!stockUnit.trim()) { toast.error("Vui lòng nhập đơn vị tồn kho (vd: lon, g, ml)."); return; }
    const upp = Number(unitsPerPurchase);
    if (!(upp > 0)) { toast.error("Hệ số quy đổi phải lớn hơn 0."); return; }
    setSaving(true);
    // NOTE: on_hand / avg_unit_cost / version are intentionally NOT sent — fnb_upsert_ingredient
    // writes METADATA only; stock/cost move solely via fnb_stock_in / fnb_commit_stocktake.
    const { data, error } = await (supabase.rpc as any)("fnb_upsert_ingredient", {
      p_club_id: clubId,
      p_id: editing?.id ?? null,
      p_name: name.trim(),
      p_stock_unit: stockUnit.trim(),
      p_purchase_unit: purchaseUnit.trim() || null,
      p_units_per_purchase: upp,
      p_low_stock_threshold: Number(threshold) || 0,
      p_is_active: isActive,
    });
    setSaving(false);
    const res = data as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success(editing ? "Đã cập nhật nguyên liệu." : "Đã thêm nguyên liệu.");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border border-border text-foreground max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Sửa nguyên liệu" : "Thêm nguyên liệu"}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Tồn kho &amp; giá vốn không nhập ở đây — chỉ qua Nhập kho / Kiểm kho.
          </DialogDescription>
        </DialogHeader>
        {readUnavailable&&<div role="alert" className="space-y-2 text-sm"><p className="text-destructive">Chưa xác minh được thực đơn. Bản nháp được giữ; hãy tải lại trước khi lưu.</p><Button type="button" variant="outline" disabled={readPending} onClick={onReadRetry}>Thử tải lại thực đơn</Button></div>}
        <div className="space-y-4">
          <div>
            <Label htmlFor="ing-name">Tên nguyên liệu *</Label>
            <Input id="ing-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Cà phê hạt" className="bg-card border-border text-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ing-su">Đơn vị tồn/bán *</Label>
              <Input id="ing-su" value={stockUnit} onChange={(e) => setStockUnit(e.target.value)}
                placeholder="g / lon / ml" className="bg-card border-border text-foreground" />
            </div>
            <div>
              <Label htmlFor="ing-pu">Đơn vị mua</Label>
              <Input id="ing-pu" value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)}
                placeholder="thùng (bỏ trống = như đv tồn)" className="bg-card border-border text-foreground" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ing-upp">1 đơn vị mua = ? đơn vị tồn</Label>
              <Input id="ing-upp" type="number" step="any" value={unitsPerPurchase}
                onChange={(e) => setUnitsPerPurchase(e.target.value)} className="bg-card border-border text-foreground" />
            </div>
            <div>
              <Label htmlFor="ing-th">Ngưỡng cảnh báo</Label>
              <Input id="ing-th" type="number" step="any" value={threshold}
                onChange={(e) => setThreshold(e.target.value)} className="bg-card border-border text-foreground" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
            <Label htmlFor="ing-active" className="cursor-pointer">Đang dùng</Label>
            <Switch id="ing-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-foreground">Hủy</Button>
            <Button onClick={save} disabled={saving || readUnavailable || !name.trim()}
              className="bg-success hover:bg-success/90 text-success-foreground">
              {saving ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
