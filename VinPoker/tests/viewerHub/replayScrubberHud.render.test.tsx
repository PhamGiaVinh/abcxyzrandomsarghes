// B1 (liveReplayHud → ReplayScrubber `hud`) — the RPT-style replay HUD. Pins:
// hud absent → byte-identical scrubber (no HUD bar / tabs / jump-to-end); hud →
// BB/POT bar uses the HAND's OWN blind, TÓM TẮT shows winner rows ±BB from
// ending−starting stacks + bullets from actions only (no hole-card source).
import { describe, it, expect, vi } from "vitest";
import { act, render, cleanup, fireEvent } from "@testing-library/react";
import i18n from "@/i18n";
import { ReplayScrubber } from "@/components/cashier/tournament-live/ReplayScrubber";
import { buildReplayFrames, type ReplayHand } from "@/lib/tracker-poker/replayEngine";
import { resolveVerifiedShowdownPresentation } from "@/lib/tracker-poker/replayBestFiveFocus";

// jsdom has no ResizeObserver; the Radix <Slider> inside the scrubber needs one.
class ROStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ROStub;

const hand: ReplayHand = {
  hand_id: "hand-141",
  hand_number: 141,
  button_seat: 1,
  community_cards: ["Th", "7c", "6d", "7s", "Ah"],
  big_blind: 300000, // the HAND's own level — ±BB must use this
  players: [
    { player_id: "a", seat_number: 1, display_name: "GUIDO", starting_stack: 12300000, ending_stack: 10200000, hole_cards: ["Qh", "Jd"] },
    { player_id: "b", seat_number: 2, display_name: "KIÊN", starting_stack: 2400000, ending_stack: 4500000, hole_cards: ["Kh", "Kc"] },
  ],
  actions: [
    { player_id: "a", street: "preflop", action_type: "post_sb", action_amount: 150000, action_order: 1 },
    { player_id: "b", street: "preflop", action_type: "post_bb", action_amount: 300000, action_order: 2 },
    { player_id: "b", street: "preflop", action_type: "all_in", action_amount: 2100000, action_order: 3 },
    { player_id: "a", street: "preflop", action_type: "call", action_amount: 1950000, action_order: 4 },
  ],
};

function presentationFor(replayHand: ReplayHand) {
  const frame = buildReplayFrames(replayHand).at(-1);
  if (!frame) throw new Error("fixture must build a final replay frame");
  return resolveVerifiedShowdownPresentation({
    handId: replayHand.hand_id ?? `hand-${replayHand.hand_number}`,
    frame,
    finalFrameIndex: replayHand.actions.length,
    settlement: replayHand.publicSettlement,
    locale: "vi",
  });
}

const chopHand: ReplayHand = {
  hand_id: "hand-8",
  hand_number: 8,
  button_seat: 1,
  community_cards: ["As", "Kd", "Qc", "Jh", "Ts"],
  big_blind: 100,
  players: [
    { player_id: "a", seat_number: 1, display_name: "Alice", starting_stack: 1000, ending_stack: 1000, hole_cards: ["2c", "3c"] },
    { player_id: "b", seat_number: 2, display_name: "Bob", starting_stack: 1000, ending_stack: 1000, hole_cards: ["4d", "5d"] },
  ],
  actions: [
    { player_id: "a", street: "preflop", action_type: "all_in", action_amount: 1000, action_order: 1 },
    { player_id: "b", street: "preflop", action_type: "call", action_amount: 1000, action_order: 2 },
  ],
};

const verifiedHand: ReplayHand = {
  ...hand,
  publicSettlement: {
    schemaVersion: "settlement-outcome-v1",
    status: "verified",
    players: [
      { playerId: "a", potAward: 0, refund: 0, netDelta: -2_100_000 },
      { playerId: "b", potAward: 4_200_000, refund: 300_000, netDelta: 2_100_000 },
    ],
    pots: [{
      potId: "main-0",
      kind: "main",
      amount: 4_200_000,
      winnerIds: ["b"],
      allocations: [{ potId: "main-0", winnerId: "b", amount: 4_200_000 }],
    }],
    refunds: [{ playerId: "b", amount: 300_000, sourceActionId: "refund-b" }],
    handRanks: [{
      playerId: "b",
      category: "two_pair",
      bestFive: ["Kh", "Kc", "7c", "7s", "Ah"],
      kickers: ["A"],
    }],
  },
};

const verifiedChopHand: ReplayHand = {
  ...chopHand,
  publicSettlement: {
    schemaVersion: "settlement-outcome-v1",
    status: "verified",
    players: [
      { playerId: "a", potAward: 1_000, refund: 0, netDelta: 0 },
      { playerId: "b", potAward: 1_000, refund: 0, netDelta: 0 },
    ],
    pots: [{
      potId: "main-0",
      kind: "main",
      amount: 2_000,
      winnerIds: ["a", "b"],
      allocations: [
        { potId: "main-0", winnerId: "a", amount: 1_000 },
        { potId: "main-0", winnerId: "b", amount: 1_000 },
      ],
    }],
    refunds: [],
    handRanks: [
      { playerId: "a", category: "straight", bestFive: ["As", "Kd", "Qc", "Jh", "Ts"], kickers: [] },
      { playerId: "b", category: "straight", bestFive: ["As", "Kd", "Qc", "Jh", "Ts"], kickers: [] },
    ],
  },
};

const verifiedRefundOnlyLoserHand: ReplayHand = {
  ...verifiedHand,
  publicSettlement: {
    ...verifiedHand.publicSettlement!,
    players: [
      { playerId: "a", potAward: 0, refund: 300_000, netDelta: -2_100_000 },
      { playerId: "b", potAward: 4_200_000, refund: 0, netDelta: 2_100_000 },
    ],
    refunds: [{ playerId: "a", amount: 300_000, sourceActionId: "refund-a" }],
  },
};

const verifiedCheckedDownHand: ReplayHand = {
  ...verifiedHand,
  actions: verifiedHand.actions.map((action) => (
    action.action_type === "all_in" ? { ...action, action_type: "bet" } : action
  )),
};

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("ReplayScrubber B1 HUD (additive `hud` prop)", () => {
  it("schedules payout before the parent exposes a final-frame presentation", () => {
    vi.useFakeTimers();
    const onRunoutPresentation = vi.fn();
    const view = render(<ReplayScrubber hand={verifiedCheckedDownHand} onFrame={() => {}} hud
      showdownPresentation={null} onRunoutPresentation={onRunoutPresentation} />);
    fireEvent.click(view.getByTitle("Tới cuối (showdown)"));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "pot_collect" });
    act(() => vi.advanceTimersByTime(420));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "pot_award", potAwardIndex: 0 });
    act(() => vi.advanceTimersByTime(3_419));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0].phase).toBe("pot_award");
    act(() => vi.advanceTimersByTime(1));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0].phase).toBe("static");
  });

  it("hud absent → no HUD bar, no tabs, no jump-to-end (byte-identical scrubber)", () => {
    const { container, queryByTestId, queryByTitle } = render(<ReplayScrubber hand={hand} onFrame={() => {}} />);
    expect(queryByTestId("replay-hud-bar")).toBeNull();
    expect(queryByTestId("replay-hud-summary")).toBeNull();
    expect(queryByTitle("Tới cuối (showdown)")).toBeNull();
    expect(container.textContent).not.toContain("Tóm tắt");
  });

  it("hud → BB/POT bar renders with the hand's own blind (300k)", () => {
    const { getByTestId } = render(<ReplayScrubber hand={hand} onFrame={() => {}} hud />);
    expect(getByTestId("replay-hud-bar").textContent).toContain("300k");
    expect(getByTestId("replay-hud-bar").textContent).toContain("POT");
  });

  it("hud keeps legacy settlement hidden even at the final frame", () => {
    const { getByTestId, getByTitle } = render(<ReplayScrubber hand={hand} onFrame={() => {}} hud />);
    expect(getByTestId("replay-hud-summary").textContent).toMatch(/Chưa có kết quả|No result yet/);

    fireEvent.click(getByTitle("Tới cuối (showdown)"));
    const s = getByTestId("replay-hud-summary").textContent || "";
    expect(s).toMatch(/Chưa có kết quả|No result yet/);
    expect(s).toContain("KIÊN");
    expect(s).toContain("all-in 7 BB");
    expect(s).not.toContain("{{bb}}");
    expect(s).not.toContain("+4.2M");
    expect(s).not.toContain("Hoàn +300k");
  });

  it("hud → jump-to-end lands on the final frame (step N/N)", () => {
    const { getByTitle, container } = render(<ReplayScrubber hand={hand} onFrame={() => {}} hud />);
    fireEvent.click(getByTitle("Tới cuối (showdown)"));
    const last = hand.actions.length; // frames = actions + initial
    expect(container.textContent).toContain(`${last}/${last}`);
  });

  it("hud → HÀNH ĐỘNG tab still lists every action", () => {
    const { getByText, container } = render(<ReplayScrubber hand={hand} onFrame={() => {}} hud />);
    fireEvent.click(getByText("Hành động"));
    expect(container.textContent).toContain("All-In");
    expect(container.textContent).toContain("Call");
  });

  it("hud uses touch-sized controls and selecting an action pushes its exact frame", () => {
    const onFrame = vi.fn();
    const { getByTestId, getByText } = render(<ReplayScrubber hand={hand} onFrame={onFrame} hud />);
    fireEvent.click(getByText("Hành động"));
    const allIn = getByText(/All-In/i).closest("button");
    expect(allIn).toBeTruthy();
    expect(allIn!.className).toContain("min-h-11");
    fireEvent.click(allIn!);
    expect(onFrame.mock.calls.at(-1)?.[0].index).toBe(3);
    expect(onFrame.mock.calls.at(-1)?.[1]).toBe("scrub");
    expect(getByTestId("replay-action-rail").className).toContain("rounded-2xl");
  });

  it("runs the all-in result timeline in order and cancels it when scrubbed", () => {
    vi.useFakeTimers();
    const onRunoutPresentation = vi.fn();
    const view = render(
      <ReplayScrubber
        hand={verifiedHand}
        onFrame={() => {}}
        hud
        showdownPresentation={presentationFor(verifiedHand)}
        onRunoutPresentation={onRunoutPresentation}
      />,
    );

    fireEvent.click(view.getByTitle("Phát"));
    for (let step = 0; step < 4; step += 1) {
      act(() => vi.advanceTimersByTime(1_000));
    }
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "hole_hold", visibleBoardCount: 0 });
    act(() => vi.advanceTimersByTime(650));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "flop", visibleBoardCount: 3 });
    act(() => vi.advanceTimersByTime(1_350));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "turn", visibleBoardCount: 4 });

    fireEvent.click(view.getByTitle("Lùi 1 bước"));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toBeNull();
    vi.useRealTimers();
  });

  it('reports manual seek even when already on the playback terminal frame',()=>{
    vi.useFakeTimers();
    try{
      const onFrame=vi.fn();
      const view=render(<ReplayScrubber hand={verifiedHand} onFrame={onFrame} hud showdownPresentation={presentationFor(verifiedHand)}/>);
      fireEvent.click(view.getByTitle('Phát'));
      for(let step=0;step<verifiedHand.actions.length;step++)act(()=>vi.advanceTimersByTime(1000));
      expect(onFrame.mock.calls.at(-1)?.[1]).toBe('playback');
      fireEvent.click(view.getByTitle('Tới cuối (showdown)'));
      expect(onFrame.mock.calls.at(-1)?.[0].index).toBe(verifiedHand.actions.length);
      expect(onFrame.mock.calls.at(-1)?.[1]).toBe('scrub');
    }finally{vi.useRealTimers();}
  });

  it("direct showdown jump collects committed chips before presenting the verified pot", () => {
    vi.useFakeTimers();
    const onRunoutPresentation = vi.fn();
    const view = render(
      <ReplayScrubber
        hand={verifiedHand}
        onFrame={() => {}}
        hud
        showdownPresentation={presentationFor(verifiedHand)}
        onRunoutPresentation={onRunoutPresentation}
      />,
    );
    fireEvent.click(view.getByTitle("Tới cuối (showdown)"));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "pot_collect", visibleBoardCount: 5 });
    act(() => vi.advanceTimersByTime(420));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "pot_award", potAwardIndex: 0 });
  });

  it("keeps the verified pot result visible for 3 seconds after chip arrival without an all-in", () => {
    vi.useFakeTimers();
    const onRunoutPresentation = vi.fn();
    const view = render(
      <ReplayScrubber
        hand={verifiedCheckedDownHand}
        onFrame={() => {}}
        hud
        showdownPresentation={presentationFor(verifiedCheckedDownHand)}
        onRunoutPresentation={onRunoutPresentation}
      />,
    );

    fireEvent.click(view.getByText("Showdown"));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "pot_collect" });
    act(() => vi.advanceTimersByTime(420));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "pot_award", potAwardIndex: 0 });
    act(() => vi.advanceTimersByTime(3_419));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "pot_award", potAwardIndex: 0 });
    act(() => vi.advanceTimersByTime(1));
    expect(onRunoutPresentation.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "static", potAwardIndex: 0 });
    expect(view.getByTestId("replay-hud-winner-b")).toBeTruthy();
  });

  it("hud does not name a reconstructed Broadway split without server proof", () => {
    const { getByTestId, getByText, queryByTestId } = render(<ReplayScrubber hand={chopHand} onFrame={() => {}} hud />);
    fireEvent.click(getByText("Showdown"));
    expect(queryByTestId("replay-hud-chop")).toBeNull();
    expect(getByTestId("replay-hud-summary").textContent).toMatch(/Chưa có kết quả|No result yet/);
  });

  it("shows only the verified winner identity at settlement and removes payout details", () => {
    vi.useFakeTimers();
    const { getByTestId, getByTitle, queryByTestId } = render(
      <ReplayScrubber hand={verifiedHand} onFrame={() => {}} hud showdownPresentation={presentationFor(verifiedHand)} />,
    );
    expect(queryByTestId("replay-hud-winner-b")).toBeNull();

    fireEvent.click(getByTitle("Tới cuối (showdown)"));
    act(() => vi.advanceTimersByTime(420));
    const winner = getByTestId("replay-hud-winner-b");
    expect(winner.textContent).toContain("KIÊN");
    expect(winner.textContent).toMatch(/Ghế 2|Seat 2/);
    expect(winner.textContent).toContain("Hai đôi K và 7 · Kicker A");
    expect(winner.textContent).not.toMatch(/Thắng pot|Pot award|\+4\.2M|Hoàn|Refund|\+300k|Bộ 5 lá/i);
    expect(queryByTestId("replay-hand-rank-b")).toBeNull();
    expect(queryByTestId("replay-best-five-b")).toBeNull();

    fireEvent.click(getByTitle("Lùi 1 bước"));
    expect(queryByTestId("replay-hud-winner-b")).toBeNull();
    expect(getByTestId("replay-hud-summary").textContent).toMatch(/Chưa có kết quả|No result yet/);
  });

  it("shows the chop banner and one identity row per verified winner without pot shares", () => {
    vi.useFakeTimers();
    const { getByTestId, getByTitle } = render(
      <ReplayScrubber hand={verifiedChopHand} onFrame={() => {}} hud showdownPresentation={presentationFor(verifiedChopHand)} />,
    );
    fireEvent.click(getByTitle("Tới cuối (showdown)"));
    act(() => vi.advanceTimersByTime(420));
    expect(getByTestId("replay-hud-chop").textContent).toMatch(/Chop pot|Chia đôi pot/i);
    expect(getByTestId("replay-hud-winner-a").textContent).toMatch(/Alice.*Ghế 1|Alice.*Seat 1/);
    expect(getByTestId("replay-hud-winner-b").textContent).toMatch(/Bob.*Ghế 2|Bob.*Seat 2/);
    expect(getByTestId("replay-hud-summary").textContent).not.toContain("+1k");
  });

  it("does not render a refund-only player row while retaining a payout-plus-refund winner", () => {
    vi.useFakeTimers();
    const first = render(
      <ReplayScrubber hand={verifiedRefundOnlyLoserHand} onFrame={() => {}} hud showdownPresentation={presentationFor(verifiedRefundOnlyLoserHand)} />,
    );
    fireEvent.click(first.getByTitle("Tới cuối (showdown)"));
    act(() => vi.advanceTimersByTime(420));
    expect(first.getByTestId("replay-hud-winner-b")).toBeTruthy();
    expect(first.queryByTestId("replay-hud-winner-a")).toBeNull();
    expect(first.queryByTestId("replay-hud-refund-a")).toBeNull();
    first.unmount();

    const second = render(
      <ReplayScrubber hand={verifiedHand} onFrame={() => {}} hud showdownPresentation={presentationFor(verifiedHand)} />,
    );
    fireEvent.click(second.getByTitle("Tới cuối (showdown)"));
    act(() => vi.advanceTimersByTime(420));
    expect(second.getByTestId("replay-hud-winner-b")).toBeTruthy();
    expect(second.getByTestId("replay-hud-summary").textContent).not.toMatch(/Hoàn|Refund|\+300k/i);
  });

  it("deduplicates a winner who receives allocations from multiple side-pot layers", () => {
    vi.useFakeTimers();
    const multiPotHand: ReplayHand = {
      ...verifiedHand,
      publicSettlement: {
        ...verifiedHand.publicSettlement!,
        pots: [
          {
            potId: "main-0",
            kind: "main",
            amount: 2_000_000,
            winnerIds: ["b"],
            allocations: [{ potId: "main-0", winnerId: "b", amount: 2_000_000 }],
          },
          {
            potId: "side-1",
            kind: "side",
            amount: 2_200_000,
            winnerIds: ["b"],
            allocations: [{ potId: "side-1", winnerId: "b", amount: 2_200_000 }],
          },
        ],
      },
    };
    const { getByTitle, queryAllByTestId } = render(
      <ReplayScrubber hand={multiPotHand} onFrame={() => {}} hud showdownPresentation={presentationFor(multiPotHand)} />,
    );
    fireEvent.click(getByTitle("Tới cuối (showdown)"));
    act(() => vi.advanceTimersByTime(420));
    expect(queryAllByTestId("replay-hud-winner-b")).toHaveLength(1);
  });

  it("a keyed hand switch emits the new hand's initial frame before any settlement", () => {
    const onFrame = vi.fn();
    const { getByTitle, rerender } = render(
      <ReplayScrubber key="hand-a" hand={hand} onFrame={onFrame} hud />,
    );
    fireEvent.click(getByTitle("Tới cuối (showdown)"));
    expect(onFrame.mock.calls.at(-1)?.[0].index).toBe(hand.actions.length);

    rerender(<ReplayScrubber key="hand-b" hand={chopHand} onFrame={onFrame} hud />);
    const firstNewFrame = onFrame.mock.calls.at(-1)?.[0];
    expect(firstNewFrame.index).toBe(0);
    expect(firstNewFrame.payoutVerified).toBe(false);
    expect(firstNewFrame.potAwards).toEqual([]);
  });

  it("hud translates all replay chrome in English", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const { getByText, getByTitle } = render(<ReplayScrubber hand={hand} onFrame={() => {}} hud />);
    expect(getByText("Summary")).toBeTruthy();
    expect(getByText("Actions")).toBeTruthy();
    expect(getByTitle("Previous action")).toBeTruthy();
    expect(getByTitle("Go to showdown")).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage("vi");
    });
  });
});

// ── UAT wave 2 (Fix 3): trackBets forwards into the frames the scrubber emits ──
describe("ReplayScrubber trackBets (additive prop)", () => {
  it("absent → frames carry NO bet keys (byte-identical); set → current_bet present", () => {
    let plainFrame: any = null;
    let betsFrame: any = null;
    render(<ReplayScrubber hand={hand} onFrame={(f) => (plainFrame = f)} />);
    render(<ReplayScrubber hand={hand} onFrame={(f) => (betsFrame = f)} trackBets />);
    expect(plainFrame).toBeTruthy();
    expect(betsFrame).toBeTruthy();
    expect(plainFrame.seats.some((s: any) => "current_bet" in s)).toBe(false);
    expect(betsFrame.seats.every((s: any) => "current_bet" in s)).toBe(true);
  });
});
