import { describe, expect, it } from "vitest";
import { parseTournamentParticipation, parseParticipationSummary } from "./tournamentParticipation";

const projection = () => ({ tournament_id: "tour", seats: [{ seat_id: "seat", entry_id: "entry", player_id: "player", player_name: null,
  entry_number: 1, table_id: "table", tournament_table_id: "table", table_session_id: "session", table_name: null,
  seat_number: 1, chip_count: 20000, is_active: true, participation_status: "seated", anomaly_reason: null }], entries: [],
  counts: { total_entries: 1, re_entries: 0, remaining: 1, seated: 1, waiting: 0, busted: 0, anomaly_entries: 0,
    anomaly_seats: 0, live_entry_stack: 20000, seated_stack: 20000, waiting_stack: 0 } });

describe("canonical participation boundary", () => {
  it("validates summary scope and refuses missing or negative aggregates", () => {
    const value = { tournament_id: "tour", counts: projection().counts, average_stack: 20000 };
    expect(parseParticipationSummary(value, "tour").counts.total_entries).toBe(1);
    expect(() => parseParticipationSummary(value, "other")).toThrow();
    expect(() => parseParticipationSummary({ ...value, average_stack: null }, "tour")).toThrow();
    expect(() => parseParticipationSummary({ ...value, counts: { ...value.counts, remaining: -1 } }, "tour")).toThrow();
  });
  it("accepts exact scope and normalizes optional display names", () => {
    expect(parseTournamentParticipation(projection(), "tour").seats[0].player_name).toBe("");
  });
  it("rejects another tournament and missing counts rather than showing empty", () => {
    expect(() => parseTournamentParticipation(projection(), "other")).toThrow();
    expect(() => parseTournamentParticipation({ ...projection(), counts: {} }, "tour")).toThrow();
  });
  it("preserves invalid occupancy and reason without treating it as actionable", () => {
    const p = projection();
    p.seats[0].participation_status = "anomaly";
    Object.assign(p.seats[0], { anomaly_reason: "closed_session" });
    expect(parseTournamentParticipation(p, "tour").seats[0].participation_status).toBe("anomaly");
  });
  it("refuses a nominally valid seat without exact session or with an anomaly", () => {
    const p = projection();
    Object.assign(p.seats[0], { table_session_id: null });
    expect(() => parseTournamentParticipation(p, "tour")).toThrow();
    Object.assign(p.seats[0], { table_session_id: "session", anomaly_reason: "closed_session" });
    expect(() => parseTournamentParticipation(p, "tour")).toThrow();
  });
  it("keeps NULL-alias anomalies visible alongside valid seats without inventing identity", () => {
    const p = projection();
    const invalid = { ...p.seats[0], seat_id: "legacy", table_id: null, entry_id: null,
      participation_status: "anomaly", anomaly_reason: "missing_entry" };
    const parsed = parseTournamentParticipation({ ...p, seats: [...p.seats, invalid] }, "tour");
    expect(parsed.seats.filter((s) => s.participation_status === "seated")).toHaveLength(1);
    expect(parsed.seats.find((s) => s.seat_id === "legacy")).toMatchObject({
      table_id: null, entry_id: null, participation_status: "anomaly", anomaly_reason: "missing_entry",
    });
  });
  it("still rejects valid seats with NULL alias and malformed or unexplained anomalies", () => {
    const p = projection();
    Object.assign(p.seats[0], { table_id: null });
    expect(() => parseTournamentParticipation(p, "tour")).toThrow("invalid_participation_seat");
    Object.assign(p.seats[0], { participation_status: "anomaly" });
    expect(() => parseTournamentParticipation(p, "tour")).toThrow("invalid_participation_seat");
    Object.assign(p.seats[0], { anomaly_reason: "missing_entry", table_id: 42 });
    expect(() => parseTournamentParticipation(p, "tour")).toThrow("invalid_participation_seat");
  });
});

it('retains an explicitly bagged entry without reclassifying it as waiting or registered',()=>{
 const p={...projection(),entries:[{id:'bagged-entry',player_id:'bagged-player',player_name:'Bagged TEST',entry_no:1,current_stack:20000,seat_number:null,finished_place:null,status:'bagged',participation_status:'bagged',anomaly_reason:null}]};
 expect(parseTournamentParticipation(p,'tour').entries[0]).toMatchObject({status:'bagged',participation_status:'bagged',current_stack:20000});
});
