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
  options: { enabled?: boolean; userId: string | null; authLoading: boolean },
) {
  const enabled = options?.enabled ?? true;
  const supabase = useSupabaseClient();
  const authLoading = options.authLoading;
  const hasUser = !!options.userId;
  const scopeKey = `${options.userId ?? "anonymous"}:${tournamentId ?? ""}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  const [state, setState] = useState<TvDataState>("loading");
  const [raw, setRaw] = useState<RawTvData | null>(null);
  const [rawScope, setRawScope] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<TvRealtimeStatus>("connecting");

  const anchorRef = useRef<ClockAnchor | null>(null);
  const requestSeqRef = useRef(0);
  const pollingRef = useRef<number | null>(null);
  const zeroPollRef = useRef<{ tries: number; timer: number | null }>({ tries: 0, timer: null });

  const nowMs = useLiveClock(); // 1s shared tick → re-render; display math uses performance.now()

  const loadAll = useCallback(async () => {
    if (!enabled || !tournamentId || scopeRef.current !== scopeKey) return;
    if (!UUID_RE.test(tournamentId)) {
      // Malformed link — a uuid-typed eq() would error; report it as a bad
      // link instead of an endlessly retrying error state.
      setState("not_found");
      return;
    }
    const seq = ++requestSeqRef.current;

    const { data: tournament, error: tournamentError } = await supabase
      .from("tournaments")
      .select("name, status, players_remaining, average_stack, prize_pool, starting_stack, guarantee_amount, buy_in, rake_amount, club:clubs(name, cover_url, tv_logo_url, tv_brand_name, tv_bg_url)")
      .eq("id", tournamentId)
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
      supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId }),
      supabase
        .from("tournament_levels")
        .select("level_number, small_blind, big_blind, ante, duration_minutes, is_break")
        .eq("tournament_id", tournamentId)
        .order("level_number"),
      supabase
        .from("tournament_registrations")
        .select("buy_in")
        .eq("tournament_id", tournamentId)
        .eq("status", "confirmed"),
      (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>)(
        "get_tournament_participation_counts_v1", { p_tournament_id: tournamentId }),
      supabase
        .from("tournament_prizes")
        .select("position, amount")
        .eq("tournament_id", tournamentId)
        .order("position"),
      // satellite_payout: cột source-only (chưa apply trên vài DB) → best-effort, lỗi (thiếu cột) → null.
      supabase
        .from("tournaments")
        .select("satellite_payout" as never)
        .eq("id", tournamentId)
        .maybeSingle(),
      FEATURES.tvLayoutEditorV1
        ? (supabase.rpc as any)("get_tv_tournament_branding_v1", { p_tournament_id: tournamentId })
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
    try {
      if (participationRes.error) throw participationRes.error;
      participation = parseParticipationSummary(participationRes.data, tournamentId);
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
    setState("ready");
  }, [enabled, hasUser, supabase, tournamentId, scopeKey]);

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
    return () => { requestSeqRef.current += 1; };
  }, [enabled, tournamentId, authLoading, loadAll]);

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
    if (!raw || rawScope !== scopeKey) return null;
    return mapTvData({ ...raw, displayRemainingSeconds: display });
  }, [raw, display, rawScope, scopeKey]);

  return { state: state === "ready" && rawScope !== scopeKey ? "loading" as const : state, data, realtimeStatus, refetch: loadAll };
}
