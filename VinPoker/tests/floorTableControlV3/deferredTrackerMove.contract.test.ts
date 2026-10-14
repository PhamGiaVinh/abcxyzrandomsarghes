import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20270115000008_floor_deferred_tracker_move_v1.sql"), "utf8").replace(/\r\n/g, "\n");
const handWriterSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20270115000009_tracker_record_hand_v3_identity.sql"), "utf8");
const handStartSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20270115000010_tracker_v3_hand_start_context.sql"), "utf8");
const trackerHook = readFileSync(resolve(process.cwd(), "src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts"), "utf8");
const trackerEdge = readFileSync(resolve(process.cwd(), "supabase/functions/tournament-live-update/index.ts"), "utf8");
const ui = readFileSync(resolve(process.cwd(), "src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx"), "utf8");

describe("deferred Floor move into active Tracker table", () => {
  it("reserves one destination seat and waits for terminal hand state", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_pending_tracker_moves_destination");
    expect(sql).toContain("WHERE status = 'pending'");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF is_active, seat_number, table_id, tournament_table_id, table_session_id");
    expect(sql).toContain("WHEN (OLD.status = 'in_progress' AND NEW.status IN ('completed', 'voided'))");
    expect(sql).toContain("v_destination_session.control_mode <> 'tracker'");
    expect(sql).toContain("v_source_session.control_mode <> 'manual'");
  });

  it("keeps the Tracker compatibility projection and caller-bound access", () => {
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("floor_table_v3_actor_is_tournament_operator");
    expect(sql).toContain("SET table_id = v_destination.game_table_id, seat_id = v_new_seat_id");
    expect(sql).toContain("v_destination.id,\n        v_destination.id, v_destination_session.id");
    expect(sql).toContain("REVOKE ALL ON TABLE public.floor_pending_tracker_moves FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).toContain("CREATE OR REPLACE VIEW floor_private.floor_break_pending_reservations_v1");
    expect(sql).not.toContain("GRANT EXECUTE ON FUNCTION public.floor_queue_tracker_move_v1");
  });

  it("finishes V3 hands from explicit session and seat identity without legacy writes", () => {
    expect(handWriterSql).toContain("h.table_session_id = v_tt.table_session_id");
    expect(handWriterSql).toContain("s.tournament_table_id = v_tt.id");
    expect(handWriterSql).toContain("s.tournament_table_id IS NULL AND s.table_id = v_tt.id");
    expect(handWriterSql).toContain("s.tournament_table_id IS NOT NULL");
    expect(handWriterSql).not.toContain("UPDATE public.tournament_tables");
  });

  it("starts a V3 hand only from the current server lease and loads its roster", () => {
    expect(handStartSql).toContain("CREATE OR REPLACE FUNCTION public.start_tracker_hand_v3");
    expect(handStartSql).toContain("v_session.control_epoch IS DISTINCT FROM p_control_epoch");
    expect(handStartSql).toContain("s.tournament_table_id = v_table.id");
    expect(handStartSql).toContain("s.table_session_id = v_session.id");
    expect(handStartSql).toContain("REVOKE ALL ON FUNCTION public.start_tracker_hand_v3");
    expect(trackerHook).toContain("get_tracker_hand_input_tables_v4");
    expect(trackerHook).toContain('.filter("tournament_table_id", "eq", tbl.tournamentTableId)');
    expect(trackerHook).toContain('.filter("table_session_id", "eq", loadedSessionId)');
    expect(trackerHook).toContain("await handleTableChange(tableId);");
    expect(trackerEdge).toContain('supabase.rpc("start_tracker_hand_v3"');
  });

  it("queues only after a direct move reports an active hand", () => {
    expect(ui).toContain('direct.error !== "table_has_active_hand"');
    expect(ui).toContain('direct.error !== "destination_table_has_active_hand"');
    expect(ui).toContain('moveDestination.controlMode !== "tracker"');
    expect(ui).toContain("return v3.queueTrackerMove(args)");
    expect(ui).toContain("v3.cancelPendingTrackerMove");
  });
});
