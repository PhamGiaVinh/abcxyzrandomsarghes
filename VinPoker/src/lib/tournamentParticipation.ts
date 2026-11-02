export interface ParticipationSeat {
  seat_id: string;
  entry_id: string | null;
  player_id: string;
  player_name: string;
  entry_number: number;
  table_id: string | null;
  tournament_table_id: string | null;
  table_session_id: string | null;
  table_name: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
  participation_status: "seated" | "anomaly";
  anomaly_reason: string | null;
}

export interface ParticipationEntry {
  id: string;
  player_id: string;
  player_name: string;
  entry_no: number;
  current_stack: number;
  seat_number: number | null;
  finished_place: number | null;
  status: string;
  participation_status: "seated" | "waiting" | "bagged" | "busted" | "finished" | "cancelled" | "anomaly";
  anomaly_reason: string | null;
}

export interface ParticipationCounts {
  total_entries: number;
  re_entries: number;
  remaining: number;
  seated: number;
  waiting: number;
  busted: number;
  anomaly_entries: number;
  anomaly_seats: number;
  live_entry_stack: number;
  seated_stack: number;
  waiting_stack: number;
}

export interface TournamentParticipation {
  tournament_id: string;
  seats: ParticipationSeat[];
  entries: ParticipationEntry[];
  counts: ParticipationCounts;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const nullableInteger = (v: unknown) => v === null || integer(v);
const text = (v: unknown) => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);

function parseCounts(value: unknown): ParticipationCounts {
  const countKeys: (keyof ParticipationCounts)[] = ["total_entries", "re_entries", "remaining", "seated", "waiting", "busted",
    "anomaly_entries", "anomaly_seats", "live_entry_stack", "seated_stack", "waiting_stack"];
  if (!record(value) || !countKeys.every((k) => integer(value[k]))) throw new Error("invalid_participation_counts");
  return value as unknown as ParticipationCounts;
}

export function parseParticipationSummary(value: unknown, tournamentId: string): { counts: ParticipationCounts; averageStack: number } {
  if (!record(value) || value.tournament_id !== tournamentId || !integer(value.average_stack)) {
    throw new Error("invalid_participation_summary");
  }
  return { counts: parseCounts(value.counts), averageStack: value.average_stack as number };
}

/** Validate the RPC boundary and exact scope; never turn malformed data into zero. */
export function parseTournamentParticipation(value: unknown, tournamentId: string): TournamentParticipation {
  if (!record(value) || value.tournament_id !== tournamentId || !record(value.counts)
    || !Array.isArray(value.seats) || !Array.isArray(value.entries)) throw new Error("invalid_participation_response");
  const counts = parseCounts(value.counts);
  for (const s of value.seats) {
    if (!record(s) || ![s.seat_id, s.player_id].every(text)
      || ![s.table_id, s.entry_id, s.tournament_table_id, s.table_session_id, s.anomaly_reason].every(nullableText)
      || ![s.entry_number, s.seat_number, s.chip_count].every(integer) || s.is_active !== true
      || !nullableText(s.player_name) || !nullableText(s.table_name)
      || !["seated", "anomaly"].includes(String(s.participation_status))
      || (s.participation_status === "seated" && (!s.table_id || !s.entry_id || !s.tournament_table_id || !s.table_session_id || s.anomaly_reason !== null))
      || (s.participation_status === "anomaly" && !s.anomaly_reason)) throw new Error("invalid_participation_seat");
  }
  for (const e of value.entries) {
    if (!record(e) || ![e.id, e.player_id, e.player_name, e.status].every(text)
      || ![e.entry_no, e.current_stack].every(integer) || ![e.seat_number, e.finished_place].every(nullableInteger)
      || !nullableText(e.anomaly_reason)
      || !["seated", "waiting", "bagged", "busted", "finished", "cancelled", "anomaly"].includes(String(e.participation_status))) {
      throw new Error("invalid_participation_entry");
    }
  }
  return {
    ...(value as unknown as TournamentParticipation),
    counts,
    seats: (value.seats as ParticipationSeat[]).map((s) => ({ ...s, player_name: s.player_name ?? "", table_name: s.table_name ?? "" })),
  };
}
