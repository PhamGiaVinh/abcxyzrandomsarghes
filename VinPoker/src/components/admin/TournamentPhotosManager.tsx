// MediaCenter "Ảnh giải đấu" tab — a club-scoped media OR floor person picks one of
// THEIR tournaments and uploads public photos that appear in the viewer's Hình ảnh tab.
// Mirrors MediaClubSchedules (compress → storage upload → getPublicUrl → save row).
// Allowed clubs come from the UNION of media_club_ids + floor_club_ids RPCs; writes are
// gated server-side by the tournament_photos / storage RLS (is_club_floor_or_media) —
// this UI is convenience only. floor_club_ids may not be live yet → it degrades to []​.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { compressImage } from "@/lib/compressImage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Upload, Trash2, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

interface TourRow { id: string; name: string; status: string; club_id: string }
interface PhotoRow { id: string; tournament_id: string; photo_url: string; storage_path: string | null; created_at: string }

function isPhotoRow(value: unknown): value is PhotoRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.tournament_id === 'string'
    && typeof row.photo_url === 'string' && typeof row.created_at === 'string'
    && (row.storage_path === null || typeof row.storage_path === 'string');
}

const MAX_BYTES = 10 * 1024 * 1024; // 10MB per file (pre-compress)
const MAX_PER_TOUR = 100;

export function TournamentPhotosManager() {
  const { user, session } = useAuth();
  if (!user) return null;
  return <ScopedTournamentPhotosManager key={JSON.stringify([user.id, sessionReadEpoch(session)])} userId={user.id} />;
}

function ScopedTournamentPhotosManager({ userId }: { userId: string }) {
  const [tours, setTours] = useState<TourRow[] | null>(null);
  const [tourId, setTourId] = useState<string>("");
  const [photoRead, setPhotoRead] = useState<{ tourId: string; rows: PhotoRow[]; loading: boolean; error: boolean }>({ tourId: "", rows: [], loading: false, error: false });
  const photoRequest = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const currentTour = useRef(tourId);
  currentTour.current = tourId;
  const photos = photoRead.tourId === tourId ? photoRead.rows : [];
  const loadingPhotos = Boolean(tourId) && (photoRead.tourId !== tourId || photoRead.loading);
  const photoError = photoRead.tourId === tourId && photoRead.error;
  const [busy, setBusy] = useState(false);

  // Tours the current user may manage (club-scoped via media_club_ids ∪ floor_club_ids).
  useEffect(() => {
    let alive = true;
    (async () => {
      // SETOF uuid can come back as bare strings or {<rpc_name>: uuid} rows — normalize both.
      const extractIds = (rows: unknown, key: string): string[] =>
        ((rows ?? []) as unknown[])
          .map((r) => (typeof r === "string" ? r : (r as Record<string, string>)[key] ?? null))
          .filter((v): v is string => typeof v === "string");
      // floor_club_ids may not be applied live yet (its migration is owner-gated). Use
      // allSettled + per-result error checks so a missing/erroring floor RPC degrades to []
      // WITHOUT taking media down with it — and a rejected promise can't crash the effect.
      const idsFrom = (res: PromiseSettledResult<any>, key: string): string[] =>
        res.status === "fulfilled" && !res.value?.error ? extractIds(res.value?.data, key) : [];
      const [mediaRes, floorRes] = await Promise.allSettled([
        supabase.rpc("media_club_ids" as any, { _user_id: userId } as any),
        supabase.rpc("floor_club_ids" as any, { _user_id: userId } as any),
      ]);
      const clubIds = Array.from(new Set([
        ...idsFrom(mediaRes, "media_club_ids"),
        ...idsFrom(floorRes, "floor_club_ids"),
      ]));
      if (!clubIds.length) { if (alive) setTours([]); return; }
      const { data } = await supabase
        .from("tournaments")
        .select("id, name, status, club_id")
        .in("club_id", clubIds)
        .order("created_at", { ascending: false });
      if (alive) setTours((data ?? []) as TourRow[]);
    })();
    return () => { alive = false; };
  }, [userId]);

  const loadPhotos = useCallback(async (id: string) => {
    if (!id || currentTour.current !== id) return;
    photoRequest.current.controller?.abort();
    const controller = new AbortController(), generation = ++photoRequest.current.generation;
    photoRequest.current.controller = controller;
    const isCurrent = () => !controller.signal.aborted && currentTour.current === id && photoRequest.current.generation === generation;
    setPhotoRead({ tourId: id, rows: [], loading: true, error: false });
    try {
      const { data, error } = await observeTrackerContextRead(supabase
        .from("tournament_photos" as any)
        .select("id, tournament_id, photo_url, storage_path, created_at")
        .eq("tournament_id", id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .abortSignal(controller.signal));
      if (!isCurrent()) return;
      // This source-only relation is absent from generated Database types. Validate its wire DTO.
      const rows: unknown = data;
      if (error || !Array.isArray(rows) || !rows.every(isPhotoRow) || rows.some(row => row.tournament_id !== id)) throw new Error('photo_read_unverified');
      setPhotoRead({ tourId: id, rows, loading: false, error: false });
    } catch {
      if (isCurrent()) setPhotoRead({ tourId: id, rows: [], loading: false, error: true });
    } finally {
      controller.abort();
      if (photoRequest.current.controller === controller) photoRequest.current.controller = undefined;
    }
  }, []);

  useEffect(() => {
    const request = photoRequest.current;
    if (tourId) void loadPhotos(tourId);
    return () => { ++request.generation; request.controller?.abort(); };
  }, [tourId, loadPhotos]);

  const uploadFiles = async (files: FileList) => {
    if (!tourId || loadingPhotos || photoError) return;
    const list = Array.from(files);
    if (photos.length + list.length > MAX_PER_TOUR) {
      toast.error(`Tối đa ${MAX_PER_TOUR} ảnh mỗi giải`);
      return;
    }
    setBusy(true);
    let ok = 0;
    for (const raw of list) {
      if (!raw.type.startsWith("image/")) { toast.error(`${raw.name}: phải là ảnh`); continue; }
      if (raw.size > MAX_BYTES) { toast.error(`${raw.name}: tối đa 10MB`); continue; }
      try {
        const file = await compressImage(raw, { maxEdge: 1920, quality: 0.82 });
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${tourId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("tournament-photos").upload(path, file, { contentType: file.type, cacheControl: "3600" });
        if (upErr) { toast.error(upErr.message); continue; }
        const { data: pub } = supabase.storage.from("tournament-photos").getPublicUrl(path);
        const { error: insErr } = await supabase.from("tournament_photos" as any).insert({
          tournament_id: tourId, photo_url: pub.publicUrl, storage_path: path, uploaded_by: userId,
        } as any);
        if (insErr) { toast.error(insErr.message); await supabase.storage.from("tournament-photos").remove([path]); continue; }
        ok += 1;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Lỗi tải ảnh");
      }
    }
    setBusy(false);
    if (ok) { toast.success(`Đã tải ${ok} ảnh`); loadPhotos(tourId); }
  };

  const removePhoto = async (p: PhotoRow) => {
    if (!confirm("Xoá ảnh này?")) return;
    const { error } = await supabase.from("tournament_photos" as any).delete().eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    if (p.storage_path) await supabase.storage.from("tournament-photos").remove([p.storage_path]);
    toast.success("Đã xoá"); void loadPhotos(tourId);
  };

  const statusLabel = (s: string) => ({ upcoming: "Sắp diễn ra", registering: "Đang ĐK", active: "Đang chạy", live: "Trực tiếp", break: "Nghỉ", final_table: "Bàn chung kết", completed: "Đã xong" } as Record<string, string>)[s] ?? s;
  const tourName = useMemo(() => tours?.find((t) => t.id === tourId)?.name ?? "", [tours, tourId]);

  if (tours === null) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  if (tours.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Bạn chưa được gán CLB nào — hãy nhờ quản trị viên gán quyền media hoặc floor theo CLB để tải ảnh giải.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-bold">Ảnh giải đấu</h2>
      </div>

      <Select value={tourId} onValueChange={setTourId}>
        <SelectTrigger className="w-full sm:w-[340px]"><SelectValue placeholder="Chọn giải đấu để tải ảnh..." /></SelectTrigger>
        <SelectContent>
          {tours.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <span className="flex items-center gap-2"><span>{t.name}</span><span className="text-[10px] uppercase text-muted-foreground">{statusLabel(t.status)}</span></span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {tourId && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">{tourName} · {loadingPhotos || photoError ? "Chưa xác minh số ảnh" : `${photos.length}/${MAX_PER_TOUR} ảnh`}</div>
            <label>
              <input type="file" accept="image/*" multiple className="hidden" disabled={busy || loadingPhotos || photoError}
                onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.currentTarget.value = ""; }} />
              <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Tải ảnh lên
              </span>
            </label>
          </div>

          {photoError ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>Chưa xác minh được ảnh của giải này. Hãy thử lại trước khi thao tác.</p>
              <Button variant="outline" onClick={() => { void loadPhotos(tourId); }}>Thử lại</Button>
            </div>
          ) : loadingPhotos ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : photos.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-10 text-center text-xs text-muted-foreground">Chưa có ảnh — tải ảnh lên để hiển thị cho người xem.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {photos.map((p) => (
                <div key={p.id} className="group relative overflow-hidden rounded-lg border border-border bg-muted/30">
                  <img src={p.photo_url} alt="" loading="lazy" className="h-28 w-full object-cover" />
                  <Button size="sm" variant="ghost" onClick={() => removePhoto(p)}
                    className="absolute right-1 top-1 h-7 w-7 bg-black/55 p-0 text-destructive opacity-0 transition group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
