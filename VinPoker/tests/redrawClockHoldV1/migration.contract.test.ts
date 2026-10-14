import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/pending-migrations/20270126000001_redraw_clock_hold_v1.sql"),
  "utf8",
).replace(/\r\n?/g, "\n");

describe("redraw clock hold V1 migration contract", () => {
  it("keeps the release gate on both new redraw plans and applying redraws", () => {
    const gate = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION floor_private.floor_redraw_gate_v1"),
      migration.indexOf("CREATE OR REPLACE FUNCTION floor_private.floor_redraw_apply_clock_hold_v1"),
    );
    expect(gate).toContain("centerpoint_private.assert_tournament_ops_release_v1(v_club_id)");
    expect(gate).toContain("TG_OP = 'INSERT'");
    expect(gate).toContain("NEW.status = 'applied'");
    expect(migration).toContain("CREATE TRIGGER trg_floor_redraw_gate_v1\nBEFORE INSERT OR UPDATE");
  });

  it("records the hold and pause atomically after the existing apply RPC has committed its movement snapshot", () => {
    const apply = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20270114000011_floor_redraw_seat_lock_v1.sql"),
      "utf8",
    );
    const applyRpc = apply.slice(
      apply.indexOf("CREATE OR REPLACE FUNCTION public.floor_apply_tournament_redraw_v1"),
      apply.indexOf("CREATE OR REPLACE FUNCTION public.get_public_tournament_redraw_v1"),
    );
    const trigger = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION floor_private.floor_redraw_apply_clock_hold_v1"),
      migration.indexOf("CREATE OR REPLACE FUNCTION floor_private.floor_redraw_start_hand_fence_v1"),
    );
    expect(applyRpc).toContain("SET status = 'applied'");
    expect(trigger).toContain("AFTER UPDATE OF status ON public.tournament_redraw_batches");
    expect(trigger).toContain("FOR UPDATE");
    expect(trigger).toContain("clock_was_running = v_clock_was_running");
    expect(trigger).toContain("clock_revision_after_pause = v_clock_revision");
    expect(trigger).toContain("pause_owner = NEW.applied_by");
    expect(trigger).toContain("redraw_hold_batch_id = NEW.id");
    expect(trigger).toContain("v_hold_count <> cardinality(NEW.target_game_table_ids)");
  });

  it("shares a physical table/session row fence with start_hand and denies new hands during a redraw hold", () => {
    const fence = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION floor_private.floor_redraw_start_hand_fence_v1"),
      migration.indexOf("CREATE OR REPLACE FUNCTION floor_private.floor_redraw_clock_resume_fence_v1"),
    );
    expect(fence).toContain("BEFORE INSERT ON public.tournament_hands");
    expect(fence).toContain("FOR KEY SHARE");
    expect(fence).toContain("COALESCE(table_row.game_table_id, table_row.table_id)");
    expect(fence).toContain("FROM public.game_tables game_table");
    expect(fence).toContain("FOR UPDATE");
    expect(fence).toContain("FROM public.table_sessions session_row");
    expect(fence).toContain("redraw_table_hold_active");
    expect(migration).toContain("BEFORE UPDATE OF status ON public.tournament_hands");
    expect(fence).toContain("OLD.status = 'in_progress' AND NEW.status = 'voided'");
  });

  it("continues idempotently and resumes only the unchanged clock pause created by that redraw", () => {
    const continueRpc = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.floor_continue_tournament_redraw_v1"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.get_public_tournament_redraw_v1"),
    );
    expect(continueRpc).toContain("floor_table_v3_lock_receipt");
    expect(continueRpc).toContain("floor_table_v3_existing_receipt");
    expect(continueRpc).toContain("IDEMPOTENCY_CONFLICT");
    expect(continueRpc).toContain("p_expected_redraw_revision");
    expect(continueRpc).toContain("clock_revision_after_pause = v_tournament.clock_control_revision");
    expect(continueRpc).toContain("hold_completed_at = pg_catalog.now()");
    expect(migration).not.toContain("centerpoint.redraw_continue_batch");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.floor_continue_tournament_redraw_v1");
    expect(migration).toContain("TO authenticated");
  });

  it("exposes only an active immutable redraw snapshot to the public TV reader", () => {
    const tv = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.get_public_tournament_redraw_v1"),
    );
    expect(tv).toContain("batch_row.hold_completed_at IS NULL");
    expect(tv).toContain("hold_row.redraw_hold_batch_id = batch_row.id");
    expect(tv).toContain("move_row.from_table_number");
    expect(tv).toContain("move_row.from_seat_number");
    expect(tv).toContain("move_row.to_table_number");
    expect(tv).toContain("move_row.to_seat_number");
    expect(tv).toContain("GRANT EXECUTE ON FUNCTION public.get_public_tournament_redraw_v1(uuid) TO anon, authenticated");
  });
});
