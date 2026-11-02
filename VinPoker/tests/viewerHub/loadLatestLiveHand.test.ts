import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    read.calls.push(["from", table]);
    const query = Object.fromEntries(["select", "eq", "order", "limit"].map((method) => [
      method, (...args: unknown[]) => { read.calls.push([method, ...args]); return query; },
    ]));
    return query;
  },
} }));

import { loadLatestLiveHand } from "@/components/cashier/tournament-live/loadLatestLiveHand";

beforeEach(() => { read.calls = []; });
describe("latest hand table scope", () => {
  it.each(["table-a", "table-b"])("filters %s before limiting rather than inheriting the tournament's latest hand", table => {
    loadLatestLiveHand("tour", table);
    expect(read.calls).toContainEqual(["eq", "tournament_id", "tour"]);
    expect(read.calls).toContainEqual(["eq", "is_voided", false]);
    const scoped = read.calls.findIndex(call => call[0] === "eq" && call[1] === "table_id");
    expect(read.calls[scoped]).toEqual(["eq", "table_id", table]);
    expect(scoped).toBeLessThan(read.calls.findIndex(call => call[0] === "limit"));
  });
  it("only uses tournament scope when no table is selected", () => {
    loadLatestLiveHand("tour", null);
    expect(read.calls.some(call => call[0] === "eq" && call[1] === "table_id")).toBe(false);
  });
});
