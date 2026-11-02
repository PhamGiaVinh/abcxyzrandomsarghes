// Edge Function: compute-payouts  (PR-2b — Payout "Engine 3-neo" server compute path)
// =====================================================================================
// SOURCE-ONLY. Not deployed by this PR. Runs the SAME pure-TS engine as the client
// (../_shared/payoutEngine.ts — a byte-identical copy guarded by payoutEngine.drift.test.ts).
//
// Two modes:
//   preview  — FORECAST only. Never persists. Computes from live-ish inputs (entries override or a
//              live confirmed-entry count) so the UI can show an estimated payout while registration
//              is open. The result is explicitly `estimated:true` and writes NOTHING.
//   official — Computes STRICTLY from the FROZEN snapshot row in tournament_payout_runs (created by
//              the PR-2a prepare_payout_snapshot RPC). NEVER recounts entries, NEVER reads live
//              mutable tournament state. Then calls apply_payout_run (PR-2a) which re-verifies every
//              invariant and writes the official payout. The Edge NEVER writes tournament_prizes
//              directly, and NEVER prepares/regenerates — the caller must pass an already-prepared
//              draft `run_id`.
//
// AUTH: the caller JWT is verified; for official mode the apply RPC is called with the CALLER's JWT
// so the DB enforces Owner/Admin/Cashier via auth.uid() (a non-privileged caller cannot apply even
// with a run_id). The service role is used only for read-only role checks (with the JWT-verified uid)
// and to read the frozen snapshot. No secret literals — all keys come from Deno.env.
//
// Deploy (LATER, owner-gated — NOT part of this PR):
//   supabase functions deploy compute-payouts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
  computePayouts,
  computeCustomPayouts,
  computeBandedPayouts,
  floorFor,
  defaultRoundingUnit,
  MIN_CASH_X,
  type PayoutArchetype,
} from "../_shared/payoutEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ARCHETYPES: PayoutArchetype[] = ["DAILY", "INTL", "MULTI", "TRITON"];
// statuses excluded from the official entry count (mirrors prepare_payout_snapshot); only 'cancelled'
// actually occurs today (tournament_entries.status CHECK), the rest are defensive.
const EXCLUDED_ENTRY_STATUS = ["void", "voided", "cancelled", "canceled", "refunded", "rejected"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return json({ error: "MISCONFIGURED" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "AUTH_REQUIRED" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "BAD_JSON" }, 400);
  }

  const mode = body.mode;
  if (mode !== "preview" && mode !== "official") {
    return json({ error: "BAD_MODE", hint: "mode must be 'preview' or 'official'" }, 400);
  }

  // Caller-scoped client: forwards the JWT so RPCs see auth.uid() = caller and RLS applies.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "AUTH_REQUIRED" }, 401);
  const uid = userData.user.id;

  // Service client: read-only role checks (with the verified uid) + reading the frozen snapshot.
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Owner/Admin/Cashier check, reusing the canonical live role helpers with the JWT-verified uid.
  async function authorizeClub(clubId: string): Promise<Response | null> {
    let unverified = false;
    for (const fn of ["is_club_owner", "is_club_admin", "is_club_cashier"]) {
      try {
        const { data, error } = await service.rpc(fn, { _user_id: uid, _club_id: clubId });
        if (error || (data !== true && data !== false)) { unverified = true; continue; }
        if (data === true) return null;
      } catch { unverified = true; }
    }
    return unverified ? json({ error: "PAYOUT_AUTHORITY_UNVERIFIED" }, 503)
      : json({ error: "NOT_AUTHORIZED" }, 403);
  }

  // ----------------------------------------------------------------------------------- OFFICIAL
  if (mode === "official") {
    const runId = body.run_id;
    if (typeof runId !== "string" || !runId) return json({ error: "RUN_ID_REQUIRED" }, 400);

    const { data: run, error: runErr } = await service
      .from("tournament_payout_runs")
      .select(
        "id, tournament_id, status, entries_snapshot, prize_pool_snapshot, effective_floor, itm_percent, archetype, rounding_unit",
      )
      .eq("id", runId)
      .maybeSingle();
    if (runErr) return json({ error: runErr.message }, 400);
    if (!run) return json({ error: "RUN_NOT_FOUND" }, 404);
    if (run.status !== "draft_snapshot") return json({ error: "RUN_NOT_DRAFT", status: run.status }, 409);

    // Authorize the caller for this tournament's club BEFORE computing/applying, so an unauthorized
    // caller cannot compute from — or learn — the frozen snapshot economics. `club_id` is immutable
    // metadata read ONLY for this auth gate; ALL economic inputs still come from the frozen snapshot.
    // (apply_payout_run independently re-checks the role via the forwarded JWT — defence in depth.)
    const { data: tourRow, error: tourLookupErr } = await service
      .from("tournaments").select("club_id").eq("id", run.tournament_id).maybeSingle();
    if (tourLookupErr) return json({ error: tourLookupErr.message }, 400);
    if (!tourRow) return json({ error: "TOURNAMENT_NOT_FOUND" }, 404);
    const denied = await authorizeClub(tourRow.club_id);
    if (denied) return denied;

    // Compute STRICTLY from the frozen snapshot — never recount, never read live tournament state.
    // CUSTOM uses the frozen `custom_percents`; presets use the α engine. Both go through
    // apply_payout_run, whose CUSTOM branch skips the α-only min-cash-floor checks.
    let result;
    try {
      if (run.archetype === "CUSTOM") {
        // CUSTOM stores its frozen percents in `custom_percents`, a column added by the 20261123
        // migration. Fetch it in a SEPARATE query so the preset path above (which never selects
        // this column) keeps working on a pre-migration schema. Fail SAFE if the column is absent:
        // this branch is only reachable for a CUSTOM run, which can't exist until the migration is
        // applied anyway, but the guard means a stray call can never crash the preset path.
        const { data: cp, error: cpErr } = await service
          .from("tournament_payout_runs")
          .select("custom_percents")
          .eq("id", runId)
          .maybeSingle();
        if (cpErr) return json({ error: "CUSTOM_SCHEMA_NOT_READY", detail: cpErr.message }, 400);
        const percents = ((cp?.custom_percents ?? []) as Array<Record<string, unknown>>).map((p) => ({
          position: Number(p.position),
          percentBp: Number(p.percent_bp),
        }));
        result = computeCustomPayouts({
          prizePool: Number(run.prize_pool_snapshot),
          percents,
          roundingUnit: Number(run.rounding_unit),
        });
      } else if (run.archetype === "LIVE_STANDARD") {
        // Banded preset: computes from the SAME frozen columns as presets (effective_floor is the real
        // min-cash floor) — no new DB column → merge-safe. apply skips only LAST_NOT_FLOOR for it.
        result = computeBandedPayouts({
          entries: Number(run.entries_snapshot),
          prizePool: Number(run.prize_pool_snapshot),
          floor: Number(run.effective_floor),
          itmPercent: Number(run.itm_percent),
          roundingUnit: Number(run.rounding_unit),
        });
      } else {
        result = computePayouts({
          entries: Number(run.entries_snapshot),
          prizePool: Number(run.prize_pool_snapshot),
          floor: Number(run.effective_floor),
          itmPercent: Number(run.itm_percent),
          archetype: run.archetype as PayoutArchetype,
          roundingUnit: Number(run.rounding_unit),
        });
      }
    } catch (e) {
      return json({ error: "ENGINE_ERROR", detail: String((e as Error).message) }, 400);
    }

    const rows = result.rows.map((r) => ({ position: r.position, amount: r.amount }));
    // Apply via the CALLER's JWT → apply_payout_run enforces the role gate + re-verifies all invariants
    // + writes tournament_prizes/prize_pool/itm_places atomically. The Edge never writes prizes itself.
    const { data: applied, error: applyErr } = await userClient.rpc("apply_payout_run", {
      p_run_id: runId,
      p_rows: rows,
      p_prize_pool: run.prize_pool_snapshot,
      p_itm_places: result.itmPlaces,
      p_effective_floor: result.effectiveFloor,
      p_warnings: result.warnings,
      p_engine_version: result.engineVersion,
      p_alpha_version: result.alphaVersion,
    });
    if (applyErr) return json({ error: applyErr.message }, 400);

    return json({
      mode: "official",
      run_id: runId,
      result: {
        rows: result.rows,
        tiers: result.tiers,
        prizePool: result.prizePool,
        itmPlaces: result.itmPlaces,
        effectiveFloor: result.effectiveFloor,
        alpha: result.alpha,
        archetype: result.archetype,
        warnings: result.warnings,
        engineVersion: result.engineVersion,
        alphaVersion: result.alphaVersion,
      },
      applied,
    });
  }

  // ------------------------------------------------------------------------------------ PREVIEW
  const tournamentId = body.tournament_id;
  if (typeof tournamentId !== "string" || !tournamentId) return json({ error: "TOURNAMENT_ID_REQUIRED" }, 400);
  const archetype = body.archetype as PayoutArchetype | "CUSTOM" | "LIVE_STANDARD";
  const isCustom = archetype === "CUSTOM";
  const isBanded = archetype === "LIVE_STANDARD";
  if (!isCustom && !isBanded && !ARCHETYPES.includes(archetype as PayoutArchetype)) return json({ error: "BAD_ARCHETYPE" }, 400);
  const itmPercent = Number(body.itm_percent);
  if (!isCustom && !(itmPercent > 0 && itmPercent < 1)) return json({ error: "BAD_ITM_PERCENT", hint: "0..1 fraction" }, 400);

  const { data: tour, error: tourErr } = await userClient
    .from("tournaments")
    .select("id, club_id, buy_in, rake_amount, event_id")
    .eq("id", tournamentId)
    .maybeSingle();
  if (tourErr) return json({ error: tourErr.message }, 400);
  if (!tour) return json({ error: "TOURNAMENT_NOT_FOUND" }, 404);
  const denied = await authorizeClub(tour.club_id);
  if (denied) return denied;
  if (tour.event_id) return json({ error: "MULTIDAY_UNSUPPORTED" }, 400);

  // Forecast only: use the same eligibility as prepare_payout_snapshot, including legacy NULL.
  let entries: number;
  let entriesSource: string;
  if (body.entries_override != null) {
    entries = Number(body.entries_override);
    entriesSource = "override";
  } else {
    const { count, error: cntErr } = await userClient
      .from("tournament_entries")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId)
      .or(`status.is.null,status.not.in.(${EXCLUDED_ENTRY_STATUS.join(",")})`);
    if (cntErr) return json({ error: cntErr.message }, 400);
    entries = count ?? 0;
    entriesSource = "live_entries";
  }
  if (!(entries > 0)) return json({ error: "NO_ENTRIES", entries }, 400);

  const buyIn = Number(tour.buy_in);
  const rake = Number(tour.rake_amount ?? 0);
  const minCashX = body.min_cash_x != null ? Number(body.min_cash_x) : MIN_CASH_X[archetype as PayoutArchetype];
  const roundingUnit = body.rounding_unit != null ? Number(body.rounding_unit) : defaultRoundingUnit(buyIn);
  const prizePool = body.prize_pool_override != null ? Number(body.prize_pool_override) : entries * buyIn;
  const floor = floorFor(minCashX, buyIn, rake);

  let result;
  try {
    if (isCustom) {
      const percents = ((body.custom_percents ?? []) as Array<Record<string, unknown>>).map((p) => ({
        position: Number(p.position),
        percentBp: Number(p.percent_bp),
      }));
      result = computeCustomPayouts({ prizePool, percents, roundingUnit });
    } else if (isBanded) {
      result = computeBandedPayouts({ entries, prizePool, floor, itmPercent, roundingUnit });
    } else {
      result = computePayouts({ entries, prizePool, floor, itmPercent, archetype: archetype as PayoutArchetype, roundingUnit });
    }
  } catch (e) {
    return json({ error: "ENGINE_ERROR", detail: String((e as Error).message) }, 400);
  }

  return json({
    mode: "preview",
    estimated: true, // forecast only — nothing persisted; the UI must label this "DỰ KIẾN"
    entries,
    entriesSource,
    prizePool: result.prizePool,
    result: {
      rows: result.rows,
      tiers: result.tiers,
      itmPlaces: result.itmPlaces,
      effectiveFloor: result.effectiveFloor,
      alpha: result.alpha,
      archetype: result.archetype,
      warnings: result.warnings,
    },
  });
});
