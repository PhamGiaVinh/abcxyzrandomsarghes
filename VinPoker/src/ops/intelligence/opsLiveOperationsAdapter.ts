import type { SupabaseClient } from "@supabase/supabase-js";
import { derivePreAssignStatus, type AssignmentShadowLike } from "@/lib/dealerSwingState";
import {createFloorTableControlV3Client} from '@/lib/floorTableControlV3';
import type { Database } from "@/integrations/supabase/types";
import type { OpsLiveOperationInputV1, OpsOperationRowV1, OpsSourceAvailabilityV1 } from "./opsIntelligenceReadModel";

type OpsClient = SupabaseClient<Database>;

type TableRow = {
  id: string;
  table_name: string;
  status: string;
  current_blind_level: number | null;
};

type TournamentTableLink = { id?: string; table_id: string | null; game_table_id?: string | null; table_session_id?: string | null; status: string };
type TournamentRow = {
  id: string;
  name: string;
  status: string;
  current_level: number | null;
  average_stack: number | null;
  tournament_tables: TournamentTableLink[] | null;
};

type AssignmentRow = AssignmentShadowLike & {
  id: string;
  table_id: string;
  table_session_id: string | null;
  attendance_id: string;
  status: string;
  pre_assigned_attendance_id: string | null;
  pre_assigned_at: string | null;
  swing_in_progress: boolean | null;
  last_swing_attempted_at: string | null;
  swing_due_at: string | null;
  dealer_attendance: {
    current_state: string | null;
    dealers: { full_name: string | null } | null;
  } | null;
};

type AttendanceRow = {
  id: string;
  dealer_id: string;
  check_in_time: string | null;
};

type QueryOutcome<T> = { readonly data: readonly T[]; readonly error: string | null };

export async function loadOpsLiveOperations(
  client: OpsClient,
  clubId: string,
  options: { readonly q0CapacityTruth?: boolean } = {},
): Promise<OpsLiveOperationInputV1> {
  const inventoryReader=createFloorTableControlV3Client(
    async()=>await client.rpc('get_club_table_inventory',{p_club_id:clubId}),{enabled:true});
  const [tablesResult, tournamentsResult, assignmentsResult, attendanceResult, inventoryResult] = await Promise.all([
    client.from("game_tables")
      .select("id,table_name,status,current_blind_level")
      .eq("club_id", clubId)
      .order("table_name"),
    client.from("tournaments")
      .select("id,name,status,current_level,average_stack,tournament_tables(id,table_id,game_table_id,table_session_id,status)")
      .eq("club_id", clubId)
      .in("status", ["drawing", "live", "break", "final_table"]),
    client.from("dealer_assignments")
      .select("id,attendance_id,table_id,table_session_id,assigned_at,released_at,status,version,updated_at,last_swing_attempted_at,swing_in_progress,swing_processed_at,swing_due_at,pre_assigned_attendance_id,pre_assigned_at,dealer_attendance!attendance_id(current_state,dealers(full_name))")
      .eq("club_id", clubId)
      .eq("status", "assigned")
      .order("assigned_at", { ascending: true }),
    client.from("dealer_attendance")
      .select("id,dealer_id,check_in_time,dealers!inner(club_id,deleted_at)")
      .eq("status", "checked_in")
      .eq("dealers.club_id", clubId)
      .is("dealers.deleted_at", null)
      .order("check_in_time", { ascending: true }),
    inventoryReader.getClubTableInventory(clubId),
  ]);
  const observedAt = new Date().toISOString();
  const tables = normalize<TableRow>(tablesResult);
  const tournaments = normalize<TournamentRow>(tournamentsResult);
  const assignments = normalize<AssignmentRow>(assignmentsResult);
  const attendance = normalize<AttendanceRow>(attendanceResult);

  if (tables.error) return Object.freeze({
    observedAt,
    asOf: null,
    availability: "unavailable",
    reasonCode: "OPS_LIVE_TABLES_READ_FAILED",
    rows: Object.freeze([]),
    runningTournamentIds: Object.freeze([]),
    openTableCount: null,
    configuredTableCount: null,
    operationalTableCount: null,
    dealersOnDutyCount: null,
    countComparisonEligible: false,
  });

  const inventoryByTable=new Map((inventoryResult.ok ? inventoryResult.data : []).map(item=>[item.gameTableId,item]));
  const configuredIds=new Set(tables.data.map(table=>table.id));
  let unverifiedLinks=false;
  const currentTournaments=tournaments.data.map(tournament=>({...tournament,
    tournament_tables:(tournament.tournament_tables??[]).filter(link=>{
      if(link.status!=='active')return false;
      const id=physicalTableId(link),item=id ? inventoryByTable.get(id) : null;
      if(!id || !configuredIds.has(id) || !item || item.availabilityStatus!=='in_use'
        || item.sessionType!=='tournament' || item.tournamentId!==tournament.id
        || !link.id || item.tournamentTableId!==link.id || !link.table_session_id
        || item.tableSessionId!==link.table_session_id){unverifiedLinks=true;return false;}
      return true;
    }),
  }));
  const inventoryUnverified=!inventoryResult.ok || tables.data.some(table=>{
    const item=inventoryByTable.get(table.id);
    return !item || item.availabilityStatus==='repair_required' || item.availabilityStatus==='preflight_required';
  });
  const assignmentByTable=new Map<string,AssignmentRow>();
  const groups=new Map<string,AssignmentRow[]>();
  for(const assignment of assignments.data){
    const group=groups.get(assignment.table_id)??[];group.push(assignment);groups.set(assignment.table_id,group);
  }
  let assignmentUnverified=false;
  for(const [tableId,group] of groups){
    const item=inventoryByTable.get(tableId),assignment=group[0];
    if(group.length!==1 || assignment.status!=='assigned' || assignment.released_at
      || !item || item.availabilityStatus!=='in_use' || !item.tableSessionId
      || assignment.table_session_id!==item.tableSessionId || assignment.id!==item.activeDealerAssignmentId){
      assignmentUnverified=true;continue;
    }
    assignmentByTable.set(tableId,assignment);
  }
  if(tables.data.some(table=>inventoryByTable.get(table.id)?.activeDealerAssignmentId && !assignmentByTable.has(table.id)))
    assignmentUnverified=true;
  const availability: OpsSourceAvailabilityV1 = tournaments.error || assignments.error || attendance.error
    || unverifiedLinks || inventoryUnverified || assignmentUnverified ? "partial" : "exact";
  const asOf = maxTimestamp([
    ...tournaments.data.map((item) => (item as unknown as { updated_at?: string | null }).updated_at ?? null),
    ...assignments.data.map((item) => item.updated_at ?? null),
  ]);
  const tournamentByTable = mapTournamentsByTable(currentTournaments);
  const capacity = deriveOpsTableCapacityQ0(tables.data.map((table) => table.id), currentTournaments);
  const activeTournamentTableIds = new Set(capacity.activeTableIds);
  const rowTables = options.q0CapacityTruth
    ? tables.data.filter((table) => activeTournamentTableIds.has(table.id))
    : tables.data;
  const rows = rowTables.map((table) => toOperationRow(
    table,
    tournamentByTable.get(table.id) ?? null,
    assignments.error ? null : assignmentByTable.get(table.id) ?? null,
    availability,
    Date.parse(observedAt),
  ));
  const openTableCount=inventoryUnverified ? null : options.q0CapacityTruth
    ? tournaments.error || unverifiedLinks ? null : activeTournamentTableIds.size
    : tables.data.filter(table=>{
      const item=inventoryByTable.get(table.id);
      return item?.availabilityStatus==='in_use' && Boolean(item.tableSessionId);
    }).length;

  return Object.freeze({
    observedAt,
    asOf,
    availability,
    reasonCode: availability === "exact" ? null : tournaments.error || assignments.error || attendance.error
      ? firstErrorCode({ tournaments, assignments, attendance }) : unverifiedLinks ? "OPS_LIVE_TABLE_IDENTITY_UNVERIFIED"
        : inventoryUnverified ? "OPS_LIVE_INVENTORY_UNVERIFIED" : "OPS_LIVE_ASSIGNMENT_SESSION_UNVERIFIED",
    rows: Object.freeze(rows),
    runningTournamentIds: Object.freeze(tournaments.data.map((tournament) => tournament.id).sort()),
    openTableCount,
    configuredTableCount: capacity.configuredTableCount,
    operationalTableCount: openTableCount,
    dealersOnDutyCount: attendance.error ? null : dedupeCheckedInAttendance(attendance.data).length,
    countComparisonEligible: Boolean(options.q0CapacityTruth) && !tournaments.error && !unverifiedLinks && !inventoryUnverified,
  });
}

export function deriveOpsTableCapacityQ0(
  configuredTableIds: readonly string[],
  tournaments: readonly Pick<TournamentRow, "tournament_tables">[],
): { readonly configuredTableCount: number; readonly operationalTableCount: number; readonly activeTableIds: readonly string[] } {
  const configured = new Set(configuredTableIds);
  const active = new Set<string>();
  for (const tournament of tournaments) {
    for (const link of tournament.tournament_tables ?? []) {
      const physicalId=physicalTableId(link);
      if (link.status === "active" && physicalId && configured.has(physicalId)) active.add(physicalId);
    }
  }
  return Object.freeze({ configuredTableCount: configured.size, operationalTableCount: active.size, activeTableIds: Object.freeze([...active].sort()) });
}

function normalize<T>(result: { data: unknown; error: { message?: string } | null }): QueryOutcome<T> {
  return Object.freeze({
    data: Object.freeze(Array.isArray(result.data) ? result.data as T[] : []),
    error: result.error?.message ?? (Array.isArray(result.data) ? null : "OPS_LIVE_MALFORMED_ARRAY"),
  });
}

// Metadata linkage only, never session or assignment authority. Match Dealer's
// dual-ID conflict rule instead of silently picking either physical table.
function physicalTableId(link: TournamentTableLink): string | null {
  if (link.game_table_id && link.table_id && link.game_table_id!==link.table_id) return null;
  return link.game_table_id || link.table_id || null;
}

function mapTournamentsByTable(tournaments: readonly TournamentRow[]): ReadonlyMap<string, TournamentRow> {
  const result = new Map<string, TournamentRow>();
  for (const tournament of tournaments) {
    for (const item of tournament.tournament_tables ?? []) {
      const physicalId=physicalTableId(item);
      if (item.status === "active" && physicalId) result.set(physicalId, tournament);
    }
  }
  return result;
}

function toOperationRow(
  table: TableRow,
  tournament: TournamentRow | null,
  assignment: AssignmentRow | null,
  availability: OpsSourceAvailabilityV1,
  nowMs: number,
): OpsOperationRowV1 {
  const dealerAssignmentState = deriveDealerAssignmentState(assignment, nowMs);
  return Object.freeze({
    tableId: table.id,
    tableName: table.table_name,
    tableStatus: table.status,
    tournamentId: tournament?.id ?? null,
    tournamentName: tournament?.name ?? null,
    currentLevel: tournament?.current_level ?? null,
    averageStack: tournament?.average_stack ?? null,
    dealerName: assignment?.dealer_attendance?.dealers?.full_name ?? null,
    dealerAssignmentState,
    sourceAvailability: availability,
  });
}

/** Same due/pre-assignment semantics as Dealer Swing; no new Ops threshold. */
export function deriveDealerAssignmentState(
  assignment: Pick<AssignmentRow, "swing_due_at" | "pre_assigned_attendance_id" | "pre_assigned_at" | "swing_in_progress" | "updated_at" | "last_swing_attempted_at" | "released_at" | "swing_processed_at" | "status"> | null,
  nowMs: number,
): "assigned" | "missing" | "overdue" {
  if (!assignment) return "missing";
  const preAssignStatus = derivePreAssignStatus(assignment, nowMs);
  const dueAt = assignment.swing_due_at ? Date.parse(assignment.swing_due_at) : Number.NaN;
  return Number.isFinite(dueAt) && dueAt < nowMs && preAssignStatus !== "valid" && preAssignStatus !== "in_progress"
    ? "overdue"
    : "assigned";
}

function dedupeCheckedInAttendance(rows: readonly AttendanceRow[]): readonly AttendanceRow[] {
  const result = new Map<string, AttendanceRow>();
  for (const row of rows) {
    const existing = result.get(row.dealer_id);
    if (!existing || (row.check_in_time ?? "") > (existing.check_in_time ?? "")) result.set(row.dealer_id, row);
  }
  return Object.freeze([...result.values()]);
}

function maxTimestamp(values: readonly (string | null)[]): string | null {
  const valid = values.filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  if (!valid.length) return null;
  return valid.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}

function firstErrorCode(input: Record<string, QueryOutcome<unknown>>): string {
  const entry = Object.entries(input).find(([, result]) => result.error);
  return entry ? `OPS_LIVE_${entry[0].toUpperCase()}_READ_FAILED` : "OPS_LIVE_PARTIAL";
}
