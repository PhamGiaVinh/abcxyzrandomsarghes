export const FLOOR_TABLE_NUMBER_MIN = 1;
export const FLOOR_TABLE_NUMBER_MAX = 100;
export const FIXED_FLOOR_TABLE_SEATS = 9;

export type FloorTableNumberState = "available" | "active" | "closed" | "unavailable";

export interface FloorTableCatalogRow {
  table_number: number | null;
  status: string | null;
  /** V3 inventory fields are optional while the legacy picker remains live. */
  availability_status?: string | null;
  session_type?: string | null;
  operational_status?: string | null;
}

export interface FloorTableNumberOption {
  number: number;
  state: FloorTableNumberState;
  detail?: string;
}

export interface FloorRosterSeat {
  seatNumber: number;
  playerName: string;
  chipsLabel: string;
  entryNumber?: number | null;
  integrityStatus?: "valid" | "missing_entry" | "invalid_participation";
  playerId?: string;
}

export interface FloorRosterSlot {
  seatNumber: number;
  seat: FloorRosterSeat | null;
}

export interface FloorRosterSeatLock {
  seatNumber: number;
  reason: string;
}

/**
 * Builds the visible 1–100 picker from the server-returned tournament catalog.
 * An active row always wins over a historical closed row for the same number.
 * The RPC still revalidates the chosen number under the tournament lock.
 */
export function buildFloorTableNumberOptions(
  rows: readonly FloorTableCatalogRow[],
  missingState: FloorTableNumberState = "available",
): FloorTableNumberOption[] {
  const stateByNumber = new Map<number, FloorTableNumberOption>();

  for (const row of rows) {
    const number = row.table_number;
    if (
      number == null
      || !Number.isInteger(number)
      || number < FLOOR_TABLE_NUMBER_MIN
      || number > FLOOR_TABLE_NUMBER_MAX
    ) {
      continue;
    }

    const availability = row.availability_status;
    const next: FloorTableNumberOption = availability === "available"
      ? { number, state: "available" }
      : availability === "in_use"
        ? {
          number,
          state: "active",
          detail: row.session_type === "tournament"
            ? "Đang dùng · Giải"
            : row.session_type === "cash"
              ? "Đang dùng · Cash"
              : row.session_type === "vip"
                ? "Đang dùng · VIP"
                : "Đang dùng",
        }
        : availability
          ? {
            number,
            state: "unavailable",
            detail: availability === "maintenance"
              ? "Bảo trì"
              : availability === "repair_required"
                ? "Cần sửa dữ liệu"
                : "Không khả dụng",
          }
          : { number, state: row.status === "active" ? "active" : "closed" };
    const current = stateByNumber.get(number);
    if (!current || next.state === "active" || (next.state === "unavailable" && current.state !== "active")) {
      stateByNumber.set(number, next);
    }
  }

  return Array.from(
    { length: FLOOR_TABLE_NUMBER_MAX },
    (_, index): FloorTableNumberOption => {
      const number = index + FLOOR_TABLE_NUMBER_MIN;
      return stateByNumber.get(number) ?? { number, state: missingState };
    },
  );
}

/**
 * Floor table detail renders the server-authoritative 8-max or 9-max capacity.
 * Duplicate seat numbers are surfaced to the UI instead of silently choosing
 * one player, because the database/Edge projection is authoritative.
 */
export function buildFloorSeatRoster(
  seats: readonly FloorRosterSeat[],
  maxSeats: 8 | 9 = FIXED_FLOOR_TABLE_SEATS,
): {
  slots: FloorRosterSlot[];
  duplicateSeatNumbers: number[];
  outOfRangeSeatNumbers: number[];
} {
  const bySeat = new Map<number, FloorRosterSeat>();
  const duplicates = new Set<number>();
  const outOfRange = new Set<number>();

  for (const seat of seats) {
    if (
      !Number.isInteger(seat.seatNumber)
      || seat.seatNumber < 1
      || seat.seatNumber > maxSeats
    ) {
      outOfRange.add(seat.seatNumber);
      continue;
    }
    if (bySeat.has(seat.seatNumber)) {
      duplicates.add(seat.seatNumber);
      continue;
    }
    bySeat.set(seat.seatNumber, seat);
  }

  return {
    slots: Array.from(
      { length: maxSeats },
      (_, index): FloorRosterSlot => {
        const seatNumber = index + 1;
        return { seatNumber, seat: bySeat.get(seatNumber) ?? null };
      },
    ),
    duplicateSeatNumbers: Array.from(duplicates).sort((a, b) => a - b),
    outOfRangeSeatNumbers: Array.from(outOfRange).sort((a, b) => a - b),
  };
}
