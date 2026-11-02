import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Trophy, Search, ChevronLeft, ChevronRight, Download, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { exportToExcel } from "@/lib/exportExcel";
import PlayerHistoryDialog from "@/components/PlayerHistoryDialog";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

const PAGE_SIZE = 20;
const hasDisplayFields = (row: unknown, fields: string[]): row is Record<string, unknown> =>
  row !== null && typeof row === "object" && !Array.isArray(row) && fields.every(field => {
    const value = (row as Record<string, unknown>)[field];
    return value == null || typeof value === "string";
  });

// Numeric columns are NOT NULL; malformed responses must not become zero rankings.
const hasMoneyFields = (row: unknown, fields: string[]) =>
  row !== null && typeof row === 'object' && !Array.isArray(row) && fields.every(field => {
    const value = (row as Record<string, unknown>)[field];
    return (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
      && Number.isFinite(Number(value));
  });

const Leaderboard = () => {
  const { user, session } = useAuth();
  return <ScopedLeaderboard key={JSON.stringify([user?.id, sessionReadEpoch(session)])} />;
};

const ScopedLeaderboard = () => {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [entries, setEntries] = useState<any[]>([]);
  const [allTime, setAllTime] = useState<any[]>([]);
  const [clubMoney, setClubMoney] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [clubs, setClubs] = useState<any[]>([]);
  const [clubFilter, setClubFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"overall" | "club" | "trusted">("overall");

  // Trusted tab
  const [trustedResults, setTrustedResults] = useState<any[]>([]);
  const [timeFilter, setTimeFilter] = useState<"week" | "month" | "all">("all");
  const [sortBy, setSortBy] = useState<"total" | "played" | "avg">("total");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPlayer, setHistoryPlayer] = useState<{ id: string; name: string; avatar: string | null } | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date>(new Date());
  const [readError, setReadError] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    let inFlight: Promise<void> | null = null;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const canRead = () => document.visibilityState !== 'hidden' && navigator.onLine !== false;
    const readSnapshot = async (signal: AbortSignal) => {
      const cutoff = (() => {
        const d = new Date();
        if (timeFilter === "week") d.setDate(d.getDate() - 7);
        else if (timeFilter === "month") d.setMonth(d.getMonth() - 1);
        else return null;
        return d.toISOString().slice(0, 10);
      })();

      let trustedQuery = supabase.from("player_results").select("*").eq("verified_by_admin", true);
      if (cutoff) trustedQuery = trustedQuery.gte("event_date", cutoff);

      const replies = await Promise.all([
        supabase.from("leaderboard_entries").select("*").abortSignal(signal),
        supabase.from("clubs").select("id,name").eq("status", "approved").abortSignal(signal),
        supabase.from("all_time_money_list").select("*").order("total_winnings", { ascending: false }).abortSignal(signal),
        supabase.from("club_money_list").select("*").order("total_winnings", { ascending: false }).abortSignal(signal),
        trustedQuery.abortSignal(signal),
      ]);
      if (signal.aborted) throw new Error('Leaderboard read cancelled');
      if (replies.some(reply => reply.error || !Array.isArray(reply.data))) throw new Error('Leaderboard read unavailable');
      const [{ data: e }, { data: c }, { data: at }, { data: cm }, { data: tr }] = replies;
      if ([e, at, cm, tr].some(rows => (rows ?? []).some(row => !hasDisplayFields(row, ['player_id', 'display_name', 'club_id'])))
        || (c ?? []).some(row => !hasDisplayFields(row, ['id', 'name']) || typeof row.id !== 'string' || !row.id.trim() || typeof row.name !== 'string')) {
        throw new Error('Leaderboard display rows unavailable');
      }
      if ((e ?? []).some(row => !hasMoneyFields(row, ['winnings', 'cashout']))
        || [...(at ?? []), ...(cm ?? [])].some(row => !hasMoneyFields(row, ['total_winnings']))
        || (tr ?? []).some(row => !hasMoneyFields(row, ['prize']))) {
        throw new Error('Leaderboard monetary rows unavailable');
      }
      const ids = Array.from(new Set([
        ...((e ?? []).map((x: any) => x.player_id)),
        ...((at ?? []).map((x: any) => x.player_id).filter(Boolean)),
        ...((cm ?? []).map((x: any) => x.player_id).filter(Boolean)),
        ...((tr ?? []).map((x: any) => x.player_id).filter(Boolean)),
      ]));
      const profileReply = ids.length
        ? await supabase.from("profiles").select("user_id, display_name, avatar_url").in("user_id", ids).abortSignal(signal)
        : { data: [], error: null };
      if (profileReply.error || !Array.isArray(profileReply.data)) throw new Error('Leaderboard profiles unavailable');
      if (profileReply.data.some(row => !hasDisplayFields(row, ['user_id', 'display_name', 'avatar_url']) || typeof row.user_id !== 'string' || !row.user_id.trim())) {
        throw new Error('Leaderboard profile rows unavailable');
      }
      return {e, c, at, cm, tr, profs: profileReply.data};
    };

    const schedule = () => {
      if (alive && !timer) timer = setTimeout(() => {timer = undefined; void load();}, 200);
    };
    const load = (): Promise<void> => {
      if (!alive) return Promise.resolve();
      if (inFlight) {queued = true; return inFlight;}
      if (!canRead()) {queued = true; setReadError(true); setLoading(false); return Promise.resolve();}
      queued = false;
      const requestController = new AbortController();
      controller = requestController;
      setLoading(true);
      setReadError(false);
      inFlight = Promise.resolve().then(async () => {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        let cancel: (() => void) | undefined;
        try {
          const interrupted = new Promise<never>((_, reject) => {
            cancel = () => reject(new Error('Leaderboard read cancelled'));
            requestController.signal.addEventListener('abort', cancel, {once: true});
            deadline = setTimeout(() => requestController.abort(), 15_000);
          });
          if (!alive || requestController.signal.aborted) return;
          const snapshot = await Promise.race([readSnapshot(requestController.signal), interrupted]);
          if (!alive || requestController.signal.aborted) return;
          setEntries(snapshot.e ?? []);
          setClubs(snapshot.c ?? []);
          setAllTime(snapshot.at ?? []);
          setClubMoney(snapshot.cm ?? []);
          setTrustedResults(snapshot.tr ?? []);
          setProfiles(Object.fromEntries(snapshot.profs.map(p => [p.user_id, p])));
          setLoadedAt(new Date());
        } catch {
          if (alive) setReadError(true);
        } finally {
          clearTimeout(deadline);
          if (cancel) requestController.signal.removeEventListener('abort', cancel);
          requestController.abort();
          inFlight = null;
          if (alive) {setLoading(false); if (queued && canRead()) schedule();}
        }
      });
      return inFlight;
    };
    const refresh = () => {queued = true; if (!inFlight && canRead()) schedule();};
    void load();
    const ch = supabase.channel("lb").on("postgres_changes",
      { event: "*", schema: "public", table: "leaderboard_entries" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "all_time_money_list" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "club_money_list" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "player_results" }, refresh)
      .subscribe();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      alive = false; clearTimeout(timer); controller?.abort();
      void supabase.removeChannel(ch);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [timeFilter, readAttempt]);

  const aggregate = useMemo(() => {
    const filtered = clubFilter === "all" ? entries : entries.filter(e => e.club_id === clubFilter);
    const map: Record<string, { player_id: string; winnings: number; cashout: number }> = {};
    for (const e of filtered) {
      if (!map[e.player_id]) map[e.player_id] = { player_id: e.player_id, winnings: 0, cashout: 0 };
      map[e.player_id].winnings += Number(e.winnings) || 0;
      map[e.player_id].cashout += Number(e.cashout) || 0;
    }
    return Object.values(map).sort((a, b) => b.winnings - a.winnings);
  }, [entries, clubFilter]);

  const trustedAgg = useMemo(() => {
    const map: Record<string, {
      player_id: string;
      played: number;
      cashed: number;
      total: number;
      biggest: number;
    }> = {};
    for (const r of trustedResults) {
      const id = r.player_id;
      if (!id) continue;
      if (!map[id]) map[id] = { player_id: id, played: 0, cashed: 0, total: 0, biggest: 0 };
      map[id].played += 1;
      const prize = Number(r.prize || 0);
      if (prize > 0) {
        map[id].cashed += 1;
        map[id].total += prize;
        if (prize > map[id].biggest) map[id].biggest = prize;
      }
    }
    const arr = Object.values(map);
    arr.sort((a, b) => {
      if (sortBy === "played") return b.played - a.played;
      if (sortBy === "avg") {
        const av = a.cashed ? a.total / a.cashed : 0;
        const bv = b.cashed ? b.total / b.cashed : 0;
        return bv - av;
      }
      return b.total - a.total;
    });
    return arr;
  }, [trustedResults, sortBy]);

  if (loading) return <div role="status" aria-label={t('leaderboardPage.loading')} className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (readError) return <div role="alert" className="py-12 text-center space-y-3">
    <p>{t('leaderboardPage.loadError')}</p>
    <Button variant="outline" onClick={() => setReadAttempt(n => n + 1)}>{t('leaderboardPage.retry')}</Button>
  </div>;

  const fmt = (n: number) => "$" + n.toLocaleString("en-US");
  const fmtVnd = (n: number) => "₫" + Math.round(n).toLocaleString("vi-VN");

  const isOverall = tab === "overall";
  const isTrusted = tab === "trusted";
  const stripVN = (s: string) => (s ?? "").replace(/vietnam/gi, "").replace(/\s+/g, " ").trim();
  const overallList = allTime.map((a, i) => ({
    key: a.id ?? `at-${i}`,
    rank: i + 1,
    name: stripVN((a.player_id && profiles[a.player_id]?.display_name) || a.display_name || ""),
    avatar_url: a.player_id ? profiles[a.player_id]?.avatar_url ?? null : null,
    winnings: Number(a.total_winnings) || 0,
    cashout: null as number | null,
    linked: !!a.player_id,
  }));
  const clubMoneyForSelected = (clubFilter !== "all")
    ? clubMoney.filter((m) => m.club_id === clubFilter)
    : [];
  const clubList = clubMoneyForSelected.length > 0
    ? clubMoneyForSelected.map((a, i) => ({
        key: a.id ?? `cm-${i}`,
        rank: i + 1,
        name: stripVN((a.player_id && profiles[a.player_id]?.display_name) || a.display_name || ""),
        avatar_url: a.player_id ? profiles[a.player_id]?.avatar_url ?? null : null,
        winnings: Number(a.total_winnings) || 0,
        cashout: null as number | null,
        linked: !!a.player_id,
      }))
    : aggregate.map((p, i) => ({
        key: p.player_id ?? `cl-${i}`,
        rank: i + 1,
        name: profiles[p.player_id]?.display_name ?? t("leaderboardPage.fallbackPlayerName"),
        avatar_url: profiles[p.player_id]?.avatar_url ?? null,
        winnings: p.winnings,
        cashout: p.cashout as number | null,
        linked: true,
      }));

  // Trusted list
  const q = search.trim().toLowerCase();
  const trustedList = trustedAgg.map((p, i) => {
    const prof = profiles[p.player_id];
    return {
      key: p.player_id,
      rank: i + 1,
      player_id: p.player_id,
      name: prof?.display_name ?? t("leaderboardPage.fallbackPlayerName"),
      avatar_url: prof?.avatar_url ?? null,
      played: p.played,
      cashed: p.cashed,
      total: p.total,
      avg: p.cashed ? p.total / p.cashed : 0,
      biggest: p.biggest,
    };
  });
  const filteredTrusted = q ? trustedList.filter((p) => p.name.toLowerCase().includes(q)) : trustedList;
  const trustedPages = Math.max(1, Math.ceil(filteredTrusted.length / PAGE_SIZE));
  const trustedSafePage = Math.min(page, trustedPages);
  const trustedPageItems = filteredTrusted.slice((trustedSafePage - 1) * PAGE_SIZE, trustedSafePage * PAGE_SIZE);

  const fullList = isOverall ? overallList : clubList;
  const filteredList = q ? fullList.filter((p) => p.name.toLowerCase().includes(q)) : fullList;
  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = filteredList.slice(pageStart, pageStart + PAGE_SIZE);

  const handleExportTrusted = () => {
    exportToExcel(
      filteredTrusted,
      [
        { header: t("leaderboardPage.exportColRank"), get: (r) => r.rank, width: 6 },
        { header: t("leaderboardPage.exportColPlayer"), get: (r) => r.name },
        { header: t("leaderboardPage.exportColTournaments"), get: (r) => r.played },
        { header: t("leaderboardPage.exportColCashed"), get: (r) => r.cashed },
        { header: t("leaderboardPage.exportColTotal"), get: (r) => Math.round(r.total) },
        { header: t("leaderboardPage.exportColAvg"), get: (r) => Math.round(r.avg) },
        { header: t("leaderboardPage.exportColBiggest"), get: (r) => Math.round(r.biggest) },
      ],
      "nguoi-choi-uy-tin",
      t("leaderboardPage.exportSheetName"),
    );
  };

  const openHistory = (p: { player_id: string; name: string; avatar_url: string | null }) => {
    setHistoryPlayer({ id: p.player_id, name: p.name, avatar: p.avatar_url });
    setHistoryOpen(true);
  };

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-card via-card to-background px-6 py-12 md:px-10 md:py-16">
        {/* Decorative glow effects */}
        <div className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-primary/10 blur-[120px]" />

        {/* Content */}
        <div className="relative z-10 space-y-4">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 backdrop-blur-sm w-fit">
            <Trophy className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-bold tracking-[0.28em] uppercase text-primary">{t("leaderboardPage.heroBadge")}</span>
          </div>

          {/* Title */}
          <h1 className="font-display text-3xl md:text-5xl lg:text-6xl tracking-[0.04em] text-primary leading-[0.9] drop-shadow-[0_0_24px_hsl(var(--primary)/0.35)]">
            {t("leaderboardPage.title")}
          </h1>

          {/* Chronograph divider */}
          <div className="flex items-center gap-2 pt-2 max-w-md">
            <div className="flex-1 h-[1px] bg-primary/60" />
            <div className="w-2 h-2 bg-primary rotate-45 shrink-0 shadow-[0_0_8px_hsl(var(--primary))]" />
            <div className="flex-1 h-[1px] bg-primary/30" />
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as any);
          setPage(1);
          setSearch("");
          if (v === "overall") setClubFilter("all");
          else if (v === "club" && clubFilter === "all" && clubs[0]) setClubFilter(clubs[0].id);
        }}
      >
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="overall">{t("leaderboardPage.overall")}</TabsTrigger>
          <TabsTrigger value="club">{t("leaderboardPage.byClub")}</TabsTrigger>
          <TabsTrigger value="trusted" className="gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> {t("leaderboardPage.trustedTab")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overall" className="mt-6">
          <div className="text-xs text-muted-foreground">{t("leaderboardPage.allTimeSubtitle", { n: overallList.length })}</div>
        </TabsContent>

        <TabsContent value="club" className="mt-6">
          <Select value={clubFilter !== "all" ? clubFilter : ""} onValueChange={(v) => { setClubFilter(v); setPage(1); }}>
            <SelectTrigger className="bg-card/50 border-border/40"><SelectValue placeholder={t("leaderboardPage.selectClub")} /></SelectTrigger>
            <SelectContent>
              {clubs.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {clubFilter !== "all" && (
            <div className="text-xs text-muted-foreground mt-2">
              {t("leaderboardPage.club")}: <span className="text-gold">{clubs.find(c => c.id === clubFilter)?.name}</span>
            </div>
          )}
        </TabsContent>

        <TabsContent value="trusted" className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={timeFilter} onValueChange={(v: any) => { setTimeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[140px] bg-card/50 border-border/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="week">{t("leaderboardPage.timeWeek")}</SelectItem>
                <SelectItem value="month">{t("leaderboardPage.timeMonth")}</SelectItem>
                <SelectItem value="all">{t("leaderboardPage.timeAll")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v: any) => { setSortBy(v); setPage(1); }}>
              <SelectTrigger className="w-[180px] bg-card/50 border-border/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="total">{t("leaderboardPage.sortByTotal")}</SelectItem>
                <SelectItem value="played">{t("leaderboardPage.sortByPlayed")}</SelectItem>
                <SelectItem value="avg">{t("leaderboardPage.sortByAvg")}</SelectItem>
              </SelectContent>
            </Select>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={handleExportTrusted} className="gap-1">
                <Download className="w-4 h-4" /> {t("leaderboardPage.exportExcel")}
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-primary" />
            {t("leaderboardPage.trustedNote")}
          </div>
        </TabsContent>
      </Tabs>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder={t("leaderboardPage.searchPlaceholder")}
          className="pl-9 bg-card/50 border-border/40"
        />
      </div>

      {isTrusted ? (
        <>
          {filteredTrusted.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground border-border/40 bg-card/40">
              {q ? t("leaderboardPage.noPlayers") : t("leaderboardPage.trustedEmpty")}
            </Card>
          ) : (
            <>
              {/* Desktop table */}
              <Card className="hidden md:block overflow-hidden border-border/40 bg-gradient-to-br from-card/60 to-card/40 backdrop-blur-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>{t("leaderboardPage.colPlayer")}</TableHead>
                      <TableHead className="text-right">{t("leaderboardPage.colTournaments")}</TableHead>
                      <TableHead className="text-right">{t("leaderboardPage.colTotal")}</TableHead>
                      <TableHead className="text-right">{t("leaderboardPage.colAvg")}</TableHead>
                      <TableHead className="text-right">{t("leaderboardPage.colBiggest")}</TableHead>
                      <TableHead className="text-right">{t("leaderboardPage.colDetail")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trustedPageItems.map((p) => {
                      const rank = p.rank;
                      const rankStyle =
                        rank === 1 ? "bg-gradient-to-br from-warning to-warning text-background"
                        : rank === 2 ? "bg-gradient-to-br from-slate-200 to-slate-400 text-background"
                        : rank === 3 ? "bg-gradient-to-br from-warning to-warning text-background"
                        : "bg-muted text-muted-foreground";
                      return (
                        <TableRow key={p.key} className="even:bg-muted/30">
                          <TableCell>
                            <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${rankStyle}`}>{rank}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {p.avatar_url && <img src={p.avatar_url} alt={p.name} className="w-7 h-7 rounded-full object-cover border border-border" />}
                              <span className="font-medium">{p.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{p.played}</TableCell>
                          <TableCell className="text-right text-gold font-display">{fmtVnd(p.total)}</TableCell>
                          <TableCell className="text-right">{fmtVnd(p.avg)}</TableCell>
                          <TableCell className="text-right">{fmtVnd(p.biggest)}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" onClick={() => openHistory(p)}>{t("leaderboardPage.view")}</Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {trustedPageItems.map((p) => {
                  const rank = p.rank;
                  const rankStyle =
                    rank === 1 ? "bg-gradient-to-br from-warning to-warning text-background"
                    : rank === 2 ? "bg-gradient-to-br from-slate-200 to-slate-400 text-background"
                    : rank === 3 ? "bg-gradient-to-br from-warning to-warning text-background"
                    : "bg-muted text-muted-foreground";
                  return (
                    <Card key={p.key} className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${rankStyle}`}>{rank}</span>
                        {p.avatar_url && <img src={p.avatar_url} alt={p.name} className="w-8 h-8 rounded-full object-cover border border-border" />}
                        <span className="font-medium flex-1 truncate">{p.name}</span>
                      </div>
                      <div className="font-display text-xl text-gold">{fmtVnd(p.total)}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t("leaderboardPage.playedCount", { n: p.played })} · {fmtVnd(p.avg)}
                      </div>
                      <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => openHistory(p)}>{t("leaderboardPage.viewDetail")}</Button>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {trustedPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={trustedSafePage <= 1}>
                <ChevronLeft className="w-4 h-4" /> {t("leaderboardPage.prev")}
              </Button>
              <div className="text-xs text-muted-foreground">
                {t("leaderboardPage.page")} {trustedSafePage} / {trustedPages} · {filteredTrusted.length}
              </div>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(trustedPages, p + 1))} disabled={trustedSafePage >= trustedPages}>
                {t("leaderboardPage.next")} <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}

          <div className="text-[11px] text-muted-foreground text-center">
            {t("leaderboardPage.updatedAt", { t: loadedAt.toLocaleTimeString() })}
          </div>
        </>
      ) : (
        <>
          <Card className="divide-y divide-border/50 overflow-hidden">
            {filteredList.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {q ? t("leaderboardPage.noPlayers") : isOverall ? t("leaderboardPage.emptyOverall") : t("leaderboardPage.emptyClub")}
              </div>
            ) : pageItems.map((p) => {
              const rank = p.rank;
              const rankStyle =
                rank === 1
                  ? "bg-gradient-to-br from-warning to-warning text-background shadow-[0_0_18px_hsl(45_90%_55%/0.7)] ring-2 ring-warning animate-scale-in"
                  : rank === 2
                  ? "bg-gradient-to-br from-slate-200 to-slate-400 text-background shadow-[0_0_14px_hsl(0_0%_75%/0.6)] ring-2 ring-border animate-scale-in"
                  : rank === 3
                  ? "bg-gradient-to-br from-warning to-warning text-background shadow-[0_0_14px_hsl(30_70%_45%/0.6)] ring-2 ring-warning animate-scale-in"
                  : rank <= 10
                  ? "bg-gradient-to-br from-primary/70 to-primary text-primary-foreground shadow-[0_0_10px_hsl(var(--primary)/0.5)] ring-1 ring-primary/60"
                  : "bg-muted/50 text-muted-foreground";
              const nameStyle =
                rank === 1 ? "text-warning font-bold drop-shadow-[0_0_6px_hsl(45_90%_55%/0.6)]"
                : rank === 2 ? "text-foreground font-semibold"
                : rank === 3 ? "text-warning font-semibold"
                : rank <= 10 ? "text-primary font-medium" : "";
              return (
                <div key={p.key} className="flex items-center gap-3 p-3 hover-scale animate-fade-in">
                  <div className={`min-w-[2.25rem] h-9 px-2 rounded-full flex items-center justify-center font-display font-bold text-sm transition-all ${rankStyle}`}>
                    {rank}
                  </div>
                  {p.avatar_url && (
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-muted/40 border border-border shrink-0">
                      <img src={p.avatar_url} alt={p.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`truncate ${nameStyle || "font-medium"}`}>{p.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">{t("leaderboardPage.winnings")}</div>
                    <div className="font-display text-primary">{fmt(p.winnings)}</div>
                  </div>
                </div>
              );
            })}
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
                <ChevronLeft className="w-4 h-4" /> {t("leaderboardPage.prev")}
              </Button>
              <div className="text-xs text-muted-foreground">
                {t("leaderboardPage.page")} {safePage} / {totalPages} · {filteredList.length} {t("leaderboardPage.playersCount")}
              </div>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
                {t("leaderboardPage.next")} <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      )}

      <PlayerHistoryDialog
        playerId={historyPlayer?.id ?? null}
        playerName={historyPlayer?.name}
        avatarUrl={historyPlayer?.avatar ?? null}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
};

export default Leaderboard;
