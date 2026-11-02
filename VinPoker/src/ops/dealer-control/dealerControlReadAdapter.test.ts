import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { loadDealerControlReadModel } from "./dealerControlReadAdapter";
import { gunzipSync } from "node:zlib";

const inventory = () => ({ game_table_id: "table", table_number: 5, table_name: "Table 5",
  operational_status: "available", availability_status: "in_use", table_session_id: "session-B",
  session_type: "cash", control_mode: "manual", control_epoch: 1, revision: 1,
  tournament_id: null, tournament_table_id: null, tournament_table_status: null,
  active_dealer_assignment_id: "assignment" });
const assignment = () => ({ id: "assignment", table_id: "table", table_session_id: "session-B",
  dealer_id: "dealer", status: "assigned", swing_due_at: null, needs_replacement: false,
  assigned_at: "2026-10-20T00:00:00Z" });
let rows: Record<string, unknown[]|null>;
let inventoryRows: unknown[];
let inventoryError: { message: string } | null;
const from = vi.fn((name: string) => {
  const result = Promise.resolve({ data: rows[name], error: null });
  const query = Object.assign(result, {
    select: vi.fn(() => query), eq: vi.fn(() => query), neq: vi.fn(() => query),
    is: vi.fn(() => query), in: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query),
    abortSignal:vi.fn(()=>query),
  });
  return query;
});
const rpc = vi.fn(() => {const result=Promise.resolve({data:inventoryRows,error:inventoryError});return Object.assign(result,{abortSignal:vi.fn(()=>result)});});
const client = { from, rpc } as unknown as SupabaseClient<Database>;

beforeEach(() => {
  from.mockClear(); rpc.mockClear(); inventoryError = null; inventoryRows = [inventory()];
  rows = {
    game_tables: [{ id: "table", table_name: "Table 5", table_type: "cash", status: "open" }],
    dealers: [{ id: "dealer", full_name: "Current Dealer", tier: "A" }],
    dealer_assignments: [assignment()],
    dealer_attendance: [{ dealer_id: "dealer", current_state: "assigned", check_in_time: "2026-10-20T00:00:00Z" }],
  };
});

it("uses the authenticated canonical club inventory for the current assignment", async () => {
  const result = await loadDealerControlReadModel(client, "club");
  expect(result.tables[0].dealerName).toBe("Current Dealer");
  expect(result.tables[0].status).toBe("in_use");
  expect(rpc).toHaveBeenCalledWith("get_club_table_inventory", { p_club_id: "club" });
  expect(from.mock.calls.map(([name]) => name)).not.toContain("table_sessions");
  const gameQuery = from.mock.results.find((_, index) => from.mock.calls[index][0] === "game_tables")!.value;
  expect(gameQuery.neq).not.toHaveBeenCalledWith("status", "inactive");
});

it.each([
  ['game_tables','DEALER_TABLE_READ_FAILED'],
  ['dealers','DEALER_ROSTER_READ_FAILED'],
  ['dealer_assignments','DEALER_ASSIGNMENT_READ_FAILED'],
  ['dealer_attendance','DEALER_ATTENDANCE_READ_FAILED'],
])('rejects null %s instead of reporting a verified empty or zero snapshot',async(table,code)=>{
  rows[table]=null;
  await expect(loadDealerControlReadModel(client,'club')).rejects.toThrow(code);
});

it('does not start another read for an already aborted lifetime',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(loadDealerControlReadModel(client,'club',controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(from).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
});

it('passes the same owned AbortSignal to all five canonical read queries',async()=>{
  const controller=new AbortController();
  await loadDealerControlReadModel(client,'club',controller.signal);
  expect(from).toHaveBeenCalledTimes(4);
  for(const read of from.mock.results)expect(read.value.abortSignal).toHaveBeenCalledWith(controller.signal);
  expect(rpc.mock.results[0].value.abortSignal).toHaveBeenCalledWith(controller.signal);
});

it("does not display a previous session assignment after the table reopens", async () => {
  rows.dealer_assignments = [{ ...assignment(), table_session_id: "session-A" }];
  await expect(loadDealerControlReadModel(client, "club")).rejects.toThrow("DEALER_ASSIGNMENT_SESSION_MISMATCH");
});

it("shows repair-required inventory without presenting the stale dealer as current", async () => {
  inventoryRows = [{ ...inventory(), availability_status: "repair_required", active_dealer_assignment_id: null }];
  rows.dealer_assignments = [{ ...assignment(), table_session_id: "session-A" }];
  const result = await loadDealerControlReadModel(client, "club");
  expect(result.tables[0]).toMatchObject({ status: "repair_required", dealerName: null, swingDueAt: null });
});

it("does not choose a latest row when two assigned rows compete for a table", async () => {
  rows.dealer_assignments = [assignment(), { ...assignment(), id: "duplicate" }];
  await expect(loadDealerControlReadModel(client, "club")).rejects.toThrow("DEALER_ASSIGNMENT_SESSION_MISMATCH");
});

it("rejects a different assignment ID even if its session matches", async () => {
  inventoryRows = [{ ...inventory(), active_dealer_assignment_id: "different" }];
  await expect(loadDealerControlReadModel(client, "club")).rejects.toThrow("DEALER_ASSIGNMENT_SESSION_MISMATCH");
});

it("does not turn an unavailable inventory into a valid unassigned table", async () => {
  inventoryError = { message: "private backend error" };
  await expect(loadDealerControlReadModel(client, "club")).rejects.toThrow("DEALER_INVENTORY_READ_FAILED");
});

it("rejects missing inventory instead of falling back to a physical-table match", async () => {
  inventoryRows = [];
  await expect(loadDealerControlReadModel(client, "club")).rejects.toThrow("DEALER_INVENTORY_SCOPE_MISMATCH");
});

it("accepts an available table with no assignment without inventing a dealer", async () => {
  inventoryRows = [{ ...inventory(), availability_status: "available", table_session_id: null,
    session_type: null, control_mode: null, control_epoch: null, revision: null, active_dealer_assignment_id: null }];
  rows.dealer_assignments = [];
  const result = await loadDealerControlReadModel(client, "club");
  expect(result.tables[0].dealerName).toBeNull();
});

it("rejects a legacy null-session assignment rather than inferring its incarnation", async () => {
  rows.dealer_assignments = [{ ...assignment(), table_session_id: null }];
  await expect(loadDealerControlReadModel(client, "club")).rejects.toThrow("DEALER_ASSIGNMENT_SESSION_MISMATCH");
});

it("rejects malformed canonical inventory", async () => {
  inventoryRows = [{ ...inventory(), availability_status: "unknown" }];
  await expect(loadDealerControlReadModel(client, "club")).rejects.toThrow("DEALER_INVENTORY_READ_FAILED");
});

it.skipIf(!process.env.VINPOKER_DEALER_INVENTORY_GZIP)("accepts the full retained native inventory through the shared parser", async () => {
  const snapshot = JSON.parse(gunzipSync(Buffer.from(process.env.VINPOKER_DEALER_INVENTORY_GZIP!, "base64")).toString("utf8"));
  inventoryRows = snapshot.inventory;
  rows = snapshot.rows;
  const result = await loadDealerControlReadModel(client, "club");
  expect(result.tables).toHaveLength(rows.game_tables.length);
  expect(result.tables.length).toBeGreaterThan(0);
  expect(result.tables.filter((table) => table.status === "in_use")).toHaveLength(
    (inventoryRows as { availability_status: string }[]).filter((table) => table.availability_status === "in_use").length,
  );
  expect(result.tables.every((table) => inventoryRows.some((row) =>
    (row as { game_table_id: string }).game_table_id === table.id))).toBe(true);
});
