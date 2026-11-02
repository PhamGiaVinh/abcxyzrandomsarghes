import { describe, it, expect } from "vitest";
import { computeAvailability, capacityCheck, type TournamentTableRow, type ActiveSeatRow } from "./seatAvailability";

const tbl = (over: Partial<TournamentTableRow>): TournamentTableRow => ({
  id: "tt-1",
  table_name: "Bàn 1",
  table_number: 1,
  max_seats: 9,
  status: "active",
  table_id: "gt-1",
  ...over,
});

describe("computeAvailability", () => {
  it('includes canonical Floor tables whose legacy physical alias is null',()=>{
    const table=tbl({table_id:null,game_table_id:'physical',table_session_id:'current'});
    expect(computeAvailability([table],[]).map(t=>t.freeSeats)).toEqual([9]);
  });
  it('counts canonical seats by exact tournament table/session, not physical alias or old session',()=>{
    const table=tbl({game_table_id:'physical',table_session_id:'current'});
    const seats:ActiveSeatRow[]=[
      {table_id:'physical',tournament_table_id:'tt-1',table_session_id:'current',is_active:true},
      {table_id:'physical',tournament_table_id:'tt-1',table_session_id:'old',is_active:true},
    ];
    expect(computeAvailability([table],seats).map(t=>[t.activeCount,t.freeSeats])).toEqual([[1,8]]);
  });
  it("counts only active seats per tournament table", () => {
    const tables = [tbl({}), tbl({ id: "tt-2", table_name: "Bàn 2", table_number: 2, table_id: "gt-2" })];
    const seats: ActiveSeatRow[] = [
      { table_id: "tt-1", is_active: true },
      { table_id: "tt-1", is_active: true },
      { table_id: "tt-1", is_active: false }, // busted — must not count
      { table_id: "tt-2", is_active: true },
    ];
    const out = computeAvailability(tables, seats);
    expect(out.map((t) => [t.tournamentTableId, t.activeCount, t.freeSeats])).toEqual([
      ["tt-1", 2, 7],
      ["tt-2", 1, 8],
    ]);
  });

  it("mirrors the RPC eligibility filter: excludes non-active tables and NULL game table_id", () => {
    const tables = [
      tbl({}),
      tbl({ id: "tt-broken", status: "broken", table_id: "gt-2" }),
      tbl({ id: "tt-closed", status: "closed", table_id: "gt-3" }),
      tbl({ id: "tt-unlinked", status: "active", table_id: null }),
    ];
    const out = computeAvailability(tables, []);
    expect(out.map((t) => t.tournamentTableId)).toEqual(["tt-1"]);
  });

  it("clamps freeSeats at 0 on over-full tables and defaults max_seats to 9", () => {
    const tables = [tbl({ max_seats: 2 }), tbl({ id: "tt-2", table_number: 2, table_id: "gt-2", max_seats: null })];
    const seats: ActiveSeatRow[] = [
      { table_id: "tt-1", is_active: true },
      { table_id: "tt-1", is_active: true },
      { table_id: "tt-1", is_active: true }, // over-full (data anomaly)
    ];
    const out = computeAvailability(tables, seats);
    expect(out[0].freeSeats).toBe(0);
    expect(out[1].maxSeats).toBe(9);
  });

  it("sorts by table_number with NULLs last", () => {
    const tables = [
      tbl({ id: "tt-null", table_number: null, table_id: "gt-9" }),
      tbl({ id: "tt-2", table_number: 2, table_id: "gt-2" }),
      tbl({ id: "tt-1b", table_number: 1, table_id: "gt-1" }),
    ];
    const out = computeAvailability(tables, []);
    expect(out.map((t) => t.tournamentTableId)).toEqual(["tt-1b", "tt-2", "tt-null"]);
  });
});

describe("capacityCheck", () => {
  const avail = computeAvailability(
    [tbl({ max_seats: 3 }), tbl({ id: "tt-2", table_number: 2, table_id: "gt-2", max_seats: 3 })],
    [{ table_id: "tt-1", is_active: true }],
  ); // free = 2 + 3 = 5

  it("ok when free seats cover all waiting players", () => {
    expect(capacityCheck(5, avail)).toEqual({ totalFree: 5, waitingCount: 5, ok: true, shortBy: 0 });
  });

  it("reports exact shortage when over capacity", () => {
    expect(capacityCheck(8, avail)).toEqual({ totalFree: 5, waitingCount: 8, ok: false, shortBy: 3 });
  });

  it("zero waiting is trivially ok", () => {
    expect(capacityCheck(0, avail).ok).toBe(true);
  });
});
