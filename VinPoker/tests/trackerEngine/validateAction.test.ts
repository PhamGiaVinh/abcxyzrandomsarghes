import { describe, it, expect } from "vitest";
import { validateAction, reconcileSidePots } from "@tracker-engine/validateAction.ts";
import type { ActionRow, PlayerSeed } from "@tracker-engine/types.ts";

// Standard 3-handed table. Button = seat 1, SB = seat 2, BB = seat 3.
const SEEDS: PlayerSeed[] = [
  { player_id: "P1", seat_number: 1, starting_stack: 10000 },
  { player_id: "P2", seat_number: 2, starting_stack: 10000 },
  { player_id: "P3", seat_number: 3, starting_stack: 10000 },
];
const BUTTON = 1;

it('reconciles the frozen BB ante as main-pot money instead of an uncalled wager',()=>{
  const actions=[['P2','post_sb',100],['P3','post_ante',200],['P3','post_bb',200],['P2','call',100]]
    .map(([player_id,action_type,action_amount],index)=>({player_id,action_type,action_amount,street:'preflop',action_order:index+1})) as ActionRow[];
  const pots=[{amount:600,eligible_player_ids:['P2','P3']}];
  expect(reconcileSidePots(actions,pots,'P3')).toEqual({tampered:false,serverSidePots:pots});
  expect(reconcileSidePots(actions,pots).tampered).toBe(true);
});

function streamBuilder() {
  let order = 0;
  const rows: ActionRow[] = [];
  const add = (
    player_id: string,
    action_type: ActionRow["action_type"],
    action_amount: number,
    street: ActionRow["street"] = "preflop",
  ) => {
    rows.push({ player_id, street, action_type, action_amount, action_order: ++order });
    return rows.slice();
  };
  return { add, rows: () => rows.slice() };
}

/** Blinds posted: SB 50 (P2), BB 100 (P3). Returns the prior-action stream. */
function blindsPosted() {
  const b = streamBuilder();
  b.add("P2", "post_sb", 50);
  b.add("P3", "post_bb", 100);
  return b;
}

const next = (rows: ActionRow[], order: number): number => order;

describe("validateAction — negatives", () => {
  it("1. cannot act out of turn (enforce mode)", () => {
    const prior = blindsPosted().rows();
    // After blinds it is UTG (P1, seat 1) to act, not P2.
    const r = validateAction(
      SEEDS,
      prior,
      BUTTON,
      { player_id: "P2", street: "preflop", action_type: "call", action_amount: 50, action_order: 3 },
      { enforceTurnOrder: true },
    );
    expect(r.valid).toBe(false);
    expect(r.code).toBe("OUT_OF_TURN");
  });

  it("2. cannot bet more than stack (except all-in semantics)", () => {
    // Flop, P2 first to act with a 10000 stack.
    const b = blindsPosted();
    b.add("P1", "call", 100);
    b.add("P2", "call", 50);
    b.add("P3", "check", 0);
    const r = validateAction(
      SEEDS,
      b.rows(),
      BUTTON,
      { player_id: "P2", street: "flop", action_type: "bet", action_amount: 99999, action_order: 6 },
    );
    expect(r.valid).toBe(false);
    expect(r.code).toBe("AMOUNT_EXCEEDS_STACK");

    // Betting the entire stack is a legal all-in even though it's "everything".
    const allIn = validateAction(
      SEEDS,
      b.rows(),
      BUTTON,
      { player_id: "P2", street: "flop", action_type: "all_in", action_amount: 0, action_order: 6 },
    );
    expect(allIn.valid).toBe(true);
    expect(allIn.normalizedAmount).toBe(9900); // 10000 - 100 already in
  });

  it("3. cannot raise below the minimum raise", () => {
    const b = blindsPosted();
    b.add("P1", "raise", 300); // raise-to 300, minRaise now 200
    // P2 must reach street_bet >= 500 (add >= 450). Adding 350 -> 400 is short.
    const short = validateAction(
      SEEDS,
      b.rows(),
      BUTTON,
      { player_id: "P2", street: "preflop", action_type: "raise", action_amount: 350, action_order: 4 },
    );
    expect(short.valid).toBe(false);
    expect(short.code).toBe("BELOW_MIN_RAISE");

    const full = validateAction(
      SEEDS,
      b.rows(),
      BUTTON,
      { player_id: "P2", street: "preflop", action_type: "raise", action_amount: 450, action_order: 4 },
    );
    expect(full.valid).toBe(true);
  });

  it("4. cannot check facing a bet", () => {
    const prior = blindsPosted().rows();
    const r = validateAction(
      SEEDS,
      prior,
      BUTTON,
      { player_id: "P1", street: "preflop", action_type: "check", action_amount: 0, action_order: 3 },
    );
    expect(r.valid).toBe(false);
    expect(r.code).toBe("CHECK_FACING_BET");
  });

  it("5a. cannot act after folding", () => {
    const b = blindsPosted();
    b.add("P1", "fold", 0);
    const r = validateAction(
      SEEDS,
      b.rows(),
      BUTTON,
      { player_id: "P1", street: "preflop", action_type: "call", action_amount: 100, action_order: 4 },
    );
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PLAYER_FOLDED");
  });

  it("5b. cannot act after going all-in", () => {
    const b = blindsPosted();
    b.add("P1", "all_in", 10000);
    const r = validateAction(
      SEEDS,
      b.rows(),
      BUTTON,
      { player_id: "P1", street: "preflop", action_type: "raise", action_amount: 100, action_order: 4 },
    );
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PLAYER_ALL_IN");
  });

  it("6. detects tampered side_pots", () => {
    // A short all-in produces a real main + side pot.
    const b = streamBuilder();
    b.add("P1", "all_in", 500);
    b.add("P2", "call", 1000);
    b.add("P3", "call", 1000);
    const honest = reconcileSidePots(b.rows(), [
      { amount: 1500, eligible_player_ids: ["P1", "P2", "P3"] },
      { amount: 1000, eligible_player_ids: ["P2", "P3"] },
    ]);
    expect(honest.tampered).toBe(false);

    const tampered = reconcileSidePots(b.rows(), [
      { amount: 99999, eligible_player_ids: ["P1"] },
    ]);
    expect(tampered.tampered).toBe(true);
    // Server value is authoritative regardless.
    expect(tampered.serverSidePots[0].amount).toBe(1500);
  });

  it("7. cannot advance street while action is pending", () => {
    const prior = blindsPosted().rows(); // P1, P2 still owe action preflop
    const r = validateAction(
      SEEDS,
      prior,
      BUTTON,
      { player_id: "P1", street: "flop", action_type: "bet", action_amount: 200, action_order: 3 },
    );
    expect(r.valid).toBe(false);
    expect(r.code).toBe("STREET_ACTION_PENDING");
  });

  it("rejects a player not in the hand", () => {
    const r = validateAction(
      SEEDS,
      blindsPosted().rows(),
      BUTTON,
      { player_id: "GHOST", street: "preflop", action_type: "call", action_amount: 100, action_order: 3 },
    );
    expect(r.code).toBe("PLAYER_NOT_IN_HAND");
  });
});

describe("validateAction — positives", () => {
  it("1. a normal preflop round validates action-by-action", () => {
    const b = blindsPosted();
    // UTG (P1) calls 100
    expect(
      validateAction(SEEDS, b.rows(), BUTTON, {
        player_id: "P1", street: "preflop", action_type: "call", action_amount: 100, action_order: next(b.rows(), 3),
      }, { enforceTurnOrder: true }).valid,
    ).toBe(true);
    b.add("P1", "call", 100);
    // SB (P2) completes
    const p2 = validateAction(SEEDS, b.rows(), BUTTON, {
      player_id: "P2", street: "preflop", action_type: "call", action_amount: 50, action_order: 4,
    }, { enforceTurnOrder: true });
    expect(p2.valid).toBe(true);
    expect(p2.normalizedAmount).toBe(50); // owed 100 - already-posted 50
    b.add("P2", "call", 50);
    // BB (P3) checks its option
    const p3 = validateAction(SEEDS, b.rows(), BUTTON, {
      player_id: "P3", street: "preflop", action_type: "check", action_amount: 0, action_order: 5,
    }, { enforceTurnOrder: true });
    expect(p3.valid).toBe(true);
  });

  it("2. a call is normalized down to the stack (short all-in call)", () => {
    const short: PlayerSeed[] = [
      { player_id: "P1", seat_number: 1, starting_stack: 10000 },
      { player_id: "P2", seat_number: 2, starting_stack: 120 },
      { player_id: "P3", seat_number: 3, starting_stack: 10000 },
    ];
    const b = streamBuilder();
    b.add("P2", "post_sb", 50);
    b.add("P3", "post_bb", 100);
    b.add("P1", "raise", 600);
    // P2 has only 70 left behind (120 - 50 posted); a call clamps to 70.
    const r = validateAction(short, b.rows(), BUTTON, {
      player_id: "P2", street: "preflop", action_type: "call", action_amount: 550, action_order: 4,
    });
    expect(r.valid).toBe(true);
    expect(r.normalizedAmount).toBe(70);
  });

  it("3. all-in below the min-raise is still legal (no reopen needed to record it)", () => {
    const b = blindsPosted();
    b.add("P1", "raise", 300);
    const seedsShort: PlayerSeed[] = [
      { player_id: "P1", seat_number: 1, starting_stack: 10000 },
      { player_id: "P2", seat_number: 2, starting_stack: 420 }, // 50 posted -> 370 behind
      { player_id: "P3", seat_number: 3, starting_stack: 10000 },
    ];
    const r = validateAction(seedsShort, b.rows(), BUTTON, {
      player_id: "P2", street: "preflop", action_type: "all_in", action_amount: 0, action_order: 4,
    });
    expect(r.valid).toBe(true);
    expect(r.normalizedAmount).toBe(370);
  });

  it("warn-friendly: turn order NOT enforced when the flag is off", () => {
    const prior = blindsPosted().rows();
    const r = validateAction(SEEDS, prior, BUTTON, {
      player_id: "P2", street: "preflop", action_type: "call", action_amount: 50, action_order: 3,
    }); // no enforceTurnOrder
    expect(r.valid).toBe(true); // legal action, just out of strict order
  });
});
