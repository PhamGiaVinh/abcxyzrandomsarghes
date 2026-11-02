import {observeTrackerContextRead} from "@/lib/tournament/observeTrackerContextRead";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mapFnbError } from "@/lib/fnbErrors";
import { useFnbMenu } from "@/hooks/useFnbMenu";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Save, Info } from "lucide-react";

type Row = { ingredient_id: string; qty: string };

export function RecipeEditor({ clubId }: { clubId: string }) {
  const { data, isLoading: menuLoading, isError: menuError, refetch: reloadMenu } = useFnbMenu(clubId);
  const items = (data?.items ?? []);
  const ingredients = (data?.ingredients ?? []).filter((i) => i.is_active);
  const ingName = (id: string) => (data?.ingredients ?? []).find((i) => i.id === id)?.name ?? "—";

  const [menuItemId, setMenuItemId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const recipeKey=JSON.stringify([clubId,menuItemId]);
  const [loadedKey,setLoadedKey]=useState(''),[recipeErrorKey,setRecipeErrorKey]=useState<string|null>(null),[recipeAttempt,setRecipeAttempt]=useState(0);
  const recipeReady=!!menuItemId&&loadedKey===recipeKey&&!loading&&recipeErrorKey!==recipeKey;
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    if(!menuItemId){setRows([]);setLoadedKey(recipeKey);setLoading(false);return()=>controller.abort();}
    setLoading(true);setRecipeErrorKey(null);setLoadedKey('');
    void (async()=>{
      try{
        const {data:r,error}=await observeTrackerContextRead<{data:unknown;error:unknown}>((supabase as any).from('fnb_recipe_items').select('ingredient_id, qty').eq('menu_item_id',menuItemId).abortSignal(controller.signal));
        if(!active)return;
        if(error||!Array.isArray(r))throw new Error('recipe_read_unverified');
        const verified=r.map((value:unknown)=>{
          if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('recipe_row_invalid');
          const row=value as Record<string,unknown>;
          if(typeof row.ingredient_id!=='string'||!row.ingredient_id.trim()
            ||!(typeof row.qty==='number'||typeof row.qty==='string'&&row.qty.trim()!=='')||!Number.isFinite(Number(row.qty))||Number(row.qty)<=0)throw new Error('recipe_row_invalid');
          return {ingredient_id:row.ingredient_id,qty:String(row.qty)};
        });
        setRows(verified);setLoadedKey(recipeKey);
      }catch{controller.abort();if(active)setRecipeErrorKey(recipeKey);}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;controller.abort();};
  },[menuItemId,recipeKey,recipeAttempt]);

  const addRow = () => setRows((r) => [...r, { ingredient_id: "", qty: "" }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const save = async () => {
    if(menuLoading||menuError||!data||!recipeReady||saving)return;
    if (!menuItemId) { toast.error("Chọn món trước."); return; }
    const items: { ingredient_id: string; qty: number }[] = [];
    for (const row of rows) {
      if (!row.ingredient_id) { toast.error("Chọn nguyên liệu cho mọi dòng (hoặc xoá dòng trống)."); return; }
      const q = Number(row.qty);
      if (!(q > 0)) { toast.error(`Định mức của “${ingName(row.ingredient_id)}” phải lớn hơn 0.`); return; }
      items.push({ ingredient_id: row.ingredient_id, qty: q });
    }
    setSaving(true);
    const { data: out, error } = await (supabase.rpc as any)("fnb_set_recipe", {
      p_menu_item_id: menuItemId,
      p_items: items, // empty array clears the recipe
    });
    setSaving(false);
    const res = out as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success(`Đã lưu công thức (${items.length} nguyên liệu).`);
    setRecipeAttempt(value=>value+1);
  };

  if(menuLoading)return <Card role="status" className="p-5">Đang tải thực đơn…</Card>;
  if(menuError||!data)return <Card role="alert" className="space-y-3 p-5"><p>Không tải được thực đơn. Chưa thể xác minh món và nguyên liệu.</p><Button variant="outline" onClick={()=>void reloadMenu()}>Thử tải lại thực đơn</Button></Card>;

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-base">Công thức (định mức nguyên liệu)</h3>
        <p className="text-xs text-muted-foreground">Khai báo mỗi món dùng bao nhiêu nguyên liệu — để trừ kho &amp; tính giá vốn khi bán.</p>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
        <span>Món <span className="font-medium">chưa có công thức</span> vẫn bán được nhưng giá vốn = 0 (không trừ kho).</span>
      </div>

      <div className="max-w-md">
        <Label>Chọn món</Label>
        <Select value={menuItemId} onValueChange={setMenuItemId} disabled={saving}>
          <SelectTrigger className="bg-card border-border text-foreground"><SelectValue placeholder="Chọn món để sửa công thức" /></SelectTrigger>
          <SelectContent className="bg-card border-border text-foreground">
            {items.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {!menuItemId ? null : recipeErrorKey===recipeKey ? (
        <div role="alert" className="space-y-3"><p>Không tải được công thức. Chưa thể xác minh định mức để lưu.</p><Button variant="outline" onClick={()=>setRecipeAttempt(value=>value+1)}>Thử tải lại công thức</Button></div>
      ) : loading||loadedKey!==recipeKey ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải công thức…</div>
      ) : (
        <div className="space-y-2">
          {rows.length === 0 && (
            <div className="rounded-lg border border-border bg-muted/20 py-6 text-center text-sm text-muted-foreground">
              Món này chưa có công thức. Bấm “Thêm nguyên liệu”.
            </div>
          )}
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <Select value={row.ingredient_id} onValueChange={(v) => setRow(i, { ingredient_id: v })}>
                  <SelectTrigger className="bg-card border-border text-foreground"><SelectValue placeholder="Nguyên liệu" /></SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    {ingredients.map((ing) => <SelectItem key={ing.id} value={ing.id}>{ing.name} ({ing.stock_unit})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Input type="number" step="any" value={row.qty} placeholder="Định mức"
                onChange={(e) => setRow(i, { qty: e.target.value })}
                className="w-28 bg-card border-border text-foreground text-right font-mono" />
              <Button size="sm" variant="ghost" onClick={() => removeRow(i)}>
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </div>
          ))}

          <div className="flex items-center justify-between pt-2">
            <Button size="sm" variant="outline" onClick={addRow} className="border-border text-foreground">
              <Plus className="w-4 h-4 mr-1" /> Thêm nguyên liệu
            </Button>
            <Button onClick={save} disabled={saving||!recipeReady}
              className="bg-success hover:bg-success/90 text-success-foreground">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Lưu công thức
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
