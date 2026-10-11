import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(
  root,
  "supabase/migrations/20270115000016_tracker_correction_uat_release2.sql",
), "utf8").replace(/\r\n/g, "\n");
const edge = readFileSync(resolve(root, "supabase/functions/tournament-live-update/index.ts"), "utf8");

describe("Tracker correction Release 2 contract", () => {
  it("rejects obsolete Tracker re-entry without invoking the participation writer", () => {
    const retired = edge.slice(edge.indexOf('case "re_enter":'), edge.indexOf('case "start_hand":'));
    expect(retired).toContain('return validationError(');
    expect(retired).toContain('"LEGACY_REENTRY_RETIRED"');
    expect(retired).not.toContain('.rpc(');
    expect(edge).not.toContain('supabase.rpc("re_enter_tournament"');
    const cashier = readFileSync(resolve(root, "src/components/cashier/ReentryPanel.tsx"), "utf8");
    expect(cashier).toContain('supabase.rpc("reenter_tournament_player"');
  });
  it("ships disabled by default and binds capabilities to an exact user/table scope", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.tracker_correction_uat_scopes");
    expect(migration).toContain("user_id uuid NOT NULL REFERENCES auth.users(id)");
    expect(migration).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(migration).not.toMatch(/INSERT INTO public\.tracker_correction_uat_scopes/i);
    expect(migration).toContain("scope_row.tournament_table_id = p_tournament_table_id");
    expect(migration).toContain("scope_row.user_id = v_actor");
  });

  it("keeps legacy undo private and exposes only the reviewed wrapper", () => {
    expect(migration).toContain("v_legacy := public.delete_last_action(p_hand_id, v_actor)");
    expect(migration).not.toContain("GRANT EXECUTE ON FUNCTION public.delete_last_action");
    expect(migration).toContain("p_expected_action_id uuid");
    expect(migration).toContain("p_expected_source_revision bigint");
    expect(migration).toContain("UNIQUE (actor_user_id, idempotency_key)");
    expect(migration).toContain("'undo_boundary_blind'");
    expect(migration).toContain("'undo_boundary_board'");
  });

  it("creates correction-pending only from a stable action reference", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.report_tracker_wrong_action_v1");
    expect(migration).toContain("v_snapshot IS DISTINCT FROM p_expected_action");
    expect(migration).toContain("correction_state = 'correction_pending'");
    expect(migration).toContain("correction_required, title, message");
  });

  it("blocks canonical hand progression while a correction alert is open", () => {
    expect(migration).toContain("_block_tracker_progress_while_correction_pending");
    expect(migration).toContain("BEFORE INSERT ON public.hand_actions");
    expect(migration).toContain("BEFORE UPDATE OF community_cards, status, is_voided ON public.tournament_hands");
    expect(migration).toContain("alert_row.status IN ('open', 'acknowledged', 'in_progress')");
    expect(migration).toContain("RAISE EXCEPTION 'tracker_correction_pending'");
  });

  it("routes browser undo through the new server contract", () => {
    expect(edge).toContain('case "undo_last_action_v1"');
    expect(edge).toContain('supabase.rpc("undo_tracker_last_action_v1"');
    expect(edge).toContain("p_expected_action_id: expected_action_id");
    expect(edge).toContain("p_expected_source_revision: expected_source_revision");
  });
});
