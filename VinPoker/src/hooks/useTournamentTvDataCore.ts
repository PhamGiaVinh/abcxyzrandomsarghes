import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useLiveClock } from "@/hooks/useLiveClock";
import { displayedRemaining, type ClockAnchor } from "@/lib/tv/clockAnchor";
import {
  mapTvData,
  type ClockRpcPayload,
  type TvLevelRow,
  type TvPrizeRow,
  type TvTournamentRow,
} from "@/lib/tv/mapTvData";
import type { TvData } from "@/types/tv";
import { FEATURES } from "@/lib/featureFlags";
import { parseParticipationSummary } from "@/lib/tournamentParticipation";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

export type TvDataState = "loading" | "auth_required" | "not_found" | "error" | "ready";
export type TvRealtimeStatus = "connecting" | "online" | "offline";

interface RawTvData {
  clock: ClockRpcPayload;
  tournament: TvTournamentRow;
  levels: TvLevelRow[];
  totalEntries: number;
  totalChips: number;
  totalBuyIns: number | null;
  reEntries: number | null;
  prizes: TvPrizeRow[];
}

// These two source RPCs postdate generated Database types. Preserve their
// abortable PostgREST read contract without casting payloads to success.
type TvReadRpc = (name: string, args: Record<string, unknown>) => {
  abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const POLL_FALLBACK_MS = 30_000;
const SAFETY_REFETCH_MS = 60_000;
const ZERO_REPOLL_MS = 2_000;
const ZERO_REPOLL_MAX = 10;

/**
 * Live data source for the TV clock (PR B). Read-only composition of existing
 * reads — get_tournament_clock RPC, tournaments row, tournament_levels,
 * confirmed buy-ins, tournament_prizes, and canonical participation counts
 * (not seat-history approximations) — mapped into the frozen TvData
 * contract from PR A.
 *
 * The TV never advances levels itself: the countdown is derived from a
 * monotonic drift anchor, clamps at 00:00, and re-anchors on realtime
 * tournaments UPDATE, zero-cross repolls, a 60s safety refetch, and
 * visibilitychange. When the realtime channel drops, a 30s polling fallback
 * takes over (mirrors TournamentLiveView).
 */
export function useTournamentTvDataCore(
  tournamentId: string | undefined,
  options: { enabled?: boolean; userId: string | null; authLoading: boolean; authEpoch?: number },
) {
  const enabled = options?.enabled ?? true;
  const supabase = useSupabaseClient();
  const authLoading = options.authLoading;
  const hasUser = !!options.userId;
  const scopeKey = JSON.stringify([options.userId ?? "anonymous", tournamentId ?? "", options.authEpoch ?? 0]);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  const [state, setState] = useState<TvDataState>("loading");
  const [raw, setRaw] = useState<RawTvData | null>(null);
  const [rawScope, setRawScope] = useState<string | null>(null);
  const [rawClient, setRawClient] = useState<typeof supabase | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<TvRealtimeStatus>("connecting");

  const anchorRef = useRef<ClockAnchor | null>(null);
  const requestSeqRef = useRef(0);
  const inFlightRef = useRef<{
    scopeKey: string; client: typeof supabase; controller: AbortController;
    queued: boolean; promise: Promise<void>;
  } | null>(null);
  const pollingRef = useRef<number | null>(null);
  const zeroPollRef = useRef<{ tries: number; timer: number | null }>({ tries: 0, timer: null });

  const nowMs = useLiveClock(); // 1s shared tick → re-render; display math uses performance.now()

  const readSnapshot = useCallback(async (seq: number, signal: AbortSignal) => {
    if (!enabled || !tournamentId || scopeRef.current !== scopeKey) return;
    if (!UUID_RE.test(tournamentId)) {
      // Malformed link — a uuid-typed eq() would error; report it as a bad
      // link instead of an endlessly retrying error state.
      setState("not_found");
      return;
    }
    const { data: tournament, error: tournamentError } = await supabase
      .from("tournaments")
      .select("name, status, players_remaining, average_stack, prize_pool, starting_stack, guarantee_amount, buy_in, rake_amount, main_event:tournament_events(guarantee_amount), club:clubs(name, cover_url, tv_logo_url, tv_brand_name, tv_bg_url)")
      .eq("id", tournamentId)
      .abortSignal(signal)
      .maybeSingle();
    if (seq !== requestSeqRef.current || scopeRef.current !== scopeKey) return;
    if (tournamentError) {
      setState("error");
      return;
    }
    if (!tournament) {
      // Live RLS hides tournaments from anon entirely, so without a session a
      // null row means "sign in first", not "does not exist" (Phase 1:
      // logged-in device). With a session it is a genuine not-found.
      setState(hasUser ? "not_found" : "auth_required");
      return;
    }
    if (!hasUser) {
      setState("auth_required");
      return;
    }

    const [clockRes, levelsRes, regsRes, participationRes, prizesRes, satRes, brandingRes] = await Promise.all([
      supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId }).abortSignal(signal),
      supabase
        .from("tournament_levels")
        .select("level_number, small_blind, big_blind, ante, duration_minutes, is_break")
        .eq("tournament_id", tournamentId)
        .abortSignal(signal)
        .order("level_number"),
      supabase
        .from("tournament_registrations")
        .select("buy_in")
        .eq("tournament_id", tournamentId)
        .eq("status", "confirmed")
        .abortSignal(signal),
      (supabase.rpc as unknown as TvReadRpc)("get_tournament_participation_counts_v1", { p_tournament_id: tournamentId }).abortSignal(signal),
      supabase
        .from("tournament_prizes")
        .select("position, amount")
        .eq("tournament_id", tournamentId)
        .abortSignal(signal)
        .order("position"),
      // satellite_payout: cột source-only (chưa apply trên vài DB) → best-effort, lỗi (thiếu cột) → null.
      supabase
        .from("tournaments")
        .select("satellite_payout" as never)
        .eq("id", tournamentId)
        .abortSignal(signal)
        .maybeSingle(),
      FEATURES.tvLayoutEditorV1
        ? (supabase.rpc as unknown as TvReadRpc)("get_tv_tournament_branding_v1", { p_tournament_id: tournamentId }).abortSignal(signal)
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (seq !== requestSeqRef.current || scopeRef.current !== scopeKey) return;
    // Unavailable levels/prizes are not confirmed empty lists. Publishing a
    // ready display would silently hide the break schedule or prize positions.
    if (levelsRes.error || prizesRes.error) {
      setState("error");
      return;
    }
    let participation: ReturnType<typeof parseParticipationSummary>;
    let prizePool: number | null;
    try {
      if (participationRes.error) throw participationRes.error;
      participation = parseParticipationSummary(participationRes.data, tournamentId);
      const value = (participationRes.data as { prize_pool?: unknown }).prize_pool;
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)) {
        throw new Error('invalid_tv_prize_pool');
      }
      prizePool = value as number | null;
    } catch {
      setState("error");
      return;
    }

    const clock = clockRes.data as unknown as ClockRpcPayload | null;
    if (clockRes.error || !clock || clock.error) {
      setState("error");
      return;
    }
    if (FEATURES.tvLayoutEditorV1 && (brandingRes.error || !brandingRes.data)) {
      setState("error");
      return;
    }

    anchorRef.current = {
      remainingAtFetch: clock.remaining_seconds ?? 0,
      anchorMs: performance.now(),
      isRunning: clock.is_running ?? false,
    };

    const row = tournament as unknown as TvTournamentRow;
    row.players_remaining = participation.counts.remaining;
    row.average_stack = participation.averageStack;
    row.prize_pool = prizePool;
    if (FEATURES.tvLayoutEditorV1 && row.club) {
      const branding = brandingRes.data as {
        logo_url: string | null; brand_name: string | null;
        background_url: string | null; layout: unknown;
      };
      row.club = {
        ...row.club,
        tv_logo_url: branding.logo_url,
        tv_brand_name: branding.brand_name,
        tv_bg_url: branding.background_url,
        tv_layout_config: branding.layout,
      };
    }
    // Best-effort satellite (source-only column): missing-column error → null, không phá màn hình.
    row.satellite_payout = satRes.error
      ? null
      : ((satRes.data as { satellite_payout?: unknown } | null)?.satellite_payout ?? null);
    const regs = regsRes.error ? null : (regsRes.data ?? []);
    setRaw({
      clock,
      tournament: row,
      levels: (levelsRes.data ?? []) as TvLevelRow[],
      totalEntries: participation.counts.total_entries,
      totalChips: participation.counts.live_entry_stack,
      totalBuyIns: regs ? regs.reduce((sum, r) => sum + Number(r.buy_in ?? 0), 0) : null,
      reEntries: participation.counts.re_entries,
      prizes: (prizesRes.data ?? []) as TvPrizeRow[],
    });
    setRawScope(scopeKey);
    setRawClient(supabase);
    setState("ready");
  }, [enabled, hasUser, supabase, tournamentId, scopeKey]);

  const loadAll = useCallback((): Promise<void> => {
    if (!enabled || authLoading || !tournamentId || scopeRef.current !== scopeKey) return Promise.resolve();
    const current = inFlightRef.current;
    if (current?.scopeKey === scopeKey && current.client === supabase) {
      current.queued = true;
      return current.promise;
    }
    if (current) { current.queued = false; current.controller.abort(); }
    const seq = ++requestSeqRef.current;
    const job = { scopeKey, client: supabase, controller: new AbortController(), queued: false, promise: Promise.resolve() };
    inFlightRef.current = job;
    job.promise = (async () => {
      try {
        await observeTrackerContextRead(readSnapshot(seq, job.controller.signal));
      } catch {
        if (seq === requestSeqRef.current && scopeRef.current === scopeKey) setState("error");
      } finally {
        job.controller.abort();
        // A transport may ignore abort. Its response must stay invalid after
        // timeout even if no later request has started yet.
        if (seq === requestSeqRef.current) requestSeqRef.current += 1;
        if (inFlightRef.current === job) {
          inFlightRef.current = null;
          if (job.queued && scopeRef.current === scopeKey) void loadAll();
        }
      }
    })();
    return job.promise;
  }, [enabled, authLoading, tournamentId, scopeKey, supabase, readSnapshot]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current != null) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollingRef.current != null) return;
    pollingRef.current = window.setInterval(() => {
      void loadAll();
    }, POLL_FALLBACK_MS);
  }, [loadAll]);

  // Entry: wait for the auth session to resolve, then load. The auth gate for
  // RLS-bound reads lives inside loadAll (Phase 1: logged-in device).
  useEffect(() => {
    if (!enabled) return;
    if (!tournamentId) {
      setState("not_found");
      return;
    }
    if (authLoading) return;
    setState("loading");
    setRaw(null);
    anchorRef.current = null;
    void loadAll();
    return () => {
      requestSeqRef.current += 1;
      const job = inFlightRef.current;
      if (job?.scopeKey === scopeKey && job.client === supabase) {
        job.queued = false;
        job.controller.abort();
        inFlightRef.current = null;
      }
    };
  }, [enabled, tournamentId, authLoading, loadAll, scopeKey, supabase]);

  // Realtime re-anchor + conditional polling fallback (TournamentLiveView pattern).
  useEffect(() => {
    if (!enabled || !tournamentId || !hasUser) return;
    let active = true;
    const channel = supabase
      .channel(`tv:${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` },
        () => {
          void loadAll();
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("online");
          stopPolling();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeStatus("offline");
          startPolling();
        }
      });
    return () => {
      active = false;
      supabase.removeChannel(channel);
      stopPolling();
    };
  }, [enabled, hasUser, loadAll, startPolling, stopPolling, supabase, tournamentId]);

  // 60s safety refetch (also auto-recovers the error state) + wake-from-standby refetch.
  useEffect(() => {
    if (!enabled || !tournamentId || !hasUser) return;
    const id = window.setInterval(() => {
      void loadAll();
    }, SAFETY_REFETCH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, tournamentId, hasUser, loadAll]);

  const display = displayedRemaining(anchorRef.current, performance.now());

  // Zero-cross: refetch once immediately, then every 2s (max 10) until the
  // operator advances the level. The TV itself never advances — it clamps at 00:00.
  useEffect(() => {
    if (!enabled || state !== "ready") return;
    const anchor = anchorRef.current;
    const zero = zeroPollRef.current;
    if (!anchor || !anchor.isRunning || display > 0) {
      zero.tries = 0;
      return;
    }
    if (zero.timer != null || zero.tries >= ZERO_REPOLL_MAX) return;
    zero.timer = window.setTimeout(
      () => {
        zero.timer = null;
        zero.tries += 1;
        void loadAll();
      },
      zero.tries === 0 ? 0 : ZERO_REPOLL_MS,
    );
    return () => {
      if (zero.timer != null) {
        window.clearTimeout(zero.timer);
        zero.timer = null;
      }
    };
  }, [enabled, state, display, nowMs, loadAll]);

  const data: TvData | null = useMemo(() => {
    if (!raw || rawScope !== scopeKey || rawClient !== supabase) return null;
    return mapTvData({ ...raw, displayRemainingSeconds: display });
  }, [raw, display, rawScope, scopeKey, rawClient, supabase]);

  return { state: state === "ready" && (rawScope !== scopeKey || rawClient !== supabase) ? "loading" as const : state, data, realtimeStatus, refetch: loadAll };
}
