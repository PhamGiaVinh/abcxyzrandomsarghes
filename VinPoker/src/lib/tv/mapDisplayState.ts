import type { TvData } from "@/types/tv";
import {
  mapTvData,
  type ClockRpcPayload,
  type TvLevelRow,
  type TvPrizeRow,
} from "@/lib/tv/mapTvData";

// get_tv_display_state envelope (contract: docs/agent-handoffs/tv-display-pairing.md).
// Field names deliberately mirror the PR B raw shapes so mapTvData is reused as-is.

export type TvDisplayStatus = "invalid" | "expired" | "unpaired" | "revoked" | "paired";

export interface TvDisplayConfig {
  id: string;
  name: string | null;
  zone: string | null;
  display_number: number | null;
  layout: string;
  theme: string;
  announcement: string | null;
  club_name: string | null;
  club_logo_url?: string | null;
  club_brand_name?: string | null;
  club_background_url?: string | null;
  club_layout?: unknown;
}

export interface TvDisplayTournament {
  id: string;
  name: string;
  status: string;
  players_remaining: number | null;
  average_stack: number | null;
  prize_pool: number | null;
}

export interface TvDisplayStatePayload {
  participation_counts?: { total_entries: number; live_entry_stack?: number };
  status: TvDisplayStatus;
  main_event?: { id: string; name: string; guarantee_amount: number | null } | null;
  display?: TvDisplayConfig;
  tournament?: TvDisplayTournament | null;
  clock?: ClockRpcPayload | null;
  levels?: TvLevelRow[] | null;
  entries?: { total_confirmed: number; total_buy_ins: number } | null;
  re_entries?: number | null;
  prizes?: TvPrizeRow[] | null;
}

export function parseDisplayStatePayload(data: unknown): TvDisplayStatePayload {
  if (!data || typeof data !== "object" || typeof (data as { status?: unknown }).status !== "string") {
    return { status: "invalid" };
  }
  return data as TvDisplayStatePayload;
}

/**
 * Paired display payload → frozen TvData contract. Null when the display has
 * no assigned tournament (standby) or the payload is not in a paired state.
 */
export function mapDisplayStateToTvData(
  payload: TvDisplayStatePayload,
  displayRemainingSeconds: number,
): TvData | null {
  if (payload.status !== "paired" || !payload.tournament || !payload.clock) return null;
  const t = payload.tournament;
  return mapTvData({
    clock: payload.clock,
    tournament: {
      name: t.name,
      status: t.status,
      players_remaining: t.players_remaining,
      average_stack: t.average_stack,
      prize_pool: t.prize_pool,
      starting_stack: null,
      guarantee_amount: null,
      main_event: payload.main_event,
      buy_in: null,
      rake_amount: null,
      satellite_payout: null,
      club: payload.display?.club_name ? {
        name: payload.display.club_name,
        cover_url: null,
        tv_logo_url: payload.display.club_logo_url ?? null,
        tv_brand_name: payload.display.club_brand_name ?? null,
        tv_bg_url: payload.display.club_background_url ?? null,
        tv_layout_config: payload.display.club_layout,
      } : null,
    },
    levels: payload.levels ?? [],
    // Same clamp as PR B: walk-ins may not exist in tournament_registrations.
    totalEntries: payload.participation_counts ? payload.participation_counts.total_entries
      : Math.max(payload.entries?.total_confirmed ?? 0, t.players_remaining ?? 0),
    totalBuyIns: payload.entries ? payload.entries.total_buy_ins : null,
    totalChips: payload.participation_counts?.live_entry_stack,
    reEntries: payload.re_entries ?? null,
    prizes: payload.prizes ?? [],
    displayRemainingSeconds,
  });
}
