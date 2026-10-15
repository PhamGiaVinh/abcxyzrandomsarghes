import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Clock3, Radio, Trophy, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtCompact } from "@/components/cashier/tournament-live/viewer-hub/hubDerive";
import type { PublicClockSummary, TournamentResultView } from "@/components/cashier/tournament-live/viewer-hub/viewerTypes";

type RpcRow = Record<string, unknown>;
type RpcError = { message: string; code?: string };
type RpcResult = { data: unknown; error: RpcError | null };

function callPublicRpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> {
  const rpc = supabase.rpc as unknown as (rpcName: string, rpcArgs: Record<string, unknown>) => PromiseLike<RpcResult>;
  return rpc(name, args);
}

async function boundedPublicRead(response: PromiseLike<RpcResult>): Promise<RpcResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(response), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('public_clock_timeout')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}

function readRpcRow(value: unknown): RpcRow | null {
  if (Array.isArray(value)) return (value[0] as RpcRow) ?? null;
  return value && typeof value === "object" ? value as RpcRow : null;
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapClock(row: RpcRow): PublicClockSummary {
  return {
    id: String(row.id ?? row.tournament_id),
    name: String(row.name ?? "VinPoker Tournament"),
    status: String(row.status ?? "scheduled"),
    startsAt: nullableText(row.starts_at),
    guarantee: nullableNumber(row.guarantee),
    buyIn: nullableNumber(row.buy_in),
    playersRemaining: nullableNumber(row.players_remaining),
    currentLevel: nullableNumber(row.current_level),
    smallBlind: Number(row.small_blind ?? 0),
    bigBlind: Number(row.big_blind ?? 0),
    bigBlindAnte: Number(row.big_blind_ante ?? 0),
    levelEndsAt: nullableText(row.level_ends_at),
    nextSmallBlind: nullableNumber(row.next_small_blind),
    nextBigBlind: nullableNumber(row.next_big_blind),
    nextBigBlindAnte: nullableNumber(row.next_big_blind_ante),
    entries: Number(row.entries ?? 0),
    averageStack: nullableNumber(row.average_stack),
  };
}

function formatCountdown(levelEndsAt: string | null, now: number): string {
  if (!levelEndsAt) return "--:--";
  const seconds = Math.max(0, Math.floor((new Date(levelEndsAt).getTime() - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function PublicTournamentClock() {
  const { tournamentId } = useParams();
  return <ScopedPublicTournamentClock key={tournamentId ?? 'missing'} />;
}

function ScopedPublicTournamentClock() {
  const { tournamentId } = useParams();
  const [searchParams] = useSearchParams();
  const [clock, setClock] = useState<PublicClockSummary | null>(null);
  const [results, setResults] = useState<TournamentResultView[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [resultsUnavailable, setResultsUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tournamentId) return;
    let active = true;
    let inFlight = false;
    let failed = false;
    if (import.meta.env.DEV && searchParams.get("preview") === "mock") {
      setClock({ id: tournamentId, name: "Midnight Sakura Championship", status: "running", startsAt: null, guarantee: 3_000_000_000, buyIn: 12_000_000, playersRemaining: 23, currentLevel: 18, smallBlind: 100_000, bigBlind: 200_000, bigBlindAnte: 200_000, levelEndsAt: new Date(Date.now() + 9 * 60_000 + 25_000).toISOString(), nextSmallBlind: 150_000, nextBigBlind: 300_000, nextBigBlindAnte: 300_000, entries: 188, averageStack: 8_170_000 });
      setResults([
        { place: 1, prize: 620_000_000, playerName: null, avatarUrl: null, status: "open" },
        { place: 2, prize: 410_000_000, playerName: "Kayhan Mokri", avatarUrl: null, status: "provisional" },
        { place: 3, prize: 280_000_000, playerName: "Limitless", avatarUrl: null, status: "official" },
      ]);
      return () => { active = false; };
    }
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
      const [clockResult, resultRows] = await Promise.all([
        boundedPublicRead(callPublicRpc("get_public_tournament_clock_summary", { p_tournament_id: tournamentId })),
        boundedPublicRead(callPublicRpc("get_public_tournament_results", { p_tournament_id: tournamentId })),
      ]);
      if (!active) return;
      const candidate = readRpcRow(clockResult.data);
      const row = candidate && String(candidate.id ?? candidate.tournament_id) === tournamentId ? candidate : null;
      failed = !!clockResult.error || !row || !!resultRows.error;
      setUnavailable(!!clockResult.error || !row);
      setClock(row ? mapClock(row) : null);
      setResultsUnavailable(!!resultRows.error || !Array.isArray(resultRows.data));
      const rows = !resultRows.error && Array.isArray(resultRows.data) ? resultRows.data as RpcRow[] : [];
      setResults(rows.map((item) => ({
        place: Number(item.place),
        prize: Number(item.prize ?? 0),
        playerName: nullableText(item.player_name),
        avatarUrl: nullableText(item.avatar_url),
        status: item.result_status === "official" || item.result_status === "provisional" ? item.result_status : "open",
      })));
      } catch {
        if (!active) return;
        setUnavailable(true);
        failed = true;
        setClock(null);
        setResults([]);
        setResultsUnavailable(true);
      } finally { inFlight = false; }
    };
    void load();
    const poll = window.setInterval(() => {
      if (!failed && document.visibilityState === 'visible' && navigator.onLine) void load();
    }, 15_000);
    return () => { active = false; window.clearInterval(poll); };
  }, [searchParams, tournamentId, attempt]);

  const countdown = useMemo(() => formatCountdown(clock?.levelEndsAt ?? null, now), [clock?.levelEndsAt, now]);

  if (unavailable) return <main className="grid min-h-[100dvh] place-items-center bg-background px-5 text-center"><div className="max-w-md rounded-3xl border border-border/55 bg-card/80 p-7"><Clock3 className="mx-auto h-8 w-8 text-[hsl(var(--poker-gold))]" /><h1 className="mt-4 text-xl font-black">Đồng hồ công khai chưa sẵn sàng</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Không xác minh được dữ liệu đồng hồ công khai. Có thể do kết nối hoặc nguồn dữ liệu chưa sẵn sàng; trang không dùng dữ liệu nội bộ để thay thế.</p><button className="mt-4 min-h-11 rounded-xl border border-border px-4 text-sm font-bold" onClick={() => setAttempt(value => value + 1)}>Thử tải lại</button><Link to="/live" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-bold"><ArrowLeft className="h-4 w-4" /> Live Center</Link></div></main>;
  if (!clock) return <main className="grid min-h-[100dvh] place-items-center bg-background text-sm text-muted-foreground">Đang đồng bộ đồng hồ...</main>;

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_50%_28%,hsl(var(--poker-felt)_/_0.2),transparent_36%),radial-gradient(circle_at_90%_5%,hsl(var(--poker-gold)_/_0.14),transparent_28%),linear-gradient(160deg,hsl(var(--background)),hsl(var(--card)))] px-[max(1rem,env(safe-area-inset-left))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-foreground">
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-[1500px] flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border/45 pb-3"><Link to="/live" className="inline-flex min-h-11 items-center gap-2 text-xs font-bold text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Live Center</Link><span className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--viewer-neon)_/_0.4)] bg-[hsl(var(--viewer-neon)_/_0.09)] px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-[hsl(var(--viewer-neon))]"><Radio className="h-3.5 w-3.5" /> Live</span></header>
        <section className="flex flex-1 flex-col justify-center py-6 text-center sm:py-9">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[hsl(var(--poker-gold))]">Level {clock.currentLevel ?? "--"}</p>
          <h1 className="mx-auto mt-2 max-w-5xl text-2xl font-black tracking-[-0.04em] sm:text-4xl xl:text-5xl">{clock.name}</h1>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Level kết thúc trong</p>
          <div className="tracker-num my-2 text-[clamp(5rem,20vw,14rem)] font-black leading-[0.88] tracking-[-0.08em] tabular-nums text-foreground drop-shadow-[0_0_38px_hsl(var(--viewer-neon)_/_0.12)]">{countdown}</div>
          <div className="mx-auto mt-5 grid w-full max-w-5xl grid-cols-3 overflow-hidden rounded-2xl border border-border/55 bg-card/55 backdrop-blur-xl">
            <div className="p-3 sm:p-5"><div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">SB</div><div className="tracker-num mt-1 text-lg font-black sm:text-3xl">{fmtCompact(clock.smallBlind)}</div></div>
            <div className="border-x border-border/45 p-3 sm:p-5"><div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">BB</div><div className="tracker-num mt-1 text-lg font-black text-[hsl(var(--viewer-neon))] sm:text-3xl">{fmtCompact(clock.bigBlind)}</div></div>
            <div className="p-3 sm:p-5"><div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">BB Ante</div><div className="tracker-num mt-1 text-lg font-black sm:text-3xl">{fmtCompact(clock.bigBlindAnte)}</div></div>
          </div>
        </section>
        <section className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
          {resultsUnavailable && <div role="status" className="text-sm text-destructive lg:col-span-2">Không tải được dữ liệu payout công khai. Không xác nhận danh sách kết quả đang trống. <button className="min-h-11 underline" onClick={() => setAttempt(value => value + 1)}>Thử tải lại payout</button></div>}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-border/50 bg-card/65 p-3"><Users className="h-4 w-4 text-[hsl(var(--poker-gold))]" /><div className="tracker-num mt-3 text-xl font-black">{clock.playersRemaining ?? "--"}</div><div className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">Còn lại</div></div>
            <div className="rounded-2xl border border-border/50 bg-card/65 p-3"><Trophy className="h-4 w-4 text-[hsl(var(--poker-gold))]" /><div className="tracker-num mt-3 text-xl font-black">{clock.entries}</div><div className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">Entries</div></div>
            <div className="rounded-2xl border border-border/50 bg-card/65 p-3"><Clock3 className="h-4 w-4 text-[hsl(var(--poker-gold))]" /><div className="tracker-num mt-3 text-xl font-black">{clock.averageStack ? fmtCompact(clock.averageStack) : "--"}</div><div className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">Avg stack</div></div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/65"><div className="border-b border-border/40 px-4 py-3 text-xs font-black uppercase tracking-widest text-[hsl(var(--poker-gold))]">Payout</div><div className="grid max-h-44 gap-px overflow-y-auto bg-border/30">{results.length ? results.map((result) => <div key={result.place} className="grid min-h-11 grid-cols-[42px_minmax(0,1fr)_auto] items-center bg-card/95 px-3"><span className="tracker-num font-black text-[hsl(var(--poker-gold))]">#{result.place}</span><span className="truncate text-xs font-bold">{result.playerName || "Chưa xác định"}</span><span className="tracker-num text-xs font-black">{fmtCompact(result.prize)}</span></div>) : <div className="p-4 text-sm text-muted-foreground">Payout sẽ cập nhật từ Floor khi có kết quả.</div>}</div></div>
        </section>
      </div>
    </main>
  );
}
