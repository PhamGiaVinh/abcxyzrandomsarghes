import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270110000007_tracker_historical_settlement_display.sql"),
  "utf8",
);
const edge = readFileSync(
  resolve(process.cwd(), "supabase/functions/tournament-historical-settlement/index.ts"),
  "utf8",
);
const publicSettlementReader = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261238000002_tracker_settlement_outcome_store.sql"),
  "utf8",
);
const completionBaseMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270128000004_tracker_history_completion_queue.sql"),
  "utf8",
);
const completionFixMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270128000006_tracker_history_completion_audit_fixes.sql"),
  "utf8",
);
const completionMigration = `${completionBaseMigration}\n${completionFixMigration}`;
const worker = readFileSync(
  resolve(process.cwd(), "supabase/functions/tournament-historical-settlement-worker/index.ts"),
  "utf8",
);
const dispatcher = readFileSync(
  resolve(process.cwd(), "supabase/functions/tournament-historical-settlement-dispatcher/index.ts"),
  "utf8",
);
const supabaseConfig = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");
const operatorWorkspace = readFileSync(
  resolve(process.cwd(), "src/components/cashier/tournament-live/HandHistoryWorkspace.tsx"),
  "utf8",
);

describe("historical settlement display migration contract", () => {
  it("keeps historical display verification target-only and non-mutating", () => {
    expect(migration).toContain("verification_scope IN ('chain', 'historical_display')");
    expect(migration).toContain("get_tournament_historical_display_source_hash");
    expect(migration).toContain("settled_hand.id = changed_hand.id");
    expect(migration).toContain("INSERT INTO public.tournament_settlement_outcomes");
    expect(migration).not.toContain("UPDATE public.hand_players SET");
    expect(migration).not.toContain("UPDATE public.tournament_chip_counts");
    expect(migration).not.toContain("UPDATE public.tournament_seats");
    expect(migration).not.toContain("UPDATE public.tournament_entries");
  });

  it("requires a service-only, owner/admin checked, CAS-bound receipt", () => {
    expect(migration).toContain("service_role_only");
    expect(migration).toContain("public.is_club_owner(p_actor_user_id, v_tournament.club_id)");
    expect(migration).toContain("public.is_club_admin(p_actor_user_id, v_tournament.club_id)");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("stale_source_revision");
    expect(migration).toContain("idempotency_mismatch");
    expect(migration).toContain("historical_settlement_already_exists");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.commit_historical_tournament_settlement_display_outcome");
    expect(migration).toContain("TO service_role");
  });

  it("rejects private public-outcome fields recursively", () => {
    for (const field of [
      "privateEvidence",
      "holeCards",
      "holeCardsByPlayer",
      "muckedHoleCardsByPlayer",
      "externalAdjustments",
      "evaluatorInput",
      "correctionNotes",
      "staffIdentity",
      "actor",
    ]) {
      expect(migration).toContain(`jsonb_path_exists(p_public_outcome, '$.**.${field}')`);
    }
  });

  it("keeps the Edge function intent-only and recomputes before a single write RPC", () => {
    expect(edge).toContain("mode?: \"preview\" | \"commit\"");
    expect(edge).not.toContain("winner_id");
    expect(edge).not.toContain("p_ending_stack");
    expect(edge).toContain("verifyHistoricalDisplaySettlement");
    expect(edge).toContain("authorize_tournament_live_resettle");
    expect(edge).toContain("commit_tracker_historical_display_outcome_v2");
    expect(edge).toContain("stale_historical_preview");
    expect(edge).toContain("get_tracker_historical_display_commit_receipt");
    expect(edge.indexOf("get_tracker_historical_display_commit_receipt")).toBeLessThan(
      edge.indexOf("get_tracker_historical_display_snapshot"),
    );
  });

  it("queues revisions idempotently and claims with a bounded fencing lease", () => {
    expect(completionMigration).toContain("CREATE TABLE IF NOT EXISTS public.tracker_historical_display_queue");
    expect(completionMigration).toContain("PRIMARY KEY (hand_id, source_revision)");
    expect(completionMigration).toContain("ON CONFLICT (hand_id, source_revision)");
    expect(completionMigration).toContain("h.source_revision = q.source_revision");
    expect(completionMigration).not.toContain("ON CONFLICT (hand_id) DO UPDATE");
    expect(completionFixMigration).toContain("LIMIT p_limit FOR UPDATE OF q SKIP LOCKED");
    expect(completionMigration).toContain("NEW.source_revision IS NOT DISTINCT FROM OLD.source_revision");
    expect(completionMigration).toContain("ON CONFLICT (hand_id, source_revision) DO NOTHING");
    expect(completionMigration).toContain("FOR UPDATE SKIP LOCKED");
    expect(completionMigration).toContain("lease_token = gen_random_uuid()");
    expect(completionMigration).toContain("lease_until > now()");
    expect(completionMigration).toContain("tracker_enqueue_historical_display");
    expect(completionMigration).toContain("tracker_small_blind");
    expect(completionMigration).toContain("tracker_big_blind");
    expect(completionMigration).toContain("tracker_blind_evidence");
    expect(completionMigration).toContain("correct_tracker_historical_hand_blinds");
    expect(completionMigration).toContain("tracker_hand_blind_correction_audit");
    expect(completionMigration).toContain("settlement_revision");
    expect(completionMigration).toContain("v_next_revision");
  });

  it("keeps the worker service-only, dark by default, and on the existing verifier", () => {
    expect(worker).toContain('TRACKER_HISTORY_COMPLETION_WORKER_ENABLED');
    expect(worker).toContain('verifyHistoricalDisplaySettlement');
    expect(worker).toContain('claim_tracker_historical_display_jobs');
    expect(worker).toContain('commit_tracker_historical_display_outcome_v2');
    expect(worker).toContain('p_actor_kind: "system_worker"');
    expect(worker).toContain('p_lease_token: job.lease_token');
    expect(worker).not.toContain('winner_id');
  });

  it("uses one stable source snapshot and exposes only a dark service dispatcher seam", () => {
    expect(completionMigration).toContain("CREATE OR REPLACE FUNCTION public.get_tracker_historical_display_snapshot(");
    expect(completionMigration).toContain("RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER");
    expect(worker).toContain('get_tracker_historical_display_snapshot');
    expect(worker).not.toContain('get_tournament_historical_display_source_hash');
    expect(edge).toContain('get_tracker_historical_display_snapshot');
    expect(edge).toContain('get_tracker_historical_display_commit_receipt');
    expect(dispatcher).toContain('TRACKER_HISTORY_COMPLETION_WORKER_ENABLED');
    expect(dispatcher).toContain('tournament-historical-settlement-worker');
    expect(dispatcher).toContain('authorizeHistoryWorker(req, serviceKey, canarySecret)');
    expect(dispatcher).toContain('!authority.ok');
    expect(dispatcher).toContain('authority.scopedOnly && !handIds');
    expect(dispatcher).toContain('authority.scopedOnly ? canarySecret : serviceKey');
    for (const functionName of ['tournament-historical-settlement-worker', 'tournament-historical-settlement-dispatcher']) {
      const section = supabaseConfig.split(`[functions.${functionName}]`)[1]?.split('[')[0];
      expect(section, `${functionName} deployment policy`).toBeDefined();
      expect(section).toMatch(/^verify_jwt\s*=\s*false\s*$/m);
    }
    expect(dispatcher.indexOf('TRACKER_HISTORY_COMPLETION_WORKER_ENABLED')
      < dispatcher.indexOf('authorizeHistoryWorker(req, serviceKey, canarySecret)')).toBe(true);
    expect(dispatcher.indexOf('authority.scopedOnly && !handIds')
      < dispatcher.indexOf('const response = await fetch')).toBe(true);
    expect(dispatcher).not.toContain('jsonResp(req, { ok: false, serviceKey');
  });

  it("keeps blind corrections missing-only and binds selected owner values in the audit", () => {
    expect(completionMigration).toContain("ADD COLUMN IF NOT EXISTS selected_snapshot jsonb");
    expect(completionMigration).toContain("ADD COLUMN IF NOT EXISTS selected_level_id uuid");
    expect(completionMigration).toContain("'owner_admin_selected_snapshot'");
    expect(completionMigration).toContain("COALESCE(tracker_small_blind, p_small_blind)");
    expect(completionMigration).toContain("blind_snapshot_conflict");
    expect(completionMigration).toContain("'needs_attention', 'blind_snapshot_conflict'");
    expect(completionFixMigration).toContain("v_existing.selected_level_id IS DISTINCT FROM p_level_id");
    expect(completionFixMigration).not.toContain("SELECT id, level_number, small_blind, big_blind, ante, is_break INTO");
  });

  it("uses the existing public projector without exposing its historical proof metadata", () => {
    expect(publicSettlementReader).toContain("CREATE OR REPLACE FUNCTION public.get_public_tournament_settlement");
    expect(publicSettlementReader).toContain("AND o.source_revision = h.source_revision");
    expect(publicSettlementReader).toContain("- 'sourceChainHash'");
    expect(publicSettlementReader).toContain("- 'outcomeHash'");
    expect(publicSettlementReader).not.toContain("verification_scope = 'chain'");
  });

  it("returns only verified historical results for the matching hand revision", () => {
    expect(completionFixMigration).toContain("WHERE o.hand_id = p.id AND o.status = 'verified'");
    expect(completionFixMigration).toContain("o.source_revision = current_source.historical_revision");
    expect(completionFixMigration).toContain("o.source_revision = current_source.chain_revision");
    expect(completionMigration).toContain("'status','pending'");
    expect(completionMigration).toContain("interval '10 seconds'");
    expect(completionMigration).toContain("'netDelta'");
    expect(completionMigration).toContain("'potKinds'");
  });

  it("adds a chronology-safe follow-up migration without rewriting the merged schema file", () => {
    expect(completionMigration).toContain("CREATE OR REPLACE FUNCTION public.get_tracker_historical_display_snapshot(");
    expect(completionFixMigration).toContain("LIMIT p_limit FOR UPDATE OF q SKIP LOCKED");
    expect(completionMigration).toContain("verification_scope = 'historical_display'");
    expect(completionMigration).toContain("ON CONFLICT (hand_id, source_revision) DO NOTHING");
  });

  it("publishes only current-revision outcomes whose canonical source hash still matches", () => {
    expect(completionFixMigration).toContain("LEFT JOIN LATERAL public.get_tournament_historical_display_source_hash(p.id) historical");
    expect(completionFixMigration).toContain("LEFT JOIN LATERAL public.get_tournament_settlement_source_hash(p.id) chain");
    expect(completionFixMigration).toContain("o.source_revision = current_source.historical_revision");
    expect(completionFixMigration).toContain("o.source_chain_hash = current_source.historical_hash");
    expect(completionFixMigration).toContain("o.source_revision = current_source.chain_revision");
    expect(completionFixMigration).toContain("o.source_chain_hash = current_source.chain_hash");
    expect(completionFixMigration).toContain("ORDER BY CASE WHEN o.verification_scope = 'historical_display' THEN 0 ELSE 1 END");
    expect(completionFixMigration).toContain("ELSE jsonb_build_object('status','pending')");
  });

  it("requires target-only historical proof for queue coverage and backfill", () => {
    expect(completionFixMigration).toContain("o.verification_scope = 'historical_display'");
    expect(completionFixMigration).toContain("o.source_chain_hash = current_source.source_chain_hash");
    expect(completionFixMigration).toContain("JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) current_source ON true");
    expect(completionFixMigration).not.toContain("o.verification_scope IN ('chain', 'historical_display')");
  });

  it("keeps operator statuses and filter controls dark behind the default-off feature gate", () => {
    expect(completionMigration).toContain("interval '10 seconds'");
    expect(operatorWorkspace).toContain('completionStatusByHand.get(hand.id) === completionFilter');
    expect(operatorWorkspace).toContain('FEATURES.trackerHistoryCompletionWorker &&');
    expect(operatorWorkspace).toContain('completionStatusError');
  });
});
