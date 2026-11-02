import {observeScheduleAnalysis} from '@/lib/scheduleAnalysisRead';
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, ImagePlus, Wand2, CheckCircle2, AlertCircle, Images } from "lucide-react";
import {useScheduleBatchCreate} from '@/hooks/useScheduleBatchCreate';
import {ScheduleBatchRecovery} from './ScheduleBatchRecovery';
import {useAuth} from '@/hooks/useAuth';
import {parseTournamentSchedule} from '@/lib/parsedTournamentSchedule';
import type { ClubRow } from "./TournamentManagerShared";

// Bulk-create regular tournaments from a schedule IMAGE (by day / by week) on the Floor.
// Reuses the deployed `parse-tournament-schedule` edge function (Google Gemini vision, direct —
// self-owned GEMINI_API_KEY, no Lovable gateway) + the batch insert pattern from
// BulkCreateTournaments. Created rows are plain tournaments → fully editable afterwards
// (tên/giờ/buy-in + cấu trúc blind) via the normal TournamentCard.

type Status = "pending" | "processing" | "done" | "error";
interface ParsedTour {
  tempId: string; name: string; start_time: string; buy_in: number | "";
  starting_stack: number | ""; game_type: "nlh" | "plo" | "mixed"; venue?: string | null;
  selected: boolean; source_image: string;
}
interface UploadedImage { id: string; file: File; url: string; status: Status; error?: string; count: number; }

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const toLocalInputValue = (iso: string) => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
};

// Group label by day (so a weekly schedule image lays out by day for review).
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "Chưa rõ ngày" : d.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" });
};

type BulkScheduleProps={clubs:ClubRow[];defaultClubId:string;multiClub:boolean;onCreated:()=>void};
export function BulkScheduleDialog(props:BulkScheduleProps) {
  const {user}=useAuth();
  return <ScopedBulkScheduleDialog key={JSON.stringify([user?.id,props.defaultClubId])} {...props}/>;
}
function ScopedBulkScheduleDialog({ clubs, defaultClubId, multiClub, onCreated }:BulkScheduleProps) {
  const [open, setOpen] = useState(false);
  const [clubId, setClubId] = useState(defaultClubId);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [parsed, setParsed] = useState<ParsedTour[]>([]);
  const batch=useScheduleBatchCreate(),creating=batch.busy;
  const inputRef = useRef<HTMLInputElement>(null);
  const processingRef=useRef(false),removedImages=useRef(new Set<string>());
  const previewUrls=useRef(new Map<string,string>());
  const analysisRef=useRef<AbortController|null>(null);
  useEffect(()=>{
    const urls=previewUrls.current;
    return()=>{analysisRef.current?.abort();urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();};
  },[]);
  const discardImagePreviews=()=>{
    previewUrls.current.forEach(url=>URL.revokeObjectURL(url));previewUrls.current.clear();setImages([]);
  };

  const onFiles = (files: FileList | null) => {
    if(batch.blocked||batch.busy)return;
    if (!files) return;
    const arr: UploadedImage[] = Array.from(files).filter((f) => f.type.startsWith("image/")).map((f) => ({
      id: crypto.randomUUID(), file: f, url: URL.createObjectURL(f), status: "pending" as Status, count: 0,
    }));
    arr.forEach(img=>previewUrls.current.set(img.id,img.url));
    setImages((prev) => [...prev, ...arr]);
  };
  const removeImage = (id: string) => {
    removedImages.current.add(id);
    const url=previewUrls.current.get(id);
    if(url){URL.revokeObjectURL(url);previewUrls.current.delete(id);}
    setImages((prev) => prev.filter((i) => i.id !== id));
    setParsed((prev) => prev.filter((p) => p.source_image !== id));
  };

  const processAll = async () => {
    if(processingRef.current)return;
    const todo = images.filter((i) => i.status === "pending" || i.status === "error");
    if (!todo.length) { toast.info("Không có ảnh mới để phân tích"); return; }
    processingRef.current=true;
    const analysis=new AbortController();
    analysisRef.current=analysis;
    try { for (const img of todo) {
      if(analysis.signal.aborted)break;
      if(removedImages.current.has(img.id))continue;
      setImages((prev) => prev.map((i) => (i.id === img.id ? { ...i, status: "processing", error: undefined } : i)));
      try {
        const result = await observeScheduleAnalysis(analysis.signal, async (signal) => {
          const b64 = await fileToBase64(img.file);
          if (signal.aborted || removedImages.current.has(img.id)) return null;
          return supabase.functions.invoke("parse-tournament-schedule", {
            signal, body: { image_base64: b64, image_mime: img.file.type },
          });
        });
        if (!result) continue;
        const { data, error } = result;
        if(analysis.signal.aborted)break;
        if(removedImages.current.has(img.id))continue;
        if (error) throw new Error(error.message);
        if ((data as any)?.error) throw new Error((data as any).error);
        const tours = parseTournamentSchedule(data);
        const np: ParsedTour[] = tours.map((tt) => ({
          tempId: crypto.randomUUID(),
          name: tt.name ?? "",
          start_time: tt.start_time ?? "",
          buy_in: tt.buy_in,
          starting_stack: tt.starting_stack,
          game_type: tt.game_type,
          venue: tt.venue ?? null,
          selected: true,
          source_image: img.id,
        }));
        setParsed((prev) => [...prev, ...np]);
        setImages((prev) => prev.map((i) => (i.id === img.id ? { ...i, status: "done", count: tours.length } : i)));
      } catch (e: any) {
        if(analysis.signal.aborted)break;
        if(removedImages.current.has(img.id))continue;
        setImages((prev) => prev.map((i) => (i.id === img.id ? { ...i, status: "error", error: e.message } : i)));
        toast.error("Phân tích lỗi: " + e.message);
      }
    }
    } finally {processingRef.current=false;analysisRef.current=null;}
  };

  const updateRow = (id: string, patch: Partial<ParsedTour>) => setParsed((prev) => prev.map((p) => (p.tempId === id ? { ...p, ...patch } : p)));
  const removeRow = (id: string) => setParsed((prev) => prev.filter((p) => p.tempId !== id));

  const createAll = async () => {
    if(batch.blocked||creating||processingRef.current)return;
    const rows = parsed.filter((p) => p.selected);
    if (!rows.length) return toast.error("Chọn ít nhất 1 giải");
    if (!clubId) return toast.error("Chọn câu lạc bộ");
    if (rows.some(r => typeof r.buy_in !== 'number' || !Number.isSafeInteger(r.buy_in) || r.buy_in < 0
      || typeof r.starting_stack !== 'number' || !Number.isSafeInteger(r.starting_stack) || r.starting_stack <= 0)) {
      toast.error("Mỗi giải cần buy-in nguyên từ 0 và stack nguyên lớn hơn 0");return;
    }
    if (rows.find((r) => !r.name.trim() || !r.start_time || !Number.isFinite(new Date(r.start_time).getTime()))) return toast.error("Mỗi giải cần có tên + thời gian");
      // `schedule_upload_id` (a client-generated tag used only by the push-notification grouping
      // trigger) is intentionally NOT written: migration 20260516123400 — which adds
      // tournaments.schedule_upload_id — is NOT applied to the live DB, so sending it made the whole
      // insert fail with "Could not find the 'schedule_upload_id' column ... in the schema cache".
      // Nothing reads this column in the app. Re-add it once that migration is applied (owner-gated).
      const payload = rows.map((r) => ({
        name: r.name.trim(),
        start_time: new Date(r.start_time).toISOString(),
        buy_in: Number(r.buy_in),
        starting_stack: Number(r.starting_stack),
        game_type: r.game_type,
        location: r.venue ?? null,
        club_id: clubId,
      }));
      const ids=await batch.submit(payload);if(!ids)return;
      toast.success(`Đã tạo ${rows.length} giải từ ảnh lịch`);
      setParsed([]);
      discardImagePreviews();
      setOpen(false);
      onCreated();
  };

  const selectedCount = parsed.filter((p) => p.selected).length;
  const sorted = [...parsed].sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
  const groups = sorted.reduce<Record<string, ParsedTour[]>>((acc, p) => { (acc[dayKey(p.start_time)] ??= []).push(p); return acc; }, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1 border-primary/40 text-primary"><Images className="w-4 h-4" /> Tạo từ ảnh lịch</Button>
      </DialogTrigger>
      <DialogContent className="grid-cols-1 max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Tạo hàng loạt từ ảnh lịch</DialogTitle></DialogHeader>
        <ScheduleBatchRecovery batch={batch} onRecovered={()=>{setParsed([]);discardImagePreviews();setOpen(false);onCreated();}}/>
        <fieldset disabled={batch.blocked||batch.busy} className="min-w-0 space-y-3">
          <DialogDescription className="text-xs text-muted-foreground">
            Tải ảnh lịch giải (theo ngày / theo tuần) → AI đọc → sửa lại → tạo. Giải tạo ra là giải thường — sửa được + chỉnh cấu trúc blind như bình thường.
          </DialogDescription>
          <p className="text-sm text-muted-foreground">Chỉ tạo lịch giải, chưa có cấu hình blind. Sau khi lưu, mở cấu hình giải để bổ sung blind trước khi bắt đầu clock.</p>
          {multiClub && (
            <div>
              <Label className="text-xs">Câu lạc bộ</Label>
              <Select value={clubId} onValueChange={setClubId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Chọn CLB" /></SelectTrigger>
                <SelectContent>{clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          <div
            className="cursor-pointer rounded-lg border-2 border-dashed border-border p-6 text-center transition hover:bg-muted/40"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
          >
            <ImagePlus className="mx-auto mb-1 h-8 w-8 text-primary" />
            <p className="text-sm font-medium">Kéo thả hoặc bấm để chọn ảnh lịch</p>
            <p className="text-xs text-muted-foreground">PNG/JPG · nhiều ảnh (mỗi ngày / mỗi tuần 1 ảnh)</p>
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          </div>

          {images.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((img) => (
                  <div key={img.id} className="relative h-24 overflow-hidden rounded-md border">
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                    <Badge variant={img.status === "done" ? "default" : img.status === "error" ? "destructive" : "secondary"} className="absolute left-1 top-1 px-1 py-0 text-[9px]">
                      {img.status === "processing" && <Loader2 className="mr-0.5 h-2.5 w-2.5 animate-spin" />}
                      {img.status === "done" && <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" />}
                      {img.status === "error" && <AlertCircle className="mr-0.5 h-2.5 w-2.5" />}
                      {img.status === "done" ? `${img.count} giải` : img.status}
                    </Badge>
                    <button type="button" onClick={() => removeImage(img.id)} className="absolute bottom-1 right-1 rounded bg-destructive/90 p-1"><Trash2 className="h-3 w-3 text-destructive-foreground" /></button>
                  </div>
                ))}
              </div>
              <Button size="sm" onClick={processAll} disabled={images.some(i=>i.status==='processing')||images.every((i) => i.status === "done" || i.status === "processing")} className="gap-1">
                <Wand2 className="h-4 w-4" /> Phân tích bằng AI
              </Button>
            </>
          )}

          {parsed.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Xem &amp; sửa ({selectedCount}/{parsed.length})</span>
                <Button size="sm" onClick={createAll} disabled={creating||batch.blocked||images.some(i=>i.status==='processing')} className="gap-1 gradient-neon text-primary-foreground border-0">
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />} Tạo {selectedCount} giải
                </Button>
              </div>
              {Object.entries(groups).map(([day, rows]) => (
                <div key={day} className="space-y-1.5">
                  <div className="text-xs font-semibold capitalize text-primary">{day}</div>
                  {rows.map((p) => (
                    <div key={p.tempId} className={`space-y-2 rounded-md border p-2 ${p.selected ? "border-primary/40" : "border-border opacity-60"}`}>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={p.selected} onChange={(e) => updateRow(p.tempId, { selected: e.target.checked })} />
                        <Input value={p.name} onChange={(e) => updateRow(p.tempId, { name: e.target.value })} className="h-8 flex-1" placeholder="Tên giải" />
                        <button type="button" onClick={() => removeRow(p.tempId)}><Trash2 className="h-4 w-4 text-destructive" /></button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div><Label className="text-[10px]">Thời gian</Label><Input type="datetime-local" value={toLocalInputValue(p.start_time)} onChange={(e) => updateRow(p.tempId, { start_time: e.target.value ? new Date(e.target.value).toISOString() : "" })} className="h-8" /></div>
                        <div><Label className="text-[10px]">Buy-in</Label><Input type="number" value={p.buy_in} onChange={(e) => updateRow(p.tempId, { buy_in: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" /></div>
                        <div><Label className="text-[10px]">Stack</Label><Input type="number" value={p.starting_stack} onChange={(e) => updateRow(p.tempId, { starting_stack: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" /></div>
                        <div><Label className="text-[10px]">Loại</Label>
                          <Select value={p.game_type} onValueChange={(v: any) => updateRow(p.tempId, { game_type: v })}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="nlh">NLH</SelectItem><SelectItem value="plo">PLO</SelectItem><SelectItem value="mixed">Mixed</SelectItem></SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">Tạo xong, mỗi giải sửa được (tên/giờ/buy-in) + chỉnh cấu trúc blind ở danh sách giải như giải thường.</p>
            </div>
          )}
        </fieldset>
      </DialogContent>
    </Dialog>
  );
}
