import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFloorTableControlV3Client } from "@/lib/floorTableControlV3";

export type DealerControlTableRead = {
  id: string;
  name: string;
  tableType: string;
  status: string;
  dealerName: string | null;
  dealerTier: string | null;
  swingDueAt: string | null;
  needsReplacement: boolean;
};

export type DealerControlReadModel = {
  tables: DealerControlTableRead[];
  checkedIn: number;
  available: number;
  assigned: number;
  onBreak: number;
  loadedAt: string;
};

type OpsClient = SupabaseClient<Database>;

export async function loadDealerControlReadModel(
  client: OpsClient,
  clubId: string,
  signal?: AbortSignal,
): Promise<DealerControlReadModel> {
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  // Reuse the authenticated inventory projection; table_sessions remains private.
  // This read surface is already capability-gated, independently of Floor UI flags.
  const inventoryReader = createFloorTableControlV3Client(
    async () => {const query=client.rpc("get_club_table_inventory", { p_club_id: clubId });return await(signal?query.abortSignal(signal):query);},
    { enabled: true },
  );
  const tableQuery=client
      .from("game_tables")
      .select("id, table_name, table_type, status")
      .eq("club_id", clubId)
      .order("table_name", { ascending: true })
      .limit(200);
  const dealerQuery=client
      .from("dealers")
      .select("id, full_name, tier")
      .eq("club_id", clubId)
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
      .limit(500);
  const [tableResult, dealerResult, inventoryResult] = await Promise.all([
    signal?tableQuery.abortSignal(signal):tableQuery,
    signal?dealerQuery.abortSignal(signal):dealerQuery,
    inventoryReader.getClubTableInventory(clubId),
  ]);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if (tableResult.error||!Array.isArray(tableResult.data)) throw new Error("DEALER_TABLE_READ_FAILED");
  if (dealerResult.error||!Array.isArray(dealerResult.data)) throw new Error("DEALER_ROSTER_READ_FAILED");
  if (!inventoryResult.ok) throw new Error("DEALER_INVENTORY_READ_FAILED");
  const inventoryByTable = new Map(inventoryResult.data.map((table) => [table.gameTableId, table]));

  const tableIds = tableResult.data.map((row) => row.id);
  if (tableIds.some((id) => !inventoryByTable.has(id))) throw new Error("DEALER_INVENTORY_SCOPE_MISMATCH");
  const dealerIds = dealerResult.data.map((row) => row.id);
  const assignmentQuery=tableIds.length
      ? client
          .from("dealer_assignments")
          .select("id, table_id, table_session_id, dealer_id, swing_due_at, status, needs_replacement, assigned_at")
          .eq("club_id", clubId)
          .eq("status", "assigned")
          .in("table_id", tableIds)
          .order("assigned_at", { ascending: false }):null;
  const attendanceQuery=dealerIds.length
      ? client
          .from("dealer_attendance")
          .select("dealer_id, current_state, check_in_time")
          .eq("status", "checked_in")
          .in("dealer_id", dealerIds)
          .order("check_in_time", { ascending: false }):null;
  const [assignmentResult, attendanceResult] = await Promise.all([
    assignmentQuery?(signal?assignmentQuery.abortSignal(signal):assignmentQuery):Promise.resolve({data:[],error:null}),
    attendanceQuery?(signal?attendanceQuery.abortSignal(signal):attendanceQuery):Promise.resolve({data:[],error:null}),
  ]);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if (assignmentResult.error||!Array.isArray(assignmentResult.data)) throw new Error("DEALER_ASSIGNMENT_READ_FAILED");
  if (attendanceResult.error||!Array.isArray(attendanceResult.data)) throw new Error("DEALER_ATTENDANCE_READ_FAILED");

  const dealerById = new Map(dealerResult.data.map((dealer) => [dealer.id, dealer]));
  const assignmentByTable = new Map<string, (typeof assignmentResult.data)[number]>();
  for (const assignment of assignmentResult.data) {
    const table = inventoryByTable.get(assignment.table_id);
    if (table?.availabilityStatus === "repair_required" || table?.availabilityStatus === "preflight_required") continue;
    if (!table || !table.tableSessionId || table.tableSessionId !== assignment.table_session_id
      || table.activeDealerAssignmentId !== assignment.id || assignmentByTable.has(assignment.table_id)) {
      throw new Error("DEALER_ASSIGNMENT_SESSION_MISMATCH");
    }
    assignmentByTable.set(assignment.table_id, assignment);
  }
  const latestAttendanceByDealer = new Map<string, string | null>();
  for (const attendance of attendanceResult.data) {
    if (!latestAttendanceByDealer.has(attendance.dealer_id)) {
      latestAttendanceByDealer.set(attendance.dealer_id, attendance.current_state);
    }
  }
  const states = [...latestAttendanceByDealer.values()];

  return {
    tables: tableResult.data.map((table) => {
      const inventory = inventoryByTable.get(table.id);
      if (!inventory) throw new Error("DEALER_INVENTORY_SCOPE_MISMATCH");
      const assignment = assignmentByTable.get(table.id);
      const dealer = assignment?.dealer_id ? dealerById.get(assignment.dealer_id) : null;
      return {
        id: table.id,
        name: table.table_name,
        tableType: table.table_type,
        status: inventory.availabilityStatus,
        dealerName: dealer?.full_name ?? null,
        dealerTier: dealer?.tier ?? null,
        swingDueAt: assignment?.swing_due_at ?? null,
        needsReplacement: assignment?.needs_replacement ?? false,
      };
    }),
    checkedIn: states.length,
    available: states.filter((state) => state === "available").length,
    assigned: states.filter((state) => state === "assigned" || state === "pre_assigned").length,
    onBreak: states.filter((state) => state === "on_break").length,
    loadedAt: new Date().toISOString(),
  };
}
