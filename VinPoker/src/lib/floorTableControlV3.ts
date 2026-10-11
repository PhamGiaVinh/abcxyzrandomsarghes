import { FEATURES } from "@/lib/featureFlags";

/**
 * Browser contract for Floor Table Control V3.
 *
 * The database contract is deliberately newer than generated Supabase types,
 * so this module is the only place allowed to cross that temporary boundary.
 * It has a fixed RPC allow-list, validates every response, and refuses every
 * call while the V3 source flag is OFF.  It must never be used as a generic
 * `rpc(name, args)` escape hatch.
 */
export type FloorTableControlV3RpcName =
  | "get_club_table_inventory"
  | "get_floor_tournament_table_inventory_v1"
  | "get_floor_seatable_entries"
  | "get_floor_tournament_table_roster_v3"
  | "get_floor_tournament_table_roster_v4"
  | "get_floor_tournament_table_roster_v5"
  | "get_floor_tournament_table_roster_v6"
  | "get_floor_restorable_entries_v3"
  | "validate_tracker_table_writer_context_v3"
  | "floor_open_tournament_table_v3"
  | "operator_open_club_tables_v2"
  | "operator_close_club_table_v2"
  | "floor_assign_entry_to_seat"
  | "floor_assign_entry_to_seat_v4"
  | "floor_set_table_seat_lock_v1"
  | "floor_set_table_control_mode_v3"
  | "floor_request_table_control_mode_v4"
  | "floor_get_table_control_mode_request_v1"
  | "floor_cancel_table_control_mode_request_v1"
  | "move_player_seat_v2"
  | "move_player_seat_v3"
  | "move_player_seat_v4"
  | "move_player_seat_v5"
  | "close_tournament_table_v3"
  | "close_tournament_table_v4"
  | "floor_break_table_v3"
  | "floor_break_table_v4"
  | "floor_break_table_v5"
  | "floor_plan_break_table_v1"
  | "floor_bust_player_v3"
  | "floor_free_sit_player_v1"
  | "floor_restore_busted_player_to_seat_v3"
  | "floor_restore_busted_player_to_seat_v4"
  | "floor_restore_busted_player_to_seat_v5"
  | "get_floor_restore_receipt_v1"
  | "cancel_floor_restore_request_v1"
  | "floor_plan_tournament_redraw_v1"
  | "floor_apply_tournament_redraw_v1"
  | "floor_continue_tournament_redraw_v1"
  | "get_public_tournament_redraw_v1"
  | "get_floor_pending_tracker_moves_v1"
  | "floor_queue_tracker_move_v1"
  | "floor_cancel_pending_tracker_move_v1";

export type FloorTableControlV3Rpc = (
  name: FloorTableControlV3RpcName,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown | null }>;

export type FloorTableControlV3Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type FloorTableInventoryAvailability =
  | "available"
  | "in_use"
  | "repair_required"
  | "maintenance"
  | "disabled"
  | "retired"
  | "preflight_required";

export type FloorTableInventoryItem = {
  gameTableId: string;
  tableNumber: number | null;
  tableName: string | null;
  operationalStatus: "available" | "maintenance" | "disabled" | "retired" | null;
  availabilityStatus: FloorTableInventoryAvailability;
  tableSessionId: string | null;
  sessionType: "tournament" | "cash" | "vip" | null;
  controlMode: "manual" | "tracker" | null;
  controlEpoch: number | null;
  revision: number | null;
  tournamentId: string | null;
  tournamentTableId: string | null;
  tournamentTableStatus: string | null;
  activeDealerAssignmentId: string | null;
};

export type FloorTournamentInventoryItem = {
  gameTableId: string;
  tableNumber: number | null;
  tableName: string | null;
  operationalStatus: "available" | "maintenance" | "disabled" | "retired" | null;
  availabilityStatus: "available" | "current_tournament" | "repair_required" | "maintenance" | "disabled" | "retired" | "preflight_required";
  tableSessionId: string | null;
  controlMode: "manual" | "tracker" | null;
  controlEpoch: number | null;
  revision: number | null;
  tournamentTableId: string | null;
  maxSeats: 8 | 9 | null;
};

export type FloorSeatableEntry = {
  entryId: string;
  playerId: string;
  entryNo: number;
  displayName: string;
  currentStack: number;
  registrationId: string | null;
};

/**
 * Canonical active-session roster.  This type deliberately has no legacy
 * `table_id`: the browser only receives all three explicit V3 identities.
 */
export type FloorTableRosterSeat = {
  seatNumber: number;
  entryId: string | null;
  playerId: string;
  displayName: string;
  entryNo: number | null;
  chipCount: number;
  isActive: true;
  integrityStatus: "valid" | "missing_entry" | "invalid_participation";
};

export type FloorBreakPlanMove = {
  entryId: string;
  playerName: string;
  sourceSeatNumber: number;
  destinationTournamentTableId: string;
  destinationTableNumber: number;
  destinationSeatNumber: number;
  transferMode: "immediate" | "after_current_hand";
};

export type FloorBreakPlan = {
  planHash: string;
  complete: boolean;
  sourceTournamentTableId: string;
  sourceTableNumber: number;
  expectedRevision: number;
  moves: FloorBreakPlanMove[];
  blockers: { playerName: string; sourceSeatNumber: number; reason: "missing_entry" | "no_destination" }[];
};

export type FloorSeatLock = {
  seatNumber: number;
  reason: string;
  lockedAt: string;
  lockedBy: string;
};

export type FloorTournamentTableRoster = {
  tournamentId: string;
  tournamentTableId: string;
  gameTableId: string;
  tableNumber: number;
  tableName: string;
  tableSessionId: string;
  sessionRevision: number;
  controlMode: "manual" | "tracker";
  controlEpoch: number;
  maxSeats: 8 | 9;
  tournamentTableStatus: "active";
  sessionClosedAt: null;
  activeDealerAssignmentId: string | null;
  seatLocks: FloorSeatLock[];
  seats: FloorTableRosterSeat[];
};

export type FloorRedrawMove = {
  entryId: string;
  playerName: string;
  fromTableNumber: number;
  fromSeatNumber: number;
  toTableNumber: number;
  toSeatNumber: number;
};

export type FloorRedrawPlan = {
  batchId: string;
  status: "planned" | "applied";
  targetMaxSeats: 8 | 9;
  targetTableCount: number | null;
  playerCount: number | null;
  movedCount: number | null;
  moves: FloorRedrawMove[];
};

export type FloorActiveRedraw = {
  batchId: string;
  redrawRevision: number;
};

export type FloorRestorableEntry = {
  entryId: string;
  playerId: string;
  entryNo: number;
  displayName: string;
  currentStack: number;
};

export type FloorPendingTrackerMove = {
  pendingMoveId: string;
  entryId: string;
  sourceTournamentTableId: string;
  destinationTournamentTableId: string;
  destinationSeatNumber: number;
  status: "pending" | "stale";
  resolutionReason: string | null;
  requestedAt: string;
};

export type FloorExactMoveIntent = {
  entryId: string;
  fromTournamentTableId: string;
  fromTableSessionId: string;
  toTournamentTableId: string;
  toTableSessionId: string;
  toSeatNumber: number;
  expectedSourceRevision: number;
  expectedDestinationRevision: number;
  expectedSourceEpoch: number;
  expectedDestinationEpoch: number;
  reason: string;
  requestId: string;
};

type JsonRecord = Record<string, unknown>;
type MutationResult = JsonRecord & { ok: boolean; error?: string };

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown): string | null | undefined {
  return value == null ? null : typeof value === "string" ? value : undefined;
}

function nullableInteger(value: unknown): number | null | undefined {
  return value == null
    ? null
    : typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : undefined;
}

function errorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return "V3_RPC_FAILED";
}

function parseInventoryItem(value: unknown): FloorTableControlV3Result<FloorTableInventoryItem> {
  if (!isRecord(value)) return { ok: false, error: "V3_INVENTORY_ROW_MALFORMED" };

  const gameTableId = value.game_table_id;
  const tableNumber = nullableInteger(value.table_number);
  const tableName = nullableString(value.table_name);
  const operationalStatus = nullableString(value.operational_status);
  const availabilityStatus = value.availability_status;
  const tableSessionId = nullableString(value.table_session_id);
  const sessionType = nullableString(value.session_type);
  const controlMode = nullableString(value.control_mode);
  const controlEpoch = nullableInteger(value.control_epoch);
  const revision = nullableInteger(value.revision);
  const tournamentId = nullableString(value.tournament_id);
  const tournamentTableId = nullableString(value.tournament_table_id);
  const tournamentTableStatus = nullableString(value.tournament_table_status);
  const activeDealerAssignmentId = nullableString(value.active_dealer_assignment_id);

  if (
    typeof gameTableId !== "string"
    || !gameTableId
    || tableNumber === undefined
    || (tableNumber !== null && (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 100))
    || tableName === undefined
    || ![null, "available", "maintenance", "disabled", "retired"].includes(operationalStatus)
    || typeof availabilityStatus !== "string"
    || !["available", "in_use", "repair_required", "maintenance", "disabled", "retired", "preflight_required"].includes(availabilityStatus)
    || tableSessionId === undefined
    || ![null, "tournament", "cash", "vip"].includes(sessionType)
    || ![null, "manual", "tracker"].includes(controlMode)
    || controlEpoch === undefined
    || revision === undefined
    || tournamentId === undefined
    || tournamentTableId === undefined
    || tournamentTableStatus === undefined
    || activeDealerAssignmentId === undefined
  ) {
    return { ok: false, error: "V3_INVENTORY_ROW_MALFORMED" };
  }

  if (
    (availabilityStatus === "in_use" && (!tableSessionId || !sessionType || controlEpoch == null || revision == null))
    || (availabilityStatus !== "repair_required" && sessionType === "tournament" && (!tournamentId || !tournamentTableId))
    || (tableNumber === null && (operationalStatus === "available" || availabilityStatus !== (operationalStatus ?? "preflight_required") || !tableName?.trim()
      || tableSessionId || tournamentTableId || sessionType || controlMode || controlEpoch != null || revision != null
      || tournamentId || tournamentTableStatus || activeDealerAssignmentId))
  ) {
    return { ok: false, error: "V3_INVENTORY_ROW_INCONSISTENT" };
  }

  return {
    ok: true,
    data: {
      gameTableId,
      tableNumber,
      tableName,
      operationalStatus: operationalStatus as FloorTableInventoryItem["operationalStatus"],
      availabilityStatus: availabilityStatus as FloorTableInventoryAvailability,
      tableSessionId,
      sessionType: sessionType as FloorTableInventoryItem["sessionType"],
      controlMode: controlMode as FloorTableInventoryItem["controlMode"],
      controlEpoch,
      revision,
      tournamentId,
      tournamentTableId,
      tournamentTableStatus,
      activeDealerAssignmentId,
    },
  };
}

function parseTournamentInventoryItem(value: unknown): FloorTableControlV3Result<FloorTournamentInventoryItem> {
  if (!isRecord(value)) return { ok: false, error: "V3_TOURNAMENT_INVENTORY_ROW_MALFORMED" };
  const gameTableId = value.game_table_id;
  const tableNumber = nullableInteger(value.table_number);
  const tableName = nullableString(value.table_name);
  const operationalStatus = nullableString(value.operational_status);
  const availabilityStatus = value.availability_status;
  const tableSessionId = nullableString(value.table_session_id);
  const controlMode = nullableString(value.control_mode);
  const controlEpoch = nullableInteger(value.control_epoch);
  const revision = nullableInteger(value.revision);
  const tournamentTableId = nullableString(value.tournament_table_id);
  const maxSeats = nullableInteger(value.max_seats);
  if (
    typeof gameTableId !== "string" || !gameTableId
    || tableNumber === undefined
    || (tableNumber !== null && (!Number.isSafeInteger(tableNumber) || tableNumber < 1 || tableNumber > 100))
    || tableName === undefined
    || ![null, "available", "maintenance", "disabled", "retired"].includes(operationalStatus)
    || typeof availabilityStatus !== "string"
    || !["available", "current_tournament", "repair_required", "maintenance", "disabled", "retired", "preflight_required"].includes(availabilityStatus)
    || tableSessionId === undefined
    || ![null, "manual", "tracker"].includes(controlMode)
    || controlEpoch === undefined
    || revision === undefined
    || tournamentTableId === undefined
    || maxSeats === undefined
    || (maxSeats != null && maxSeats !== 8 && maxSeats !== 9)
  ) {
    return { ok: false, error: "V3_TOURNAMENT_INVENTORY_ROW_MALFORMED" };
  }
  if (
    availabilityStatus === "current_tournament"
    && (!tableSessionId || !tournamentTableId || !controlMode || controlEpoch == null || revision == null || maxSeats == null)
  ) {
    return { ok: false, error: "V3_TOURNAMENT_INVENTORY_ROW_INCONSISTENT" };
  }
  if (tableNumber === null && (operationalStatus === "available" || availabilityStatus !== (operationalStatus ?? "preflight_required") || !tableName?.trim()
    || tableSessionId || tournamentTableId || controlMode || controlEpoch != null || revision != null || maxSeats != null)) {
    return { ok: false, error: "V3_TOURNAMENT_INVENTORY_ROW_INCONSISTENT" };
  }
  return {
    ok: true,
    data: {
      gameTableId,
      tableNumber,
      tableName,
      operationalStatus: operationalStatus as FloorTournamentInventoryItem["operationalStatus"],
      availabilityStatus: availabilityStatus as FloorTournamentInventoryItem["availabilityStatus"],
      tableSessionId,
      controlMode: controlMode as FloorTournamentInventoryItem["controlMode"],
      controlEpoch,
      revision,
      tournamentTableId,
      maxSeats: maxSeats as 8 | 9 | null,
    },
  };
}

function parseSeatableEntry(value: unknown): FloorTableControlV3Result<FloorSeatableEntry> {
  if (!isRecord(value)) return { ok: false, error: "V3_SEATABLE_ENTRY_MALFORMED" };
  const entryId = value.entry_id;
  const playerId = value.player_id;
  const entryNo = value.entry_no;
  const displayName = value.display_name;
  const currentStack = value.current_stack;
  const registrationId = value.registration_id;
  if (
    typeof entryId !== "string" || !entryId
    || typeof playerId !== "string" || !playerId
    || typeof entryNo !== "number" || !Number.isSafeInteger(entryNo)
    || typeof displayName !== "string" || !displayName.trim()
    || typeof currentStack !== "number" || !Number.isSafeInteger(currentStack)
    || (registrationId !== null && (typeof registrationId !== "string" || !registrationId))
  ) {
    return { ok: false, error: "V3_SEATABLE_ENTRY_MALFORMED" };
  }
  const validatedRegistrationId = typeof registrationId === "string" ? registrationId : null;
  return { ok: true, data: { entryId, playerId, entryNo, displayName, currentStack, registrationId: validatedRegistrationId } };
}

function parseRosterSeat(value: unknown, requireIntegrityStatus: boolean): FloorTableControlV3Result<FloorTableRosterSeat> {
  if (!isRecord(value)) return { ok: false, error: "V3_ROSTER_SEAT_MALFORMED" };
  const seatNumber = value.seat_number;
  const entryId = value.entry_id;
  const playerId = value.player_id;
  const displayName = value.display_name;
  const entryNo = value.entry_no;
  const chipCount = value.chip_count;
  const isActive = value.is_active;
  const integrityStatus = value.integrity_status ?? (!requireIntegrityStatus ? "valid" : undefined);
  if (
    typeof seatNumber !== "number" || !Number.isSafeInteger(seatNumber) || seatNumber < 1 || seatNumber > 9
    || (entryId !== null && (typeof entryId !== "string" || !entryId))
    || typeof playerId !== "string" || !playerId
    || typeof displayName !== "string" || !displayName.trim()
    || (entryNo !== null && (typeof entryNo !== "number" || !Number.isSafeInteger(entryNo)))
    || typeof chipCount !== "number" || !Number.isSafeInteger(chipCount) || chipCount < 0
    || isActive !== true
    || (integrityStatus !== "valid" && integrityStatus !== "missing_entry" && integrityStatus !== "invalid_participation")
    || (integrityStatus === "valid" && (entryId === null || entryNo === null))
    || (integrityStatus === "missing_entry" && (entryId !== null || entryNo !== null))
  ) {
    return { ok: false, error: "V3_ROSTER_SEAT_MALFORMED" };
  }
  return {
    ok: true,
    data: {
      seatNumber: seatNumber as number,
      entryId: entryId as string | null,
      playerId: playerId as string,
      displayName: displayName as string,
      entryNo: entryNo as number | null,
      chipCount: chipCount as number,
      isActive: true,
      integrityStatus: integrityStatus as FloorTableRosterSeat["integrityStatus"],
    },
  };
}

function parseSeatLock(value: unknown): FloorTableControlV3Result<FloorSeatLock> {
  if (!isRecord(value)) return { ok: false, error: "V3_SEAT_LOCK_MALFORMED" };
  const seatNumber = value.seat_number;
  const reason = value.reason;
  const lockedAt = value.locked_at;
  const lockedBy = value.locked_by;
  if (
    typeof seatNumber !== "number" || !Number.isSafeInteger(seatNumber) || seatNumber < 1 || seatNumber > 9
    || typeof reason !== "string" || !reason.trim()
    || typeof lockedAt !== "string" || !lockedAt
    || typeof lockedBy !== "string" || !lockedBy
  ) return { ok: false, error: "V3_SEAT_LOCK_MALFORMED" };
  return { ok: true, data: { seatNumber, reason, lockedAt, lockedBy } };
}

function parseRoster(value: unknown, v4 = false, requireIntegrityStatus = false): FloorTableControlV3Result<FloorTournamentTableRoster> {
  if (!isRecord(value)) return { ok: false, error: "V3_ROSTER_ROW_MALFORMED" };
  const tournamentId = value.tournament_id;
  const tournamentTableId = value.tournament_table_id;
  const gameTableId = value.game_table_id;
  const tableNumber = value.table_number;
  const tableName = value.table_name;
  const tableSessionId = value.table_session_id;
  const sessionRevision = value.session_revision;
  const controlMode = value.control_mode;
  const controlEpoch = value.control_epoch;
  const maxSeats = v4 ? value.max_seats : 9;
  const tournamentTableStatus = value.tournament_table_status;
  const sessionClosedAt = nullableString(value.session_closed_at);
  const activeDealerAssignmentId = nullableString(value.active_dealer_assignment_id);
  const seatLocks = v4 ? value.seat_locks : [];
  const seats = value.seats;

  if (
    typeof tournamentId !== "string" || !tournamentId
    || typeof tournamentTableId !== "string" || !tournamentTableId
    || typeof gameTableId !== "string" || !gameTableId
    || typeof tableNumber !== "number" || !Number.isSafeInteger(tableNumber) || tableNumber < 1 || tableNumber > 100
    || typeof tableName !== "string" || !tableName.trim()
    || typeof tableSessionId !== "string" || !tableSessionId
    || typeof sessionRevision !== "number" || !Number.isSafeInteger(sessionRevision) || sessionRevision < 0
    || !["manual", "tracker"].includes(String(controlMode))
    || typeof controlEpoch !== "number" || !Number.isSafeInteger(controlEpoch) || controlEpoch < 1
    || (maxSeats !== 8 && maxSeats !== 9)
    || tournamentTableStatus !== "active"
    || sessionClosedAt !== null
    || activeDealerAssignmentId === undefined
    || !Array.isArray(seatLocks)
    || !Array.isArray(seats)
  ) {
    return { ok: false, error: "V3_ROSTER_ROW_MALFORMED" };
  }

  const parsedSeats: FloorTableRosterSeat[] = [];
  const seenSeatNumbers = new Set<number>();
  const seenEntries = new Set<string>();
  for (const value of seats) {
    const parsed = parseRosterSeat(value, requireIntegrityStatus);
    if (parsed.ok === false) return { ok: false, error: parsed.error };
    if (parsed.data.seatNumber > maxSeats) {
      return { ok: false, error: "V3_ROSTER_SEAT_OUTSIDE_TABLE_CAPACITY" };
    }
    if (seenSeatNumbers.has(parsed.data.seatNumber) || (parsed.data.entryId != null && seenEntries.has(parsed.data.entryId))) {
      return { ok: false, error: "V3_ROSTER_SEAT_DUPLICATE" };
    }
    seenSeatNumbers.add(parsed.data.seatNumber);
    if (parsed.data.entryId != null) seenEntries.add(parsed.data.entryId);
    parsedSeats.push(parsed.data);
  }
  if (parsedSeats.length > 9) return { ok: false, error: "V3_ROSTER_TOO_MANY_SEATS" };

  const parsedLocks: FloorSeatLock[] = [];
  const seenLocks = new Set<number>();
  for (const value of seatLocks) {
    const parsed = parseSeatLock(value);
    if (parsed.ok === false) return parsed;
    if (parsed.data.seatNumber > maxSeats || seenLocks.has(parsed.data.seatNumber) || seenSeatNumbers.has(parsed.data.seatNumber)) {
      return { ok: false, error: "V3_ROSTER_SEAT_LOCK_INCONSISTENT" };
    }
    seenLocks.add(parsed.data.seatNumber);
    parsedLocks.push(parsed.data);
  }

  return {
    ok: true,
    data: {
      tournamentId,
      tournamentTableId,
      gameTableId,
      tableNumber,
      tableName,
      tableSessionId,
      sessionRevision,
      controlMode: controlMode as "manual" | "tracker",
      controlEpoch,
      maxSeats,
      tournamentTableStatus: "active",
      sessionClosedAt: null,
      activeDealerAssignmentId,
      seatLocks: parsedLocks.sort((left, right) => left.seatNumber - right.seatNumber),
      seats: parsedSeats.sort((left, right) => left.seatNumber - right.seatNumber),
    },
  };
}

function parseRedrawMove(value: unknown): FloorTableControlV3Result<FloorRedrawMove> {
  if (!isRecord(value)) return { ok: false, error: "V3_REDRAW_MOVE_MALFORMED" };
  const entryId = value.entry_id;
  const playerName = value.player_name;
  const fromTableNumber = value.from_table_number;
  const fromSeatNumber = value.from_seat_number;
  const toTableNumber = value.to_table_number;
  const toSeatNumber = value.to_seat_number;
  if (
    typeof entryId !== "string" || !entryId
    || typeof playerName !== "string" || !playerName.trim()
    || typeof fromTableNumber !== "number" || !Number.isSafeInteger(fromTableNumber) || fromTableNumber < 1 || fromTableNumber > 100
    || typeof toTableNumber !== "number" || !Number.isSafeInteger(toTableNumber) || toTableNumber < 1 || toTableNumber > 100
    || typeof fromSeatNumber !== "number" || !Number.isSafeInteger(fromSeatNumber) || fromSeatNumber < 1 || fromSeatNumber > 9
    || typeof toSeatNumber !== "number" || !Number.isSafeInteger(toSeatNumber) || toSeatNumber < 1 || toSeatNumber > 9
  ) return { ok: false, error: "V3_REDRAW_MOVE_MALFORMED" };
  return { ok: true, data: { entryId, playerName, fromTableNumber, fromSeatNumber, toTableNumber, toSeatNumber } };
}

function parseRedrawPlan(value: unknown): FloorTableControlV3Result<FloorRedrawPlan> {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.moves)) {
    return { ok: false, error: "V3_REDRAW_RESPONSE_MALFORMED" };
  }
  const batchId = value.batch_id;
  const status = value.status;
  const targetMaxSeats = value.target_max_seats;
  const targetTableCount = nullableInteger(value.target_table_count);
  const playerCount = nullableInteger(value.player_count);
  const movedCount = nullableInteger(value.moved_count);
  if (
    typeof batchId !== "string" || !batchId
    || (status !== "planned" && status !== "applied")
    || (targetMaxSeats !== 8 && targetMaxSeats !== 9)
    || targetTableCount === undefined || playerCount === undefined || movedCount === undefined
  ) return { ok: false, error: "V3_REDRAW_RESPONSE_MALFORMED" };
  const moves: FloorRedrawMove[] = [];
  const entries = new Set<string>();
  const targets = new Set<string>();
  for (const row of value.moves) {
    const parsed = parseRedrawMove(row);
    if (parsed.ok === false) return parsed;
    const targetKey = `${parsed.data.toTableNumber}:${parsed.data.toSeatNumber}`;
    if (entries.has(parsed.data.entryId) || targets.has(targetKey)) {
      return { ok: false, error: "V3_REDRAW_MOVE_DUPLICATE" };
    }
    entries.add(parsed.data.entryId);
    targets.add(targetKey);
    moves.push(parsed.data);
  }
  return {
    ok: true,
    data: { batchId, status, targetMaxSeats, targetTableCount, playerCount, movedCount, moves },
  };
}

function parseRestorableEntry(value: unknown): FloorTableControlV3Result<FloorRestorableEntry> {
  if (!isRecord(value)) return { ok: false, error: "V3_RESTORABLE_ENTRY_MALFORMED" };
  const entryId = value.entry_id;
  const playerId = value.player_id;
  const entryNo = value.entry_no;
  const displayName = value.display_name;
  const currentStack = value.current_stack;
  if (
    typeof entryId !== "string" || !entryId
    || typeof playerId !== "string" || !playerId
    || typeof entryNo !== "number" || !Number.isSafeInteger(entryNo)
    || typeof displayName !== "string" || !displayName.trim()
    || typeof currentStack !== "number" || !Number.isSafeInteger(currentStack) || currentStack < 0
  ) {
    return { ok: false, error: "V3_RESTORABLE_ENTRY_MALFORMED" };
  }
  return { ok: true, data: { entryId, playerId, entryNo, displayName, currentStack } };
}

function parsePendingTrackerMove(value: unknown): FloorTableControlV3Result<FloorPendingTrackerMove> {
  if (!isRecord(value)) return { ok: false, error: "V3_PENDING_MOVE_MALFORMED" };
  const pendingMoveId = value.pending_move_id;
  const entryId = value.entry_id;
  const sourceTournamentTableId = value.source_tournament_table_id;
  const destinationTournamentTableId = value.destination_tournament_table_id;
  const destinationSeatNumber = value.destination_seat_number;
  const status = value.status;
  const resolutionReason = nullableString(value.resolution_reason);
  const requestedAt = value.requested_at;
  if (typeof pendingMoveId !== "string" || !pendingMoveId
    || typeof entryId !== "string" || !entryId
    || typeof sourceTournamentTableId !== "string" || !sourceTournamentTableId
    || typeof destinationTournamentTableId !== "string" || !destinationTournamentTableId
    || typeof destinationSeatNumber !== "number" || !Number.isSafeInteger(destinationSeatNumber)
    || destinationSeatNumber < 1 || destinationSeatNumber > 9
    || (status !== "pending" && status !== "stale")
    || resolutionReason === undefined
    || typeof requestedAt !== "string" || !requestedAt) {
    return { ok: false, error: "V3_PENDING_MOVE_MALFORMED" };
  }
  return { ok: true, data: {
    pendingMoveId, entryId, sourceTournamentTableId, destinationTournamentTableId,
    destinationSeatNumber, status, resolutionReason, requestedAt,
  } };
}

function parseMutation(value: unknown): FloorTableControlV3Result<MutationResult> {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return { ok: false, error: "V3_MUTATION_RESPONSE_MALFORMED" };
  }
  if (!value.ok) {
    return { ok: false, error: typeof value.error === "string" && value.error ? value.error : "V3_MUTATION_REJECTED" };
  }
  return { ok: true, data: value as MutationResult };
}

function mutationFromResponse(response: FloorTableControlV3Result<unknown>): FloorTableControlV3Result<MutationResult> {
  return response.ok === false
    ? { ok: false, error: response.error }
    : parseMutation(response.data);
}

function parseBreakPlan(value: unknown): FloorTableControlV3Result<FloorBreakPlan> {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.moves)) {
    return { ok: false, error: "V3_BREAK_PLAN_MALFORMED" };
  }
  const planHash = value.plan_hash;
  const sourceTournamentTableId = value.source_tournament_table_id;
  const sourceTableNumber = value.source_table_number;
  const expectedRevision = value.expected_revision;
  const complete = value.complete;
  if (typeof planHash !== "string" || !planHash
    || typeof sourceTournamentTableId !== "string" || !sourceTournamentTableId
    || typeof sourceTableNumber !== "number" || !Number.isSafeInteger(sourceTableNumber)
    || typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision)
    || typeof complete !== "boolean") {
    return { ok: false, error: "V3_BREAK_PLAN_MALFORMED" };
  }
  const moves: FloorBreakPlanMove[] = [];
  const blockers: FloorBreakPlan["blockers"] = [];
  for (const move of value.moves) {
    if (isRecord(move) && complete === false
      && typeof move.player_name === "string" && !!move.player_name.trim()
      && typeof move.source_seat_number === "number" && Number.isSafeInteger(move.source_seat_number)
      && (move.entry_id === null || move.destination_tournament_table_id === null)) {
      blockers.push({ playerName: move.player_name, sourceSeatNumber: move.source_seat_number,
        reason: move.entry_id === null ? "missing_entry" : "no_destination" });
      continue;
    }
    if (!isRecord(move)
      || typeof move.entry_id !== "string" || !move.entry_id
      || typeof move.player_name !== "string" || !move.player_name.trim()
      || typeof move.source_seat_number !== "number" || !Number.isSafeInteger(move.source_seat_number)
      || typeof move.destination_tournament_table_id !== "string" || !move.destination_tournament_table_id
      || typeof move.destination_table_number !== "number" || !Number.isSafeInteger(move.destination_table_number)
      || typeof move.destination_seat_number !== "number" || !Number.isSafeInteger(move.destination_seat_number)
      || (move.transfer_mode !== "immediate" && move.transfer_mode !== "after_current_hand")) {
      return { ok: false, error: "V3_BREAK_PLAN_MALFORMED" };
    }
    moves.push({
      entryId: move.entry_id,
      playerName: move.player_name,
      sourceSeatNumber: move.source_seat_number,
      destinationTournamentTableId: move.destination_tournament_table_id,
      destinationTableNumber: move.destination_table_number,
      destinationSeatNumber: move.destination_seat_number,
      transferMode: move.transfer_mode,
    });
  }
  return { ok: true, data: { planHash, complete, sourceTournamentTableId, sourceTableNumber, expectedRevision, moves, blockers } };
}

export function createFloorTableControlV3Client(
  rpc: FloorTableControlV3Rpc,
  options: { enabled?: boolean; redrawSeatLockEnabled?: boolean; deferredTrackerMoveEnabled?: boolean } = {},
) {
  const enabled = options.enabled ?? FEATURES.floorTableControlV3;
  const redrawSeatLockEnabled = options.redrawSeatLockEnabled ?? FEATURES.floorRedrawSeatLockV1;
  const deferredTrackerMoveEnabled = options.deferredTrackerMoveEnabled ?? FEATURES.floorDeferredTrackerMoveV1;

  const call = async (
    name: FloorTableControlV3RpcName,
    args: Record<string, unknown>,
  ): Promise<FloorTableControlV3Result<unknown>> => {
    if (!enabled) return { ok: false, error: "FLOOR_TABLE_CONTROL_V3_DISABLED" };
    const response = await rpc(name, args);
    if (response.error) return { ok: false, error: errorMessage(response.error) };
    return { ok: true, data: response.data };
  };

  const callRedrawSeatLock = async (
    name: FloorTableControlV3RpcName,
    args: Record<string, unknown>,
  ): Promise<FloorTableControlV3Result<unknown>> => {
    if (!redrawSeatLockEnabled) return { ok: false, error: "FLOOR_REDRAW_SEAT_LOCK_V1_DISABLED" };
    return call(name, args);
  };

  return {
    enabled,
    redrawSeatLockEnabled,
    deferredTrackerMoveEnabled,

    async getClubTableInventory(clubId: string): Promise<FloorTableControlV3Result<FloorTableInventoryItem[]>> {
      const response = await call("get_club_table_inventory", { p_club_id: clubId });
      if (response.ok === false) return { ok: false, error: response.error };
      if (!Array.isArray(response.data)) return { ok: false, error: "V3_INVENTORY_RESPONSE_MALFORMED" };
      const inventory: FloorTableInventoryItem[] = [];
      const tableIds = new Set<string>();
      const tableNumbers = new Set<number>();
      for (const row of response.data) {
        const parsed = parseInventoryItem(row);
        if (parsed.ok === false) return { ok: false, error: parsed.error };
        if (tableIds.has(parsed.data.gameTableId) || (parsed.data.tableNumber !== null && tableNumbers.has(parsed.data.tableNumber))) {
          return { ok: false, error: "V3_INVENTORY_DUPLICATE_PHYSICAL_TABLE" };
        }
        tableIds.add(parsed.data.gameTableId);
        if (parsed.data.tableNumber !== null) tableNumbers.add(parsed.data.tableNumber);
        inventory.push(parsed.data);
      }
      return { ok: true, data: inventory };
    },

    async getTournamentTableInventory(tournamentId: string): Promise<FloorTableControlV3Result<FloorTournamentInventoryItem[]>> {
      const response = await callRedrawSeatLock("get_floor_tournament_table_inventory_v1", { p_tournament_id: tournamentId });
      if (response.ok === false) return { ok: false, error: response.error };
      if (!Array.isArray(response.data)) return { ok: false, error: "V3_TOURNAMENT_INVENTORY_RESPONSE_MALFORMED" };
      const inventory: FloorTournamentInventoryItem[] = [];
      const tableIds = new Set<string>();
      const tableNumbers = new Set<number>();
      for (const row of response.data) {
        const parsed = parseTournamentInventoryItem(row);
        if (parsed.ok === false) return { ok: false, error: parsed.error };
        if (tableIds.has(parsed.data.gameTableId) || (parsed.data.tableNumber !== null && tableNumbers.has(parsed.data.tableNumber))) {
          return { ok: false, error: "V3_TOURNAMENT_INVENTORY_DUPLICATE_PHYSICAL_TABLE" };
        }
        tableIds.add(parsed.data.gameTableId);
        if (parsed.data.tableNumber !== null) tableNumbers.add(parsed.data.tableNumber);
        inventory.push(parsed.data);
      }
      return { ok: true, data: inventory };
    },

    async getSeatableEntries(tournamentId: string): Promise<FloorTableControlV3Result<FloorSeatableEntry[]>> {
      const response = await call("get_floor_seatable_entries", { p_tournament_id: tournamentId });
      if (response.ok === false) return { ok: false, error: response.error };
      if (!Array.isArray(response.data)) return { ok: false, error: "V3_SEATABLE_ENTRIES_RESPONSE_MALFORMED" };
      const entries: FloorSeatableEntry[] = [];
      const ids = new Set<string>();
      for (const row of response.data) {
        const parsed = parseSeatableEntry(row);
        if (parsed.ok === false) return { ok: false, error: parsed.error };
        if (ids.has(parsed.data.entryId)) return { ok: false, error: "V3_SEATABLE_ENTRY_DUPLICATE" };
        ids.add(parsed.data.entryId);
        entries.push(parsed.data);
      }
      return { ok: true, data: entries };
    },

    async getTournamentTableRoster(tournamentId: string): Promise<FloorTableControlV3Result<FloorTournamentTableRoster[]>> {
      const response = redrawSeatLockEnabled
        ? await callRedrawSeatLock("get_floor_tournament_table_roster_v6", { p_tournament_id: tournamentId })
        : await call("get_floor_tournament_table_roster_v3", { p_tournament_id: tournamentId });
      if (response.ok === false) return { ok: false, error: response.error };
      if (!Array.isArray(response.data)) return { ok: false, error: "V3_ROSTER_RESPONSE_MALFORMED" };
      const roster: FloorTournamentTableRoster[] = [];
      const tableIds = new Set<string>();
      const sessionIds = new Set<string>();
      const tableNumbers = new Set<number>();
      for (const row of response.data) {
        const parsed = parseRoster(row, redrawSeatLockEnabled, redrawSeatLockEnabled);
        if (parsed.ok === false) return { ok: false, error: parsed.error };
        if (
          parsed.data.tournamentId !== tournamentId
          || tableIds.has(parsed.data.tournamentTableId)
          || sessionIds.has(parsed.data.tableSessionId)
          || tableNumbers.has(parsed.data.tableNumber)
        ) {
          return { ok: false, error: "V3_ROSTER_TABLE_DUPLICATE_OR_SCOPE_MISMATCH" };
        }
        tableIds.add(parsed.data.tournamentTableId);
        sessionIds.add(parsed.data.tableSessionId);
        tableNumbers.add(parsed.data.tableNumber);
        roster.push(parsed.data);
      }
      return { ok: true, data: roster.sort((left, right) => left.tableNumber - right.tableNumber) };
    },

    async getRestorableEntries(tournamentId: string): Promise<FloorTableControlV3Result<FloorRestorableEntry[]>> {
      const response = await call("get_floor_restorable_entries_v3", { p_tournament_id: tournamentId });
      if (response.ok === false) return { ok: false, error: response.error };
      if (!Array.isArray(response.data)) return { ok: false, error: "V3_RESTORABLE_ENTRIES_RESPONSE_MALFORMED" };
      const entries: FloorRestorableEntry[] = [];
      const ids = new Set<string>();
      for (const row of response.data) {
        const parsed = parseRestorableEntry(row);
        if (parsed.ok === false) return { ok: false, error: parsed.error };
        if (ids.has(parsed.data.entryId)) return { ok: false, error: "V3_RESTORABLE_ENTRY_DUPLICATE" };
        ids.add(parsed.data.entryId);
        entries.push(parsed.data);
      }
      return { ok: true, data: entries };
    },

    openTournamentTable: (args: { tournamentId: string; gameTableId: string; controlMode: "manual" | "tracker"; requestId: string }) =>
      call("floor_open_tournament_table_v3", {
        p_tournament_id: args.tournamentId,
        p_game_table_id: args.gameTableId,
        p_control_mode: args.controlMode,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    openClubTables: (args: { gameTableIds: string[]; sessionType: "cash" | "vip"; requestId: string }) =>
      call("operator_open_club_tables_v2", {
        p_game_table_ids: args.gameTableIds,
        p_session_type: args.sessionType,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    closeClubTable: (args: { tableSessionId: string; expectedRevision: number; requestId: string }) =>
      call("operator_close_club_table_v2", {
        p_table_session_id: args.tableSessionId,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    assignEntryToSeat: (args: { entryId: string; tournamentTableId: string; seatNumber: number; expectedRevision: number; requestId: string }) =>
      (redrawSeatLockEnabled ? callRedrawSeatLock : call)(redrawSeatLockEnabled ? "floor_assign_entry_to_seat_v4" : "floor_assign_entry_to_seat", {
        p_entry_id: args.entryId,
        p_tournament_table_id: args.tournamentTableId,
        p_seat_number: args.seatNumber,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    setTableControlMode: (args: { tournamentTableId: string; controlMode: "manual" | "tracker"; expectedRevision: number; requestId: string }) =>
      call("floor_set_table_control_mode_v3", {
        p_tournament_table_id: args.tournamentTableId,
        p_control_mode: args.controlMode,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    requestTableControlMode: (args: { tournamentTableId: string; tableSessionId: string; controlMode: "manual" | "tracker"; expectedRevision: number; expectedEpoch: number; requestId: string }) =>
      call("floor_request_table_control_mode_v4", {
        p_tournament_table_id: args.tournamentTableId, p_table_session_id: args.tableSessionId,
        p_control_mode: args.controlMode, p_expected_revision: args.expectedRevision,
        p_expected_epoch: args.expectedEpoch, p_request_id: args.requestId,
      }).then(mutationFromResponse),

    getTableControlModeRequest: (args: { tournamentTableId: string; tableSessionId: string }) =>
      call("floor_get_table_control_mode_request_v1", {
        p_tournament_table_id: args.tournamentTableId, p_table_session_id: args.tableSessionId,
      }).then(mutationFromResponse),

    cancelTableControlModeRequest: (args: { tournamentTableId: string; tableSessionId: string; modeRequestId: string }) =>
      call("floor_cancel_table_control_mode_request_v1", {
        p_tournament_table_id: args.tournamentTableId, p_table_session_id: args.tableSessionId,
        p_mode_request_id: args.modeRequestId,
      }).then(mutationFromResponse),

    movePlayerSeat: (args: { entryId: string; toTournamentTableId: string; toSeatNumber: number; expectedSourceRevision: number; expectedDestinationRevision: number; requestId: string }) =>
      (redrawSeatLockEnabled ? callRedrawSeatLock : call)(redrawSeatLockEnabled ? "move_player_seat_v3" : "move_player_seat_v2", {
        p_entry_id: args.entryId,
        p_to_tournament_table_id: args.toTournamentTableId,
        p_to_seat_number: args.toSeatNumber,
        p_expected_source_revision: args.expectedSourceRevision,
        p_expected_destination_revision: args.expectedDestinationRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    movePlayerSeatExact: (args: FloorExactMoveIntent) => call("move_player_seat_v4", {
      p_entry_id: args.entryId,
      p_from_tournament_table_id: args.fromTournamentTableId,
      p_from_table_session_id: args.fromTableSessionId,
      p_to_tournament_table_id: args.toTournamentTableId,
      p_to_table_session_id: args.toTableSessionId,
      p_to_seat_number: args.toSeatNumber,
      p_expected_source_revision: args.expectedSourceRevision,
      p_expected_destination_revision: args.expectedDestinationRevision,
      p_expected_source_epoch: args.expectedSourceEpoch,
      p_expected_destination_epoch: args.expectedDestinationEpoch,
      p_reason: args.reason,
      p_request_id: args.requestId,
    }).then(mutationFromResponse),

    movePlayerSeatOrQueueExact: (args: FloorExactMoveIntent) => call("move_player_seat_v5", {
      p_entry_id: args.entryId,
      p_from_tournament_table_id: args.fromTournamentTableId,
      p_from_table_session_id: args.fromTableSessionId,
      p_to_tournament_table_id: args.toTournamentTableId,
      p_to_table_session_id: args.toTableSessionId,
      p_to_seat_number: args.toSeatNumber,
      p_expected_source_revision: args.expectedSourceRevision,
      p_expected_destination_revision: args.expectedDestinationRevision,
      p_expected_source_epoch: args.expectedSourceEpoch,
      p_expected_destination_epoch: args.expectedDestinationEpoch,
      p_reason: args.reason,
      p_request_id: args.requestId,
    }).then(mutationFromResponse),

    async getPendingTrackerMoves(tournamentId: string): Promise<FloorTableControlV3Result<FloorPendingTrackerMove[]>> {
      // Producer OFF does not cancel existing reservations. Always verify the
      // authoritative read; unavailable must never be shown as an empty seat.
      const response = await call("get_floor_pending_tracker_moves_v1", { p_tournament_id: tournamentId });
      if (response.ok === false) return response;
      if (!Array.isArray(response.data)) return { ok: false, error: "V3_PENDING_MOVES_RESPONSE_MALFORMED" };
      const moves: FloorPendingTrackerMove[] = [];
      const ids = new Set<string>();
      for (const row of response.data) {
        const parsed = parsePendingTrackerMove(row);
        if (parsed.ok === false) return parsed;
        if (ids.has(parsed.data.pendingMoveId)) return { ok: false, error: "V3_PENDING_MOVE_DUPLICATE" };
        ids.add(parsed.data.pendingMoveId);
        moves.push(parsed.data);
      }
      return { ok: true, data: moves };
    },

    queueTrackerMove: (args: { entryId: string; toTournamentTableId: string; toSeatNumber: number; expectedSourceRevision: number; expectedDestinationRevision: number; requestId: string }) =>
      deferredTrackerMoveEnabled
        ? call("floor_queue_tracker_move_v1", {
            p_entry_id: args.entryId,
            p_destination_tournament_table_id: args.toTournamentTableId,
            p_destination_seat_number: args.toSeatNumber,
            p_expected_source_revision: args.expectedSourceRevision,
            p_expected_destination_revision: args.expectedDestinationRevision,
            p_request_id: args.requestId,
          }).then(mutationFromResponse)
        : Promise.resolve({ ok: false as const, error: "FLOOR_DEFERRED_TRACKER_MOVE_V1_DISABLED" }),

    cancelPendingTrackerMove: (pendingMoveId: string) =>
      deferredTrackerMoveEnabled
        ? call("floor_cancel_pending_tracker_move_v1", { p_pending_move_id: pendingMoveId }).then(mutationFromResponse)
        : Promise.resolve({ ok: false as const, error: "FLOOR_DEFERRED_TRACKER_MOVE_V1_DISABLED" }),

    closeTournamentTable: (args: { tournamentTableId: string; expectedRevision: number; requestId: string }) =>
      (redrawSeatLockEnabled ? callRedrawSeatLock : call)(redrawSeatLockEnabled ? "close_tournament_table_v4" : "close_tournament_table_v3", {
        p_tournament_table_id: args.tournamentTableId,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    breakTournamentTable: (args: { tournamentTableId: string; expectedRevision: number; requestId: string; drawMode: "fill_lowest_table" | "redraw_balanced"; planHash?: string }) => {
      const baseArgs = {
        p_tournament_table_id: args.tournamentTableId,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
        p_draw_mode: args.drawMode,
      };
      return (redrawSeatLockEnabled
        ? callRedrawSeatLock("floor_break_table_v5", { ...baseArgs, p_plan_hash: args.planHash ?? "" })
        : call("floor_break_table_v3", baseArgs)
      ).then(mutationFromResponse);
    },

    async planBreakTable(args: { tournamentTableId: string; expectedRevision: number; drawMode: "fill_lowest_table" | "redraw_balanced" }): Promise<FloorTableControlV3Result<FloorBreakPlan>> {
      const response = await callRedrawSeatLock("floor_plan_break_table_v1", {
        p_tournament_table_id: args.tournamentTableId,
        p_expected_revision: args.expectedRevision,
        p_draw_mode: args.drawMode,
      });
      if (response.ok === false) return response;
      return parseBreakPlan(response.data);
    },

    bustPlayer: (args: { entryId: string; expectedRevision: number; expectedControlEpoch: number; expectedChipCount: number; requestId: string; reason?: string }) =>
      call("floor_bust_player_v3", {
        p_entry_id: args.entryId,
        p_expected_revision: args.expectedRevision,
        p_expected_control_epoch: args.expectedControlEpoch,
        p_expected_chip_count: args.expectedChipCount,
        p_request_id: args.requestId,
        p_reason: args.reason ?? "floor_bust",
      }).then(mutationFromResponse),

    freeSitPlayer: (args: { entryId: string; expectedRevision: number; expectedControlEpoch: number; expectedChipCount: number; requestId: string; reason?: string }) =>
      call("floor_free_sit_player_v1", {
        p_entry_id: args.entryId,
        p_expected_revision: args.expectedRevision,
        p_expected_control_epoch: args.expectedControlEpoch,
        p_expected_chip_count: args.expectedChipCount,
        p_request_id: args.requestId,
        p_reason: args.reason ?? "floor_free_sit",
      }).then(mutationFromResponse),

    restoreBustedPlayer: (args: { entryId: string; toTournamentTableId: string; toSeatNumber: number; expectedRevision: number; expectedControlEpoch: number; expectedTableSessionId: string; requestId: string }) =>
      call("floor_restore_busted_player_to_seat_v5", {
        p_entry_id: args.entryId,
        p_expected_table_session_id: args.expectedTableSessionId,
        p_to_tournament_table_id: args.toTournamentTableId,
        p_to_seat_number: args.toSeatNumber,
        p_expected_revision: args.expectedRevision,
        p_expected_control_epoch: args.expectedControlEpoch,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    cancelRestoreRequest: (args: { entryId: string; toTournamentTableId: string; toSeatNumber: number; expectedRevision: number; expectedControlEpoch: number; expectedTableSessionId: string; requestId: string }) =>
      call("cancel_floor_restore_request_v1", {
        p_entry_id: args.entryId,
        p_expected_table_session_id: args.expectedTableSessionId,
        p_to_tournament_table_id: args.toTournamentTableId,
        p_to_seat_number: args.toSeatNumber,
        p_expected_revision: args.expectedRevision,
        p_expected_control_epoch: args.expectedControlEpoch,
        p_request_id: args.requestId,
      }),

    getRestoreReceipt: (args: { entryId: string; toTournamentTableId: string; toSeatNumber: number; expectedRevision: number; expectedControlEpoch: number; expectedTableSessionId: string; requestId: string }) =>
      call("get_floor_restore_receipt_v1", {
        p_entry_id: args.entryId,
        p_expected_table_session_id: args.expectedTableSessionId,
        p_to_tournament_table_id: args.toTournamentTableId,
        p_to_seat_number: args.toSeatNumber,
        p_expected_revision: args.expectedRevision,
        p_expected_control_epoch: args.expectedControlEpoch,
        p_request_id: args.requestId,
      }),

    setSeatLock: (args: { tournamentTableId: string; seatNumber: number; locked: boolean; reason: string; expectedRevision: number; requestId: string }) =>
      callRedrawSeatLock("floor_set_table_seat_lock_v1", {
        p_tournament_table_id: args.tournamentTableId,
        p_seat_number: args.seatNumber,
        p_locked: args.locked,
        p_reason: args.reason,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.requestId,
      }).then(mutationFromResponse),

    async planTournamentRedraw(args: { tournamentId: string; targetMaxSeats: 8 | 9; gameTableIds: string[]; requestId: string }): Promise<FloorTableControlV3Result<FloorRedrawPlan>> {
      const response = await callRedrawSeatLock("floor_plan_tournament_redraw_v1", {
        p_tournament_id: args.tournamentId,
        p_target_max_seats: args.targetMaxSeats,
        p_game_table_ids: args.gameTableIds,
        p_request_id: args.requestId,
      });
      if (response.ok === false) return { ok: false, error: response.error };
      const mutation = parseMutation(response.data);
      if (mutation.ok === false) return { ok: false, error: mutation.error };
      return parseRedrawPlan(mutation.data);
    },

    async applyTournamentRedraw(args: { batchId: string; requestId: string }): Promise<FloorTableControlV3Result<FloorRedrawPlan>> {
      const response = await callRedrawSeatLock("floor_apply_tournament_redraw_v1", {
        p_batch_id: args.batchId,
        p_request_id: args.requestId,
      });
      if (response.ok === false) return { ok: false, error: response.error };
      const mutation = parseMutation(response.data);
      if (mutation.ok === false) return { ok: false, error: mutation.error };
      return parseRedrawPlan(mutation.data);
    },

    async getActiveTournamentRedraw(tournamentId: string): Promise<FloorTableControlV3Result<FloorActiveRedraw | null>> {
      const response = await callRedrawSeatLock("get_public_tournament_redraw_v1", {
        p_tournament_id: tournamentId,
      });
      if (response.ok === false) return response;
      if (!isRecord(response.data)) return { ok: false, error: "V3_REDRAW_RESPONSE_MALFORMED" };
      if (response.data.batch_id == null) return { ok: true, data: null };
      if (typeof response.data.batch_id !== "string" || !response.data.batch_id
        || typeof response.data.redraw_revision !== "number"
        || !Number.isSafeInteger(response.data.redraw_revision)
        || response.data.redraw_revision < 1) {
        return { ok: false, error: "V3_REDRAW_RESPONSE_MALFORMED" };
      }
      return { ok: true, data: {
        batchId: response.data.batch_id,
        redrawRevision: response.data.redraw_revision,
      } };
    },

    async continueTournamentRedraw(args: { batchId: string; expectedRedrawRevision: number; requestId: string }): Promise<FloorTableControlV3Result<{ clockResumed: boolean }>> {
      const response = await callRedrawSeatLock("floor_continue_tournament_redraw_v1", {
        p_batch_id: args.batchId,
        p_expected_redraw_revision: args.expectedRedrawRevision,
        p_request_id: args.requestId,
      });
      const mutation = mutationFromResponse(response);
      if (mutation.ok === false) return mutation;
      if (mutation.data.batch_id !== args.batchId
        || typeof mutation.data.redraw_revision !== "number"
        || !Number.isSafeInteger(mutation.data.redraw_revision)
        || typeof mutation.data.clock_resumed !== "boolean") {
        return { ok: false, error: "V3_REDRAW_CONTINUE_RESPONSE_MALFORMED" };
      }
      return { ok: true, data: { clockResumed: mutation.data.clock_resumed } };
    },

    validateTrackerContext: (args: { tournamentId: string; tournamentTableId: string; tableSessionId: string; controlEpoch: number }) =>
      call("validate_tracker_table_writer_context_v3", {
        p_tournament_id: args.tournamentId,
        p_tournament_table_id: args.tournamentTableId,
        p_table_session_id: args.tableSessionId,
        p_control_epoch: args.controlEpoch,
      }).then((response) => response.ok ? parseMutation(response.data) : response),
  };
}
