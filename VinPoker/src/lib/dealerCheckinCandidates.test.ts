import { describe, expect, it } from "vitest";
import { mapCheckinCandidates, mergeCheckinCandidateReads } from "./dealerCheckinCandidates";

const dealer = { id: "dealer-a", full_name: "TEST Dealer", tier: "C", club_id: "club-a" };
const open = { dealer_id: dealer.id, status: "checked_in", check_in_time: "2026-10-14T11:48:00Z", check_out_time: null, dealers: { club_id: "club-a" } };
const closed = { ...open, status: "checked_out", check_out_time: "2026-10-14T12:00:00Z" };
describe("scoped check-in candidate read model", () => {
  it("does not call a currently checked-in dealer new", () => {
    expect(mapCheckinCandidates("club-a", [dealer], [open])[0].checkinStatus).toBe("already_checked_in");
  });
  it("shows previous checkout without a browser-day calculation", () => {
    expect(mapCheckinCandidates("club-a", [dealer], [closed])[0].checkinStatus).toBe("previously_checked_out");
  });
  it("shows new only for a successfully read empty attendance list", () => {
    expect(mapCheckinCandidates("club-a", [dealer], [])[0].checkinStatus).toBe("new");
    expect(() => mapCheckinCandidates("club-a", [dealer], null)).toThrow();
  });
  it("does not hide an open older attendance behind a later closed row", () => {
    expect(mapCheckinCandidates("club-a", [dealer], [closed, open])[0].checkinStatus).toBe("already_checked_in");
  });
  it("flags duplicate open or contradictory lifecycle markers", () => {
    expect(mapCheckinCandidates("club-a", [dealer], [open, open])[0].checkinStatus).toBe("ambiguous");
    expect(mapCheckinCandidates("club-a", [dealer], [{ ...open, check_out_time: closed.check_out_time }])[0].checkinStatus).toBe("ambiguous");
  });
  it("rejects malformed or cross-club results instead of reassigning their scope", () => {
    expect(() => mapCheckinCandidates("club-a", [{ ...dealer, club_id: "club-b" }], [])).toThrow();
    expect(() => mapCheckinCandidates("club-a", [dealer], [{ ...open, dealers: { club_id: "club-b" } }])).toThrow();
    expect(() => mapCheckinCandidates("club-a", [dealer], [{}])).toThrow();
  });
});

describe("complete check-in snapshot merge", () => {
  const read = (data: unknown[]) => ({ data, count: data.length, error: null });
  const row = { ...open, id: "attendance-a" };
  const latest = { ...dealer, dealer_attendance: [row] };
  it("deduplicates the same current attendance returned by both queries", () => {
    expect(mergeCheckinCandidateReads("club-a", read([latest]), read([row]))[0].checkinStatus).toBe("already_checked_in");
  });
  it("fails closed when one response is denied, missing count, or truncated", () => {
    for (const bad of [{ ...read([]), error: "denied" }, { ...read([]), count: null }, { ...read([]), count: 1 }]) {
      expect(() => mergeCheckinCandidateReads("club-a", read([latest]), bad)).toThrow();
    }
  });
  it("marks different lifecycle snapshots of the same row ambiguous", () => {
    expect(mergeCheckinCandidateReads("club-a", read([{ ...dealer, dealer_attendance: [{ ...closed, id: row.id }] }]), read([row]))[0].checkinStatus).toBe("ambiguous");
  });
  it("does not lose an older open row behind the latest closed row", () => {
    expect(mergeCheckinCandidateReads("club-a", read([{ ...dealer, dealer_attendance: [{ ...closed, id: "closed-b" }] }]), read([row]))[0].checkinStatus).toBe("already_checked_in");
  });
  it("rejects cross-linked or missing embedded attendance instead of assuming new", () => {
    expect(() => mergeCheckinCandidateReads("club-a", read([dealer]), read([]))).toThrow();
    expect(() => mergeCheckinCandidateReads("club-a", read([{ ...dealer, dealer_attendance: [{ ...row, dealer_id: "other" }] }]), read([]))).toThrow();
  });
});
