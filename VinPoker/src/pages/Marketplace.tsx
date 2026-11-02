import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { z } from "zod";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { Button } from "@/components/ui/button";
import { LiquidButton, LiquidGlassCard } from "@/components/kokonutui/liquid-glass-card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { Search, TrendingUp, Sparkles, X, Users, ExternalLink, Clock, ChevronRight } from "lucide-react";
import { TransferInstructions } from "@/components/TransferInstructions";

interface DealRow {
  id: string;
  player_id: string;
  tournament_id: string | null;
  custom_event_name: string | null;
  custom_event_date: string | null;
  buy_in_amount_vnd: number;
  percentage_sold: number;
  filled_percent: number;
  min_purchase_percent: number;
  early_closed: boolean;
  markup: number;
  asking_price_vnd: number;
  status: string;
  description: string | null;
  escrow_bank_reference: string;
  created_at: string;
  registration_deadline: string | null;
  player_checked_in: boolean;
  player?: { display_name: string | null; avatar_url: string | null; verification_status: string | null };
  tournament?: { name: string; start_time: string; club_id: string; buy_in: number } | null;
}

interface PlayerStats {
  player_id: string;
  itm_rate: number;
  roi_percentage: number;
  tournaments_played: number;
  total_profit_loss: number;
  verified: boolean;
}

interface DealBreakdown {
  funded_pct: number;
  pending_pct: number;
  funded_count: number;
  pending_count: number;
}

interface TournamentOpt { id: string; name: string }

const TWO_HOURS = 2 * 60 * 60 * 1000;
const THIRTY_MIN = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const Marketplace = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const playerFilter = searchParams.get("player");
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [allDeals, setAllDeals] = useState<DealRow[]>([]);
  const [tournaments, setTournaments] = useState<TournamentOpt[]>([]);
  const [statsByPlayer, setStatsByPlayer] = useState<Record<string, PlayerStats>>({});
  const [breakdownByDeal, setBreakdownByDeal] = useState<Record<string, DealBreakdown>>({});
  const [search, setSearch] = useState("");
  const [tournamentFilter, setTournamentFilter] = useState<string>("all");
  const [markupRange, setMarkupRange] = useState<[number, number]>([1.0, 2.0]);
  const [verifFilter, setVerifFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("closing");
  const [selected, setSelected] = useState<DealRow | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const playerFilterName = useMemo(() => {
    if (!playerFilter) return null;
    const d = deals.find((x) => x.player_id === playerFilter);
    return d?.player?.display_name ?? null;
  }, [playerFilter, deals]);

  const clearPlayerFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("player");
    setSearchParams(next, { replace: true });
  };

  const load = async () => {
    setLoading(true);
    try { await supabase.rpc("auto_close_expired_deals" as any); } catch { /* noop */ }

    const { data, error } = await supabase
      .from("staking_deals")
      .select("*")
      .eq("admin_review_status", "approved")
      .in("status", ["listing", "committing", "funded"])
      .eq("early_closed", false)
      .eq("player_checked_in", false)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as DealRow[];
    const playerIds = Array.from(new Set(rows.map((d) => d.player_id)));
    const tournamentIds = Array.from(new Set(rows.map((d) => d.tournament_id).filter(Boolean) as string[]));

    const [profilesRes, tourRes, statsRes] = await Promise.all([
      playerIds.length
        ? supabase.from("profiles").select("user_id, display_name, avatar_url, verification_status").in("user_id", playerIds)
        : Promise.resolve({ data: [], error: null } as any),
      tournamentIds.length
        ? supabase.from("tournaments").select("id, name, start_time, club_id, buy_in").in("id", tournamentIds)
        : Promise.resolve({ data: [], error: null } as any),
      playerIds.length
        ? supabase.from("player_stats").select("player_id, itm_rate, roi_percentage, tournaments_played, total_profit_loss, verified").in("player_id", playerIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    const profMap = new Map<string, any>((profilesRes.data ?? []).map((p: any) => [p.user_id, p]));
    const tourMap = new Map<string, any>((tourRes.data ?? []).map((t: any) => [t.id, t]));
    const sMap: Record<string, PlayerStats> = {};
    (statsRes.data ?? []).forEach((s: any) => { sMap[s.player_id] = s; });

    const enriched = rows.map((d) => ({
      ...d,
      player: profMap.get(d.player_id) ?? null,
      tournament: d.tournament_id ? tourMap.get(d.tournament_id) ?? null : null,
    }));

    setAllDeals(enriched);

    const bMap: Record<string, DealBreakdown> = {};
    const dealIds = rows.map((d) => d.id);
    if (dealIds.length) {
      const { data: pData } = await supabase.rpc("get_deal_purchase_breakdown", { _deal_ids: dealIds });
      (pData ?? []).forEach((row: any) => {
        bMap[row.deal_id] = {
          funded_pct: Number(row.funded_pct ?? 0),
          pending_pct: Number(row.pending_pct ?? 0),
          funded_count: Number(row.funded_count ?? 0),
          pending_count: Number(row.pending_count ?? 0),
        };
      });
    }

    setBreakdownByDeal(bMap);
    setStatsByPlayer(sMap);

    const { data: allT } = await supabase
      .from("tournaments")
      .select("id, name")
      .gt("start_time", new Date().toISOString())
      .order("start_time", { ascending: true })
      .limit(50);
    setTournaments((allT ?? []) as TournamentOpt[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const ch = supabase
      .channel("marketplace-deals")
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_deals" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_purchases" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const { availableDeals, soldDeals } = useMemo(() => {
    const avail: DealRow[] = [];
    const sold: DealRow[] = [];
    const cutoff = now - DAY_MS;
    for (const d of allDeals) {
      const remaining = (d.percentage_sold ?? 0) - (d.filled_percent ?? 0);
      const eventTime = d.tournament?.start_time ?? d.custom_event_date ?? null;
      if (eventTime && new Date(eventTime).getTime() < cutoff) continue;
      if (remaining <= 0) { sold.push(d); continue; }
      avail.push(d);
    }
    return { availableDeals: avail, soldDeals: sold };
  }, [allDeals, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return availableDeals.filter((d) => {
      if (playerFilter && d.player_id !== playerFilter) return false;
      if (tournamentFilter !== "all" && d.tournament_id !== tournamentFilter) return false;
      const mk = Number(d.markup);
      if (mk < markupRange[0] - 0.001 || mk > markupRange[1] + 0.001) return false;
      const verified = d.player?.verification_status === "verified";
      if (verifFilter === "verified" && !verified) return false;
      if (verifFilter === "unverified" && verified) return false;
      if (q) {
        const name = (d.player?.display_name ?? "").toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortBy === "roi") {
        const aRoi = statsByPlayer[a.player_id]?.roi_percentage ?? 0;
        const bRoi = statsByPlayer[b.player_id]?.roi_percentage ?? 0;
        return bRoi - aRoi;
      }
      const aDeadline = resolveDeadline(a);
      const bDeadline = resolveDeadline(b);
      return (aDeadline?.getTime() ?? Infinity) - (bDeadline?.getTime() ?? Infinity);
    });
  }, [availableDeals, search, tournamentFilter, markupRange, verifFilter, sortBy, playerFilter, statsByPlayer]);

  return (
    <div className="space-y-8 font-display">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-card/70 px-6 py-12 backdrop-blur-2xl [box-shadow:inset_0_1px_0_hsl(var(--primary)/0.24)] md:px-10 md:py-16">
        {/* Decorative glow effects */}
        <div className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-primary/10 blur-[120px]" />

        {/* Content */}
        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-8">
          <div className="space-y-4">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 backdrop-blur-sm w-fit">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] font-bold tracking-[0.28em] uppercase text-primary">{t('marketplace.badge')}</span>
            </div>

            {/* Title */}
            <h1 className="font-display text-5xl md:text-7xl tracking-[0.04em] text-primary leading-[0.9] drop-shadow-[0_0_24px_hsl(var(--primary)/0.35)]">
              {t("marketplace.title")}
            </h1>

            {/* Subtitle */}
            <p className="max-w-2xl text-sm leading-relaxed text-foreground/75 md:text-base">
              {t("marketplace.subtitle")}{" "}
              <button onClick={() => nav("/find-backer")} className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors">
                {t("marketplace.findPlayerLink")}
              </button>.
            </p>

            {/* Chronograph divider */}
            <div className="flex items-center gap-2 pt-2 max-w-md">
              <div className="flex-1 h-[1px] bg-primary/60" />
              <div className="w-2 h-2 bg-primary rotate-45 shrink-0 shadow-[0_0_8px_hsl(var(--primary))]" />
              <div className="flex-1 h-[1px] bg-primary/30" />
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-wrap gap-3 shrink-0">
            <LiquidButton
              variant="outline"
              onClick={() => nav(user ? "/staking/my-deals" : "/auth")}
              className="h-11 rounded-xl border-primary/25 bg-card/35 px-6 font-display transition-[background-color,border-color,transform] duration-200 hover:border-primary/55 hover:bg-primary/10 hover:text-primary active:translate-y-px"
            >
              {t("marketplace.myDealsBtn")}
            </LiquidButton>
            <Button
              onClick={() => nav(user ? "/staking/new" : "/auth")}
              className="h-11 rounded-xl border-0 gradient-neon px-6 font-bold text-primary-foreground shadow-none transition-[filter,transform] duration-200 hover:brightness-105 active:translate-y-px"
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              {t("marketplace.createDealBtn")}
            </Button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="grid items-end gap-3 rounded-2xl border border-white/10 bg-card/65 p-4 backdrop-blur-2xl [box-shadow:inset_0_1px_0_hsl(var(--foreground)/0.08)] md:grid-cols-[1fr_220px_200px]">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold font-display">
            {t("marketplace.filterSearchLabel")}
          </label>
          <div className="relative mt-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("marketplace.filterSearchPh")}
              className="h-10 rounded-xl border-white/10 bg-background/35 pl-9 font-display text-sm placeholder:text-muted-foreground/80 focus-visible:border-primary/60"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold font-display">
            {t("marketplace.filterTournament")}
          </label>
          <Select value={tournamentFilter} onValueChange={setTournamentFilter}>
            <SelectTrigger className="mt-1 h-10 rounded-xl border-white/10 bg-background/35 font-display focus:ring-primary/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-white/10 bg-popover/95 backdrop-blur-2xl">
              <SelectItem value="all" className="font-display">{t("marketplace.filterAllTournaments")}</SelectItem>
              {tournaments.map((t) => (
                <SelectItem key={t.id} value={t.id} className="font-display">{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold font-display">
            {t("marketplace.filterMarkup", { from: markupRange[0].toFixed(2), to: markupRange[1].toFixed(2) })}
          </label>
          <Slider
            value={markupRange}
            min={1.0}
            max={2.0}
            step={0.05}
            onValueChange={(v) => setMarkupRange([v[0], v[1]] as [number, number])}
            className="mt-3"
          />
        </div>
      </div>

      {/* Player filter banner */}
      {playerFilter && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-card/65 p-3 backdrop-blur-xl [box-shadow:inset_0_1px_0_hsl(var(--foreground)/0.06)]">
          <div className="flex items-center gap-2 text-sm font-display">
            <Users className="w-4 h-4 text-primary" />
            <span>
              {t("marketplace.viewingDealsOf")}{" "}
              <span className="font-semibold text-primary">
                {playerFilterName ?? t("marketplace.thisPlayer")}
              </span>
              {filtered.length > 0 && (
                <span className="text-muted-foreground"> · {t("marketplace.dealCount", { n: filtered.length })}</span>
              )}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={clearPlayerFilter} className="font-display">
            <X className="w-3.5 h-3.5 mr-1" /> {t("marketplace.removeFilter")}
          </Button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-card/65 p-5 backdrop-blur-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                </div>
              </div>
              <div className="mb-3 h-3 w-1/4 rounded bg-muted animate-pulse" />
              <div className="mb-3 h-2 rounded-full bg-muted animate-pulse" />
              <div className="mb-4 h-3 w-1/3 rounded bg-muted animate-pulse" />
              <div className="h-10 rounded-xl bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 && soldDeals.length === 0 ? (
        <div className="space-y-4 rounded-2xl border border-dashed border-border/80 bg-card/45 py-24 text-center backdrop-blur-xl">
          <TrendingUp className="w-10 h-10 mx-auto text-muted-foreground" />
          <h3 className="font-semibold font-display">
            {playerFilter ? t("marketplace.emptyPlayerNoDeals") : t("marketplace.emptyNoMatch")}
          </h3>
          <p className="text-sm text-muted-foreground font-display">
            {playerFilter ? t("marketplace.emptyPlayerNoDealsHint") : t("marketplace.emptyNoMatchHint")}
          </p>
          {!playerFilter && (
            <Button onClick={() => nav("/find-backer")} variant="outline" size="sm" className="mt-2 rounded-xl border-primary/25 bg-card/35 font-display hover:border-primary/55 hover:bg-primary/10">
              <Users className="w-4 h-4 mr-1.5" /> {t("marketplace.discoverPlayers")}
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Active deals grid */}
          {filtered.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((d) => (
                <DealCard
                  key={d.id}
                  deal={d}
                  stats={statsByPlayer[d.player_id]}
                  breakdown={breakdownByDeal[d.id]}
                  onClick={() => setSelected(d)}
                  onViewProfile={() => nav(`/player/${d.player_id}`)}
                  now={now}
                />
              ))}
            </div>
          )}

          {/* Sold-out section */}
          {soldDeals.length > 0 && (
            <div className="space-y-4 pt-6 border-t border-border">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-[1px] bg-muted-foreground/30" />
                <h2 className="font-display text-xl tracking-[0.04em] text-muted-foreground">
                  {t("marketplace.soldOutSection")}
                </h2>
                <div className="flex-1 h-[1px] bg-muted-foreground/30" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {soldDeals.slice(0, 6).map((d) => (
                  <DealCard
                    key={d.id}
                    deal={d}
                    stats={statsByPlayer[d.player_id]}
                    breakdown={breakdownByDeal[d.id]}
                    onClick={() => {}}
                    onViewProfile={() => nav(`/player/${d.player_id}`)}
                    sold
                    now={now}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <DealDetailDialog
        deal={selected}
        stats={selected ? statsByPlayer[selected.player_id] : undefined}
        breakdown={selected ? breakdownByDeal[selected.id] : undefined}
        onClose={() => setSelected(null)}
        onPurchased={() => { setSelected(null); load(); }}
        currentUser={user?.id ?? null}
        onAuthRequired={() => { setSelected(null); nav("/auth"); }}
      />
    </div>
  );
};

function resolveDeadline(deal: DealRow): Date | null {
  if (deal.registration_deadline) return new Date(deal.registration_deadline);
  if (deal.tournament?.start_time) return new Date(new Date(deal.tournament.start_time).getTime() - ONE_HOUR);
  return new Date(new Date(deal.created_at).getTime() + DAY_MS);
}

const DealCard = ({
  deal, stats, breakdown, onClick, onViewProfile, sold, now,
}: {
  deal: DealRow; stats?: PlayerStats; breakdown?: DealBreakdown; onClick: () => void;
  onViewProfile: () => void; sold?: boolean; now: number;
}) => {
  const { t } = useTranslation();
  const initials = (deal.player?.display_name ?? "P").slice(0, 2).toUpperCase();
  const tournamentName = deal.tournament?.name ?? deal.custom_event_name ?? t("marketplace.customEvent");
  const soldPct = deal.percentage_sold;
  const filledPct = Math.min(deal.filled_percent ?? 0, soldPct);
  const remaining = soldPct - filledPct;
  const pricePer1Pct = (Number(deal.buy_in_amount_vnd) / 100) * Number(deal.markup);
  const verified = deal.player?.verification_status === "verified";

  const fundedPct = Math.min(breakdown?.funded_pct ?? 0, soldPct);
  const pendingPct = Math.min(breakdown?.pending_pct ?? 0, soldPct - fundedPct);
  const fundedW = Math.round((fundedPct / Math.max(1, soldPct)) * 100);
  const pendingW = Math.round((pendingPct / Math.max(1, soldPct)) * 100);

  const deadline = resolveDeadline(deal);
  const remainingMs = deadline ? deadline.getTime() - now : null;
  const showCountdown = remainingMs !== null && remainingMs > 0 && remainingMs <= TWO_HOURS;
  const isCritical = remainingMs !== null && remainingMs < THIRTY_MIN;
  const isUrgent = remainingMs !== null && remainingMs < TWO_HOURS && remainingMs >= THIRTY_MIN;

  const totalSec = remainingMs !== null ? Math.floor(remainingMs / 1000) : 0;
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  return (
    <LiquidGlassCard
      onClick={sold ? undefined : onClick}
      glassSize="sm"
      contentClassName="flex flex-col gap-3"
      className={`${sold ? "opacity-50" : "cursor-pointer hover:-translate-y-0.5 hover:border-primary/45 hover:bg-card/65"} rounded-2xl border-white/10 bg-card/55 ![box-shadow:inset_0_1px_0_hsl(var(--foreground)/0.08)] transition-[background-color,border-color,transform] duration-200 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
    >
      {/* Player row */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full overflow-hidden border border-white/10 bg-background/35 shrink-0">
          {deal.player?.avatar_url ? (
            <img src={deal.player.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs font-bold text-muted-foreground">
              {initials}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onViewProfile(); }}
              className="font-display text-lg leading-none truncate text-left hover:text-primary transition-colors"
            >
              {deal.player?.display_name ?? t("marketplace.playerLabel")}
            </button>
            {verified && (
              <span className="w-2 h-2 rounded-full bg-success shrink-0" title={t("marketplace.verified")} />
            )}
            {!verified && (
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" title={t("marketplace.unverified")} />
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate font-display mt-0.5">{tournamentName}</div>
        </div>
      </div>

      {/* Markup tag */}
      <div className="inline-flex self-start items-center gap-1 rounded-full border border-success/25 bg-success/10 px-3 py-1">
        <span className="font-jetbrains text-sm font-semibold tabular-nums text-success">{Number(deal.markup).toFixed(2)}x</span>
        <span className="text-[10px] text-success/70 font-display">{t("marketplace.markupLabel")}</span>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-display text-muted-foreground">
          <span>{t("marketplace.sold")}: <span className="font-jetbrains font-semibold tabular-nums text-foreground">{filledPct}%</span></span>
          <span className="text-success">{t("marketplace.remainingLabel")} <span className="font-jetbrains font-semibold tabular-nums">{remaining}%</span></span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-success transition-all" style={{ width: `${fundedW}%` }} />
          <div className="h-full bg-warning/60 transition-all" style={{ width: `${pendingW}%` }} />
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-2 border-t border-border/70 pt-2">
        <div className="text-center">
          <div className="font-jetbrains text-xs font-semibold tabular-nums text-foreground">{filledPct}%</div>
          <div className="text-[10px] text-muted-foreground font-display">{t("marketplace.sold")}</div>
        </div>
        <div className="text-center">
          <div className="font-jetbrains text-xs font-semibold tabular-nums text-foreground">{remaining}%</div>
          <div className="text-[10px] text-muted-foreground font-display">{t("marketplace.remainingLabel")}</div>
        </div>
        <div className="text-center">
          <div className="font-jetbrains text-xs font-semibold tabular-nums text-success">{formatVND(Math.round(pricePer1Pct))}</div>
          <div className="text-[10px] text-muted-foreground font-display">{t("marketplace.pricePer1")}</div>
        </div>
      </div>

      {/* Countdown */}
      {showCountdown && (
        <div className={`rounded-xl border py-1.5 text-center font-display text-xs ${isCritical ? "bg-destructive/10 border-destructive/20 text-destructive" : isUrgent ? "bg-warning/10 border-warning/20 text-warning" : "border-border/70 bg-muted/25 text-muted-foreground"}`}>
          <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
          {t("marketplace.regClosesIn")} <span className="font-jetbrains font-semibold tabular-nums">{String(hrs).padStart(2, "0")}:{String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}</span>
        </div>
      )}

      {/* CTA */}
      {sold ? (
        <div className="w-full rounded-xl border border-border/70 py-2.5 text-center font-display text-xs tracking-wider text-muted-foreground">
          {t("marketplace.soldOut")}
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="w-full rounded-xl bg-success py-2.5 font-display text-sm font-bold tracking-wider text-success-foreground transition-[background-color,transform] duration-200 hover:bg-success/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px"
        >
          {t("marketplace.buyActionShort")} <ChevronRight className="w-4 h-4 inline -mt-0.5" />
        </button>
      )}
    </LiquidGlassCard>
  );
};

const reservationReceiptSchema = z.object({
  committed_at: z.string().datetime({offset:true}),
  request_id: z.string().uuid(), deal_id: z.string().uuid(),
  success: z.literal(true), purchase_id: z.string().uuid(), reference_code: z.string().min(1),
  amount_vnd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  deal_status: z.enum(["committing", "committed"]), filled_percent: z.number().int().min(1).max(100),
  bank_name: z.string().min(1), account_number: z.string().min(1), account_holder: z.string().min(1),
  qr_code_url: z.string().nullable().default(null),
});
const purchaseIntentSchema = z.object({
  actor_id: z.string().uuid(), deal_id: z.string().uuid(), request_id: z.string().uuid(),
  percent: z.number().int().min(1).max(100),
}).strict();

export function DealDetailDialog(props: ComponentProps<typeof ScopedDealDetailDialog>) {
  const { session } = useAuth();
  return <ScopedDealDetailDialog key={`${props.currentUser ?? 'signed-out'}:${sessionReadEpoch(session)}:${props.deal?.id ?? 'none'}`} {...props} />;
}

const ScopedDealDetailDialog = ({
  deal, stats, breakdown, onClose, onPurchased, currentUser, onAuthRequired,
}: {
  deal: DealRow | null;
  stats?: PlayerStats;
  breakdown?: DealBreakdown;
  onClose: () => void;
  onPurchased: () => void;
  currentUser: string | null;
  onAuthRequired: () => void;
}) => {
  const { t } = useTranslation();
  const sold = deal?.percentage_sold ?? 0;
  const filled = deal?.filled_percent ?? 0;
  const remaining = Math.max(0, sold - filled);
  const minP = deal?.min_purchase_percent ?? 5;
  const effectiveMin = Math.min(minP, remaining);
  const initialPercent = Math.min(remaining, Math.max(effectiveMin, Math.min(10, remaining)));

  const [percent, setPercent] = useState<number>(initialPercent || effectiveMin);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const purchaseErrorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (purchaseError) purchaseErrorRef.current?.focus(); }, [purchaseError]);
  const [pendingPurchase, setPendingPurchase] = useState<z.infer<typeof purchaseIntentSchema> | null>(null);
  useEffect(() => {
    if (!currentUser || !deal?.id) return;
    try {
      const raw = localStorage.getItem(`vinpoker:staking-purchase:v1:${currentUser}:${deal.id}`);
      if (raw === null) return;
      const intent = purchaseIntentSchema.parse(JSON.parse(raw));
      if (intent.actor_id !== currentUser || intent.deal_id !== deal.id) throw new Error('scope');
      setPendingPurchase(intent);
    } catch {
      setPurchaseError("Chưa đọc được intent cam kết đang chờ; dữ liệu được giữ nguyên để đối chiếu.");
    }
  }, [currentUser, deal?.id]);
  const purchaseInFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [committed, setCommitted] = useState<{
    purchaseId: string; amount: number; reference: string; committedAt: string;
    escrowAccount: ComponentProps<typeof TransferInstructions>['escrowAccount'];
  } | null>(null);

  useEffect(() => {
    if (!deal) {
      setConfirming(false);
      setCommitted(null);
      return;
    }
    setPercent(pendingPurchase?.percent ?? (Math.min(remaining, Math.max(effectiveMin, Math.min(10, remaining))) || effectiveMin));
  }, [deal?.id, pendingPurchase?.request_id, pendingPurchase?.percent]);

  if (!deal) return null;

  const isOwn = currentUser && currentUser === deal.player_id;
  const tournamentName = deal.tournament?.name ?? deal.custom_event_name ?? t("marketplace.customEvent");
  const pricePer1Pct = (Number(deal.buy_in_amount_vnd) / 100) * Number(deal.markup);
  const totalToPay = Math.round(pricePer1Pct * percent);
  const canBuy = (remaining > 0 || pendingPurchase !== null) && !isOwn;
  const isLastSlice = remaining < minP && remaining > 0;

  const fundedPct = Math.min(breakdown?.funded_pct ?? 0, sold);
  const pendingPct = Math.min(breakdown?.pending_pct ?? 0, Math.max(0, sold - fundedPct));
  const fundedW = Math.round((fundedPct / Math.max(1, sold)) * 100);
  const pendingW = Math.round((pendingPct / Math.max(1, sold)) * 100);

  const handleBuy = async () => {
    if (purchaseInFlight.current) return;
    if (!currentUser) { onAuthRequired(); return; }
    const recovering = pendingPurchase?.percent === percent;
    if (!recovering && (percent < effectiveMin || percent > remaining)) {
      toast.error(t("marketplace.pickRange", { min: effectiveMin, max: remaining })); return;
    }
    purchaseInFlight.current = true;
    setSubmitting(true);
    setPurchaseError(null);
    try {
      if (!navigator.locks) throw new Error("Trình duyệt chưa hỗ trợ khóa an toàn giữa các tab; chưa gửi cam kết.");
      await navigator.locks.request(`vinpoker:staking-purchase-lock:v1:${currentUser}:${deal.id}`, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("Cam kết đang được xử lý ở tab khác; hãy chờ và tải lại trước khi thử tiếp.");
      if (!alive.current) return;
      const journalKey = `vinpoker:staking-purchase:v1:${currentUser}:${deal.id}`;
      const stored = localStorage.getItem(journalKey);
      if (stored === null && pendingPurchase) throw new Error("Intent đang chờ đã thay đổi ở tab khác; hãy tải lại để đối chiếu.");
      const intent = stored === null
        ? purchaseIntentSchema.parse({ actor_id: currentUser, deal_id: deal.id, request_id: crypto.randomUUID(), percent })
        : purchaseIntentSchema.parse(JSON.parse(stored));
      if (intent.actor_id !== currentUser || intent.deal_id !== deal.id || intent.percent !== percent) {
        throw new Error("Còn cam kết chưa xác minh với payload khác; hãy khôi phục lựa chọn cũ trước khi thử lại.");
      }
      const serializedIntent = JSON.stringify(intent);
      localStorage.setItem(journalKey, serializedIntent);
      if (localStorage.getItem(journalKey) !== serializedIntent) throw new Error("Không lưu được intent cam kết; chưa gửi thao tác.");
      setPendingPurchase(intent);
      const { data, error } = await supabase.functions.invoke("staking-commit-deal", {
        body: { deal_id: intent.deal_id, percent: intent.percent, request_id: intent.request_id },
      });
      if (!alive.current) return;
      if (error) {
        const ctx: any = (error as any).context;
        let body: any = null;
        try { body = ctx ? await ctx.json() : null; } catch { /* noop */ }
        if (!alive.current) return;
        if (body?.code === "MISSING_BANK_ACCOUNT") {
          setPurchaseError(body.error);
          toast.error(body.error, {
            action: { label: t("marketplace.openProfile"), onClick: () => { window.location.href = "/account"; } },
          });
          return;
        }
        throw new Error(body?.error || error.message);
      }
      const d = data as any;
      if (d?.error) {
        if (d?.code === "MISSING_BANK_ACCOUNT") {
          setPurchaseError(d.error);
          toast.error(d.error, {
            action: { label: t("marketplace.openProfile"), onClick: () => { window.location.href = "/account"; } },
          });
          return;
        }
        throw new Error(d.error);
      }
      const verified = reservationReceiptSchema.safeParse(data);
      if (!verified.success || verified.data.request_id !== intent.request_id || verified.data.deal_id !== intent.deal_id) {
        throw new Error("Chưa xác minh được kết quả đúng intent cam kết; hãy tải lại trước khi thử tiếp.");
      }
      if (localStorage.getItem(journalKey) !== serializedIntent) throw new Error("Intent cam kết đã thay đổi; cần đối chiếu lại kết quả.");
      localStorage.removeItem(journalKey);
      if (localStorage.getItem(journalKey) !== null) throw new Error("Chưa hoàn tất lưu kết quả cam kết; hãy tải lại trước khi thử tiếp.");
      setPendingPurchase(null);
      toast.success(t("marketplace.reservedToast", { pct: percent }));
      setCommitted({
        purchaseId: verified.data.purchase_id,
        amount: verified.data.amount_vnd,
        reference: verified.data.reference_code,
        escrowAccount: {bank_name:verified.data.bank_name,account_number:verified.data.account_number,
          account_holder:verified.data.account_holder,qr_code_url:verified.data.qr_code_url,notes:null},
        committedAt: verified.data.committed_at,
      });
      });
    } catch (e: any) {
      if (alive.current) {
        const message = e.message ?? t("marketplace.cantReserve");
        setPurchaseError(message);toast.error(message);
      }
    } finally {
      purchaseInFlight.current = false;
      if (alive.current) {
        setSubmitting(false);
        setConfirming(false);
      }
    }
  };

  return (
    <Dialog open={!!deal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-popover/90 backdrop-blur-2xl [box-shadow:inset_0_1px_0_hsl(var(--foreground)/0.1)]">
        {purchaseError && <p ref={purchaseErrorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{purchaseError}</p>}
        {pendingPurchase && !committed && <div className="space-y-2 text-sm">
          <p>Còn cam kết chưa xác minh. Khôi phục lựa chọn không tự gửi lại hoặc tạo request mới.</p>
          <Button variant="outline" disabled={submitting} onClick={() => {setPercent(pendingPurchase.percent);setConfirming(false);}}>
            Khôi phục lựa chọn đang chờ: {pendingPurchase.percent}%
          </Button>
        </div>}
        {!committed ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 font-display text-2xl tracking-[0.03em]">
                <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10 bg-background/35 shrink-0">
                  {deal.player?.avatar_url ? (
                    <img src={deal.player.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {(deal.player?.display_name ?? "P").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <span>{deal.player?.display_name ?? t("marketplace.playerLabel")}</span>
              </DialogTitle>
              <DialogDescription className="font-display text-muted-foreground">{tournamentName}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 font-display">
              {/* Stats */}
              {stats?.verified && stats.tournaments_played > 0 ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-white/10 bg-background/30 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-display">ITM</div>
                    <div className="font-semibold font-jetbrains tabular-nums">{Number(stats.itm_rate).toFixed(1)}%</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-background/30 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-display">ROI</div>
                    <div className="font-semibold font-jetbrains tabular-nums">{Number(stats.roi_percentage).toFixed(1)}%</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-background/30 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-display">{t("marketplace.tournamentCount")}</div>
                    <div className="font-semibold font-jetbrains tabular-nums">{stats.tournaments_played}</div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-background/30 p-3 font-display text-xs text-muted-foreground">
                  {t("marketplace.noVerifiedStats")}
                </div>
              )}

              {/* Deal breakdown */}
              <div className="space-y-3 rounded-xl border border-white/10 bg-background/25 p-4">
                <div className="flex justify-between text-xs text-muted-foreground font-display">
                  <span>{t("marketplace.soldFraction")} <strong className="font-jetbrains font-semibold tabular-nums text-foreground">{filled}%</strong> / <span className="font-jetbrains font-semibold tabular-nums">{sold}%</span></span>
                  <span className="text-success font-semibold">{t("marketplace.remainingLabel")} <span className="font-jetbrains font-semibold tabular-nums">{remaining}%</span></span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-success" style={{ width: `${fundedW}%` }} />
                  <div className="h-full bg-warning/60" style={{ width: `${pendingW}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs font-display">
                  <span className="text-muted-foreground">{t("marketplace.markupLabel")}</span>
                  <span className="font-jetbrains font-semibold tabular-nums text-success">{Number(deal.markup).toFixed(2)}x</span>
                </div>
                <div className="flex items-center justify-between text-xs font-display">
                  <span className="text-muted-foreground">{t("marketplace.pricePer1")}</span>
                  <span className="font-jetbrains font-semibold tabular-nums">{formatVND(Math.round(pricePer1Pct))}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-display">
                  <span className="text-muted-foreground">{t("marketplace.buyIn")}</span>
                  <span className="font-jetbrains font-semibold tabular-nums">{formatVND(deal.buy_in_amount_vnd)}</span>
                </div>
              </div>

              {/* Buy section */}
              {canBuy && (
                <div className="space-y-3 rounded-xl border border-success/30 bg-success/5 p-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold font-display">
                      {t("marketplace.buyHowMany")}
                    </label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={effectiveMin}
                        max={Math.max(remaining, pendingPurchase?.percent ?? 0)}
                        value={percent}
                        onChange={(e) => {
                          const v = Math.floor(Number(e.target.value));
                          if (Number.isFinite(v)) setPercent(Math.max(effectiveMin, Math.min(remaining, v)));
                        }}
                        className="h-9 w-20 rounded-lg border-success/30 bg-background/35 text-right font-jetbrains text-sm font-bold tabular-nums focus-visible:border-success"
                        disabled={isLastSlice || !!pendingPurchase}
                      />
                      <span className="text-sm font-semibold font-jetbrains tabular-nums">%</span>
                    </div>
                  </div>
                  {!isLastSlice && (
                    <Slider
                      value={[percent]}
                      min={effectiveMin}
                      max={Math.max(remaining, pendingPurchase?.percent ?? 0)}
                      disabled={!!pendingPurchase}
                      step={1}
                      onValueChange={(v) => setPercent(v[0])}
                    />
                  )}
                  <div className="flex items-center justify-between border-t border-success/20 pt-2">
                    <span className="text-xs text-muted-foreground font-display">{t("marketplace.youPay")}</span>
                    <span className="text-xl font-bold font-jetbrains tabular-nums text-success">{formatVND(totalToPay)}</span>
                  </div>
                  {deal.description && (
                    <div className="rounded-lg bg-background/30 p-3 font-display text-xs italic text-muted-foreground">
                      &ldquo;{deal.description}&rdquo;
                    </div>
                  )}
                  {!confirming ? (
                    <Button
                      className="h-11 w-full rounded-xl bg-success font-display font-bold tracking-wider text-success-foreground hover:bg-success/90 active:translate-y-px"
                      onClick={() => setConfirming(true)}
                    >
                      {t("marketplace.buyAction", { pct: percent, price: formatVND(totalToPay) })}
                    </Button>
                  ) : (
                    <div className="space-y-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
                      <div className="flex items-start gap-2 text-sm font-display">
                        <Sparkles className="w-4 h-4 mt-0.5 text-warning shrink-0" />
                        <span>
                          <Trans
                            i18nKey="marketplace.confirmBuyText"
                            values={{ pct: percent, price: formatVND(totalToPay) }}
                            components={{ b: <b /> }}
                          />
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <LiquidButton variant="outline" className="flex-1 rounded-lg border-white/10 bg-background/30 font-display hover:border-success/45 hover:bg-success/10" onClick={() => setConfirming(false)} disabled={submitting}>
                          {t("marketplace.cancel")}
                        </LiquidButton>
                        <Button
                          className="flex-1 rounded-lg bg-success font-display font-bold tracking-wider text-success-foreground hover:bg-success/90 active:translate-y-px"
                          onClick={handleBuy}
                          disabled={submitting}
                        >
                          {submitting ? t("marketplace.processing") : t("marketplace.confirmReserve")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sold out state */}
              {(!canBuy || isOwn) && (
                <Button disabled className="h-11 w-full cursor-not-allowed rounded-xl border border-border/70 bg-muted/80 font-display text-muted-foreground">
                  {isOwn ? t("marketplace.yourOwnDeal") : t("marketplace.soldOut")}
                </Button>
              )}
            </div>
          </>
        ) : (
          <TransferInstructions
            purchaseId={committed.purchaseId}
            dealId={deal.id}
            amount={committed.amount}
            reference={committed.reference}
            committedAt={committed.committedAt}
            escrowAccount={committed.escrowAccount}
            onMarkedTransferred={onPurchased}
            onCancel={onPurchased}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default Marketplace;
