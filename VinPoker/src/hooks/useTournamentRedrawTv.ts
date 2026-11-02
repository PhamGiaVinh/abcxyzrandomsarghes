import { useCallback, useEffect, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

export type TournamentRedrawTvMove = {
  ordinal: number;
  playerName: string;
  fromTableNumber: number | null;
  fromSeatNumber: number | null;
  toTableNumber: number;
  toSeatNumber: number;
};

export type TournamentRedrawTvBatch = {
  kind?: 'initial_d2';
  batchId: string;
  redrawRevision: number;
  tournamentName: string;
  targetMaxSeats: 8 | 9;
  appliedAt: string;
  moves: TournamentRedrawTvMove[];
};

export type TournamentRedrawTvPage = {
  tableNumber: number;
  moves: TournamentRedrawTvMove[];
};

export function buildTournamentRedrawTvPages(batch: TournamentRedrawTvBatch): TournamentRedrawTvPage[] {
  const byTable = new Map<number, TournamentRedrawTvMove[]>();
  for (const move of batch.moves) {
    const rows = byTable.get(move.toTableNumber) ?? [];
    rows.push(move);
    byTable.set(move.toTableNumber, rows);
  }
  return [...byTable.entries()]
    .sort(([left], [right]) => left - right)
    .map(([tableNumber, moves]) => ({
      tableNumber,
      moves: [...moves].sort((left, right) => left.ordinal - right.ordinal),
    }));
}

export function getTournamentRedrawPageIndex(
  appliedAt: string,
  pageCount: number,
  nowMs = Date.now(),
  pageDurationMs = 12_000,
): number {
  if (pageCount < 2 || pageDurationMs < 1) return 0;
  const startMs = Date.parse(appliedAt);
  if (!Number.isFinite(startMs)) return 0;
  const elapsedMs = Math.max(0, nowMs - startMs);
  return Math.floor(elapsedMs / pageDurationMs) % pageCount;
}

export function useTournamentRedrawTv(tournamentId: string | undefined, enabled: boolean) {
  const supabase = useSupabaseClient();
  type ReadState = "loading" | "ready" | "stale" | "empty" | "error";
  const [snapshot, setSnapshot] = useState<{
    tournamentId: string | undefined;
    client: typeof supabase;
    data: TournamentRedrawTvBatch | null;
    state: ReadState;
  }>({ tournamentId, client: supabase, data: null, state: "loading" });
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let inFlight: Promise<void> | null = null;
    let lastGood: TournamentRedrawTvBatch | null = null;
    const publish = (data: TournamentRedrawTvBatch | null, state: ReadState) => {
      if (alive) setSnapshot({ tournamentId, client: supabase, data, state });
    };
    const canPoll = () => document.visibilityState === "visible" && navigator.onLine !== false;
    const schedule = () => {
      if (alive && enabled && tournamentId) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { void read(); }, 4_000);
      }
    };
    const read = (): Promise<void> => {
      if (!alive || !enabled || !tournamentId) return Promise.resolve();
      if (inFlight) return inFlight;
      window.clearTimeout(timer);
      if (!canPoll()) { schedule(); return Promise.resolve(); }
      const requestController = new AbortController();
      controller = requestController;
      inFlight = Promise.resolve().then(async () => {
        if (!alive) return;
        let deadline: number | undefined;
        let cancel: (() => void) | undefined;
        try {
          const interrupted = new Promise<never>((_, reject) => {
            cancel = () => reject(new Error("redraw_read_cancelled"));
            requestController.signal.addEventListener("abort", cancel, { once: true });
            deadline = window.setTimeout(() => requestController.abort(), 15_000);
          });
          const query = (supabase.rpc as unknown as (
            name: "get_public_tournament_redraw_v1",
            args: { p_tournament_id: string },
          ) => { abortSignal: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }> })(
            "get_public_tournament_redraw_v1", { p_tournament_id: tournamentId },
          );
          const response = await Promise.race([
            query.abortSignal(requestController.signal),
            interrupted,
          ]);
          if (!alive) return;
          if (response.error) throw response.error;
          const parsed = parseTournamentRedrawTvBatch(response.data);
          if (parsed === "empty" || !parsed) {
            lastGood = null;
            publish(null, parsed === "empty" ? "empty" : "error");
          } else {
            lastGood = parsed;
            publish(parsed, "ready");
          }
        } catch {
          publish(lastGood, lastGood ? "stale" : "error");
        } finally {
          window.clearTimeout(deadline);
          if (cancel) requestController.signal.removeEventListener("abort", cancel);
          inFlight = null;
          schedule();
        }
      });
      return inFlight;
    };
    refreshRef.current = read;
    publish(null, enabled && tournamentId ? "loading" : "empty");
    void read();
    const resume = () => { if (canPoll()) void read(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      controller?.abort();
      if (refreshRef.current === read) refreshRef.current = async () => {};
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [enabled, supabase, tournamentId]);

  const sameScope = snapshot.tournamentId === tournamentId && snapshot.client === supabase;
  return {
    data: enabled && tournamentId && sameScope ? snapshot.data : null,
    state: !enabled || !tournamentId ? "empty" as const : sameScope ? snapshot.state : "loading" as const,
    refresh,
  };
}

export function parseTournamentRedrawTvBatch(value: unknown): TournamentRedrawTvBatch | "empty" | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== undefined && row.kind !== 'initial_d2') return null;
  if (row.batch_id === null) return Array.isArray(row.moves) && row.moves.length === 0 ? "empty" : null;
  if (
    typeof row.batch_id !== "string" || !row.batch_id.trim()
    || typeof row.redraw_revision !== "number" || !Number.isSafeInteger(row.redraw_revision) || row.redraw_revision < 1
    || typeof row.tournament_name !== "string" || !row.tournament_name.trim()
    || (row.target_max_seats !== 8 && row.target_max_seats !== 9)
    || typeof row.applied_at !== "string" || !Number.isFinite(Date.parse(row.applied_at))
    || !Array.isArray(row.moves)
  ) return null;
  const moves: TournamentRedrawTvMove[] = [];
  const ordinals = new Set<number>();
  const targets = new Set<string>();
  for (const value of row.moves) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const move = value as Record<string, unknown>;
    if (
      typeof move.player_name !== "string" || !move.player_name.trim()
      || typeof move.ordinal !== "number" || !Number.isSafeInteger(move.ordinal) || move.ordinal < 1
      || (row.kind === 'initial_d2'
        ? move.from_table_number !== null || move.from_seat_number !== null
        : !validTable(move.from_table_number) || !validSeat(move.from_seat_number))
      || !validTable(move.to_table_number) || !validSeat(move.to_seat_number)
      || move.to_seat_number > row.target_max_seats
    ) return null;
    const target = `${move.to_table_number}:${move.to_seat_number}`;
    if (ordinals.has(move.ordinal) || targets.has(target)) return null;
    ordinals.add(move.ordinal);
    targets.add(target);
    moves.push({
      ordinal: move.ordinal,
      playerName: move.player_name,
      fromTableNumber: row.kind === 'initial_d2' ? null : move.from_table_number as number,
      fromSeatNumber: row.kind === 'initial_d2' ? null : move.from_seat_number as number,
      toTableNumber: move.to_table_number,
      toSeatNumber: move.to_seat_number,
    });
  }
  return {
    ...(row.kind === 'initial_d2' ? { kind: 'initial_d2' as const } : {}),
    batchId: row.batch_id,
    redrawRevision: row.redraw_revision,
    tournamentName: row.tournament_name,
    targetMaxSeats: row.target_max_seats,
    appliedAt: row.applied_at,
    moves,
  };
}

function validTable(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 100;
}

function validSeat(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 9;
}
