import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { canonicalVoiceJson } from "@/lib/trackerVoice/canonicalRequest";
import { Palette, RotateCcw, Save } from "lucide-react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProofUploader } from "@/components/ProofUploader";
import { VinPokerTournamentClock } from "@/components/tournament-clock/VinPokerTournamentClock";
import type { TournamentClockData } from "@/components/tournament-clock/types";
import { FEATURES } from "@/lib/featureFlags";
import {
  DEFAULT_TV_BRANDING_LAYOUT,
  TV_BRANDING_FONTS,
  TV_TEXT_STYLES,
  parseTvBrandingLayout,
  serializeTvBrandingLayout,
  validateTvBrandingLayout,
  type TvBrandingFont,
  type TvBrandingLayout,
  type TvTextStyle,
} from "@/lib/tv/brandingLayout";

const BRANDING_PREVIEW_DATA: TournamentClockData = {
  title: "MAIN EVENT · DAY 1",
  players: 93,
  entries: 128,
  reEntries: 35,
  prizePool: "2,910,000,000 VND",
  totalChips: "38,400,000",
  averageStack: "412,903 · 82 BB",
  levelLabel: "Level 8",
  secondsLeft: 35 * 60 + 31,
  nextBreakSecondsLeft: 18 * 60,
  currentLevel: "2,000 / 4,000 / 4,000",
  nextLevel: "2,500 / 5,000 / 5,000",
  payouts: [
    { rank: "1st", amount: "720,000,000 VND" },
    { rank: "2nd", amount: "480,000,000 VND" },
    { rank: "3rd", amount: "320,000,000 VND" },
    { rank: "4th", amount: "210,000,000 VND" },
    { rank: "5th", amount: "150,000,000 VND" },
  ],
  footerNote: "Next level · 40 min",
};

type UntypedRpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;

function RangeControl({ label, value, min, max, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <span className="min-w-12 text-right font-mono text-xs text-muted-foreground">{value}%</span>
      </div>
      <Slider aria-label={label} min={min} max={max} step={1} value={[value]} onValueChange={([next]) => onChange(next)} />
    </div>
  );
}

export function TvBrandingEditor({ tournamentId }: { tournamentId: string }) {
  const { user } = useAuth();
  return <ScopedTvBrandingEditor key={JSON.stringify([user?.id, tournamentId])} tournamentId={tournamentId} />;
}

function ScopedTvBrandingEditor({ tournamentId }: { tournamentId: string }) {
  const supabase = useSupabaseClient();
  const rpc = useMemo(
    () => supabase.rpc.bind(supabase) as UntypedRpc,
    [supabase],
  );
  const [open, setOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const [layout, setLayout] = useState<TvBrandingLayout>({ ...DEFAULT_TV_BRANDING_LAYOUT });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  const saveFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (!open || !FEATURES.tvLayoutEditorV1) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const { data, error } = await observeTrackerContextRead(rpc("get_tv_tournament_branding_v1", { p_tournament_id: tournamentId }));
        if (cancelled) return;
        if (error || !data) {
          setLoadError(error?.message ?? "Tournament TV settings were not found.");
          setLoading(false);
          return;
        }
        const row = data as unknown as {
          logo_url: string | null;
          brand_name: string | null;
          background_url: string | null;
          layout: unknown;
          revision: number;
        };
        if (!Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error("tv_revision_unverified");
        setLogoUrl(row.logo_url);
        setBgUrl(row.background_url);
        setBrandName(row.brand_name ?? "");
        setLayout(parseTvBrandingLayout(row.layout));
        setRevision(row.revision);
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError("Could not load current TV settings. Close and reopen to retry."); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [open, rpc, tournamentId]);

  const previewData = useMemo<TournamentClockData>(() => ({
    ...BRANDING_PREVIEW_DATA,
    clubBackgroundUrl: bgUrl,
    clubLogoUrl: logoUrl,
    brandName: brandName.trim() || "VINPOKER",
    brandingLayout: layout,
  }), [bgUrl, brandName, layout, logoUrl]);

  const patchLayout = <K extends keyof TvBrandingLayout>(key: K, value: TvBrandingLayout[K]) => {
    setLayout((current) => ({ ...current, [key]: value }));
  };

  const patchText = (id: string, patch: Partial<TvBrandingLayout["textBlocks"][number]>) => {
    setLayout((current) => ({
      ...current,
      textBlocks: current.textBlocks.map((block) => block.id === id ? { ...block, ...patch } : block),
    }));
  };

  const layoutError = validateTvBrandingLayout(layout);

  const save = async () => {
    if (saveFlight.current || loading || loadError || layoutError) return;
    saveFlight.current = true;
    const submitted = {
      brandName: brandName.trim(),
      logoUrl: logoUrl?.trim() || null,
      backgroundUrl: bgUrl?.trim() || null,
      layout: serializeTvBrandingLayout(layout),
    };
    setSaving(true);
    try {
      const { data, error } = await waitForManualPlayerResponse(Promise.resolve(rpc("save_tv_tournament_layout_v1", {
        p_tournament_id: tournamentId,
        p_expected_revision: revision,
        p_brand_name: submitted.brandName,
        p_logo_url: submitted.logoUrl ?? "",
        p_bg_url: submitted.backgroundUrl ?? "",
        p_layout: submitted.layout,
      })));
      if (!alive.current) return;
      if (error || !data) {
        toast.error(error?.message?.includes("tv_layout_stale_revision")
          ? "Another operator published a new layout. Reopen the editor before saving."
          : error?.message ?? "The TV layout was not saved.");
        return;
      }
      const savedRevision = (data as { revision?: unknown }).revision;
      if (!Number.isSafeInteger(savedRevision) || Number(savedRevision) <= revision) throw new Error("tv_publish_unconfirmed");
      toast.success("TV layout published. Screens update on their next refresh.");
      setOpen(false);
    } catch {
      if (!alive.current) return;
      // A lost response can happen after the transaction commits. Re-read the
      // canonical head before inviting a retry, which would otherwise produce
      // a misleading revision conflict.
      try {
        const { data, error } = await observeTrackerContextRead(rpc("get_tv_tournament_branding_v1", { p_tournament_id: tournamentId }));
        if (!alive.current) return;
        const canonical = data as null | {
          brand_name: string | null; logo_url: string | null;
          background_url: string | null; layout: unknown; revision: number;
        };
        if (!error && canonical
          && Number.isSafeInteger(canonical.revision) && canonical.revision > revision
          && (canonical.brand_name ?? "") === submitted.brandName
          && canonical.logo_url === submitted.logoUrl
          && canonical.background_url === submitted.backgroundUrl
          && canonicalVoiceJson(canonical.layout) === canonicalVoiceJson(submitted.layout)) {
          toast.success("TV layout published. Screens update on their next refresh.");
          setOpen(false);
        } else {
          toast.error("The TV layout response was lost and the published state could not be confirmed. Reopen the editor before retrying.");
        }
      } catch {
        if (alive.current) toast.error("The TV layout response was lost and the published state could not be confirmed. Reopen the editor before retrying.");
      }
    } finally {
      saveFlight.current = false;
      if (alive.current) setSaving(false);
    }
  };

  if (!FEATURES.tvLayoutEditorV1) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saveFlight.current) setOpen(next); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-11 gap-1.5 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10">
          <Palette className="h-4 w-4" /> Edit TV layout
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2"><Palette className="h-4 w-4 text-emerald-400" /> Tournament TV layout</DialogTitle>
          <DialogDescription>Preview your changes, then publish them to the tournament TV screens.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Loading TV settings…</p>
        ) : loadError ? (
          <div className="space-y-3 px-5 py-8 text-center">
            <p className="text-sm text-destructive">{loadError}</p>
            <p className="text-xs text-muted-foreground">Editing is blocked until the current server settings can be loaded.</p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
            <section className="border-b bg-black/95 p-4 lg:border-b-0 lg:border-r">
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[.18em] text-white/60">
                <span>Draft 16:9 preview · not on TV</span><span>Safe area: 4–96%</span>
              </div>
              <div className="relative aspect-video overflow-hidden rounded-xl border border-emerald-400/30 shadow-2xl">
                <VinPokerTournamentClock
                  data={previewData}
                  brandingEditing
                  editorPreview
                  onBrandingLayoutChange={setLayout}
                />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-white/55">Changes appear on TV only after Publish. Tournament numbers remain server-controlled.</p>
              {layoutError && <p role="alert" className="mt-2 text-xs text-amber-300">{layoutError}</p>}
            </section>

            <section className="space-y-5 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div className="space-y-1.5"><Label className="text-xs">Tournament logo</Label><ProofUploader folder="tv/branding-logo" versioned value={logoUrl} onChange={setLogoUrl} /></div>
                <div className="space-y-1.5"><Label className="text-xs">TV background</Label><ProofUploader folder="tv/branding-background" versioned value={bgUrl} onChange={setBgUrl} /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="tv-brand-name" className="text-xs">Brand name</Label><Input id="tv-brand-name" value={brandName} onChange={(event) => setBrandName(event.target.value)} maxLength={40} placeholder="VINPOKER" /></div>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div><h3 className="text-sm font-semibold">Text blocks</h3><p className="text-xs text-muted-foreground">Move each block on the preview or focus it and use arrow keys.</p></div>
                  <Button type="button" variant="outline" size="sm" disabled={layout.textBlocks.length >= 6} onClick={() => {
                    const id = crypto.randomUUID();
                    const candidates = [{ x: 42, y: 19 }, { x: 58, y: 19 }, { x: 86, y: 10 }, { x: 12, y: 90 }, { x: 88, y: 90 }, { x: 50, y: 10 }];
                    setLayout((current) => {
                      const block = candidates.map(({ x, y }) => ({
                        id, text: "New text", x, y, width: 14, height: 6,
                        font: current.font, size: 18, style: "plain" as const,
                      })).find((candidate) => validateTvBrandingLayout({ ...current, textBlocks: [...current.textBlocks, candidate] }) === null);
                      return block ? { ...current, textBlocks: [...current.textBlocks, block] } : current;
                    });
                  }}>Add text ({layout.textBlocks.length}/6)</Button>
                </div>
                {layout.textBlocks.map((block, index) => (
                  <fieldset key={block.id} className="grid gap-3 rounded-lg border border-border/70 p-3 sm:grid-cols-2">
                    <legend className="px-1 text-xs font-medium">Text {index + 1}</legend>
                    <div className="space-y-1.5 sm:col-span-2"><Label htmlFor={`tv-text-${block.id}`} className="text-xs">Text</Label><Input id={`tv-text-${block.id}`} value={block.text} onChange={(event) => patchText(block.id, { text: event.target.value.slice(0, 100) })} maxLength={100} /></div>
                    <RangeControl label="Horizontal position" value={block.x} min={4} max={96} onChange={(value) => patchText(block.id, { x: value })} />
                    <RangeControl label="Vertical position" value={block.y} min={4} max={96} onChange={(value) => patchText(block.id, { y: value })} />
                    <div className="space-y-1.5"><Label className="text-xs">Font</Label><Select value={block.font} onValueChange={(value) => patchText(block.id, { font: value as TvBrandingFont })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TV_BRANDING_FONTS.map((font) => <SelectItem key={font} value={font}>{font[0].toUpperCase() + font.slice(1)}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1.5"><Label className="text-xs">Style</Label><Select value={block.style} onValueChange={(value) => patchText(block.id, { style: value as TvTextStyle })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TV_TEXT_STYLES.map((style) => <SelectItem key={style} value={style}>{style[0].toUpperCase() + style.slice(1)}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1.5"><Label htmlFor={`tv-size-${block.id}`} className="text-xs">Size (12–42)</Label><Input id={`tv-size-${block.id}`} type="number" min={12} max={42} value={block.size} onChange={(event) => patchText(block.id, { size: Number(event.target.value) })} /></div>
                    <div className="flex items-end justify-end"><Button type="button" variant="ghost" size="sm" onClick={() => patchLayout("textBlocks", layout.textBlocks.filter((item) => item.id !== block.id))}>Remove text</Button></div>
                  </fieldset>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Brand font</Label>
                <Select value={layout.font} onValueChange={(value) => patchLayout("font", value as TvBrandingFont)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TV_BRANDING_FONTS.map((font) => <SelectItem key={font} value={font}>{font[0].toUpperCase() + font.slice(1)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <RangeControl label="Logo horizontal" value={layout.brandX} min={8} max={92} onChange={(value) => patchLayout("brandX", value)} />
                <RangeControl label="Logo vertical" value={layout.brandY} min={4} max={96} onChange={(value) => patchLayout("brandY", value)} />
                <RangeControl label="Brand size" value={layout.brandScale} min={70} max={140} onChange={(value) => patchLayout("brandScale", value)} />
                <RangeControl label="Logo size" value={layout.logoScale} min={60} max={150} onChange={(value) => patchLayout("logoScale", value)} />
                <RangeControl label="Background horizontal" value={layout.backgroundX} min={0} max={100} onChange={(value) => patchLayout("backgroundX", value)} />
                <RangeControl label="Background vertical" value={layout.backgroundY} min={0} max={100} onChange={(value) => patchLayout("backgroundY", value)} />
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="border-t px-5 py-4 sm:justify-between">
          <Button type="button" variant="ghost" className="gap-2" disabled={loading || !!loadError || saving} onClick={() => { setLayout({ ...DEFAULT_TV_BRANDING_LAYOUT }); setLogoUrl(null); setBgUrl(null); setBrandName(""); }}><RotateCcw className="h-4 w-4" /> Reset draft to defaults</Button>
          <Button type="button" className="gap-2" onClick={save} disabled={loading || !!loadError || !!layoutError || saving}><Save className="h-4 w-4" /> {saving ? "Publishing…" : "Publish TV layout"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
