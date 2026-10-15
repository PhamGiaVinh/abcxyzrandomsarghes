import { useEffect, useMemo, useState } from "react";
import { LegacyScheduleEvidenceNote } from "@/components/LegacyScheduleEvidenceNote";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { formatBuyInShort, formatShortDate, formatTime, formatStack } from "@/lib/format";
import { FomoPrice } from "@/components/FomoPrice";
import { FEATURES } from "@/lib/featureFlags";
import { ImageCarousel } from "@/components/ImageCarousel";
import { Loader2, ChevronLeft, ChevronRight, Trophy, ExternalLink, Radio, Newspaper, ChevronDown, Filter, Search, X, ArrowUp, ArrowDown, Eye, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { LivestreamSection } from "@/components/LivestreamSection";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getCurrentLevel, getLevelEndsIn, isLateRegClosed, formatCountdown, getEffectiveStart } from "@/lib/tournamentLive";
import { useTranslation } from "react-i18next";
import { TournamentRegisterModal } from "@/components/TournamentRegisterModal";
import News from "./News";
import { useTournamentPackages } from "@/hooks/useTournamentPackages";
import PackageCard from "@/components/packages/PackageCard";
import PackageCardSkeleton from "@/components/packages/PackageCardSkeleton";


interface Tournament {
  id: string;
  name: string;
  start_time: string;
  buy_in: number;
  rake_amount?: number;
  service_fee_amount?: number;
  free_rake_enabled?: boolean;
  free_rake_slots?: number;
  free_rake_used?: number;
  starting_stack: number;
  current_players: number;
  current_blinds: string | null;
  live_status: string;
  clock_started_at?: string | null;
  location: string | null;
  game_type: string;
  minutes_per_level: number | null;
  late_reg_close_level: number | null;
  club: { id: string; name: string; region: string };
}

interface BannerItem {
  id?: string;
  title: string;
  subtitle: string;
  image_url: string;
  cta_url: string;
}

const PAGE_SIZE = 5;
const GAME_LABEL: Record<string, string> = { nlh: "No Limit Hold'em", plo: "Pot Limit Omaha", mixed: "Mixed Games" };

interface SeriesItem {
  id: string;
  name: string;
  location: string | null;
  start_date: string;
  end_date: string;
  cover_url: string | null;
}

const Tournaments = () => {
  const { user, isAdmin } = useAuth();
  const { t: tr } = useTranslation();
  const nav = useNavigate();
  const [items, setItems] = useState<Tournament[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [scheduleClubs, setScheduleClubs] = useState<{ id: string; name: string; region: string; daily_schedule_image_url: string | null; weekly_schedule_image_url: string | null; schedule_sort_order: number }[]>([]);
  const [seriesByClub, setSeriesByClub] = useState<Record<string, { image_url: string; caption: string | null }[]>>({});
  const [reordering, setReordering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"daily" | "weekly" | "news" | "series" | "livestream" | "livetracker" | "packages">("weekly");
  const [buyInRange, setBuyInRange] = useState("all");
  const [statusUpcoming, setStatusUpcoming] = useState(true);
  const [statusLateReg, setStatusLateReg] = useState(true);
  const [gameTypes, setGameTypes] = useState<Record<string, boolean>>({ nlh: true, plo: true, mixed: true });
  const [page, setPage] = useState(1);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [bannerIdx, setBannerIdx] = useState(0);
  const [registerFor, setRegisterFor] = useState<{ id: string; name: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: t }, { data: bs }, { data: vb }, { data: sr }, { data: cs }] = await Promise.all([
        // Cast to any: the dynamic (feature-flagged) select string overflows the
        // generated-types union (TS2590); the result is narrowed to Tournament[] below.
        (supabase as any)
          .from("tournaments")
          .select(`id,name,start_time,buy_in,rake_amount${FEATURES.tournamentServiceFee ? ",service_fee_amount" : ""},free_rake_enabled,free_rake_slots,free_rake_used,starting_stack,current_players,current_blinds,live_status,clock_started_at,location,game_type,minutes_per_level,late_reg_close_level, club:clubs(id,name,region)`)
          .order("buy_in", { ascending: false }),
        supabase.from("app_settings").select("value").eq("key", "banners").maybeSingle(),
        supabase.from("app_settings").select("value").eq("key", "vip_banner").maybeSingle(),
        supabase.from("tournament_series").select("id,name,location,start_date,end_date,cover_url").order("start_date", { ascending: true }),
        supabase.from("clubs").select("id,name,region,daily_schedule_image_url,weekly_schedule_image_url,schedule_sort_order").eq("status", "approved").order("schedule_sort_order", { ascending: true }).order("name"),
      ]);
      setItems((t as any) ?? []);
      setSeries((sr as any) ?? []);
      setScheduleClubs((cs as any) ?? []);
      // Club "Lịch series" galleries embedded in the weekly view (gated).
      if (FEATURES.clubSeriesSchedule) {
        const ids = ((cs as any[]) ?? []).map((c) => c.id);
        if (ids.length) {
          const { data: simgs } = await (supabase as any)
            .from("club_series_images")
            .select("club_id, image_url, caption, position")
            .in("club_id", ids)
            .order("position");
          const grouped: Record<string, { image_url: string; caption: string | null }[]> = {};
          for (const r of ((simgs ?? []) as any[])) (grouped[r.club_id] ??= []).push({ image_url: r.image_url, caption: r.caption ?? null });
          setSeriesByClub(grouped);
        }
      }
      const list: BannerItem[] = [];
      const multi = (bs?.value as any)?.items;
      if (Array.isArray(multi)) {
        for (const b of multi) if (b?.image_url || b?.title) list.push(b);
      }
      // Fallback to legacy single VIP banner
      if (list.length === 0 && vb?.value) {
        const v = vb.value as any;
        if (v.image_url || v.title) list.push(v);
      }
      setBanners(list);
      setLoading(false);
    })();
  }, []);

  // Auto-rotate banners every 5s
  useEffect(() => {
    if (banners.length <= 1) return;
    const id = setInterval(() => setBannerIdx(i => (i + 1) % banners.length), 5000);
    return () => clearInterval(id);
  }, [banners.length]);

  const banner = banners[bannerIdx] ?? null;

  // Tick every 30s so countdowns / auto-hide refresh
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const q = searchQuery.trim().toLowerCase();
    return items.filter((i) => {
      const ts = new Date(i.start_time).getTime();
      // Auto-hide once late reg is closed (buy-in window ended) or finished
      if (isLateRegClosed(i, now)) return false;
      // A tournament whose clock has actually started (floor pressed "Bắt đầu giải")
      // and whose late reg is still open must stay registerable even if its planned
      // start_time is now stale — otherwise the date-window below would hide it.
      const isLiveRunning = !!i.clock_started_at && i.live_status !== "finished";
      if (!isLiveRunning) {
        if (view === "daily") {
          const sameDay = new Date(i.start_time).toDateString() === new Date().toDateString();
          if (!sameDay && (ts < now || ts > now + 24 * 60 * 60 * 1000)) return false;
        } else {
          if (ts < now - 12 * 60 * 60 * 1000 || ts > now + weekMs) return false;
        }
      }
      if (buyInRange !== "all") {
        const v = i.buy_in;
        if (buyInRange === "low" && v >= 2_000_000) return false;
        if (buyInRange === "mid" && (v < 2_000_000 || v >= 10_000_000)) return false;
        if (buyInRange === "high" && v < 10_000_000) return false;
      }
      if (!gameTypes[i.game_type ?? "nlh"]) return false;
      // Upcoming = not yet started; Late Reg = started but buy-in still open.
      // A running tournament is always "late reg" (never "upcoming") regardless of
      // its planned start_time, so the Late Reg filter toggle controls it correctly.
      const isUp = ts > now && !isLiveRunning;
      const isLate = (ts <= now || isLiveRunning) && !isLateRegClosed(i, now);
      if (!statusUpcoming && isUp) return false;
      if (!statusLateReg && isLate) return false;
      if (!statusUpcoming && !statusLateReg) return false;
      if (q) {
        const nameMatch = i.name?.toLowerCase().includes(q);
        const buyInMatch = formatBuyInShort(i.buy_in).toLowerCase().includes(q);
        if (!nameMatch && !buyInMatch) return false;
      }
      return true;
    });
  }, [items, view, buyInRange, statusUpcoming, statusLateReg, gameTypes, tick, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggleGame = (k: string) => { setGameTypes(prev => ({ ...prev, [k]: !prev[k] })); setPage(1); };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (buyInRange !== "all") n++;
    if (!gameTypes.nlh || !gameTypes.plo || !gameTypes.mixed) n++;
    if (!statusUpcoming || !statusLateReg) n++;
    return n;
  }, [buyInRange, gameTypes, statusUpcoming, statusLateReg]);

  // Compact view selector: 3 primary tabs always visible, the rest under "Khác".
  type ViewKey = typeof view;
  const PRIMARY_VIEWS: ViewKey[] = ["daily", "weekly", "livetracker"];
  const MORE_VIEWS: ViewKey[] = ["news", "series", "livestream", "packages"];
  const viewLabel = (v: ViewKey) =>
    v === "daily" ? tr("tournamentsPage.daily")
      : v === "weekly" ? tr("tournamentsPage.weekly")
      : v === "series" ? tr("tournamentsPage.series")
      : v === "livestream" ? tr("tournamentsPage.livestream")
      : v === "livetracker" ? tr("tournamentsPage.livetracker")
      : v === "packages" ? tr("tournamentsPage.packages")
      : tr("tournamentsPage.news");
  const viewIcon = (v: ViewKey) =>
    v === "livestream" ? <Radio className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#ff1900] shrink-0" />
      : v === "livetracker" ? <Eye className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-success shrink-0" />
      : v === "news" ? <Newspaper className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
      : v === "packages" ? <span className="material-symbols-outlined text-sm sm:text-base shrink-0">redeem</span>
      : null;
  const selectFromMore = MORE_VIEWS.includes(view);

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-card via-card to-background px-5 py-6 md:px-8 md:py-8">
        {/* Decorative glow effects */}
        <div className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-primary/10 blur-[120px]" />

        {/* Content */}
        <div className="relative z-10">
          {/* Compact title row (badge + title merged) */}
          <div className="flex items-center gap-2 mb-1.5">
            <Trophy className="w-4 h-4 text-primary shrink-0" />
            <h1 className="font-display text-xl md:text-3xl tracking-[0.03em] text-primary leading-tight drop-shadow-[0_0_18px_hsl(var(--primary)/0.3)]">
              {tr("tournamentsPage.title")}
            </h1>
          </div>

          {/* Subtitle */}
          <p className="text-xs md:text-sm text-muted-foreground leading-relaxed max-w-2xl mb-4">
            {tr("tournamentsPage.subtitle")}
          </p>

          {/* View selector — 3 primary tabs + "Khác" dropdown */}
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto rounded-2xl bg-card/40 border border-border/30 p-1.5 backdrop-blur-sm">
            {PRIMARY_VIEWS.map((v) => (
              <button
                key={v}
                onClick={() => { setView(v); setPage(1); }}
                className={cn(
                  "px-3 sm:px-4 py-2 text-[10px] sm:text-xs font-bold tracking-wider uppercase rounded-full transition-all inline-flex items-center justify-center gap-1 sm:gap-1.5 leading-tight text-center",
                  view === v
                    ? v === "livetracker"
                      ? "bg-success/20 text-success shadow-[0_0_12px_rgba(16,185,129,0.25)]"
                      : "gradient-neon text-primary-foreground shadow-neon"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/70"
                )}
              >
                {viewIcon(v)}
                <span className="truncate">{viewLabel(v)}</span>
              </button>
            ))}
            <Link
              to="/documents"
              className="px-3 sm:px-4 py-2 text-[10px] sm:text-xs font-bold tracking-wider uppercase rounded-full transition-all inline-flex items-center justify-center gap-1 sm:gap-1.5 leading-tight text-center text-muted-foreground hover:text-foreground hover:bg-card/70"
            >
              <BookOpen className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
              <span className="truncate">{tr("nav.documents")}</span>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "px-3 sm:px-4 py-2 text-[10px] sm:text-xs font-bold tracking-wider uppercase rounded-full transition-all inline-flex items-center justify-center gap-1 sm:gap-1.5 leading-tight",
                    selectFromMore
                      ? view === "livestream"
                        ? "bg-[#ff1900]/15 text-[#ff5b3f] shadow-[0_0_12px_rgba(255,25,0,0.25)]"
                        : "gradient-neon text-primary-foreground shadow-neon"
                      : "text-muted-foreground hover:text-foreground hover:bg-card/70"
                  )}
                >
                  {selectFromMore
                    ? <><span className="inline-flex shrink-0">{viewIcon(view)}</span><span className="truncate">{viewLabel(view)}</span></>
                    : tr("tournamentsPage.more")}
                  <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44">
                {MORE_VIEWS.map((v) => (
                  <DropdownMenuItem
                    key={v}
                    onClick={() => { setView(v); setPage(1); }}
                    className={cn("gap-2 cursor-pointer text-xs font-bold tracking-wider uppercase", view === v && "text-primary")}
                  >
                    <span className="inline-flex w-4 justify-center shrink-0">{viewIcon(v)}</span>
                    {viewLabel(v)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {view === "livestream" ? (
        <LivestreamSection />
      ) : view === "livetracker" ? (
        <LiveTrackerSection />
      ) : view === "news" ? (
        <News />
      ) : view === "packages" ? (
        <PackagesSection />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <aside className="space-y-5">
          <Card className="p-6 bg-gradient-to-br from-card/60 to-card/40 border border-border/40 backdrop-blur-sm">
            <Collapsible open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 lg:cursor-default lg:pointer-events-none"
                >
                  <h3 className="font-display font-bold text-lg flex items-center gap-2">
                    <Filter className="w-4 h-4 lg:hidden text-primary" />
                    {tr("tournamentsPage.filters")}
                    {activeFilterCount > 0 && (
                      <span className="lg:hidden text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/40 rounded-full px-2 py-0.5">
                        {tr("tournamentsPage.filtersActive", { count: activeFilterCount })}
                      </span>
                    )}
                  </h3>
                  <ChevronDown className={cn("w-4 h-4 lg:hidden text-muted-foreground transition-transform", mobileFiltersOpen && "rotate-180")} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent forceMount className="overflow-hidden data-[state=closed]:hidden lg:!block">
                <div className="space-y-3 mt-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{tr("tournamentsPage.gameType")}</div>
                  {(["nlh","plo","mixed"] as const).map(k => (
                    <label key={k} className="flex items-center gap-2.5 text-sm cursor-pointer hover:text-primary transition-colors">
                      <Checkbox checked={gameTypes[k]} onCheckedChange={() => toggleGame(k)} />
                      <span>{GAME_LABEL[k]}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-5 space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{tr("tournamentsPage.buyInRange")}</div>
                  <Select value={buyInRange} onValueChange={(v) => { setBuyInRange(v); setPage(1); }}>
                    <SelectTrigger className="bg-muted/40 border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tr("tournamentsPage.allStakes")}</SelectItem>
                      <SelectItem value="low">&lt; 2M</SelectItem>
                      <SelectItem value="mid">2M – 10M</SelectItem>
                      <SelectItem value="high">10M+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="mt-5 space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{tr("tournamentsPage.status")}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { setStatusUpcoming((v) => !v); setPage(1); }}
                      className={cn(
                        "px-3 py-1.5 text-xs font-bold rounded-lg border transition-all",
                        statusUpcoming
                          ? "gradient-neon text-primary-foreground border-transparent shadow-neon"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tr("tournamentsPage.upcoming")}
                    </button>
                    <button
                      onClick={() => { setStatusLateReg((v) => !v); setPage(1); }}
                      className={cn(
                        "px-3 py-1.5 text-xs font-bold rounded-lg border transition-all",
                        statusLateReg
                          ? "bg-primary/15 text-primary border-primary/40"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tr("tournamentsPage.lateReg")}
                    </button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* VIP Card (sidebar small) */}
          <Card className="relative overflow-hidden border border-primary/20 p-0 bg-gradient-to-br from-card/60 to-card/40">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent pointer-events-none" />
            <div className="aspect-[4/3] bg-gradient-to-br from-secondary/50 to-background/50 flex items-center justify-center overflow-hidden">
              {banner?.image_url ? (
                <img src={banner.image_url} alt={banner.title} className="w-full h-full object-cover" />
              ) : (
                <Trophy className="w-16 h-16 text-primary/60" />
              )}
            </div>
            {(banner?.title || banner?.subtitle) && (
              <div className="relative p-3">
                {banner?.title && <div className="font-display font-bold">{banner.title}</div>}
                {banner?.subtitle && <div className="text-xs text-primary mt-0.5">{banner.subtitle}</div>}
              </div>
            )}
          </Card>
        </aside>

        {/* Right column: VIP HERO Banner + Tournament Table */}
        <div className="space-y-6">
          {/* Big rotating Banner Carousel */}
          {banner && (
            <Card className="relative overflow-hidden border border-primary/20 p-0 shadow-neon">
              <div className="relative aspect-[16/6] md:aspect-[16/5] bg-gradient-to-br from-secondary/40 via-background/60 to-secondary/40">
                {banner.image_url && (
                  <img
                    key={banner.image_url}
                    src={banner.image_url}
                    alt={banner.title}
                    className="absolute inset-0 w-full h-full object-cover animate-fade-in"
                  />
                )}
                
                <div className="relative h-full flex flex-col justify-center px-6 md:px-10 max-w-[60%]">
                  
                  {banner.title && (
                    <h2 className="font-display font-black text-2xl md:text-4xl leading-tight">
                      {banner.title}
                    </h2>
                  )}
                  {banner.subtitle && <div className="text-sm md:text-base text-primary mt-2">{banner.subtitle}</div>}
                  {banner.cta_url && (
                    banner.cta_url.startsWith("/") ? (
                      <Link to={banner.cta_url}
                       className="mt-4 inline-flex items-center gap-2 self-start gradient-neon text-primary-foreground font-bold tracking-wider rounded-full px-5 h-9 shadow-neon hover:opacity-90 text-xs">
                        {tr("tournamentsPage.learnMore")} <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    ) : (
                      <a href={banner.cta_url} target="_blank" rel="noopener noreferrer"
                       className="mt-4 inline-flex items-center gap-2 self-start gradient-neon text-primary-foreground font-bold tracking-wider rounded-full px-5 h-9 shadow-neon hover:opacity-90 text-xs">
                        {tr("tournamentsPage.learnMore")} <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )
                  )}
                </div>
                {banners.length > 1 && (
                  <div className="absolute bottom-3 right-4 flex items-center gap-1.5">
                    {banners.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setBannerIdx(i)}
                        aria-label={`Banner ${i + 1}`}
                        className={cn(
                          "h-1.5 rounded-full transition-all",
                          i === bannerIdx ? "w-6 bg-primary shadow-neon" : "w-1.5 bg-muted-foreground/50 hover:bg-muted-foreground"
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {view === "daily" && (
            <div className="relative w-full lg:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                placeholder={tr("tournamentsPage.searchPlaceholder")}
                className="pl-9 pr-9 bg-muted/40 border-border"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); setPage(1); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {view === "weekly" ? (() => {
            const visible = scheduleClubs.filter(c => c.weekly_schedule_image_url || c.daily_schedule_image_url || (FEATURES.clubSeriesSchedule && (seriesByClub[c.id]?.length ?? 0) > 0));
            const moveClub = async (clubId: string, dir: "up" | "down") => {
              if (reordering) return;
              const idx = visible.findIndex(c => c.id === clubId);
              const newIdx = dir === "up" ? idx - 1 : idx + 1;
              if (newIdx < 0 || newIdx >= visible.length) return;
              setReordering(true);
              const reordered = [...visible];
              [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
              const updates = reordered.map((c, i) => ({ id: c.id, schedule_sort_order: (i + 1) * 10 }));
              setScheduleClubs(prev => {
                const mapped = prev.map(c => {
                  const u = updates.find(x => x.id === c.id);
                  return u ? { ...c, schedule_sort_order: u.schedule_sort_order } : c;
                });
                return [...mapped].sort((a, b) => (a.schedule_sort_order - b.schedule_sort_order) || a.name.localeCompare(b.name));
              });
              try {
                await Promise.all(updates.map(u =>
                  supabase.from("clubs").update({ schedule_sort_order: u.schedule_sort_order }).eq("id", u.id)
                ));
              } catch (e: any) {
                toast.error("Không thể cập nhật thứ tự: " + (e?.message ?? "lỗi"));
              } finally {
                setReordering(false);
              }
            };
            return (
              <div className="space-y-5">
                {visible.length === 0 ? (
                  <Card className="p-12 text-center text-sm text-muted-foreground border border-border/40 bg-card/40">Chưa có CLB nào tải lên lịch thi đấu.</Card>
                ) : (
                  visible.map((c, idx) => (
                    <Card key={c.id} className="p-5 border border-border/40 bg-gradient-to-br from-card/60 to-card/40 backdrop-blur-sm">
                      <div className="flex items-center justify-between mb-3 gap-2">
                        <Link to={`/club/${c.id}`} className="font-display font-bold text-lg hover:text-primary transition-colors truncate">
                          {c.name}
                        </Link>
                        <div className="flex items-center gap-2 shrink-0">
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="outline" className="h-7 w-7" disabled={reordering || idx === 0} onClick={() => moveClub(c.id, "up")} aria-label="Lên">
                                <ArrowUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="outline" className="h-7 w-7" disabled={reordering || idx === visible.length - 1} onClick={() => moveClub(c.id, "down")} aria-label="Xuống">
                                <ArrowDown className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          )}
                          <span className="text-xs text-muted-foreground">{c.region}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {c.weekly_schedule_image_url && (
                          <div>
                            <div className="text-[11px] uppercase tracking-wider text-primary font-bold mb-1">Lịch hàng tuần</div>
                            <img src={c.weekly_schedule_image_url} alt={`${c.name} weekly schedule`} className="w-full h-auto object-contain rounded-md border border-border" loading="lazy" />
                            <LegacyScheduleEvidenceNote />
                          </div>
                        )}
                        {c.daily_schedule_image_url && (
                          <div>
                            <div className="text-[11px] uppercase tracking-wider text-primary font-bold mb-1">Lịch hàng ngày</div>
                            <img src={c.daily_schedule_image_url} alt={`${c.name} daily schedule`} className="w-full h-auto object-contain rounded-md border border-border" loading="lazy" />
                            <LegacyScheduleEvidenceNote />
                          </div>
                        )}
                      </div>

                      {FEATURES.clubSeriesSchedule && (seriesByClub[c.id]?.length ?? 0) > 0 && (
                        <div className="mt-3">
                          <div className="text-[11px] uppercase tracking-wider text-primary font-bold mb-1">Lịch series</div>
                          <ImageCarousel images={seriesByClub[c.id]} />
                        </div>
                      )}
                    </Card>
                  ))
                )}
              </div>
            );
          })()
          : view === "series" ? (
            <Card className="border border-border/40 bg-gradient-to-br from-card/60 to-card/40 overflow-hidden p-0 backdrop-blur-sm">
              {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : series.length === 0 ? (
                <div className="px-5 py-16 text-center text-muted-foreground text-sm">{tr("tournamentsPage.noSeries")}</div>
              ) : (
                <div className="divide-y divide-border">
                  {series.map((s) => {
                    const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
                    const yr = new Date(s.end_date).getFullYear();
                    return (
                      <div key={s.id} className="flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-4 hover:bg-muted/20 transition-colors">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-muted overflow-hidden shrink-0">
                          {s.cover_url ? <img src={s.cover_url} alt={s.name} className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full grid place-items-center"><Trophy className="w-7 h-7 text-primary/50" /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-display font-bold text-base">{s.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {fmt(s.start_date)} – {fmt(s.end_date)}, {yr}
                            {s.location ? ` · ${s.location}` : ""}
                          </div>
                        </div>
                        <Link to={`/series/${s.id}`}>
                          <Button size="sm" variant="ghost" className="bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 font-bold tracking-wider rounded-full px-4 h-8 whitespace-nowrap">
                            {tr("tournamentsPage.viewDetails")}
                          </Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          ) : (
            <Card className="border border-border/40 bg-gradient-to-br from-card/60 to-card/40 overflow-hidden p-0 backdrop-blur-sm">
              {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-[11px] uppercase tracking-wider text-primary font-bold">
                          <th className="text-left px-5 py-3.5">{tr("tournamentsPage.tournamentName")}</th>
                          <th className="text-left px-3 py-3.5 hidden sm:table-cell">{tr("tournamentsPage.dateTime")}</th>
                          <th className="text-left px-3 py-3.5">{tr("tournamentsPage.buyIn")}</th>
                          <th className="text-left px-3 py-3.5 hidden md:table-cell">{tr("tournamentsPage.players")}</th>
                          <th className="text-right px-5 py-3.5">{tr("tournamentsPage.action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageItems.length === 0 && (
                          <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">{tr("tournamentsPage.noMatch")}</td></tr>
                        )}
                        {pageItems.map((t) => {
                          const nowMs = Date.now() + tick * 0; // tie to tick
                          const started = new Date(t.start_time).getTime() <= nowMs;
                          const isLive = started && !isLateRegClosed(t, nowMs);
                          const lvl = isLive ? getCurrentLevel(t, nowMs) : 0;
                          const endsIn = isLive ? formatCountdown(getLevelEndsIn(t, nowMs)) : "";
                          const mpl = t.minutes_per_level ?? 20;
                          const closeLv = t.late_reg_close_level ?? 6;
                          return (
                            <tr key={t.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors align-top">
                              <td className="text-left px-5 py-4">
                                <div className="flex items-start gap-3">
                                  <span className={cn("mt-2 w-2 h-2 shrink-0 shadow-sm rounded-full", isLive ? "bg-primary animate-pulse" : "bg-primary")} />
                                  <div className="min-w-0">
                                    <Link to={`/tournament/${t.id}`} className="hover:text-primary transition-colors font-serif font-extrabold">
                                      {t.name}
                                    </Link>
                                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                      {GAME_LABEL[t.game_type ?? "nlh"]}{t.current_blinds ? ` · ${t.current_blinds} Blinds` : ""}
                                    </div>
                                    {/* Mobile-only: show date, blind info, live state and players (hidden on sm+) */}
                                    <div className="sm:hidden mt-1 space-y-0.5">
                                      <div className="text-[10px] text-muted-foreground">
                                        {formatShortDate(t.start_time)}, {formatTime(t.start_time)}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground">
                                        {tr("tournamentsPage.blindInfo", { minutes: mpl, level: closeLv })}
                                      </div>
                                      {isLive && (
                                        <div className="text-[10px] text-primary font-bold">
                                          {tr("tournamentsPage.live")} · Lv {lvl} · {endsIn}
                                        </div>
                                      )}
                                      <div className="text-[10px]">
                                        <span className="text-primary font-bold">{t.current_players}</span>
                                        <span className="text-muted-foreground"> {tr("tournamentsPage.entries")}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="text-left px-3 py-4 hidden sm:table-cell whitespace-nowrap">
                                <div>{formatShortDate(t.start_time)}, {formatTime(t.start_time)}</div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  {tr("tournamentsPage.blindInfo", { minutes: mpl, level: closeLv })}
                                </div>
                                {isLive && (
                                  <div className="text-[10px] text-primary mt-0.5 font-bold">
                                    {tr("tournamentsPage.live")} · Lv {lvl} · {endsIn}
                                  </div>
                                )}
                              </td>
                              <td className="text-left px-3 py-4 font-display font-bold whitespace-nowrap"><FomoPrice tournament={t} compact formatter={formatBuyInShort} /></td>
                              <td className="text-left px-3 py-4 hidden md:table-cell">
                                <span className="text-primary font-bold">{t.current_players}</span>
                                <span className="text-muted-foreground text-xs"> {tr("tournamentsPage.entries")}</span>
                              </td>
                              <td className="px-5 py-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {isLive && (
                                    <Link to={`/live/${t.id}`}>
                                      <Button
                                        size="sm"
                                        className="bg-success/15 text-success border border-success/40 hover:bg-success/25 font-bold tracking-wider rounded-full px-3 h-8"
                                        variant="ghost"
                                      >
                                        <Eye className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Live</span>
                                      </Button>
                                    </Link>
                                  )}
                                  <Button
                                    size="sm"
                                    onClick={() => user ? setRegisterFor({ id: t.id, name: t.name }) : nav("/auth")}
                                    className="bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 font-bold tracking-wider rounded-full px-4 h-8"
                                    variant="ghost"
                                  >
                                    {tr("tournamentsPage.register")}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs">
                    <div className="text-muted-foreground">
                      {tr("tournamentsPage.showing")} {(safePage - 1) * PAGE_SIZE + (pageItems.length ? 1 : 0)}–{(safePage - 1) * PAGE_SIZE + pageItems.length} {tr("tournamentsPage.of")} {filtered.length}
                    </div>
                    <div className="flex items-center gap-1">
                      <PageBtn disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </PageBtn>
                      {Array.from({ length: totalPages }).slice(0, 5).map((_, i) => {
                        const n = i + 1;
                        return (
                          <PageBtn key={n} active={n === safePage} onClick={() => setPage(n)}>{n}</PageBtn>
                        );
                      })}
                      <PageBtn disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </PageBtn>
                    </div>
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      </div>
      )}

      {registerFor && (
        <TournamentRegisterModal
          tournamentId={registerFor.id}
          tournamentName={registerFor.name}
          open={!!registerFor}
          onClose={() => setRegisterFor(null)}
        />
      )}
    </div>
  );
};

const PageBtn = ({ children, active, disabled, onClick }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "min-w-[28px] h-7 px-2 rounded-md text-xs font-semibold transition-colors flex items-center justify-center",
      active
        ? "bg-primary text-primary-foreground shadow-neon"
        : disabled
          ? "text-muted-foreground/40 cursor-not-allowed"
          : "border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
    )}
  >
    {children}
  </button>
);

const LiveTrackerSection = () => {
  const [liveTournaments, setLiveTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("tournaments")
        .select("id, name, status, current_players, current_level, current_blinds, players_remaining, average_stack, buy_in, starting_stack, game_type, club:clubs(id, name, region)")
        .in("status", ["live", "break", "final_table", "registering"])
        .order("start_time", { ascending: false });
      setLiveTournaments((data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("live-tracker-list")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tournaments" }, () => {
        supabase
          .from("tournaments")
          .select("id, name, status, current_players, current_level, current_blinds, players_remaining, average_stack, buy_in, starting_stack, game_type, club:clubs(id, name, region)")
          .in("status", ["live", "break", "final_table", "registering"])
          .order("start_time", { ascending: false })
          .then(({ data }) => { if (data) setLiveTournaments(data as any); });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const STATUS_LABEL: Record<string, string> = {
    registering: "Đang đăng ký",
    drawing: "Bốc bàn",
    live: "Đang chơi",
    break: "Nghỉ giải lao",
    final_table: "Bàn cuối",
  };
  const STATUS_CLS: Record<string, string> = {
    registering: "bg-warning/15 text-warning border-warning/30",
    drawing: "bg-[hsl(var(--ds-active)_/_0.15)] text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active)_/_0.3)]",
    live: "bg-success/15 text-success border-success/30 animate-pulse",
    break: "bg-warning/15 text-warning border-warning/30",
    final_table: "bg-[hsl(var(--ds-preassign)_/_0.15)] text-[hsl(var(--ds-preassign))] border-[hsl(var(--ds-preassign)_/_0.3)]",
  };

  if (loading) {
    return (
      <Card className="p-12 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-success mx-auto" />
      </Card>
    );
  }

  if (liveTournaments.length === 0) {
    return (
      <Card className="p-12 text-center space-y-3">
        <Radio className="w-10 h-10 text-muted-foreground/30 mx-auto" />
        <p className="text-muted-foreground">Chưa có giải đấu nào đang diễn ra</p>
        <p className="text-xs text-muted-foreground/60">Khi giải đấu bắt đầu, thông tin sẽ xuất hiện tại đây</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {liveTournaments.map((t) => (
        <Card key={t.id} className="border border-success/20 bg-gradient-to-r from-card to-success/10 p-4 hover:border-success/40 transition-all">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${STATUS_CLS[t.status] || "bg-muted/30 text-muted-foreground border-border"}`}>
                  {STATUS_LABEL[t.status] || t.status}
                </span>
                {t.game_type && (
                  <span className="text-[10px] text-muted-foreground uppercase">
                    {GAME_LABEL[t.game_type] || t.game_type}
                  </span>
                )}
              </div>
              <h3 className="font-display font-bold text-base truncate">{t.name}</h3>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t.club?.name}
                {t.club?.region ? ` · ${t.club.region}` : ""}
              </div>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="hidden sm:flex items-center gap-4 text-xs">
                {t.players_remaining != null && (
                  <div className="text-center">
                    <div className="text-success font-bold text-base">{t.players_remaining}</div>
                    <div className="text-muted-foreground text-[10px]">Players</div>
                  </div>
                )}
                {t.current_level != null && (
                  <div className="text-center">
                    <div className="text-warning font-bold text-base">Lv {t.current_level}</div>
                    <div className="text-muted-foreground text-[10px]">Level</div>
                  </div>
                )}
                {t.current_blinds && (
                  <div className="text-center">
                    <div className="text-foreground font-bold text-base">{t.current_blinds}</div>
                    <div className="text-muted-foreground text-[10px]">Blinds</div>
                  </div>
                )}
                {t.average_stack != null && (
                  <div className="text-center">
                    <div className="text-foreground font-bold text-base">{formatStack(t.average_stack)}</div>
                    <div className="text-muted-foreground text-[10px]">AVG Stack</div>
                  </div>
                )}
              </div>

              <Button
                size="sm"
                onClick={() => nav(`/live/${t.id}`)}
                className="bg-success/15 text-success border border-success/40 hover:bg-success/25 font-bold tracking-wider rounded-full px-4 h-9"
                variant="ghost"
              >
                <Eye className="w-4 h-4 mr-1.5" /> Theo dõi
              </Button>
            </div>
          </div>

          <div className="sm:hidden mt-3 grid grid-cols-4 gap-2 text-xs text-center">
            {t.players_remaining != null && (
              <div className="rounded-md bg-muted/30 px-2 py-1.5">
                <div className="text-success font-bold">{t.players_remaining}</div>
                <div className="text-muted-foreground text-[9px]">Players</div>
              </div>
            )}
            {t.current_level != null && (
              <div className="rounded-md bg-muted/30 px-2 py-1.5">
                <div className="text-warning font-bold">Lv {t.current_level}</div>
                <div className="text-muted-foreground text-[9px]">Level</div>
              </div>
            )}
            {t.current_blinds && (
              <div className="rounded-md bg-muted/30 px-2 py-1.5">
                <div className="text-foreground font-bold">{t.current_blinds}</div>
                <div className="text-muted-foreground text-[9px]">Blinds</div>
              </div>
            )}
            {t.average_stack != null && (
              <div className="rounded-md bg-muted/30 px-2 py-1.5">
                <div className="text-foreground font-bold">{formatStack(t.average_stack)}</div>
                <div className="text-muted-foreground text-[9px]">AVG</div>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
};

const PackagesSection = () => {
  const { data: packages, isLoading } = useTournamentPackages();
  const navigate = useNavigate();
  const { t: tr } = useTranslation();

  const featured = isLoading ? [] : (packages || []).slice(0, 3);

  return (
    <Card className="border border-border bg-card overflow-hidden p-0">
      {isLoading ? (
        <div className="space-y-4 p-5">
          <PackageCardSkeleton />
          <PackageCardSkeleton />
          <PackageCardSkeleton />
        </div>
      ) : featured.length === 0 ? (
        <div className="px-5 py-16 text-center text-muted-foreground text-sm">
          Chưa có gói giải đấu nào
        </div>
      ) : (
        <div className="divide-y divide-border">
          {featured.map((pkg, i) => (
            <PackageCard key={pkg.id} pkg={pkg} index={i} />
          ))}
        </div>
      )}
      {!isLoading && packages && packages.length > 0 && (
        <div className="border-t border-border px-5 py-3">
          <Link
            to="/packages"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-success transition-colors hover:text-success"
          >
            Xem tất cả gói giải đấu
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </Link>
        </div>
      )}
    </Card>
  );
};

export default Tournaments;
