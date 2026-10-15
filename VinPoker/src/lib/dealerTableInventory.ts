import type { FloorTableInventoryItem } from "@/lib/floorTableControlV3";
import type { TournamentWithTables } from "@/types/tournament";

/** Resolve config only for one unambiguous current table/session relation. */
export function findDealerTableTournament(
  table: { id: string; club_id?: string; tournament_id?: string | null; table_session_id?: string | null; availability_status?: string },
  assignmentSession: string | null | undefined,
  tournaments: readonly TournamentWithTables[] | undefined,
): TournamentWithTables | undefined {
  if (table.availability_status === "repair_required") return undefined;
  if (table.table_session_id && assignmentSession && table.table_session_id !== assignmentSession) return undefined;
  const session = table.table_session_id ?? assignmentSession;
  const matches = (tournaments ?? []).flatMap((tour) => {
    if (table.club_id && tour.club_id !== table.club_id) return [];
    if (table.tournament_id && tour.id !== table.tournament_id) return [];
    return tour.tournament_tables.filter((link) => {
      if (link.game_table_id && link.table_id && link.game_table_id !== link.table_id) return false;
      if ((link.game_table_id ?? link.table_id) !== table.id) return false;
      if (link.status != null && link.status !== "active") return false;
      if (session) return link.status === "active" && link.table_session_id === session;
      // Legacy metadata has no session authority: never adopt a canonical session.
      return !link.game_table_id && !link.table_session_id;
    }).map(() => tour);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export type DealerOperationalTable = {
  id: string;
  club_id: string;
  shift_id: string | null;
  status: "active" | "inactive" | "maintenance" | "disabled" | "retired";
  table_name: string;
  opened_at: string | null;
  dealer_open_operation_id: string | null;
  table_type: "tournament" | "cash" | "vip" | null;
  table_number: number | null;
  availability_status: FloorTableInventoryItem["availabilityStatus"];
  table_session_id: string | null;
  tournament_id: string | null;
  tournament_table_id: string | null;
  control_mode: "manual" | "tracker" | null;
  control_epoch: number | null;
  revision: number | null;
};

/**
 * Dealer Swing projects the same physical-table inventory used by Floor.
 * `status=active` means an active table session exists; it is not inferred from
 * a dealer assignment or the legacy game_tables.status marker.
 */
export function projectDealerOperationalTable(
  clubId: string,
  item: FloorTableInventoryItem,
): DealerOperationalTable {
  const inactiveStatus = item.operationalStatus === "maintenance"
    ? "maintenance"
    : item.operationalStatus === "disabled"
      ? "disabled"
      : item.operationalStatus === "retired"
        ? "retired"
        : "inactive";

  return {
    id: item.gameTableId,
    club_id: clubId,
    shift_id: null,
    status: item.availabilityStatus === "in_use" ? "active" : inactiveStatus,
    table_name: item.tableName?.trim() || (item.tableNumber == null ? "Bàn chưa chuẩn hóa" : `Bàn ${item.tableNumber}`),
    opened_at: null,
    dealer_open_operation_id: null,
    table_type: item.sessionType,
    table_number: item.tableNumber,
    availability_status: item.availabilityStatus,
    table_session_id: item.tableSessionId,
    tournament_id: item.tournamentId,
    tournament_table_id: item.tournamentTableId,
    control_mode: item.controlMode,
    control_epoch: item.controlEpoch,
    revision: item.revision,
  };
}

export function isDealerTableAvailable(table: { availability_status?: string | null; status: string }): boolean {
  return table.availability_status === "available" && table.status === "inactive";
}

export function isTournamentStructureBreak(tournament: {
  status?: string | null;
  current_level?: number | null;
  tournament_levels?: ReadonlyArray<{ level_number: number; is_break: boolean }>;
} | null | undefined): boolean {
  if (!tournament) return false;
  if (tournament.status === "break") return true;
  if (tournament.current_level == null) return false;
  return tournament.tournament_levels?.some(
    (level) => level.level_number === tournament.current_level && level.is_break,
  ) ?? false;
}
