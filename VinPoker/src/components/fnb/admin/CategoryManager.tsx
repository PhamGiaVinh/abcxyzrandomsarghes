import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mapFnbError } from "@/lib/fnbErrors";
import { useFnbMenu, type FnbCategory } from "@/hooks/useFnbMenu";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Plus, Pencil } from "lucide-react";

export function CategoryManager({ clubId }: { clubId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, isFetching, refetch } = useFnbMenu(clubId);
  const menuUnavailable=isLoading||isError||!data;
  const [editing, setEditing] = useState<FnbCategory | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["fnb", "menu", clubId] });
  const openNew = () => { setEditing(null); setOpen(true); };
  const openEdit = (c: FnbCategory) => { setEditing(c); setOpen(true); };

  const categories = data?.categories ?? [];

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-base">Danh mục</h3>
          <p className="text-xs text-muted-foreground">Nhóm món trong thực đơn (Đồ uống, Đồ ăn…).</p>
        </div>
        <Button size="sm" disabled={menuUnavailable} onClick={openNew}><Plus className="w-4 h-4 mr-1" /> Thêm danh mục</Button>
      </div>

      {isError||!data&&!isLoading ? (
        <div role="alert" className="space-y-3"><p>Không tải được thực đơn. Dữ liệu chưa được xác minh.</p><Button variant="outline" onClick={()=>void refetch()}>Thử tải lại thực đơn</Button></div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang tải…
        </div>
      ) : categories.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
          Chưa có danh mục nào. Bấm “Thêm danh mục” để bắt đầu.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tên</TableHead>
                <TableHead className="text-center w-24">Thứ tự</TableHead>
                <TableHead className="text-center w-28">Trạng thái</TableHead>
                <TableHead className="text-right w-16">—</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{c.sort_order}</TableCell>
                  <TableCell className="text-center">
                    {c.is_active
                      ? <Badge variant="outline" className="text-[10px] border-success/40 text-success">Đang bán</Badge>
                      : <Badge variant="outline" className="text-[10px] text-muted-foreground">Tắt</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" disabled={menuUnavailable} onClick={() => openEdit(c)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CategoryDialog
        clubId={clubId}
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        onSaved={refresh} readUnavailable={menuUnavailable} readPending={isLoading||isFetching} onReadRetry={()=>void refetch()}
      />
    </Card>
  );
}

function CategoryDialog({
  clubId, open, onOpenChange, editing, onSaved, readUnavailable, readPending, onReadRetry,
}: {
  clubId: string; open: boolean; onOpenChange: (v: boolean) => void;
  editing: FnbCategory | null; onSaved: () => void; readUnavailable: boolean; readPending: boolean; onReadRetry: () => void;
}) {
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Sync form to the editing target whenever the dialog opens.
  const key = `${open}:${editing?.id ?? "new"}`;
  const [syncedKey, setSyncedKey] = useState("");
  if (open && key !== syncedKey) {
    setSyncedKey(key);
    setName(editing?.name ?? "");
    setSortOrder(String(editing?.sort_order ?? 0));
    setIsActive(editing?.is_active ?? true);
  }

  const save = async () => {
    if(readUnavailable||saving)return;
    if (!name.trim()) { toast.error("Vui lòng nhập tên danh mục."); return; }
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("fnb_upsert_category", {
      p_club_id: clubId,
      p_id: editing?.id ?? null,
      p_name: name.trim(),
      p_sort_order: Number(sortOrder) || 0,
      p_is_active: isActive,
    });
    setSaving(false);
    const res = data as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success(editing ? "Đã cập nhật danh mục." : "Đã thêm danh mục.");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border border-border text-foreground">
        <DialogHeader>
          <DialogTitle>{editing ? "Sửa danh mục" : "Thêm danh mục"}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Danh mục giúp nhóm món trên màn hình gọi món.
          </DialogDescription>
        </DialogHeader>
        {readUnavailable&&<div role="alert" className="space-y-2 text-sm"><p className="text-destructive">Chưa xác minh được thực đơn. Bản nháp được giữ; hãy tải lại trước khi lưu.</p><Button type="button" variant="outline" disabled={readPending} onClick={onReadRetry}>Thử tải lại thực đơn</Button></div>}
        <div className="space-y-4">
          <div>
            <Label htmlFor="cat-name">Tên danh mục *</Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Đồ uống" className="bg-card border-border text-foreground" />
          </div>
          <div>
            <Label htmlFor="cat-sort">Thứ tự hiển thị</Label>
            <Input id="cat-sort" type="number" value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)} className="bg-card border-border text-foreground" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
            <Label htmlFor="cat-active" className="cursor-pointer">Đang bán</Label>
            <Switch id="cat-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-foreground">
              Hủy
            </Button>
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
