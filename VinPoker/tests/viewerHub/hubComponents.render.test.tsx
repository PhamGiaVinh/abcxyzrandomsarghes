import { describe, it, expect, afterAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import { LiveTablesStrip } from "@/components/cashier/tournament-live/viewer-hub/LiveTablesStrip";
import { LiveUpdatesFeed } from "@/components/cashier/tournament-live/viewer-hub/LiveUpdatesFeed";
import { OrientationToggle } from "@/components/cashier/tournament-live/viewer-hub/OrientationToggle";
import { LiveStatsBar } from "@/components/cashier/tournament-live/viewer-hub/LiveStatsBar";
import { LiveStoryFeed } from "@/components/cashier/tournament-live/viewer-hub/LiveStoryFeed";
import { LiveTablesMap } from "@/components/cashier/tournament-live/viewer-hub/LiveTablesMap";
import { HandBreakdown } from "@/components/cashier/tournament-live/viewer-hub/HandBreakdown";
import { HandFeedCard } from "@/components/cashier/tournament-live/viewer-hub/HandFeedCard";
import { TournamentPostCard } from "@/components/cashier/tournament-live/viewer-hub/TournamentPostCard";
import type { HubFeedItem, HubStoryItem, HubTableSummary } from "@/components/cashier/tournament-live/viewer-hub/hubDerive";
import type { HandFeedItem } from "@/components/cashier/tournament-live/viewer-hub/handFeedDerive";
import type { TournamentPostViewModel } from "@/components/cashier/tournament-live/viewer-hub/viewerTypes";
import type { BreakdownAction } from "@/lib/tracker-poker/handBreakdown";

const breakdownActions: BreakdownAction[] = [
  { player_id: "p1", street: "preflop", action_type: "raise", action_amount: 150, action_order: 1 },
  { player_id: "p2", street: "preflop", action_type: "call", action_amount: 100, action_order: 2 },
  { player_id: "p1", street: "flop", action_type: "bet", action_amount: 200, action_order: 3 },
  { player_id: "p2", street: "flop", action_type: "fold", action_amount: null, action_order: 4 },
];
// p1 nets +2000 (winner, shown); p2 nets -2000 (loser, never shown).
const breakdownPlayers = [
  { player_id: "p1", seat_number: 1, display_name: "An", starting_stack: 10000, ending_stack: 12000 },
  { player_id: "p2", seat_number: 2, display_name: "Binh", starting_stack: 10000, ending_stack: 8000 },
];

const storyItems: HubStoryItem[] = [
  { id: "elim:h1:p1", kind: "elimination", name: "An", count: 18, label: "An bị loại — còn 18 người" },
  { id: "story:ms:18", kind: "milestone", count: 18, label: "Còn 18 người" },
  { id: "story:final_table", kind: "final_table", count: 9, label: "Final table — còn 9 người" },
  { id: "story:bubble", kind: "bubble", count: 10, label: "Đang ở bubble — còn 10 người" },
  { id: "story:itm", kind: "itm", count: 9, label: "Đã vào tiền — còn 9 người" },
];

const tables: HubTableSummary[] = [
  { tableId: "tA", name: "Bàn 1", playerCount: 8 },
  { tableId: "tB", name: "Bàn 2", playerCount: 6 },
];

const handCard: HandFeedItem = {
  handId: "hand-safe",
  handNumber: 12,
  tableId: "tA",
  createdAt: "2026-07-10T10:00:00.000Z",
  board: ["As", "Kd", "7h"],
  potChips: 24_000,
  potBB: 48,
  sidePotCount: 0,
  bigBlind: 500,
  tags: ["big_pot"],
  players: [{
    playerId: "abcdef00-0000-0000-0000-000000000000",
    seatNumber: 0,
    name: "abcdef",
    avatarUrl: null,
    endingStack: 20_000,
    deltaChips: 2_000,
    deltaBB: 4,
    holeCards: null,
    isWinner: true,
    isEliminated: false,
    finishPosition: 0,
    prize: null,
  }],
  highHand: null,
};

describe("LiveTablesStrip", () => {
  it("renders a mini card per table when >1 table", () => {
    const html = renderToStaticMarkup(<LiveTablesStrip tables={tables} activeTableId="tA" />);
    expect(html).toContain("Bàn 1");
    expect(html).toContain("Bàn 2");
    expect(html).toContain("8 người chơi");
  });
  it("renders nothing for a single table", () => {
    const html = renderToStaticMarkup(<LiveTablesStrip tables={[tables[0]]} />);
    expect(html).toBe("");
  });
});

describe("LiveTablesMap (spectator table picker)", () => {
  it("renders a table-logo tile per table (>1) with name, count, picker title + active highlight", () => {
    const html = renderToStaticMarkup(<LiveTablesMap tables={tables} activeTableId="tA" onSelect={() => {}} />);
    expect(html).toContain("Chọn bàn"); // picker title (vi)
    expect(html).toContain("Bàn 1");
    expect(html).toContain("Bàn 2");
    expect(html).toContain("8 người chơi");
    expect(html).toContain("<svg"); // the table-logo icon
    expect(html).toContain('aria-pressed="true"'); // tA is the active/featured tile
  });
  it("renders nothing for a single table (no picker needed)", () => {
    expect(renderToStaticMarkup(<LiveTablesMap tables={[tables[0]]} onSelect={() => {}} />)).toBe("");
  });
});

describe("LiveUpdatesFeed", () => {
  const feed: HubFeedItem[] = [
    { id: "1", seatNumber: 2, playerName: "Bình", label: "ALL-IN 5k", kind: "allin" },
    { id: "2", seatNumber: 1, playerName: "An", label: "Theo 2.4k", kind: "call" },
  ];
  it("renders feed rows with badges", () => {
    const html = renderToStaticMarkup(<LiveUpdatesFeed feed={feed} />);
    expect(html).toContain("Cập nhật");
    expect(html).toContain("Bình");
    expect(html).toContain("ALL-IN 5k");
    expect(html).toContain("ALL-IN"); // badge
    expect(html).toContain("Ghế 2");
  });
  it("shows an empty state when no actions", () => {
    const html = renderToStaticMarkup(<LiveUpdatesFeed feed={[]} />);
    expect(html).toContain("Chưa có hành động");
  });

  it("RPT rail hides Seat 0 and opaque player-id fragments", () => {
    const html = renderToStaticMarkup(
      <LiveUpdatesFeed rpt feed={[{ id: "unsafe", seatNumber: 0, playerName: "abcdef", label: "Check", kind: "check" }]} />,
    );
    expect(html).toContain("Người chơi");
    expect(html).not.toContain("Ghế 0");
    expect(html).not.toContain(">abcdef<");
  });
});

describe("OrientationToggle (UI-only)", () => {
  it("renders both orientations, defaulting to landscape selected", () => {
    const html = renderToStaticMarkup(<OrientationToggle />);
    expect(html).toContain("Ngang");
    expect(html).toContain("Dọc");
    expect(html).toContain('aria-pressed="true"'); // default landscape is pressed
  });
});

describe("LiveStatsBar", () => {
  it("renders prize pool, players remaining and chip leader when present", () => {
    const html = renderToStaticMarkup(
      <LiveStatsBar
        prizePool={48_000_000}
        playersRemaining={27}
        chipLeader={{ playerName: "Bình", seatNumber: 5, chipCount: 1_500_000 }}
      />
    );
    expect(html).toContain("Giải thưởng");
    expect(html).toContain("48M"); // prize pool, compact
    expect(html).toContain("Còn lại");
    expect(html).toContain("27"); // players remaining
    expect(html).toContain("Chip Leader");
    expect(html).toContain("Bình");
    expect(html).toContain("Ghế 5");
    expect(html).toContain("1.5M"); // leader stack, compact
  });

  it("hides a stat whose data is missing", () => {
    const html = renderToStaticMarkup(<LiveStatsBar prizePool={null} playersRemaining={12} chipLeader={null} />);
    expect(html).toContain("Còn lại");
    expect(html).not.toContain("Giải thưởng");
    expect(html).not.toContain("Chip Leader");
  });

  it("renders nothing when there is no data at all", () => {
    const html = renderToStaticMarkup(<LiveStatsBar prizePool={0} playersRemaining={null} chipLeader={null} />);
    expect(html).toBe("");
  });
});

describe("LiveStoryFeed", () => {
  it("renders every story kind with safe localized (vi) copy", () => {
    const html = renderToStaticMarkup(<LiveStoryFeed items={storyItems} />);
    expect(html).toContain("Diễn biến giải"); // section title
    expect(html).toContain("An bị loại — còn 18 người"); // elimination
    expect(html).toContain("Còn 18 người"); // milestone
    expect(html).toContain("Final table — còn 9 người"); // final table
    expect(html).toContain("Đang ở bubble — còn 10 người"); // bubble
    expect(html).toContain("Đã vào tiền — còn 9 người"); // ITM
    expect(html).not.toMatch(/loại B|thắng/); // never a killer/winner
  });
  it("renders nothing when there are no story items", () => {
    expect(renderToStaticMarkup(<LiveStoryFeed items={[]} />)).toBe("");
  });

  it("RPT moment rail replaces opaque eliminated-player names", () => {
    const html = renderToStaticMarkup(
      <LiveStoryFeed rpt items={[{ id: "unsafe", kind: "elimination", name: "abcdef", count: 7, label: "unsafe" }]} />,
    );
    expect(html).toContain("Người chơi bị loại");
    expect(html).not.toContain("abcdef");
  });
});

describe("RPT hand and editorial cards", () => {
  it("never renders #0, Seat 0 or opaque IDs and shows card backs for hidden cards", () => {
    const html = renderToStaticMarkup(<HandFeedCard rpt item={{ ...handCard, handNumber: 0 }} tableName="Bàn A" />);
    expect(html).toContain("Người chơi");
    expect(html).toContain("Bài không được lộ");
    expect(html).not.toContain("#0");
    expect(html).not.toContain("Ghế 0");
    expect(html).not.toContain("abcdef");
  });

  it("uses readable viewer card sizes and a neon-glow View hand CTA", () => {
    const html = renderToStaticMarkup(<HandFeedCard rpt item={handCard} onViewHand={() => {}} />);
    expect(html).toContain('data-testid="viewer-rpt-board"');
    // RPT deliberately overrides the generic PokerCard md dimensions. Verify
    // five board slots, not obsolete generic size classes. Actual375px browser
    // geometry is recorded in viewer205: five40x56 cards fit without overflow.
    const doc=new DOMParser().parseFromString(html,'text/html');
    const board=doc.querySelector('[data-testid="viewer-rpt-board"]')!;
    expect(board.children).toHaveLength(5);
    expect(Array.from(board.querySelectorAll('[data-card-code]')).map(card=>card.getAttribute('data-card-code'))).toEqual(['As','Kd','7h']);
    expect(html).toContain('data-testid="viewer-rpt-hole-cards"');
    expect(html).toContain("h-12 w-9");
    expect(html).toContain("min-[390px]:h-14");
    expect(html).toContain('data-testid="viewer-view-hand-button"');
    expect(html).toContain("0_0_22px_hsl");
  });

  it("English chrome falls back to Vietnamese editorial copy only when English copy is absent", async () => {
    const post: TournamentPostViewModel = {
      id: "post-1",
      tournamentId: "t1",
      kind: "commentary",
      titleVi: "Bàn chung kết bắt đầu",
      titleEn: null,
      bodyVi: "Còn chín người chơi.",
      bodyEn: null,
      coverPhotoUrl: null,
      linkedHandNumber: null,
      isPinned: false,
      publishedAt: "2026-07-10T10:00:00.000Z",
      sourceLabel: "VinPoker Media",
    };
    await i18n.changeLanguage("en");
    const html = renderToStaticMarkup(<TournamentPostCard post={post} onShare={() => {}} />);
    expect(html).toContain("Commentary");
    expect(html).toContain("Bàn chung kết bắt đầu");
    expect(html).toContain("Còn chín người chơi.");
    expect(html).not.toContain("Bình luận");
    await i18n.changeLanguage("vi");
  });
});

describe("HandBreakdown (spectator action breakdown)", () => {
  it('does not announce a prior stack-derived winner while settlement needs recalculation',()=>{
    const html=renderToStaticMarkup(<HandBreakdown actions={breakdownActions} players={breakdownPlayers}
      buttonSeat={1} bigBlind={50} showdownResult="needs_resettle"/>);
    expect(html).toContain(i18n.t('liveHub.felt.needsResettle'));
    expect(html).not.toContain('lucide-trophy');expect(html).not.toContain('+40 BB');
    expect(html).toContain('Bet 4 BB'); // actions remain inspectable, not erased
  });
  it.each([undefined,NaN,Infinity,-1])('does not invent a winner when the starting stack is %s',starting=>{
    const html=renderToStaticMarkup(<HandBreakdown actions={breakdownActions}
      players={[{...breakdownPlayers[0],starting_stack:starting}]} buttonSeat={1} bigBlind={50}/>);
    expect(html).not.toContain('lucide-trophy');
    expect(html).not.toContain('+240 BB');
  });
  it.each([undefined,NaN,Infinity,-1])('does not claim a winner when the ending stack is %s',ending=>{
    const html=renderToStaticMarkup(<HandBreakdown actions={breakdownActions}
      players={[{...breakdownPlayers[0],ending_stack:ending}]} buttonSeat={1} bigBlind={50}/>);
    expect(html).not.toContain('lucide-trophy');
  });
  it("does not label cumulative wagers including an uncalled return as the awarded pot", () => {
    // Actual Final hand8: 161400 + (300 + 19700) + dead SB200 = 181600
    // wagered, but only40200 contested;141400 is returned, not awarded.
    const html = renderToStaticMarkup(<HandBreakdown actions={[
      {player_id:'sb',street:'preflop',action_type:'post_sb',action_amount:200,action_order:1},
      {player_id:'bb',street:'preflop',action_type:'post_bb',action_amount:300,action_order:2},
      {player_id:'winner',street:'preflop',action_type:'all_in',action_amount:161400,action_order:3},
      {player_id:'sb',street:'preflop',action_type:'fold',action_amount:0,action_order:4},
      {player_id:'bb',street:'preflop',action_type:'call',action_amount:19700,action_order:5},
    ]} players={[]} buttonSeat={8} bigBlind={300}/>);
    expect(html).toContain('Cược lũy kế');
    expect(html).toContain('605.33 BB');
    expect(html).toContain('chưa trừ cược được hoàn');
    expect(html).not.toContain('>Pot ');
  });

  it("renders street columns, positions, action + cumulative pot, and a POSITIVE win indicator only", () => {
    const html = renderToStaticMarkup(
      <HandBreakdown
        actions={breakdownActions}
        players={breakdownPlayers}
        buttonSeat={1}
        bigBlind={50}
      />
    );
    expect(html).toContain("Phân tích ván"); // title (vi)
    expect(html).toContain("Preflop");
    expect(html).toContain("Flop");
    expect(html).toContain("Cược lũy kế"); // committed wagers, not the settled pot
    expect(html).toContain("BB"); // heads-up position badge / BB units
    // Same public BB contract independently tested by handBreakdown.test.ts:
    // action200/BB50=4BB; positive net2000/BB50=40BB, never raw chips as BB.
    expect(html).toContain("Bet 4 BB");
    expect(html).toContain("+40 BB");
    expect(html).not.toContain("+2k");
    expect((html.match(/lucide-trophy/g) || []).length).toBe(1);
    expect(html).not.toContain("+-"); // never a negative net after the "+" prefix
  });

  it("renders nothing when there are no actions", () => {
    expect(
      renderToStaticMarkup(
        <HandBreakdown actions={[]} players={[]} buttonSeat={1} bigBlind={50} />
      )
    ).toBe("");
  });
});

describe("viewer-hub i18n wiring", () => {
  afterAll(async () => {
    await i18n.changeLanguage("vi"); // restore the deterministic test language
  });

  it("renders English strings when the language is switched to en", async () => {
    await i18n.changeLanguage("en");
    const stats = renderToStaticMarkup(
      <LiveStatsBar prizePool={1000} playersRemaining={9} chipLeader={{ playerName: "Al", seatNumber: 3, chipCount: 5000 }} />
    );
    expect(stats).toContain("Prize pool");
    expect(stats).toContain("Remaining");
    expect(stats).toContain("Chip Leader");
    expect(stats).toContain("Seat 3"); // interpolated, localized

    const strip = renderToStaticMarkup(<LiveTablesStrip tables={tables} activeTableId="tA" />);
    expect(strip).toContain("Live tables");
    expect(strip).toContain("8 players");

    const story = renderToStaticMarkup(<LiveStoryFeed items={storyItems} />);
    expect(story).toContain("Tournament feed"); // localized section title
    expect(story).toContain("An eliminated — 18 left"); // localized elimination, interpolated
    expect(story).toContain("Final table — 9 left");
    expect(story).toContain("On the bubble — 10 left"); // localized bubble
    expect(story).toContain("In the money — 9 left"); // localized ITM

    const breakdown = renderToStaticMarkup(
      <HandBreakdown actions={breakdownActions} players={breakdownPlayers} buttonSeat={1} bigBlind={50} />
    );
    expect(breakdown).toContain("Hand breakdown"); // localized title (en)
    expect(breakdown).toContain("+40 BB"); // same public BB contract in English
    expect(breakdown).not.toContain("+2k");
  });
});
