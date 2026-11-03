import { describe, expect, it, vi } from "vitest";
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: vi.fn() }));
import { parseFloorPayoutResults } from "./FloorPayoutResults";

const result = { ok: true, tournamentId: "tour-a", published: true, checkedAt: "2026-11-03T00:00:00Z",
  items: [{ fromPlace: 1, toPlace: 1, amountPerPlayer: 4000000, playerName: "Internal winner", avatarUrl: null, resultStatus: "official" }] };

describe("internal Floor result contract", () => {
  it("accepts finalized internal names before a payment marker exists", () => {
    expect(parseFloorPayoutResults(result, "tour-a").items[0].playerName).toBe("Internal winner");
  });
  it("rejects a response from another tournament", () => {
    expect(() => parseFloorPayoutResults(result, "tour-b")).toThrow();
  });
  it.each([NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid server amounts (%s)", (amountPerPlayer) => {
    expect(() => parseFloorPayoutResults({ ...result, items: [{ ...result.items[0], amountPerPlayer }] }, "tour-a")).toThrow();
  });
  it("rejects ambiguous ranks and unsuccessful responses", () => {
    expect(() => parseFloorPayoutResults({ ...result, items: [{ ...result.items[0], toPlace: 2 }] }, "tour-a")).toThrow();
    expect(() => parseFloorPayoutResults({ ...result, ok: false }, "tour-a")).toThrow();
  });
});
