// READ-ONLY data hook for the spectator HAND FEED. Queries COMPLETED, non-voided
// hands (paginated, newest-first — same shape HandSelector / the replay path use),
// batches hand_players / hand_actions / tournament_eliminations / profiles by hand
// id, and builds the feed view-models via the pure `handFeedDerive`. No writes, no
// new RPC/Edge/publication. Visibility-aware 13s poll on the loaded pages; mounted
// only when FEATURES.liveHandFeed is on, so a flag-OFF viewer pays zero extra reads.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchHandPlayerDisplay, handPlayersHasSnapshot } from "@/lib/tracker-poker/handPlayerNames";
import {
  buildHandFeedItems,
  filterByTags,
  type HandFeedItem,
  type HandFeedTag,
  type RawElimination,
  type RawHandAction,
  type RawHandPlayer,
  type RawHandRow,
  type RawProfile,
} from "./handFeedDerive";
import { FEATURES } from "@/lib/featureFlags";
import { parseReplayPublicSettlement } from "@/lib/tracker-poker/replaySettlement";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { z } from "zod";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";

const PAGE_SIZE = 10;
const POLL_MS = 13_000;
const publicCatalogSchema = z.object({ items: z.array(z.object({
  id: z.string().min(1), handNumber: z.number().int().safe().positive(),
  createdAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  board: z.array(z.string()).max(5), pot: z.number().int().safe().nonnegative().nullable(),
  bigBlind: z.number().int().safe().nonnegative().nullable().optional(),
  buttonSeat: z.number().int().positive(), tableId: z.string().min(1).nullable(),
  status: z.string().min(1), isVoided: z.boolean(),
})) });

export interface CompletedHandsFeedOptions {
  /** Restrict to one table (the viewer's featured table). null = all tables. */
  tableId?: string | null;
  /** Client-side tag filter (empty = no filter). */
  tags?: HandFeedTag[];
  bigPotThresholdBB?: number;
}

export interface CompletedHandsFeedData {
  items: HandFeedItem[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: string | null;
  reload: () => Promise<void>;
}

function groupByHand<T extends { hand_id: string }>(rows: T[] | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows ?? []) {
    const arr = m.get(r.hand_id) ?? [];
    arr.push(r);
    m.set(r.hand_id, arr);
  }
  return m;
}

export function useCompletedHandsFeed(
  tournamentId: string | undefined,
  opts: CompletedHandsFeedOptions = {},
): CompletedHandsFeedData {
  const { tableId = null, tags = [], bigPotThresholdBB } = opts;
  const [pageCount, setPageCount] = useState(1);
  const [allItems, setAllItems] = useState<HandFeedItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const activeRead = useRef<AbortController | null>(null);

  // Reset paging when the tournament / table scope changes.
  useEffect(() => {
    setPageCount(1);
    setAllItems([]);
    setHasMore(false);
    setError(null);
    return () => { ++seqRef.current; activeRead.current?.abort(); };
  }, [tournamentId, tableId]);

  const fetchFeed = useCallback(async () => {
    if (!tournamentId) {
      setAllItems([]);
      setHasMore(false);
      setLoading(false);
      setError(null);
      return;
    }
    const seq = ++seqRef.current;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    setLoading(true);
    try {
    await observeTrackerContextRead((async () => {
    const want = FEATURES.publicSpectatorRealtimeV2 ? Math.min(100, pageCount * PAGE_SIZE) : pageCount * PAGE_SIZE;

    let handRows: Array<RawHandRow & { status?: string; is_voided?: boolean }> = [];
    if (FEATURES.publicSpectatorRealtimeV2) {
      const { data, error } = await supabase.rpc("get_public_tournament_hand_catalog_v2" as never, {
        p_tournament_id: tournamentId,
        p_tournament_table_id: tableId,
        p_limit: want + 1,
      } as never).abortSignal(controller.signal);
      const catalog = (data ?? {}) as unknown as { error?: string; access?: string; items?: Array<{
        bigBlind?: number | null; id: string; handNumber: number; createdAt: string; board: string[]; pot: number | null;
        buttonSeat: number; tableId: string | null; status: string; isVoided: boolean;
      }> };
      if (seq !== seqRef.current) return;
      if (error || catalog.error) throw new Error(error?.message || catalog.error);
      const parsed = publicCatalogSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_public_hand_catalog");
      handRows = parsed.data.items.map((hand) => ({
        id: hand.id, hand_number: hand.handNumber, created_at: hand.createdAt, tracker_big_blind: hand.bigBlind,
        community_cards: hand.board, pot_size: hand.pot, button_seat: hand.buttonSeat,
        table_id: hand.tableId ?? "", status: hand.status, is_voided: hand.isVoided,
      }));
    } else {
      let q = supabase
        .from("tournament_hands")
        .select("id, hand_number, created_at, community_cards, pot_size, button_seat, table_id, status, is_voided")
        .eq("tournament_id", tournamentId)
        .eq("is_voided", false)
        .order("created_at", { ascending: false })
        .limit(want + 1);
      if (tableId) q = q.eq("table_id", tableId);
      const { data, error } = await q.abortSignal(controller.signal);
      if (error) throw new Error(error.message);
      handRows = (data ?? []) as unknown as RawHandRow[];
    }
    if (seq !== seqRef.current) return;

    const completed = handRows.filter((h: { status?: string }) => h.status !== "in_progress");
    const more = completed.length > want && (!FEATURES.publicSpectatorRealtimeV2 || want < 100);
    const pageHands = completed.slice(0, want) as unknown as RawHandRow[];
    const ids = pageHands.map((h) => h.id);
    if (ids.length === 0) {
      setAllItems([]);
      setHasMore(false);
      setLoading(false);
      setError(null);
      return;
    }

    // E1: prefer the per-hand snapshot (hand_players.player_name/avatar_url) — selected
    // only if present (feature-detect). handFeedDerive reads it per-row; the profMap below
    // is the tournament_seats fallback for rows the snapshot didn't capture (old hands).
    let hp: RawHandPlayer[] = [];
    let ha: RawHandAction[] = [];
    let el: RawElimination[] = [];
    if (FEATURES.publicSpectatorRealtimeV2) {
      const publicHands = await Promise.all(ids.map(async (handId) => {
        const { data, error }: PostgrestSingleResponse<unknown> = await supabase.rpc("get_public_tournament_hand_v2" as never, {
          p_tournament_id: tournamentId,
          p_hand_id: handId,
        } as never).abortSignal(controller.signal);
        if (error) throw new Error(error.message);
        if (data && typeof data === "object" && "error" in data && data.error) {
          throw new Error(String(data.error));
        }
        return (data ?? {}) as unknown as {
          players?: Array<{ playerId: string; seatNumber: number; startingStack: number | null; endingStack: number | null; eliminated: boolean; name: string; avatarUrl: string | null; holeCards: string[] }>;
          actions?: Array<{ id: string; playerId: string; street: string | null; actionType: string; amount: number | null; order: number }>;
        };
      }));
      publicHands.forEach((publicHand, index) => {
        const handId = ids[index];
        hp.push(...(publicHand.players ?? []).map((player) => ({
          hand_id: handId, player_id: player.playerId, seat_number: player.seatNumber,
          starting_stack: player.startingStack, ending_stack: player.endingStack,
          hole_cards: player.holeCards, is_eliminated: player.eliminated,
          player_name: player.name, avatar_url: player.avatarUrl,
        })));
        ha.push(...(publicHand.actions ?? []).map((action) => ({
          id: action.id, hand_id: handId, player_id: action.playerId,
          street: action.street, action_type: action.actionType,
          action_amount: action.amount, action_order: action.order,
        })));
      });
    } else {
      const snap = await handPlayersHasSnapshot();
      const hpCols = snap
        ? "hand_id, player_id, seat_number, starting_stack, ending_stack, hole_cards, is_eliminated, player_name, avatar_url"
        : "hand_id, player_id, seat_number, starting_stack, ending_stack, hole_cards, is_eliminated";
      const [hpResult, haResult, elResult] = await Promise.all([
        supabase.from("hand_players").select(hpCols).in("hand_id", ids).abortSignal(controller.signal),
        supabase.from("hand_actions").select(FEATURES.liveViewerPulseV2
          ? "id, hand_id, player_id, street, action_type, action_amount, action_order"
          : "hand_id, player_id, action_type, action_amount, action_order").in("hand_id", ids).order("action_order").abortSignal(controller.signal),
        supabase.from("tournament_eliminations").select("hand_id, player_id, position, prize").in("hand_id", ids).abortSignal(controller.signal),
      ]);
      const readError = hpResult.error || haResult.error || elResult.error;
      if (readError) throw new Error(readError.message);
      hp = (hpResult.data ?? []) as unknown as RawHandPlayer[];
      ha = (haResult.data ?? []) as unknown as RawHandAction[];
      el = (elResult.data ?? []) as unknown as RawElimination[];
    }
    if (seq !== seqRef.current) return;

    // Fallback roster (keyed by player_id, handFeedDerive already looks up by player_id)
    // — only for rows whose snapshot is missing, so the query is free once all snapshotted.
    const needIds = FEATURES.publicSpectatorRealtimeV2 ? [] : hp.filter((player) => !player.player_name).map((player) => player.player_id);
    const display = await fetchHandPlayerDisplay(tournamentId, needIds, { includeProfiles: FEATURES.liveViewerPulseV2 });
    if (seq !== seqRef.current) return;

    const profMap = new Map<string, RawProfile>();
    display.forEach((d, pid) =>
      profMap.set(pid, { user_id: pid, display_name: d.name ?? null, avatar_url: d.avatar ?? null }),
    );

    // The public projection intentionally omits source revisions. A hand UUID is
    // therefore not a freshness key: correction may invalidate its proof between polls.
    const settlementRows = await Promise.all(ids.map(async (handId) => {
      const { data, error } = await supabase.rpc(
        "get_public_tournament_settlement" as never,
        { p_hand_id: handId } as never,
      ).abortSignal(controller.signal);
      return [handId, { proof: error ? null : parseReplayPublicSettlement(data), unavailable: !!error }] as const;
    }));
    if (seq !== seqRef.current) return;
    const currentSettlements = new Map(settlementRows);
    const settledHands = pageHands.map((hand) => ({
      ...hand,
      publicSettlement: currentSettlements.get(hand.id)?.proof ?? null,
      settlementUnavailable: currentSettlements.get(hand.id)?.unavailable ?? false,
    }));

    const items = buildHandFeedItems(
      settledHands,
      groupByHand(hp),
      groupByHand(ha),
      groupByHand(el),
      profMap,
      { bigPotThresholdBB, viewerPulseV2: FEATURES.liveViewerPulseV2 },
    );
    setAllItems(items);
    setHasMore(more);
    setLoading(false);
    setError(null);
    })());
    } catch (failure: unknown) {
      if (seq !== seqRef.current) return;
      controller.abort();
      // Promise deadlines do not cancel transport: invalidate any late continuation.
      ++seqRef.current;
      // Do not present a previous verified winner as the result of a failed refresh.
      setAllItems([]);
      setHasMore(false);
      setError(failure instanceof Error ? failure.message : "Không tải được lịch sử hand.");
      setLoading(false);
    } finally {
      if(activeRead.current === controller)activeRead.current = null;
    }
  }, [tournamentId, tableId, pageCount, bigPotThresholdBB]);

  useEffect(() => {
    setLoading(true);
    void fetchFeed();
  }, [fetchFeed]);

  // Visibility-aware poll: pause when the tab is hidden, refetch the loaded pages.
  useEffect(() => {
    if (!tournamentId || typeof document === "undefined") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => void fetchFeed(), POLL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") stop();
      else {
        void fetchFeed();
        start();
      }
    };
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tournamentId, fetchFeed]);

  const loadMore = useCallback(() => setPageCount((c) => c + 1), []);
  const items = tags.length ? filterByTags(allItems, tags) : allItems;
  return { items, loading, hasMore, loadMore, error, reload: fetchFeed };
}
