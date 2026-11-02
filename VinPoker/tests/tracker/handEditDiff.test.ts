// F2 — pure diff/patch builder for the completed-hand editor.
import { describe, it, expect } from "vitest";
import {
  buildHandEditPatch,
  buildHandEditSummary,
  buildEditCompletedHandArgs,
  hasHandEdit,
  type EditableHand,
} from "@/components/cashier/tournament-live/handEditDiff";

const base: EditableHand = {
  community_cards: ["As", "Kd", "Qc"],
  pot_size: 1000,
  holes: [
    { player_id: "p1", entry_number: 1, hole_cards: ["Ah", "Ac"] },
    { player_id: "p2", entry_number: 1, hole_cards: ["Kh", "Ks"] },
  ],
  actions: [
    { player_id: "p1", entry_number: 1, street: "preflop", action_type: "raise", action_amount: 400, action_order: 1 },
    { player_id: "p2", entry_number: 1, street: "preflop", action_type: "call", action_amount: 400, action_order: 2 },
    { player_id: "p1", entry_number: 1, street: "flop", action_type: "bet", action_amount: 600, action_order: 3 },
  ],
};
const clone = (h: EditableHand): EditableHand => JSON.parse(JSON.stringify(h));

describe("buildHandEditPatch — PATCH minimisation", () => {
  it("no change → every section null", () => {
    const p = buildHandEditPatch(base, clone(base));
    expect(p).toEqual({ p_community_cards: null, p_hole_cards: null, p_actions: null, p_pot_size: null, p_side_pots: null });
    expect(hasHandEdit(p)).toBe(false);
  });

  it("board change → only p_community_cards set", () => {
    const e = clone(base); e.community_cards[1] = "Kc";
    const p = buildHandEditPatch(base, e);
    expect(p.p_community_cards).toEqual(["As", "Kc", "Qc"]);
    expect(p.p_hole_cards).toBeNull();
    expect(p.p_actions).toBeNull();
    expect(hasHandEdit(p)).toBe(true);
  });

  it("hole change → only p_hole_cards set", () => {
    const e = clone(base); e.holes[1].hole_cards = ["Kh", "Kc"];
    const p = buildHandEditPatch(base, e);
    expect(p.p_hole_cards).not.toBeNull();
    expect(p.p_community_cards).toBeNull();
    expect(p.p_actions).toBeNull();
  });

  it("action edit → p_actions + recomputed display pot (side_pots too)", () => {
    const e = clone(base); e.actions[2].action_amount = 1000; // bet 600 → 1000
    const p = buildHandEditPatch(base, e);
    expect(p.p_actions).not.toBeNull();
    expect(p.p_pot_size).toBeGreaterThan(0);
    expect(p.p_side_pots).not.toBeNull();
  });

  it("delete a row keeps the surviving action_order values (no renumber)", () => {
    const e = clone(base); e.actions = e.actions.filter((a) => a.action_order !== 2); // drop #2
    const p = buildHandEditPatch(base, e);
    expect(p.p_actions!.map((a) => a.action_order)).toEqual([1, 3]); // gap at 2 kept
  });
});

describe("buildEditCompletedHandArgs — exact rpc shape (NO actor arg)", () => {
  it("produces the p_* arg object without any actor param", () => {
    const patch = buildHandEditPatch(base, clone(base));
    const args = buildEditCompletedHandArgs({ tournamentId: "t1", handId: "h1", reason: "sửa lá", patch });
    expect(Object.keys(args).sort()).toEqual(
      ["p_actions", "p_community_cards", "p_hand_id", "p_hole_cards", "p_pot_size", "p_reason", "p_side_pots", "p_tournament_id"].sort(),
    );
    expect(args).not.toHaveProperty("p_actor_user_id");
    expect(args.p_tournament_id).toBe("t1");
    expect(args.p_hand_id).toBe("h1");
    expect(args.p_reason).toBe("sửa lá");
  });
});

describe("buildHandEditSummary — VN diff lines", () => {
  it("lists changes and always ends with the display-only warning", () => {
    const e = clone(base); e.community_cards[1] = "Kc";
    const s = buildHandEditSummary(base, e);
    expect(s.some((l) => l.includes("Board:") && l.includes("Kd") && l.includes("Kc"))).toBe(true);
    expect(s[s.length - 1]).toBe("Chỉ thay đổi HIỂN THỊ — chip và kết quả đã lưu KHÔNG đổi.");
  });

  it("reports a deleted action + pot recompute", () => {
    const e = clone(base); e.actions = e.actions.filter((a) => a.action_order !== 3);
    const s = buildHandEditSummary(base, e);
    expect(s.some((l) => l.includes("Xoá hành động #3"))).toBe(true);
    expect(s).toContain("Pot đã lưu: 1000 · Pot từ action nháp: 800");
  });
});
