import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { mapFnbError } from "@/lib/fnbErrors";
import { compressImage } from "@/lib/compressImage";
import { useFnbMenu, type FnbMenuItem, type FnbCategory } from "@/hooks/useFnbMenu";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, ImagePlus, X, Eye, UtensilsCrossed } from "lucide-react";
import { FnbGuestMenuPreviewDialog } from "@/components/fnb/admin/FnbGuestMenuPreviewDialog";

const NO_CATEGORY = "__none__";

type FnbRpcError = {
  message?: string;
  details?: string;
  detail?: string;
  hint?: string;
  code?: string;
};
type FnbRpcCall = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: FnbRpcError | null }>;

export function MenuManager({ clubId, clubName }: { clubId: string; clubName: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, isFetching, refetch } = useFnbMenu(clubId);
  const menuUnavailable=isLoading||isError||!data;
  const [editing, setEditing] = useState<FnbMenuItem | null>(null);
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["fnb", "menu", clubId] });
  const items = data?.items ?? [];
  const categories = data?.categories ?? [];
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-base">Thực đơn</h3>
          <p className="text-xs text-muted-foreground">Giá ở đây là giá bán; sửa giá không làm thay đổi đơn đã thanh toán.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)} disabled={menuUnavailable||items.length === 0}>
            <Eye className="w-4 h-4 mr-1" /> Xem như khách
          </Button>
          <Button size="sm" disabled={menuUnavailable} onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Thêm món
          </Button>
        </div>
      </div>

      {isError||!data&&!isLoading ? (
        <div role="alert" className="space-y-3"><p>Không tải được thực đơn. Dữ liệu chưa được xác minh.</p><Button variant="outline" onClick={()=>void refetch()}>Thử tải lại thực đơn</Button></div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang tải…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
          Chưa có món nào. Bấm “Thêm món” để tạo thực đơn.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Món</TableHead>
                <TableHead>Danh mục</TableHead>
                <TableHead className="text-right">Giá</TableHead>
                <TableHead className="text-center w-28">Trạng thái</TableHead>
                <TableHead className="text-right w-16">—</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex min-w-48 items-center gap-3">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                        {m.image_url ? (
                          <img src={m.image_url} alt={m.name} className="h-full w-full object-cover" />
                        ) : (
                          <UtensilsCrossed className="h-5 w-5 text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{m.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {m.image_url ? "Ảnh đang hiển thị" : "Chưa có ảnh"}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{catName(m.category_id)}</TableCell>
                  <TableCell className="fnb-number text-right">{formatVND(m.price_vnd)}</TableCell>
                  <TableCell className="text-center">
                    {m.is_active
                      ? <Badge variant="outline" className="border-success/40 text-xs text-success">Đang bán</Badge>
                      : <Badge variant="outline" className="text-xs text-muted-foreground">Tắt</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" disabled={menuUnavailable} onClick={() => { setEditing(m); setOpen(true); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <MenuItemDialog
        clubId={clubId} open={open} onOpenChange={setOpen}
        editing={editing} categories={categories} onSaved={refresh} readUnavailable={menuUnavailable} readPending={isLoading||isFetching} onReadRetry={()=>void refetch()}
      />
      <FnbGuestMenuPreviewDialog
        open={previewOpen&&!menuUnavailable}
        onOpenChange={setPreviewOpen}
        clubName={clubName}
        categories={categories}
        items={items}
      />
    </Card>
  );
}

function MenuItemDialog({
  clubId, open, onOpenChange, editing, categories, onSaved, readUnavailable, readPending, onReadRetry,
}: {
  clubId: string; open: boolean; onOpenChange: (v: boolean) => void;
  editing: FnbMenuItem | null; categories: FnbCategory[]; onSaved: () => void; readUnavailable: boolean; readPending: boolean; onReadRetry: () => void;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>(NO_CATEGORY);
  const [price, setPrice] = useState("0");
  const [imageUrl, setImageUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageFile = async (rawFile: File) => {
    if(readUnavailable||uploading)return;
    if (!rawFile.type.startsWith("image/")) { toast.error("Vui lòng chọn tệp ảnh."); return; }
    if (rawFile.size > 8 * 1024 * 1024) { toast.error("Ảnh quá lớn (tối đa 8MB)."); return; }
    setUploading(true);
    try {
      const file = await compressImage(rawFile, { maxEdge: 1200, quality: 0.82 });
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${clubId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("fnb-menu").upload(path, file, {
        cacheControl: "3600", contentType: file.type, upsert: false,
      });
      if (upErr) { toast.error(upErr.message); return; }
      const { data: pub } = supabase.storage.from("fnb-menu").getPublicUrl(path);
      setImageUrl(pub.publicUrl);
      toast.success("Đã tải ảnh lên.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Tải ảnh thất bại.");
    } finally {
      setUploading(false);
    }
  };

  const key = `${open}:${editing?.id ?? "new"}`;
  const [syncedKey, setSyncedKey] = useState("");
  if (open && key !== syncedKey) {
    setSyncedKey(key);
    setName(editing?.name ?? "");
    setCategoryId(editing?.category_id ?? NO_CATEGORY);
    setPrice(String(editing?.price_vnd ?? 0));
    setImageUrl(editing?.image_url ?? "");
    setIsActive(editing?.is_active ?? true);
  }

  const save = async () => {
    if(readUnavailable||saving)return;
    if (!name.trim()) { toast.error("Vui lòng nhập tên món."); return; }
    const priceNum = Number(price);
    if (!price.trim() || !Number.isSafeInteger(priceNum) || priceNum < 0) {
      toast.error("Vui lòng nhập giá bán là số nguyên không âm hợp lệ.");
      return;
    }
    setSaving(true);
    const callRpc = supabase.rpc.bind(supabase) as unknown as FnbRpcCall;
    const { data, error } = await callRpc("fnb_upsert_menu_item", {
      p_club_id: clubId,
      p_id: editing?.id ?? null,
      p_category_id: categoryId === NO_CATEGORY ? null : categoryId,
      p_name: name.trim(),
      p_price_vnd: priceNum,
      p_is_active: isActive,
      p_image_url: imageUrl.trim() || null,
      p_sort_order: editing?.sort_order ?? 0,
    });
    setSaving(false);
    const res = data as { error?: string } | null;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success(editing ? "Đã cập nhật món." : "Đã thêm món.");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border border-border text-foreground max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Sửa món" : "Thêm món"}</DialogTitle>
          <DialogDescription className="text-muted-foreground">Tên, danh mục và giá bán.</DialogDescription>
        </DialogHeader>
        {readUnavailable&&<div role="alert" className="space-y-2 text-sm"><p className="text-destructive">Chưa xác minh được thực đơn. Bản nháp được giữ; hãy tải lại trước khi lưu.</p><Button type="button" variant="outline" disabled={readPending} onClick={onReadRetry}>Thử tải lại thực đơn</Button></div>}
        <div className="space-y-4">
          <div>
            <Label htmlFor="mi-name">Tên món *</Label>
            <Input id="mi-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Cà phê sữa" className="bg-card border-border text-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Danh mục</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  <SelectItem value={NO_CATEGORY}>— Không —</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mi-price">Giá bán (₫) *</Label>
              <Input id="mi-price" type="number" value={price} onChange={(e) => setPrice(e.target.value)}
                className="fnb-number bg-card border-border text-right text-foreground" />
            </div>
          </div>
          <div>
            <Label>Ảnh món (không bắt buộc)</Label>
            <div className="flex items-start gap-3 mt-1">
              <div className="w-20 h-20 shrink-0 rounded-lg overflow-hidden border border-border bg-card flex items-center justify-center">
                {imageUrl
                  ? <img src={imageUrl} alt="Ảnh món" className="w-full h-full object-cover" />
                  : <ImagePlus className="w-6 h-6 text-muted-foreground" />}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={uploading||readUnavailable}
                    onClick={() => fileRef.current?.click()}
                    className="border-border text-foreground">
                    {uploading
                      ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Đang tải…</>
                      : <><ImagePlus className="w-3.5 h-3.5 mr-1" /> Tải ảnh lên</>}
                  </Button>
                  {imageUrl && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setImageUrl("")}
                      className="text-muted-foreground">
                      <X className="w-3.5 h-3.5 mr-1" /> Xóa ảnh
                    </Button>
                  )}
                </div>
                <Input id="mi-img" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="hoặc dán URL ảnh…" className="bg-card border-border text-foreground text-xs" />
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ""; }} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
            <Label htmlFor="mi-active" className="cursor-pointer">Đang bán</Label>
            <Switch id="mi-active" checked={isActive} onCheckedChange={setIsActive} />
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
