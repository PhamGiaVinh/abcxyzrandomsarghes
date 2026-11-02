import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import { parseParticipationSummary } from "@/lib/tournamentParticipation";

// The tv_* RPCs went live with migration 20260818000001, which postdates the
// generated src/integrations/supabase/types.ts — call them through one local
// cast until the types file is regenerated (planned alongside PR C3).
type UntypedRpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  abortSignal: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const rpc = supabase.rpc.bind(supabase) as UntypedRpc;

export interface TvPairBeginResult {
  error?: string;
  display_id?: string;
  pair_code?: string;
  display_token?: string;
  expires_at?: string;
}

export async function rpcTvPairBegin(): Promise<{ data: TvPairBeginResult | null; error: string | null }> {
  const { data, error } = await rpc("tv_pair_begin");
  return { data: (data as TvPairBeginResult) ?? null, error: error?.message ?? null };
}

function validTvPrizeRows(value: unknown): boolean {
  // Preserve the existing optional collection contract, including null.
  if (value == null) return true;
  if (!Array.isArray(value)) return false;
  const positions = new Set<number>();
  return value.every((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const prize = row as Record<string, unknown>;
    if (typeof prize.position !== "number" || !Number.isSafeInteger(prize.position)
      || prize.position < 1 || positions.has(prize.position)) return false;
    if (!(typeof prize.amount === "number" || typeof prize.amount === "string" && prize.amount.trim())) return false;
    const amount = Number(prize.amount);
    if (!Number.isFinite(amount) || amount < 0) return false;
    positions.add(prize.position);
    return true;
  });
}

export async function rpcGetTvDisplayState(
  displayToken: string,
  signal?: AbortSignal,
): Promise<{ data: unknown; error: string | null }> {
  let response: Awaited<ReturnType<UntypedRpc>>;
  try {
    const request = rpc("get_tv_display_state_v4", {
      p_display_token: displayToken, p_include_branding: FEATURES.tvLayoutEditorV1,
    });
    response = await (signal ? request.abortSignal(signal) : request);
  } catch (failure) {
    // Keep the read-result contract even when fetch rejects. The display's
    // existing bounded backoff can recover; do not retry the heartbeat here.
    return { data: null, error: failure instanceof Error ? failure.message : "tv_display_transport_error" };
  }
  const { data, error } = response;
  const status = data && typeof data === "object" ? (data as { status?: unknown }).status : undefined;
  if (!error && (!data || typeof data !== "object" || Array.isArray(data)
    || typeof status !== "string" || !["paired", "unpaired", "invalid", "expired", "revoked"].includes(status))) {
    return { data: null, error: "invalid_tv_display_response" };
  }
  if (!error && data && typeof data === "object") {
    const payload = data as Record<string, any>;
    if (payload.status === "paired" && payload.tournament) {
      if (!validTvPrizeRows(payload.prizes)) return { data: null, error: "invalid_tv_prizes" };
      try {
        const summary = parseParticipationSummary({ tournament_id: payload.tournament.id,
          counts: payload.participation_counts, average_stack: payload.tournament.average_stack }, payload.tournament.id);
        if (payload.entries?.total_confirmed !== summary.counts.total_entries
          || payload.re_entries !== summary.counts.re_entries
          || payload.tournament.players_remaining !== summary.counts.remaining) throw new Error("inconsistent_tv_participation");
      } catch (failure) {
        return { data: null, error: failure instanceof Error ? failure.message : "invalid_tv_participation" };
      }
    }
  }
  return { data, error: error?.message ?? null };
}
