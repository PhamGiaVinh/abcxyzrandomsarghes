import type { SupabaseClient } from "@supabase/supabase-js";
import { parseParticipationSummary } from "@/lib/tournamentParticipation";
import type { Database } from "@/integrations/supabase/types";

export type TrackerReadTable = {
  id: string;
  number: number | null;
  name: string;
  status: string;
  occupiedSeats: number;
  maxSeats: number;
};

export type TrackerReadTournament = {
  id: string;
  name: string;
  status: string;
  startTime: string | null;
  currentPlayers: number;
  currentLevel: number | null;
  tables: TrackerReadTable[];
};

export type TrackerReadModel = {
  tournaments: TrackerReadTournament[];
  loadedAt: string;
};

type OpsClient = SupabaseClient<Database>;

export async function loadTrackerReadModel(client: OpsClient, clubId: string, signal?: AbortSignal): Promise<TrackerReadModel> {
  const tournamentQuery = client
    .from("tournaments")
    .select("id, name, status, start_time, current_players, current_level")
    .eq("club_id", clubId)
    .is("deleted_at", null)
    .in("status", ["registering", "drawing", "live", "break", "final_table"])
    .order("start_time", { ascending: true })
    .limit(80);
  const tournamentResult=await(signal?tournamentQuery.abortSignal(signal):tournamentQuery);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if (tournamentResult.error || !Array.isArray(tournamentResult.data)) throw new Error("TRACKER_TOURNAMENT_READ_FAILED");

  const tournaments = tournamentResult.data;
  if (tournaments.length === 0) return { tournaments: [], loadedAt: new Date().toISOString() };
  const tournamentIds = tournaments.map((row) => row.id);

  const tableQuery=client
      .from("tournament_tables")
      .select("id, tournament_id, table_number, table_name, status, max_seats")
      .in("tournament_id", tournamentIds)
      .order("table_number", { ascending: true });
  const seatQuery=client
      .from("tournament_seats")
      .select("table_id")
      .in("tournament_id", tournamentIds)
      .eq("is_active", true);
  const participationRpc = client.rpc.bind(client) as unknown as (
    name: "get_tournament_participation_counts_v1", args: { p_tournament_id: string },
  ) => PromiseLike<{ data: unknown; error: unknown }> & { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };
  const [tableResult, seatResult, participation] = await Promise.all([
    signal?tableQuery.abortSignal(signal):tableQuery,
    signal?seatQuery.abortSignal(signal):seatQuery,
    Promise.all(tournaments.map(async (row) => {
      const query = participationRpc("get_tournament_participation_counts_v1", { p_tournament_id: row.id });
      const result = await (signal ? query.abortSignal(signal) : query);
      if (result.error) throw new Error("TRACKER_PARTICIPATION_READ_FAILED");
      return [row.id, parseParticipationSummary(result.data, row.id).counts.remaining] as const;
    })),
  ]);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if (tableResult.error || !Array.isArray(tableResult.data)) throw new Error("TRACKER_TABLE_READ_FAILED");
  if (seatResult.error || !Array.isArray(seatResult.data)) throw new Error("TRACKER_SEAT_READ_FAILED");

  const remainingByTournament = new Map(participation);
  const occupiedByTable = new Map<string, number>();
  for (const seat of seatResult.data) {
    occupiedByTable.set(seat.table_id, (occupiedByTable.get(seat.table_id) ?? 0) + 1);
  }
  const tablesByTournament = new Map<string, TrackerReadTable[]>();
  for (const table of tableResult.data) {
    // Closed sessions remain in history, but are not operational Tracker tables.
    if (table.status === "closed") continue;
    const rows = tablesByTournament.get(table.tournament_id) ?? [];
    rows.push({
      id: table.id,
      number: table.table_number,
      name: table.table_name,
      status: table.status,
      occupiedSeats: occupiedByTable.get(table.id) ?? 0,
      maxSeats: table.max_seats,
    });
    tablesByTournament.set(table.tournament_id, rows);
  }

  return {
    tournaments: tournaments.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      startTime: row.start_time,
      currentPlayers: remainingByTournament.get(row.id)!,
      currentLevel: row.current_level,
      tables: tablesByTournament.get(row.id) ?? [],
    })),
    loadedAt: new Date().toISOString(),
  };
}
