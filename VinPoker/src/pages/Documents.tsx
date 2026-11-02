import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BookOpen, Captions, Download, Eye, FileText, Pencil, Play, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentUploadDialog, type DocumentRow } from "@/components/DocumentUploadDialog";
import { DocumentViewerDialog } from "@/components/DocumentViewerDialog";
import { TabLoader } from "@/components/RouteLoader";

import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

const ICMCalculator = lazy(() => import("@/components/gto/ICMCalculator"));
const EquityCalculator = lazy(() => import("@/components/gto/EquityCalculator"));
const BankrollManager = lazy(() => import("@/pages/BankrollManager"));

const fmtSize = (b: number | null) => {
  if (!b) return "";
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
};
const fmtDate = (s: string) => new Date(s).toLocaleDateString();

const ytEmbed = (url: string) => {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  const v = url.match(/vimeo\.com\/(\d+)/);
  if (v) return `https://player.vimeo.com/video/${v[1]}`;
  return null;
};

export default function Documents() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<(DocumentRow & { created_at: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const readRef = useRef<AbortController | null>(null);
  const liveRef = useRef(false);
  const [q, setQ] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [playing, setPlaying] = useState<DocumentRow | null>(null);
  const [viewing, setViewing] = useState<DocumentRow | null>(null);

  const buildVideoHref = (v: DocumentRow & { created_at?: string }) => {
    const ytId = (v.file_url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/) || [])[1];
    if (!ytId || !v.subtitle_url) return null;
    // Cache-bust subtitle URL so a freshly uploaded SRT replaces any cached old version
    const sep = v.subtitle_url.includes("?") ? "&" : "?";
    const subUrl = `${v.subtitle_url}${sep}v=${Date.now()}`;
    return `/video?videoId=${ytId}&title=${encodeURIComponent(v.title)}&subtitleUrl=${encodeURIComponent(subUrl)}`;
  };

  const openVideo = (v: DocumentRow) => {
    const href = buildVideoHref(v);
    if (href) {
      navigate(href);
      return;
    }
    setPlaying(v);
  };

  const load = useCallback(async () => {
    if (!liveRef.current) return;
    readRef.current?.abort();
    const controller = new AbortController();
    readRef.current = controller;
    const current = () => liveRef.current && readRef.current === controller && !controller.signal.aborted;
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await observeTrackerContextRead(supabase
        .from("documents")
        .select("id, kind, title, description, tags, file_url, thumbnail_url, mime_type, size_bytes, is_public, subtitle_url, created_at")
        .order("created_at", { ascending: false })
        .abortSignal(controller.signal));
      if (!current()) return;
      if (error || !Array.isArray(data) || data.some(row => !row || typeof row.id !== "string" ||
        !["file", "video"].includes(row.kind) || typeof row.title !== "string" ||
        typeof row.file_url !== "string" || typeof row.created_at !== "string")) throw new Error("documents_read_unavailable");
      setRows(data.map((row):DocumentRow & {created_at:string}=>({...row,kind:row.kind==='file'?'file':'video'})));
    } catch {
      if (current()) { setRows([]); setLoadError(true); }
    } finally {
      if (current()) setLoading(false);
      controller.abort();
    }
  }, []);

  useEffect(() => {
    liveRef.current = true;
    void load();
    return () => { liveRef.current = false; readRef.current?.abort(); };
  }, [load]);

  const videos = useMemo(
    () => rows.filter((r) => r.kind === "video" && r.title.toLowerCase().includes(q.toLowerCase())),
    [rows, q]
  );
  const files = useMemo(
    () => rows.filter((r) => r.kind === "file" && r.title.toLowerCase().includes(q.toLowerCase())),
    [rows, q]
  );

  const handleDelete = async (id: string) => {
    if (!confirm(t("documentsPage.confirmDelete"))) return;
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) {
      toast.error(t("documentsPage.deleteFailed"));
      return;
    }
    toast.success(t("documentsPage.deleted"));
    load();
  };

  return (
    <div className="space-y-8">
      <section className="relative rounded-2xl bg-gradient-to-br from-card/60 to-card/40 border border-gold/30 p-6 backdrop-blur-sm overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/20 rounded-full blur-3xl opacity-30" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary/10 rounded-full blur-[120px] opacity-20" />
        </div>
        <div className="relative">
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-xs font-semibold text-primary">
              <BookOpen className="w-3.5 h-3.5" />
              {t("documentsPage.title")}
            </span>
          </div>
          <h1 className="font-display text-3xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-2">
            {t("documentsPage.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("documentsPage.subtitle")}</p>
          {isAdmin && (
            <Button
              onClick={() => {
                setEditing(null);
                setUploadOpen(true);
              }}
              className="mt-4 gradient-gold text-primary-foreground border-0"
            >
              <Plus className="w-4 h-4" />
              {t("documentsPage.uploadBtn")}
            </Button>
          )}
        </div>
      </section>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("documentsPage.search")} className="pl-9 bg-card/50 border-border/40" />
      </div>

      {loadError && (
        <div role="alert" className="rounded-lg border border-border p-4 space-y-3">
          <p className="text-sm text-muted-foreground">{t("documentsPage.readError")}</p>
          <Button variant="outline" onClick={() => void load()}>{t("documentsPage.retry")}</Button>
        </div>
      )}
      <Tabs defaultValue="files">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="files">{t("documentsPage.title")}</TabsTrigger>
          <TabsTrigger value="videos">Video</TabsTrigger>
          <TabsTrigger value="icm">{t("icmCalc.title")}</TabsTrigger>
          <TabsTrigger value="equity">Equity</TabsTrigger>
          <TabsTrigger value="bankroll">{t("bankroll.title")}</TabsTrigger>
        </TabsList>
        <TabsContent value="files">
          {loading ? (
            <p className="text-muted-foreground py-12 text-center">{t("common.loading")}</p>
          ) : loadError ? null : files.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center">{t("documentsPage.empty")}</p>
          ) : (
            <div className="space-y-3">
              {files.map((f) => (
                <Card key={f.id} className="p-4 flex items-center gap-4 border-border/40 bg-gradient-to-r from-card/60 to-card/40 backdrop-blur-sm hover:border-border/60 transition-colors">
                  {f.thumbnail_url ? (
                    <img
                      src={f.thumbnail_url}
                      alt={f.title}
                      className="w-12 h-12 rounded-md object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <FileText className="w-6 h-6" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{f.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {(f.mime_type ?? "").split("/").pop()?.toUpperCase()} · {fmtSize(f.size_bytes)} · {fmtDate(f.created_at)}
                    </p>
                    {f.description && <p className="text-xs text-muted-foreground line-clamp-1">{f.description}</p>}
                  </div>
                  <Button size="sm" variant="default" onClick={() => setViewing(f)}>
                    <Eye className="w-4 h-4" />
                    <span className="hidden sm:inline">{t("documentsPage.view")}</span>
                  </Button>
                  <a
                    href={f.file_url}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    aria-label={t("documentsPage.download")}
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(f); setUploadOpen(true); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(f.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="videos">
          {loading ? (
            <p className="text-muted-foreground py-12 text-center">{t("common.loading")}</p>
          ) : loadError ? null : videos.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center">{t("documentsPage.empty")}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {videos.map((v) => {
                const ytId = (v.file_url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/) || [])[1];
                const hasCC = !!v.subtitle_url;
                return (
                  <Card key={v.id} className="overflow-hidden flex flex-col border-border/40 bg-gradient-to-br from-card/60 to-card/40 backdrop-blur-sm hover:border-border/60 transition-colors">
                    <button
                      type="button"
                      onClick={() => openVideo(v)}
                      className="relative aspect-video bg-muted/40 group"
                    >
                      {v.thumbnail_url ? (
                        <img src={v.thumbnail_url} alt={v.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-primary/10">
                          <Play className="w-10 h-10 text-primary" />
                        </div>
                      )}
                      <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 group-hover:opacity-100 transition">
                        <Play className="w-10 h-10 text-white" />
                      </div>
                      {hasCC && (
                        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5">
                          <Captions className="w-3 h-3" /> CC
                        </span>
                      )}
                    </button>
                    <div className="p-3 space-y-2 flex-1 flex flex-col">
                      <h3 className="font-semibold truncate">{v.title}</h3>
                      {v.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{v.description}</p>
                      )}
                      <div className="flex gap-2 mt-auto pt-2">
                        <Button size="sm" variant="default" onClick={() => openVideo(v)} className="flex-1">
                          <Play className="w-4 h-4" /> {t("documentsPage.view")}
                        </Button>
                        {ytId && hasCC && (
                          <Button size="sm" variant="outline" asChild>
                            <Link to={buildVideoHref(v) ?? "#"}>
                              <Captions className="w-4 h-4" /> CC
                            </Link>
                          </Button>
                        )}
                        {isAdmin && (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => { setEditing(v); setUploadOpen(true); }}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => handleDelete(v.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
        <TabsContent value="icm">
          <Suspense fallback={<TabLoader />}>
            <ICMCalculator />
          </Suspense>
        </TabsContent>
        <TabsContent value="equity">
          <Suspense fallback={<TabLoader />}>
            <EquityCalculator />
          </Suspense>
        </TabsContent>
        <TabsContent value="bankroll">
          <Suspense fallback={<TabLoader />}>
            <BankrollManager />
          </Suspense>
        </TabsContent>
      </Tabs>

      <DocumentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        editing={editing}
        onSaved={load}
      />

      <Dialog open={!!playing} onOpenChange={(v) => !v && setPlaying(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{playing?.title}</DialogTitle>
          </DialogHeader>
          {playing && (() => {
            const embed = ytEmbed(playing.file_url);
            if (embed) {
              return (
                <div className="aspect-video w-full">
                  <iframe
                    src={embed}
                    className="w-full h-full rounded-md"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              );
            }
            return (
              <video src={playing.file_url} controls className="w-full rounded-md" />
            );
          })()}
        </DialogContent>
      </Dialog>
      <DocumentViewerDialog
        doc={viewing}
        open={!!viewing}
        onOpenChange={(v) => !v && setViewing(null)}
      />
    </div>
  );
}
