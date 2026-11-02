import { describe, expect, it } from "vitest";
import { parsePublicTableCurrentResponse, parsePublicTableHistoryPage,parsePublicParticipationSummary } from "./publicTableHistory";

describe('public participation aggregate boundary',()=>{
  const row={tournament_id:'tour',players_remaining:3,average_stack:20000};
  it('keeps exact scoped canonical aggregates including a real zero',()=>{
    expect(parsePublicParticipationSummary([row],'tour')).toEqual({playersRemaining:3,averageStack:20000});
    expect(parsePublicParticipationSummary([{...row,players_remaining:0,average_stack:0}],'tour')).toEqual({playersRemaining:0,averageStack:0});
  });
  it('rejects missing, duplicate or another tournament instead of inventing zero',()=>{
    for(const value of [null,[],[row,row],[{...row,tournament_id:'other'}]])expect(parsePublicParticipationSummary(value,'tour')).toBeNull();
  });
  it('rejects malformed count or average rather than showing healthy-looking values',()=>{
    for(const value of [{...row,players_remaining:null},{...row,players_remaining:-1},{...row,players_remaining:1.5},
      {...row,average_stack:null},{...row,average_stack:Infinity},{...row,average_stack:-1}])expect(parsePublicParticipationSummary([value],'tour')).toBeNull();
  });
});

describe("public current-table RPC parser", () => {
  it("keeps a confirmed last-completed hand separate from waiting", () => {
    expect(parsePublicTableCurrentResponse({
      access: "public", tableId: "table-a", tableSessionId: "session-a", state: "last_completed", hand: { id: "hand-12" },
    })).toMatchObject({ state: "last_completed", hand: { id: "hand-12" } });
    expect(parsePublicTableCurrentResponse({
      access: "public", tableId: "table-a", tableSessionId: "session-a", state: "waiting", hand: null,
    })).toMatchObject({ state: "waiting", hand: null });
  });

  it("fails closed for a malformed state and clears on access revocation", () => {
    expect(parsePublicTableCurrentResponse({ access: "public", state: "idle" })).toBeNull();
    expect(parsePublicTableCurrentResponse({ access: "revoked" })).toMatchObject({ access: "revoked", hand: null });
  });
});

describe("public table history parser", () => {
  it("keeps a verified full uncalled refund separate from pot winners", () => {
    const refund = { playerId: "bb", entryNumber: 2, seatNumber: 9, name: "BB", amount: 100 };
    const parse = (result: unknown) => parsePublicTableHistoryPage({ access: "public", items: [{
      handId: "dead-sb", createdAt: "2026-10-29T01:00:00Z", pot: 100, result,
    }], nextCursor: null }, "tour", "table")?.items[0];
    expect(parse({ status: "refunded", refund })).toMatchObject({ pot: 0, result: { status: "refunded", refund } });
    for (const changed of [{ amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: Infinity },
      { playerId: "" }, { entryNumber: null }, { entryNumber: 0 }, { seatNumber: 11 }]) {
      expect(parse({ status: "refunded", refund: { ...refund, ...changed } })?.result).toEqual({ status: "pending" });
    }
    expect(parse({ status: "refunded", refund, recipients: [] })?.result).toEqual({ status: "pending" });
    expect(parse({ status: "refunded" })?.result).toEqual({ status: "pending" });
  });
  it("keeps needs-attention distinct without exposing private diagnostic or recipients", () => {
    const page = parsePublicTableHistoryPage({ access: "public", items: [{ handId: "hand", createdAt: "2026-09-17T01:00:00Z",
      result: { status: "needs_attention", last_error_code: "private", recipients: [{ name: "unverified" }] } }], nextCursor: null }, "tour", "table");
    expect(page?.items[0].result).toEqual({ status: "needs_attention" });
  });
  it("preserves tuple cursor identity for same-timestamp pages", () => {
    const page = parsePublicTableHistoryPage({
      access: "public",
      items: [
        { handId: "z", tableSessionId: "session-2", handNumber: 12, createdAt: "2026-09-17T01:00:00Z", board: ["AS"], pot: 200, bigBlind: 100, ante: 25 },
        { handId: "y", tableSessionId: "session-1", handNumber: 11, createdAt: "2026-09-17T01:00:00Z", board: [], pot: 100, bigBlind: null },
      ],
      nextCursor: { createdAt: "2026-09-17T01:00:00Z", id: "y" },
    }, "tour", "table");
    expect(page?.items.map((item) => item.handId)).toEqual(["z", "y"]);
    expect(page?.nextCursor).toEqual({ createdAt: "2026-09-17T01:00:00Z", handId: "y" });
    expect(page?.items[1].bigBlind).toBeNull();
    expect(page?.items[0].ante).toBe(25);
  });

  it("does not accept a page with a cursor that cannot perform strict tuple pagination", () => {
    expect(parsePublicTableHistoryPage({ access: "public", items: [], nextCursor: { createdAt: "same" } }, "tour", "table")).toBeNull();
  });

  it.each([undefined, "bad-cursor", 0, false, []])("does not interpret malformed cursor %j as the end of history", (nextCursor) => {
    expect(parsePublicTableHistoryPage({ access: "public", items: [], nextCursor }, "tour", "table")).toBeNull();
  });

  it("accepts only explicit null as the confirmed final page", () => {
    expect(parsePublicTableHistoryPage({ access: "public", items: [], nextCursor: null }, "tour", "table"))
      .toMatchObject({ items: [], nextCursor: null });
  });

  it("shows verified side-pot recipients with their signed net, once per entry", () => {
    const page = parsePublicTableHistoryPage({ access: "public", items: [{
      handId: "hand", createdAt: "2026-09-17T01:00:00Z", pot: 300_000, bigBlind: 20_000,
      result: { status: "verified", recipients: [
        { playerId: "a", entryNumber: 1, seatNumber: 2, name: "A", potAward: 240_000, netDelta: 160_000, potKinds: ["main"] },
        { playerId: "b", entryNumber: 1, seatNumber: 3, name: "B", potAward: 40_000, netDelta: -60_000, potKinds: ["side"] },
      ] },
    }], nextCursor: null }, "tour", "table");
    expect(page?.items[0].result).toMatchObject({ status: "verified", recipients: [
      { playerId: "a", netDelta: 160_000 }, { playerId: "b", netDelta: -60_000, potKinds: ["side"] },
    ] });
    expect(page?.items[0].pot).toBe(280_000);
  });

  it('sums chop awards once and rejects unsafe aggregate awards',()=>{
    const parse=(awards:number[])=>parsePublicTableHistoryPage({access:'public',items:[{handId:'chop',createdAt:'2026-09-17T01:00:00Z',pot:900,
      result:{status:'verified',recipients:awards.map((potAward,i)=>({playerId:`p${i}`,entryNumber:1,potAward,netDelta:0,potKinds:['main']}))}}],nextCursor:null},'tour','table')?.items[0];
    expect(parse([100,100])?.pot).toBe(200);
    expect(parse([Number.MAX_SAFE_INTEGER,1])?.result).toEqual({status:'pending'});
  });

  it("fails closed for absent, malformed, refunded-only or duplicate winner data", () => {
    const item = (result?: unknown) => ({ handId: "hand", createdAt: "2026-09-17T01:00:00Z", result });
    const parse = (result?: unknown) => parsePublicTableHistoryPage({ access: "public", items: [item(result)], nextCursor: null }, "tour", "table")?.items[0].result;
    expect(parse()).toEqual({ status: "pending" });
    expect(parse({ status: "verified", recipients: [{ playerId: "refund", potAward: 0, netDelta: 40_000, potKinds: ["main"] }] })).toEqual({ status: "pending" });
    expect(parse({ status: "verified", recipients: [{ playerId: "a", potAward: 40_000, netDelta: null, potKinds: ["main"] }] })).toEqual({ status: "pending" });
    const recipient = { playerId: "a", entryNumber: 1, potAward: 40_000, netDelta: 0, potKinds: ["main"] };
    expect(parse({ status: "verified", recipients: [recipient, recipient] })).toEqual({ status: "pending" });
  });
});
