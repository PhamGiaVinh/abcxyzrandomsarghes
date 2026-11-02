import { describe, expect, it } from "vitest";
import {
  buildTournamentRedrawTvPages,
  getTournamentRedrawPageIndex,
  parseTournamentRedrawTvBatch,
} from "./useTournamentRedrawTv";

const validBatch = {
  batch_id: "batch-a",
  redraw_revision: 1,
  tournament_name: "Main Event",
  target_max_seats: 8,
  applied_at: "2026-09-15T12:00:00.000Z",
  moves: [{
    ordinal: 1,
    player_name: "Phạm Gia Vinh",
    from_table_number: 9,
    from_seat_number: 3,
    to_table_number: 4,
    to_seat_number: 5,
  }],
};

describe("parseTournamentRedrawTvBatch", () => {
  it('accepts explicit initial D2 seating without inventing a previous table/seat',()=>{
    const initial={...validBatch,kind:'initial_d2',moves:[{...validBatch.moves[0],from_table_number:null,from_seat_number:null}]};
    const parsed=parseTournamentRedrawTvBatch(initial);
    expect(parsed).not.toBeNull();expect(parsed).not.toBe('empty');
    if(!parsed||parsed==='empty')return;
    expect(parsed.kind).toBe('initial_d2');expect(parsed.moves[0].fromSeatNumber).toBeNull();
    expect(parseTournamentRedrawTvBatch({...initial,kind:undefined})).toBeNull();
    expect(parseTournamentRedrawTvBatch({...initial,moves:[{...initial.moves[0],from_table_number:9}]})).toBeNull();
  });
  it("parses the sanitized old-to-new TV projection", () => {
    expect(parseTournamentRedrawTvBatch(validBatch)).toEqual({
      batchId: "batch-a",
      redrawRevision: 1,
      tournamentName: "Main Event",
      targetMaxSeats: 8,
      appliedAt: "2026-09-15T12:00:00.000Z",
      moves: [{
        ordinal: 1,
        playerName: "Phạm Gia Vinh",
        fromTableNumber: 9,
        fromSeatNumber: 3,
        toTableNumber: 4,
        toSeatNumber: 5,
      }],
    });
  });

  it("distinguishes no applied batch from a malformed response", () => {
    expect(parseTournamentRedrawTvBatch({ batch_id: null, moves: [] })).toBe("empty");
    expect(parseTournamentRedrawTvBatch(null)).toBeNull();
    for (const invalid of [{}, {moves:[]}, {batch_id:null}, {batch_id:null,moves:[validBatch.moves[0]]}]) {
      expect(parseTournamentRedrawTvBatch(invalid)).toBeNull();
    }
    expect(parseTournamentRedrawTvBatch({...validBatch,applied_at:'not-a-date'})).toBeNull();
    expect(parseTournamentRedrawTvBatch({...validBatch,batch_id:''})).toBeNull();
  });

  it("fails closed for a seat outside 8-max or duplicate target", () => {
    expect(parseTournamentRedrawTvBatch({
      ...validBatch,
      moves: [{ ...validBatch.moves[0], to_seat_number: 9 }],
    })).toBeNull();
    expect(parseTournamentRedrawTvBatch({
      ...validBatch,
      moves: [validBatch.moves[0], { ...validBatch.moves[0], ordinal: 2, player_name: "Player B" }],
    })).toBeNull();
  });

  it("groups a single destination table per stable numeric page and synchronizes page changes to apply time", () => {
    const parsed = parseTournamentRedrawTvBatch({
      ...validBatch,
      moves: [
        { ...validBatch.moves[0], ordinal: 3, to_table_number: 17 },
        { ...validBatch.moves[0], ordinal: 2, player_name: "Player B", to_table_number: 3 },
        { ...validBatch.moves[0], ordinal: 1, player_name: "Player C", to_table_number: 17, to_seat_number: 2 },
      ],
    });
    expect(parsed).not.toBe("empty");
    expect(parsed).not.toBeNull();
    if (!parsed || parsed === "empty") return;
    const pages = buildTournamentRedrawTvPages(parsed);
    expect(pages.map((page) => page.tableNumber)).toEqual([3, 17]);
    expect(pages[1].moves.map((move) => move.ordinal)).toEqual([1, 3]);
    expect(getTournamentRedrawPageIndex(validBatch.applied_at, 2, Date.parse(validBatch.applied_at) + 12_001)).toBe(1);
    expect(getTournamentRedrawPageIndex(validBatch.applied_at, 2, Date.parse(validBatch.applied_at) + 48_001)).toBe(0);
  });
});
