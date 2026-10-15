import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, Trash2, CalendarDays, ArrowLeft, ArrowRight, Images } from "lucide-react";
import { toast } from "sonner";
import { FEATURES } from "@/lib/featureFlags";
import { compressImage } from "@/lib/compressImage";

interface ClubRow {
  id: string;
  name: string;
  region: string;
  daily_schedule_image_url: string | null;
  weekly_schedule_image_url: string | null;
}

type SeriesImg = { id: string; club_id: string; image_url: string; caption: string | null; position: number };

export const MediaClubSchedules = () => {
  const { t } = useTranslation();
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [seriesByClub, setSeriesByClub] = useState<Record<string, SeriesImg[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("clubs")
      .select("id,name,region,daily_schedule_image_url,weekly_schedule_image_url")
      .eq("status", "approved")
      .order("name");
    if (error) toast.error(error.message);
    const list = (data as any[]) ?? [];
    setClubs(list as ClubRow[]);
    // Series-schedule gallery (gated): load all images for the visible clubs at once.
    if (FEATURES.clubSeriesSchedule && list.length) {
      const { data: imgs } = await (supabase as any)
        .from("club_series_images")
        .select("id, club_id, image_url, caption, position")
        .in("club_id", list.map((c) => c.id))
        .order("position");
      const grouped: Record<string, SeriesImg[]> = {};
      for (const r of ((imgs ?? []) as SeriesImg[])) (grouped[r.club_id] ??= []).push(r);
      setSeriesByClub(grouped);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const uploadSeries = async (clubId: string, files: FileList) => {
    setBusyId(clubId + "series");
    try {
      const existing = seriesByClub[clubId] ?? [];
      let pos = existing.length ? Math.max(...existing.map((x) => x.position)) + 1 : 0;
      let published = 0;
      for (const raw of Array.from(files)) {
        if (!raw.type.startsWith("image/")) continue;
        const file = await compressImage(raw, { maxEdge: 1600, quality: 0.85 });
        const ext = file.type === "image/png" ? "png" : "jpg";
        const path = `series-schedules/${clubId}/${Date.now()}-${pos}.${ext}`;
        const { error: upErr } = await supabase.storage.from("app-assets").upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) { toast.error(upErr.message); continue; }
        const { data: pub } = supabase.storage.from("app-assets").getPublicUrl(path);
        const { error } = await (supabase as any).from("club_series_images").insert({ club_id: clubId, image_url: pub.publicUrl, position: pos });
        if (error) { toast.error(error.message); continue; }
        published++;
        pos++;
      }
      if (published === files.length && published > 0) toast.success(t("admin.scheduleUpload.complete"));
      else if (published > 0) toast.warning(t("admin.scheduleUpload.partial", { published, total: files.length }));
      load();
    } catch {
      // A rejected write may have committed: do not retry or delete its object.
      toast.error(t("admin.scheduleUpload.unknown"));
    } finally {
      setBusyId(null);
    }
  };

  const deleteSeries = async (id: string) => {
    if (!confirm("Xoá ảnh này?")) return;
    const { error } = await (supabase as any).from("club_series_images").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Đã xoá"); load(); }
  };

  const moveSeries = async (clubId: string, id: string, dir: "up" | "down") => {
    const list = [...(seriesByClub[clubId] ?? [])];
    const idx = list.findIndex((x) => x.id === id);
    const ni = dir === "up" ? idx - 1 : idx + 1;
    if (ni < 0 || ni >= list.length) return;
    [list[idx], list[ni]] = [list[ni], list[idx]];
    const updates = list.map((x, i) => ({ id: x.id, position: i }));
    setSeriesByClub((prev) => ({ ...prev, [clubId]: list.map((x, i) => ({ ...x, position: i })) }));
    await Promise.all(updates.map((u) => (supabase as any).from("club_series_images").update({ position: u.position }).eq("id", u.id)));
  };

  const upload = async (clubId: string, kind: "daily" | "weekly", file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Phải là file ảnh");
    if (file.size > 8 * 1024 * 1024) return toast.error("Ảnh tối đa 8MB");
    setBusyId(clubId + kind);
    const ext = file.name.split(".").pop();
    const path = `schedules/${clubId}/${kind}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("app-assets").upload(path, file, { upsert: true });
    if (upErr) { setBusyId(null); return toast.error(upErr.message); }
    const { data: pub } = supabase.storage.from("app-assets").getPublicUrl(path);
    const col = kind === "daily" ? "daily_schedule_image_url" : "weekly_schedule_image_url";
    const payload: any = { [col]: pub.publicUrl };
    const { error } = await supabase.from("clubs").update(payload).eq("id", clubId);
    setBusyId(null);
    if (error) toast.error(error.message);
    else { toast.success("Đã cập nhật lịch"); load(); }
  };

  const clear = async (clubId: string, kind: "daily" | "weekly") => {
    if (!confirm("Xoá ảnh lịch này?")) return;
    const col = kind === "daily" ? "daily_schedule_image_url" : "weekly_schedule_image_url";
    const clearPayload: any = { [col]: null };
    const { error } = await supabase.from("clubs").update(clearPayload).eq("id", clubId);
    if (error) toast.error(error.message);
    else { toast.success("Đã xoá"); load(); }
  };

  const filtered = clubs.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.region.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-primary" />
        <h2 className="font-display font-bold text-lg">Lịch thi đấu CLB</h2>
      </div>
      <Input placeholder="Tìm CLB theo tên / khu vực..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className="grid gap-3">
        {filtered.map(c => (
          <Card key={c.id} className="p-4 border border-border">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-display font-bold">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.region}</div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {(["weekly", "daily"] as const).map(kind => {
                const url = kind === "daily" ? c.daily_schedule_image_url : c.weekly_schedule_image_url;
                const label = kind === "daily" ? "Lịch hàng ngày" : "Lịch hàng tuần";
                const busy = busyId === c.id + kind;
                return (
                  <div key={kind} className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wider font-bold text-primary">{label}</div>
                    {url ? (
                      <div className="relative">
                        <img src={url} alt={`${c.name} ${kind}`} className="w-full h-40 object-contain rounded border border-border bg-muted/30" />
                      </div>
                    ) : (
                      <div className="h-40 rounded border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">Chưa có ảnh</div>
                    )}
                    <div className="flex gap-2">
                      <label className="flex-1">
                        <input type="file" accept="image/*" className="hidden" disabled={busy}
                          onChange={e => { const f = e.target.files?.[0]; if (f) upload(c.id, kind, f); e.currentTarget.value = ""; }} />
                        <span className="inline-flex items-center justify-center gap-1 w-full text-xs px-2 py-1.5 rounded bg-primary/10 text-primary border border-primary/30 cursor-pointer hover:bg-primary/20">
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                          Tải ảnh
                        </span>
                      </label>
                      {url && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => clear(c.id, kind)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {FEATURES.clubSeriesSchedule && (
              <div className="mt-4 border-t border-border pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-wider font-bold text-primary flex items-center gap-1">
                    <Images className="w-3.5 h-3.5" /> Lịch series (nhiều ảnh)
                  </div>
                  <label>
                    <input type="file" accept="image/*" multiple className="hidden" disabled={busyId === c.id + "series"}
                      onChange={e => { if (e.target.files?.length) uploadSeries(c.id, e.target.files); e.currentTarget.value = ""; }} />
                    <span className="inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded bg-primary/10 text-primary border border-primary/30 cursor-pointer hover:bg-primary/20">
                      {busyId === c.id + "series" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      Tải nhiều ảnh
                    </span>
                  </label>
                </div>
                {(seriesByClub[c.id] ?? []).length === 0 ? (
                  <div className="text-xs text-muted-foreground">Chưa có ảnh lịch series.</div>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {(seriesByClub[c.id] ?? []).map((img, i, arr) => (
                      <div key={img.id} className="relative shrink-0 w-28">
                        <img src={img.image_url} alt="" className="w-28 h-28 object-cover rounded border border-border bg-muted/30" />
                        <div className="mt-1 flex items-center justify-center gap-1.5">
                          <button onClick={() => moveSeries(c.id, img.id, "up")} disabled={i === 0} className="p-1 rounded text-muted-foreground hover:text-primary disabled:opacity-30" aria-label="Lùi">
                            <ArrowLeft className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteSeries(img.id)} className="p-1 rounded text-destructive hover:bg-destructive/10" aria-label="Xoá">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => moveSeries(c.id, img.id, "down")} disabled={i === arr.length - 1} className="p-1 rounded text-muted-foreground hover:text-primary disabled:opacity-30" aria-label="Tiến">
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
};
