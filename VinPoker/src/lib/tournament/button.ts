const POSITION_NAMES: Record<number, string[]> = {
  2: ["BTN/SB", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["BTN", "SB", "BB", "CO"],
  5: ["BTN", "SB", "BB", "UTG", "CO"],
  6: ["BTN", "SB", "BB", "UTG", "LJ", "HJ"],
  7: ["BTN", "SB", "BB", "UTG", "LJ", "HJ", "CO"],
  8: ["BTN", "SB", "BB", "UTG", "UTG+1", "LJ", "HJ", "CO"],
  9: ["BTN", "SB", "BB", "UTG", "UTG+1", "MP", "LJ", "HJ", "CO"],
  10: ["BTN", "SB", "BB", "UTG", "UTG+1", "MP", "MP+1", "LJ", "HJ", "CO"],
}

export function getPosition(seat: number, btnSeat: number, total: number): string {
  if (total <= 1) return ""
  const offset = ((seat - btnSeat + total) % total)
  const names = POSITION_NAMES[total]
  if (names && offset < names.length) {
    return names[offset]
  }
  return `+${offset}`
}

/**
 * Map every OCCUPIED seat to its full poker position, robust to non-contiguous
 * seat numbers (e.g. seats 1,3,5,7). Unlike getPosition (which does raw
 * seat−btn mod total and mislabels when seats have gaps), this orders the
 * occupied seats clockwise from the button and assigns POSITION_NAMES in order.
 * `activeSeats` = the seats dealt into the hand. Returns Map<seatNumber, name>.
 */
export function getSeatPositions(activeSeats: number[], btnSeat: number): Map<number, string> {
  const seats = [...new Set(activeSeats)]
    .filter((s) => Number.isInteger(s) && s > 0)
    .sort((a, b) => a - b)
  const result = new Map<number, string>()
  const count = seats.length
  if (count === 0) return result
  if (count === 1) {
    result.set(seats[0], "BTN")
    return result
  }

  // Rotate so the button seat is first. If the button is on an empty seat,
  // start at the next occupied seat clockwise.
  let start = seats.indexOf(btnSeat)
  if (start < 0) {
    const nextHigher = seats.findIndex((s) => s > btnSeat)
    start = nextHigher < 0 ? 0 : nextHigher
  }

  const names = POSITION_NAMES[count]
  for (let i = 0; i < count; i++) {
    const seat = seats[(start + i) % count]
    result.set(seat, names && i < names.length ? names[i] : `+${i}`)
  }
  return result
}

/** Operator display with known blind slots, including a dead SB/button.
 * Missing slots still occupy positions in the existing position-name convention;
 * they must not shift UTG onto the second/third live player after the actual BB.
 * Display only: never used to choose an actor, move the button or post a blind.
 */
export function getBlindSlotSeatPositions(
  activeSeats: number[], btnSeat: number, sbSeat: number | null, bbSeat: number | null,
): Map<number, string> {
  const positions = getSeatPositions(activeSeats, btnSeat)
  const seats = [...positions.keys()].sort((a, b) => a - b)
  if (seats.length < 2 || bbSeat == null || !positions.has(bbSeat)) return positions
  for (const seat of seats) positions.set(seat, "")
  if (positions.has(btnSeat)) positions.set(btnSeat, sbSeat === btnSeat ? "BTN/SB" : "BTN")
  if (sbSeat != null && positions.has(sbSeat) && sbSeat !== btnSeat) positions.set(sbSeat, "SB")
  positions.set(bbSeat, "BB")
  if (seats.length === 2) return positions

  const slotCount = seats.length + Number(!positions.has(btnSeat)) + Number(sbSeat == null)
  const names = POSITION_NAMES[slotCount]?.slice(3) ?? []
  const afterBb = seats.filter((seat) => seat > bbSeat).concat(seats.filter((seat) => seat < bbSeat))
    .filter((seat) => seat !== btnSeat && seat !== sbSeat)
  afterBb.forEach((seat, index) => positions.set(seat, names[index] ?? ""))
  return positions
}

/** Display only: recorded blind posts outrank an occupied-seat approximation.
 * A dead blind/button breaks that approximation. Without frozen slot metadata,
 * keep the known BTN/blinds and leave other positions neutral rather than
 * inventing their full-ring labels. Never changes action order or settlement.
 */
export function getHandSeatPositions(
  players: ReadonlyArray<{ player_id: string; seat_number: number }>,
  btnSeat: number,
  actions: ReadonlyArray<{ player_id: string; action_type: string }>,
): Map<number, string> {
  const positions = getSeatPositions(players.map((player) => player.seat_number), btnSeat)
  const seatByPlayer = new Map(players.map((player) => [player.player_id, player.seat_number]))
  const postedSeats = (type: string) => [...new Set(actions
    .filter((action) => action.action_type === type)
    .map((action) => seatByPlayer.get(action.player_id))
    .filter((seat): seat is number => seat != null && positions.has(seat)))]
  const sb = postedSeats("post_sb")
  const bb = postedSeats("post_bb")
  if (sb.length === 0 && bb.length === 0) return positions
  const agrees = sb.length <= 1 && bb.length <= 1
    && (sb.length === 0 || ["SB", "BTN/SB"].includes(positions.get(sb[0]) ?? ""))
    && (bb.length === 0 || positions.get(bb[0]) === "BB")
  if (agrees) return positions

  for (const seat of positions.keys()) positions.set(seat, seat === btnSeat ? "BTN" : "")
  if (sb.length === 1) positions.set(sb[0], sb[0] === btnSeat ? "BTN/SB" : "SB")
  if (bb.length === 1) positions.set(bb[0], "BB")
  return positions
}

export function nextButton(activeSeats: number[], currentBtn: number): number {
  const sorted = [...new Set(activeSeats)]
    .filter((seat) => Number.isInteger(seat) && seat > 0)
    .sort((a, b) => a - b)

  if (sorted.length === 0) return 1
  if (sorted.length === 1) return sorted[0]

  const idx = sorted.indexOf(currentBtn)

  if (idx >= 0) {
    return sorted[(idx + 1) % sorted.length]
  }

  const nextHigher = sorted.find((seat) => seat > currentBtn)
  return nextHigher ?? sorted[0]
}
