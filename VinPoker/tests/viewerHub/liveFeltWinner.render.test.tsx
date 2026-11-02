import { describe, expect, it, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveFelt, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";
import {
  selectVerifiedPotLayerPresentation,
  type BestFiveFocus,
  type VerifiedShowdownPresentation,
} from "@/lib/tracker-poker/replayBestFiveFocus";

function seat(overrides: Partial<SeatInfo>): SeatInfo {
  return {
    player_id: overrides.player_id ?? "player",
    display_name: overrides.display_name ?? "Player",
    seat_number: overrides.seat_number ?? 1,
    chip_count: overrides.chip_count ?? 20_000,
    is_active: true,
    table_id: "table-1",
    position: "",
    ...overrides,
  };
}

const winner = seat({
  player_id: "tom",
  display_name: "Tom Dwan",
  seat_number: 1,
  hole_cards: ["Jd", "Jh"],
  pot_winner: true,
  payout_award: 20_000,
  net_won: 10_000,
  hand_rank: {
    category: "quads",
    best_five: ["Jd", "Jh", "Jc", "Js", "Ah"],
    kickers: ["A"],
  },
});
const refundOnly = seat({
  player_id: "phil",
  display_name: "Phil Ivey",
  seat_number: 2,
  chip_count: 0,
  hole_cards: ["Qd", "As"],
  pot_winner: false,
  payout_award: 0,
  refund_award: 5_000,
});

const focus: BestFiveFocus = {
  enabled: true,
  winnerPlayerIds: new Set(["tom"]),
  boardCardCodes: new Set(["Jc", "Js", "Ah"]),
  holeCardCodesByPlayerId: new Map([["tom", new Set(["Jd", "Jh"])]]),
};

const showdownPresentation: VerifiedShowdownPresentation = {
  enabled: true,
  handId: "hand-1",
  frameIndex: 7,
  isChop: false,
  potLayers: [{
    potId: "main-1",
    kind: "main",
    amount: 20_000,
    winnerPlayerIds: ["tom"],
    allocations: [{ playerId: "tom", amount: 20_000 }],
  }],
  winners: [{
    playerId: "tom",
    playerName: "Tom Dwan",
    seatNumber: 1,
    category: "four_of_a_kind",
    bestFive: ["Jd", "Jh", "Jc", "Js", "Ah"],
    kickers: ["A"],
    rankingText: "Four Jacks - Ace kicker",
    holeBestFive: new Set(["Jd", "Jh"]),
  }],
  focus,
};

const baseProps = {
  seats: [winner, refundOnly],
  lastActorId: null,
  toActId: null,
  displayCards: ["Kh", "Jc", "Qh", "Ah", "Js"],
  potSize: 20_000,
  potBreakdown: null,
  multiTableUnresolved: false,
  handNumber: 1,
  latestAction: null,
  formatBB: (amount: number) => `${(amount / 200).toFixed(0)} BB`,
};

function cardClass(html: string, code: string): string {
  const match = html.match(new RegExp(`<[^>]+data-card-code="${code}"[^>]+class="([^"]*)"`));
  return match?.[1] ?? "";
}

describe("LiveFelt verified best-five focus", () => {
  it.each([false,true])('keeps nine-seat board and one active pot structurally separate through collection/awards (portrait=%s)',portrait=>{
    vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
    vi.useFakeTimers();
    try{
      const nineSeats=Array.from({length:9},(_,i)=>seat({
        player_id:i===0?'tom':`nine-${i}`,seat_number:i+1,
        display_name:`TEST long player name at seat ${i+1}`,chip_count:i===0?7000:1000,
        payout_starting_stack:1000,is_all_in:true,current_bet:100,
        ...(i===0?{payout_award:6000,pot_winner:true,hole_cards:['Jd','Jh']}:{}),
      }));
      const presentation:VerifiedShowdownPresentation={...showdownPresentation,potLayers:[0,1,2].map(index=>({
        potId:`nine-pot-${index}`,kind:index===0?'main':'side',amount:2000,
        winnerPlayerIds:['tom'],allocations:[{playerId:'tom',amount:2000}],
      }))};
      const props={...baseProps,seats:nineSeats,potSize:6000,viewerLayout:true,viewerAmountsInBB:true,tableFx:true,portrait,showdownPresentation:presentation};
      const view=render(<LiveFelt {...props} replayRunoutPhase="pot_collect"
        replayRunoutPresentation={{key:'nine-pots',phase:'pot_collect',visibleBoardCount:5,potAwardIndex:null}}/>);
      const checkBoard=()=>{
        const board=view.getByTestId('board-cards');
        expect(board.querySelectorAll('[data-card-code]')).toHaveLength(5);
        expect(view.getAllByTestId('seat-holecards')).toHaveLength(9);
        expect(board.querySelector('[data-testid^="felt-settlement-"]')).toBeNull();
        expect(view.queryByTestId('felt-total-pot')).toBeNull();
      };
      checkBoard();expect(view.getAllByTestId('felt-settlement-collect-stack')).toHaveLength(9);
      expect(view.getByTestId('felt-stack-tom')).toHaveAttribute('data-stack-target','1000');
      for(const phase of ['pot_award','static'] as const){
        for(let index=0;index<3;index++){
          view.rerender(<LiveFelt {...props} replayRunoutPhase={phase}
            replayRunoutPresentation={{key:'nine-pots',phase,visibleBoardCount:5,potAwardIndex:index}}/>);
          checkBoard();
          expect(view.queryByTestId('felt-settlement-collect-center')).toBeNull();
          const pots=view.container.querySelectorAll('[data-testid^="felt-settlement-pot-"]');
          expect(pots).toHaveLength(1);
          expect(pots[0]).toHaveAttribute('data-testid',`felt-settlement-pot-${index===0?'main':'side'}-0`);
          expect(pots[0].className.includes('-translate-y-1/2')).toBe(portrait);
          expect((pots[0] as HTMLElement).style.marginTop).toBe(portrait?'16px':'24px');
          if(phase==='pot_award')act(()=>vi.advanceTimersByTime(420));
          const credited=phase==='static'?6000:(index+1)*2000;
          expect(view.getByTestId('felt-stack-tom')).toHaveAttribute('data-stack-target',String(1000+credited));
          const total=Array.from(view.container.querySelectorAll('[data-testid^="felt-stack-"]'))
            .reduce((sum,element)=>sum+Number(element.getAttribute('data-stack-target')),0);
          expect(total).toBe(9000+credited);
        }
      }
    }finally{cleanup();vi.useRealTimers();vi.unstubAllGlobals();}
  });
  it.each(['pot_collect','static'] as const)('keeps the landscape %s pot below its anchor rather than lifting it across the board',phase=>{
    vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
    try {
    const view=render(<LiveFelt {...baseProps} viewerLayout tableFx portrait={false}
      showdownPresentation={showdownPresentation}
      replayRunoutPresentation={{key:'board-clearance',phase,visibleBoardCount:5,potAwardIndex:0}} />);
    const pot=view.getByTestId(phase==='pot_collect'?'felt-settlement-collect-center':'felt-settlement-pot-main-0');
    expect(pot.className).not.toContain('-translate-y-1/2');
    // Existing scaled clearance plus the reveal's8px travel and8px breathing room.
    expect(pot.style.marginTop).toBe('24px');
    } finally {cleanup();vi.unstubAllGlobals();}
  });
  it('keeps portrait centering with clearance for the actual narrow-view board reveal',()=>{
    vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
    try{
      const view=render(<LiveFelt {...baseProps} viewerLayout tableFx portrait
        showdownPresentation={showdownPresentation}
        replayRunoutPresentation={{key:'portrait-clearance',phase:'pot_collect',visibleBoardCount:5,potAwardIndex:0}}/>);
      const pot=view.getByTestId('felt-settlement-collect-center');
      expect(pot.className).toContain('-translate-y-1/2');expect(pot.style.marginTop).toBe('16px');
    }finally{cleanup();vi.unstubAllGlobals();}
  });
  it("focuses the exact Hand #1 five cards and dims every other face-up card", () => {
    const html = renderToStaticMarkup(
      <LiveFelt {...baseProps} tableFx bestFiveFocus={focus} showdownResult="winner" />,
    );

    expect(html).toContain("tracker-best-five-focus-active");
    expect((html.match(/tracker-best-five-card/g) ?? []).length).toBe(5);
    for (const code of ["Jd", "Jh", "Jc", "Js", "Ah"]) {
      expect(cardClass(html, code)).toContain("tracker-best-five-card");
    }
    for (const code of ["Kh", "Qh", "Qd", "As"]) {
      expect(cardClass(html, code)).toContain("tracker-non-best-five-card");
    }
  });

  it("keeps only the winner avatar glow and removes payout, rank, refund, and duplicate best-five text", () => {
    const html = renderToStaticMarkup(
      <LiveFelt {...baseProps} tableFx bestFiveFocus={focus} showdownResult="winner" />,
    );

    expect((html.match(/tracker-win-glow/g) ?? []).length).toBe(1);
    expect(html).not.toContain('data-testid="seat-net-won"');
    expect(html).not.toContain('data-testid="seat-pot-award"');
    expect(html).not.toContain('data-testid="seat-hand-rank"');
    expect(html).not.toContain('data-testid="seat-refund-award"');
    expect(html).not.toMatch(/Thắng pot|Hoàn \+5k|quads|Kicker|Bộ 5 lá mạnh nhất/i);
    expect(html).toContain("20k");
    expect(html).toContain("100 BB");
  });

  it("shows verified ranking in the center only during the winner phase", () => {
    const html = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        tableFx
        bestFiveFocus={focus}
        showdownPresentation={showdownPresentation}
        bestFiveFocusPhase="static"
        showdownResult="winner"
      />,
    );

    expect(html).toContain('data-testid="felt-showdown-ranking"');
    expect(html).toContain('data-testid="felt-showdown-ranking-tom"');
    expect(html).toContain(showdownPresentation.winners[0].rankingText);

    const dimmed = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        tableFx
        bestFiveFocus={focus}
        showdownPresentation={showdownPresentation}
        bestFiveFocusPhase="dim"
        showdownResult="winner"
      />,
    );
    expect(dimmed).not.toContain('data-testid="felt-showdown-ranking"');
  });

  it("does not apply card focus when the derived focus is disabled", () => {
    const html = renderToStaticMarkup(
      <LiveFelt {...baseProps} tableFx bestFiveFocus={{ ...focus, enabled: false }} />,
    );

    expect(html).not.toContain("tracker-best-five-focus-active");
    expect(html).not.toContain("tracker-best-five-card");
    expect(html).not.toContain("tracker-non-best-five-card");
  });

  it("keeps operator and TV rendering free of viewer-only focus treatment", () => {
    const html = renderToStaticMarkup(<LiveFelt {...baseProps} bestFiveFocus={focus} />);
    expect(html).not.toContain("tracker-best-five-focus-active");
    expect(html).not.toContain("tracker-best-five-card");
    expect(html).not.toContain("tracker-non-best-five-card");
    expect(html).not.toContain("tracker-win-glow");
  });

  it("never promotes a refund-only player to winner glow or result text", () => {
    const html = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[refundOnly]}
        tableFx
        bestFiveFocus={null}
      />,
    );
    expect(html).not.toContain("tracker-win-glow");
    expect(html).not.toContain("Hoàn");
    expect(html).not.toContain("+5k");
  });

  it("collects committed chips, then awards only the active verified pot recipient", () => {
    const sideWinner = seat({
      player_id: "side",
      display_name: "Side winner",
      seat_number: 3,
      hole_cards: ["Ks", "Qs"],
      is_all_in: true,
      display_committed_bet: 8_000,
    });
    const layeredPresentation: VerifiedShowdownPresentation = {
      ...showdownPresentation,
      winners: [
        ...showdownPresentation.winners,
        {
          playerId: "side",
          playerName: "Side winner",
          seatNumber: 3,
          category: "one_pair",
          bestFive: ["Ks", "Qs", "Jc", "Js", "Ah"],
          kickers: ["A", "Q", "J"],
          rankingText: "Pair of Jacks - Ace-Q king kickers",
          holeBestFive: new Set(["Ks", "Qs"]),
        },
      ],
      potLayers: [
        showdownPresentation.potLayers[0],
        {
          potId: "side-1",
          kind: "side",
          amount: 8_000,
          winnerPlayerIds: ["side"],
          allocations: [{ playerId: "side", amount: 8_000 }],
        },
      ],
    };
    const collecting = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[{ ...winner, is_all_in: true, display_committed_bet: 12_000 }, sideWinner]}
        tableFx
        viewerLayout
        bestFiveFocus={focus}
        showdownPresentation={layeredPresentation}
        replayRunoutPhase="pot_collect"
        replayRunoutPresentation={{ key: "hand-1:7:verified", phase: "pot_collect", visibleBoardCount: 5, potAwardIndex: null }}
      />,
    );
    expect(collecting).toContain('data-testid="felt-settlement-payout-motion"');
    expect((collecting.match(/data-testid="felt-settlement-collect-stack"/g) ?? []).length).toBe(2);
    expect(collecting).not.toContain('data-testid="felt-settlement-award-tom"');

    const foldedCommitter = seat({
      player_id: "folded",
      seat_number: 4,
      display_name: "Folded caller",
      is_folded: true,
      total_committed: 9_000,
      display_committed_bet: 1_000,
      current_bet: 0,
    });
    const collectingWholeHandCommitments = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[{ ...winner, is_all_in: true, total_committed: 12_000, display_committed_bet: 2_000 }, sideWinner, foldedCommitter]}
        tableFx
        viewerLayout
        showdownPresentation={layeredPresentation}
        replayRunoutPhase="pot_collect"
        replayRunoutPresentation={{ key: "hand-1:7:verified", phase: "pot_collect", visibleBoardCount: 5, potAwardIndex: null }}
      />,
    );
    expect((collectingWholeHandCommitments.match(/data-testid="felt-settlement-collect-stack"/g) ?? []).length).toBe(2);
    expect(collectingWholeHandCommitments).not.toContain("9k");

    const mainPresentation = selectVerifiedPotLayerPresentation(layeredPresentation, 0);
    const mainAward = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[{ ...winner, is_all_in: true, display_committed_bet: 12_000 }, sideWinner]}
        tableFx
        viewerLayout
        bestFiveFocus={mainPresentation.focus}
        showdownPresentation={mainPresentation}
        replayRunoutPhase="pot_award"
        replayRunoutPresentation={{ key: "hand-1:7:verified", phase: "pot_award", visibleBoardCount: 5, potAwardIndex: 0 }}
      />,
    );
    expect((mainAward.match(/data-testid="felt-settlement-award-tom"/g) ?? []).length).toBe(3);
    expect(mainAward).not.toContain('data-testid="felt-settlement-award-side"');
    expect((mainAward.match(/tracker-win-glow/g) ?? []).length).toBe(1);
    expect(mainAward).toContain('data-testid="felt-settlement-award-announcement"');
    expect(mainAward).toContain('data-testid="felt-settlement-award-recipient-tom"');
    expect(mainAward).toContain("Main Pot");
    expect(mainAward).toContain("Tom Dwan");
    expect(mainAward).toContain("+20k (100 BB)");
    expect(mainAward).toContain(showdownPresentation.winners[0].rankingText);
    expect((mainAward.match(/tracker-best-five-card/g) ?? []).length).toBe(5);

    const settledMain = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[{ ...winner, is_all_in: true, display_committed_bet: 12_000 }, sideWinner]}
        tableFx
        viewerLayout
        bestFiveFocus={mainPresentation.focus}
        showdownPresentation={mainPresentation}
        replayRunoutPhase="static"
        replayRunoutPresentation={{ key: "hand-1:7:verified", phase: "static", visibleBoardCount: 5, potAwardIndex: 0 }}
      />,
    );
    expect(settledMain).toContain('data-testid="felt-settlement-award-label-tom"');
    expect(settledMain).toContain('data-testid="felt-settlement-award-recipient-tom"');
    expect(settledMain).toContain("+20k (100 BB)");
    expect(settledMain).not.toContain('data-testid="felt-settlement-award-tom"');

    const sidePresentation = selectVerifiedPotLayerPresentation(layeredPresentation, 1);
    const sideAward = renderToStaticMarkup(
      <LiveFelt
        {...baseProps}
        seats={[{ ...winner, is_all_in: true, display_committed_bet: 12_000 }, sideWinner]}
        tableFx
        viewerLayout
        bestFiveFocus={sidePresentation.focus}
        showdownPresentation={sidePresentation}
        replayRunoutPhase="pot_award"
        replayRunoutPresentation={{ key: "hand-1:7:verified", phase: "pot_award", visibleBoardCount: 5, potAwardIndex: 1 }}
      />,
    );
    expect((sideAward.match(/data-testid="felt-settlement-award-side"/g) ?? []).length).toBe(3);
    expect(sideAward).not.toContain('data-testid="felt-settlement-award-tom"');
    expect((sideAward.match(/tracker-win-glow/g) ?? []).length).toBe(1);
    expect(sideAward).toContain('data-testid="felt-settlement-award-recipient-side"');
    expect(sideAward).not.toContain('data-testid="felt-settlement-award-recipient-tom"');
    expect(sideAward).toContain("Side Pot");
    expect(sideAward).toContain("Side winner");
    expect(sideAward).toContain("+8k (40 BB)");
    expect(sideAward).toContain("Pair of Jacks - Ace-Q king kickers");
    expect(sideAward).not.toContain(showdownPresentation.winners[0].rankingText);
    expect((sideAward.match(/tracker-best-five-card/g) ?? []).length).toBe(5);
  });

  it("makes the viewer portrait board larger without resizing operator cards", () => {
    const viewer = renderToStaticMarkup(
      <LiveFelt {...baseProps} viewerLayout portrait />,
    );
    const operator = renderToStaticMarkup(
      <LiveFelt {...baseProps} portrait />,
    );

    expect(viewer).toContain("width:clamp(30px,11.5cqi,50px)");
    expect(viewer).toContain("height:clamp(42px,16.2cqi,70px)");
    expect(operator).not.toContain("11.5cqi");
    expect(operator).not.toContain("16.2cqi");
  });
});

 it("credits each verified pot once after arrival and keeps final stacks when reviewing another pot", () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const layers = { ...showdownPresentation, potLayers: [
    { ...showdownPresentation.potLayers[0], amount: 8_000, allocations: [{ playerId: "tom", amount: 8_000 }] },
    { ...showdownPresentation.potLayers[0], potId: "side-1", kind: "side" as const, amount: 12_000, allocations: [{ playerId: "tom", amount: 12_000 }] },
  ] };
  const payoutSeats = [{ ...winner, chip_count: 0, payout_starting_stack: 5_000 }, { ...refundOnly, payout_starting_stack: 5_000 }];
  const felt = (phase: "pot_award" | "static", index: number) => <LiveFelt {...baseProps} seats={payoutSeats}
    viewerLayout viewerAmountsInBB tableFx showdownPresentation={layers} bestFiveFocus={focus}
    replayRunoutPresentation={{ key: "award-test", phase, visibleBoardCount: 5, potAwardIndex: index }} />;
  try {
    const view = render(felt("pot_award", 0));
    const target = () => Number(view.getByTestId("felt-stack-tom").getAttribute("data-stack-target"));
    const tooltip = () => view.getByTestId("felt-stack-tom").parentElement?.getAttribute("title");
    expect(target()).toBe(5_000);
    expect(tooltip()).toBe("Tom Dwan · 5000");
    expect(view.queryByTestId("felt-settlement-award-label-tom")).toBeNull();
    act(() => vi.advanceTimersByTime(420));
    expect(target()).toBe(13_000);
    expect(tooltip()).toBe("Tom Dwan · 13000");
    expect(view.getByTestId("felt-settlement-award-label-tom").textContent).toBe("+40 BB");
    view.rerender(felt("pot_award", 0));
    expect(target()).toBe(13_000);
    view.rerender(felt("pot_award", 1));
    expect(target()).toBe(13_000);
    act(() => vi.advanceTimersByTime(420));
    expect(target()).toBe(25_000);
    expect(tooltip()).toBe("Tom Dwan · 25000");
    expect(view.getByTestId("felt-settlement-award-label-tom").textContent).toBe("+60 BB");
    view.rerender(felt("static", 0));
    expect(target()).toBe(25_000);
    expect(view.queryByTestId("felt-settlement-award-label-phil")).toBeNull();
    expect(Number(view.getByTestId("felt-stack-phil").getAttribute("data-stack-target"))).toBe(5_000);
    expect(target() + 5_000).toBe(5_000 + 5_000 + 20_000);
  } finally { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
