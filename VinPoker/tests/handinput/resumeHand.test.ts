import { describe, it, expect } from "vitest";
import {
  nextActionOrderFrom,
  readResumeCards,
  deriveResumeStreet,
  replayActions,
  type ResumeActionRow,
  type ResumePlayer,
} from "@/components/cashier/tournament-live/handinput/resumeHand";

describe('persisted resume deck boundary',()=>{
 const players=[{player_id:'p1',entry_number:1},{player_id:'p2',entry_number:2}];
 const rows=()=>[{player_id:'p1',entry_number:1,hole_cards:['As','Ad']},{player_id:'p2',entry_number:2,hole_cards:['Ks','Kd']}];
 it('restores exact identities and card order without changing persisted inputs',()=>{
  const board=['2h','3d','4c',null,null],cards=rows(),before=JSON.stringify({board,cards});
  expect(readResumeCards(board,cards,players)).toEqual({communitySlots:board,communityCount:3,playerHoleCards:{p1:['As','Ad'],p2:['Ks','Kd']}});
  expect(JSON.stringify({board,cards})).toBe(before);
 });
 it('keeps legacy explicit NULL undealt board/hole cards distinct from missing evidence',()=>{
  expect(readResumeCards(null,[{player_id:'p1',entry_number:1,hole_cards:null},{player_id:'p2',entry_number:2,hole_cards:[]}],players))
   .toEqual({communitySlots:[null,null,null,null,null],communityCount:0,playerHoleCards:{}});
 });
 it.each([
  [{player_id:'p1',entry_number:2,hole_cards:[]},{player_id:'p2',entry_number:2,hole_cards:[]}],
  [{player_id:'ghost',entry_number:undefined,hole_cards:[]},{player_id:'p2',entry_number:2,hole_cards:[]}],
  [{player_id:'p1',entry_number:1},{player_id:'p2',entry_number:2,hole_cards:[]}],
  [{player_id:'p1',entry_number:1,hole_cards:['As']}],
  [{player_id:'p1',entry_number:1,hole_cards:[]},{player_id:'p1',entry_number:1,hole_cards:[]}],
 ].map(cards=>({cards})))('rejects missing, duplicate or wrong-entry participants',({cards})=>{
  expect(()=>readResumeCards([],cards,players)).toThrow('Không xác minh');
 });
 it.each([
  {board:['As','2h','3d'],cards:rows()},
  {board:[],cards:[{player_id:'p1',entry_number:1,hole_cards:['As','Ad']},{player_id:'p2',entry_number:2,hole_cards:['As','Kd']}]},
  {board:[],cards:[{player_id:'p1',entry_number:1,hole_cards:['As','As']},{player_id:'p2',entry_number:2,hole_cards:[]}]},
 ])('rejects any duplicate across the persisted deck',({board,cards})=>{
  expect(()=>readResumeCards(board,cards,players)).toThrow('Không xác minh');
 });
});

function player(id: string, stack: number): ResumePlayer {
  return {
    player_id: id,
    starting_stack: stack,
    current_stack: stack,
    current_bet: 0,
    total_bet: 0,
    is_folded: false,
    is_all_in: false,
  };
}

function act(over: Partial<ResumeActionRow> & { action_order: number }): ResumeActionRow {
  return {
    player_id: over.player_id ?? "a",
    action_type: over.action_type ?? "check",
    action_amount: over.action_amount ?? 0,
    street: over.street ?? "preflop",
    action_order: over.action_order,
  };
}

describe("resumeHand — nextActionOrderFrom (the P0 collision fix)", () => {
  it("returns max(action_order) + 1 after actions 1..N", () => {
    const rows = [act({ action_order: 1 }), act({ action_order: 2 }), act({ action_order: 3 })];
    // Resuming a hand with actions 1,2,3 must submit the NEXT action as 4 — never 1.
    expect(nextActionOrderFrom(rows)).toBe(4);
  });

  it("is robust to unordered / sparse action_order values", () => {
    expect(nextActionOrderFrom([act({ action_order: 5 }), act({ action_order: 2 })])).toBe(6);
  });

  it("empty hand resumes at 1", () => {
    expect(nextActionOrderFrom([])).toBe(1);
  });
});

describe("resumeHand — deriveResumeStreet", () => {
  it("uses community-card count when no actions are further along", () => {
    expect(deriveResumeStreet([], 0)).toBe("preflop");
    expect(deriveResumeStreet([], 3)).toBe("flop");
    expect(deriveResumeStreet([], 4)).toBe("turn");
    expect(deriveResumeStreet([], 5)).toBe("river");
  });

  it("takes the furthest of community vs last action street", () => {
    // Flop dealt (3 cards) but the last action recorded is still preflop → flop.
    expect(deriveResumeStreet([act({ action_order: 1, street: "preflop" })], 3)).toBe("flop");
    // 4 cards on board, last action already on the turn → turn.
    expect(deriveResumeStreet([act({ action_order: 9, street: "turn" })], 4)).toBe("turn");
    // Actions reached the river before the community slot count caught up → river.
    expect(deriveResumeStreet([act({ action_order: 12, street: "river" })], 4)).toBe("river");
  });
});

describe("resumeHand — replayActions rebuilds mid-hand state", () => {
  it("replays a preflop line: SB/BB post, call, fold", () => {
    const base = [player("btn", 1000), player("sb", 1000), player("bb", 1000)];
    const rows: ResumeActionRow[] = [
      act({ action_order: 1, player_id: "sb", action_type: "post_sb", action_amount: 25 }),
      act({ action_order: 2, player_id: "bb", action_type: "post_bb", action_amount: 50 }),
      act({ action_order: 3, player_id: "btn", action_type: "call", action_amount: 50 }),
      act({ action_order: 4, player_id: "sb", action_type: "fold" }),
    ];
    const out = replayActions(base, rows);
    const byId = Object.fromEntries(out.map((p) => [p.player_id, p]));

    expect(byId.btn.current_stack).toBe(950);
    expect(byId.btn.current_bet).toBe(50);
    expect(byId.btn.total_bet).toBe(50);

    expect(byId.sb.is_folded).toBe(true);
    expect(byId.sb.current_stack).toBe(975); // posted 25 then folded
    expect(byId.sb.total_bet).toBe(25);

    expect(byId.bb.current_stack).toBe(950);
    expect(byId.bb.current_bet).toBe(50);
  });

  it("resets current_bet at a street boundary but keeps total_bet cumulative", () => {
    const base = [player("a", 1000), player("b", 1000)];
    const rows: ResumeActionRow[] = [
      act({ action_order: 1, player_id: "a", action_type: "bet", action_amount: 100, street: "preflop" }),
      act({ action_order: 2, player_id: "b", action_type: "call", action_amount: 100, street: "preflop" }),
      act({ action_order: 3, player_id: "a", action_type: "bet", action_amount: 200, street: "flop" }),
    ];
    const out = replayActions(base, rows);
    const a = out.find((p) => p.player_id === "a")!;
    const b = out.find((p) => p.player_id === "b")!;

    expect(a.current_bet).toBe(200); // only the flop bet — preflop bet was reset
    expect(a.total_bet).toBe(300); // cumulative across streets
    expect(a.current_stack).toBe(700);
    expect(b.current_bet).toBe(0); // reset at the flop boundary
    expect(b.total_bet).toBe(100);
  });

  it("marks a player all-in when an action empties the stack", () => {
    const base = [player("hero", 300)];
    const rows: ResumeActionRow[] = [
      act({ action_order: 1, player_id: "hero", action_type: "all_in", action_amount: 300 }),
    ];
    const out = replayActions(base, rows);
    expect(out[0].current_stack).toBe(0);
    expect(out[0].is_all_in).toBe(true);
  });

  it("does not mutate the input players", () => {
    const base = [player("a", 1000)];
    replayActions(base, [act({ action_order: 1, player_id: "a", action_type: "bet", action_amount: 100 })]);
    expect(base[0].current_stack).toBe(1000);
    expect(base[0].current_bet).toBe(0);
  });

  it("ignores actions for unknown players (seat left mid-hand)", () => {
    const base = [player("a", 1000)];
    const out = replayActions(base, [act({ action_order: 1, player_id: "ghost", action_type: "bet", action_amount: 100 })]);
    expect(out[0].current_stack).toBe(1000);
  });
});

// ── UAT wave 2 (R3): resuming an orphan MID-RUNOUT ─────────────────────────────
// The hook seeds sentCommunityStreets from the PERSISTED board count on resume, and
// the auto-advance needs replayActions to rebuild the all-in/coverer money state so
// the cover-call waiver sees the same runout it saw before the refresh. Pin the pure
// pieces: street derivation lands on the runout's current board street, and the
// rebuilt seats carry the all-in flags + zeroed stacks that make eligibleActorCount≤1.
describe("resume mid cover-call runout (UAT wave 2)", () => {
  const rows: ResumeActionRow[] = [
    act({ player_id: "sb", action_type: "post_sb", action_amount: 100, action_order: 1 }),
    act({ player_id: "bb", action_type: "post_bb", action_amount: 200, action_order: 2 }),
    act({ player_id: "shover", action_type: "all_in", action_amount: 5000, action_order: 3 }),
    act({ player_id: "cover", action_type: "call", action_amount: 4900, action_order: 4, street: "preflop" }),
  ];

  it("street derives from the persisted board (flop dealt during the runout)", () => {
    // No flop ACTIONS exist in a runout — the street must come from the board count.
    expect(deriveResumeStreet(rows, 3)).toBe("flop");
    expect(deriveResumeStreet(rows, 4)).toBe("turn");
  });

  it("replayActions rebuilds the runout money state: shover all-in at 0, coverer live", () => {
    const base = [player("sb", 10000), player("bb", 10000), player("shover", 5000), player("cover", 20000)];
    const rebuilt = replayActions(base, rows);
    const shover = rebuilt.find((p) => p.player_id === "shover")!;
    const cover = rebuilt.find((p) => p.player_id === "cover")!;
    expect(shover.is_all_in).toBe(true);
    expect(shover.current_stack).toBe(0);
    expect(cover.is_all_in).toBe(false);
    expect(cover.current_stack).toBe(15100); // 20000 − 4900 call delta
  });
});
