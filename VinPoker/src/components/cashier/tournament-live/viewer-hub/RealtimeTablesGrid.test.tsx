import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RealtimeTablesGrid } from "./RealtimeTablesGrid";
import type { PublicTableSnapshot } from "./publicSnapshotTypes";

vi.mock("../PokerVisuals", () => ({ PokerCard: ({ card }: { card: string }) => <span>{card}</span>, CardBack: () => <span data-testid="card-back" /> }));
vi.mock('@/components/tracker/PublicPlayerHud',()=>({PublicPlayerHud:({playerId}:{playerId:string|null})=>playerId?<div role="dialog">HUD {playerId}</div>:null}));
const makeTable = (id: string): PublicTableSnapshot => ({
  tableId: id, tableSessionId: `session-${id}`, name: `Bàn ${id}`, handId: `hand-${id}`,
  handNumber: 1, buttonSeat: 1, street: "flop", board: ["AS", "KH", "2C"], pot: 1000,
  bigBlind: 200, smallBlind: 100, trackerState: "live", players: [{ entryId: `entry-${id}`,
    playerId: `player-${id}`, entryNumber: 1, seatNumber: 1, name: `Player ${id}`, avatarUrl: null, stack: 2000, holeCards: [], isFolded: false }],
  latestAction: { playerId: `player-${id}`, entryNumber: 1, actionType: "call", amount: 200 },
});
it('opens the clicked public player separately from whole-table navigation',()=>{
  const table=makeTable('hud');const onView=vi.fn();
  const view=render(<RealtimeTablesGrid tournamentId="t" tables={[table]} catalog={[{tableId:'hud',name:table.name,playerCount:1,searchPlayers:[]}]} onVisibleTableIds={vi.fn()} onView={onView} onHistory={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Thống kê Player hud'}));
  expect(screen.getByRole('dialog')).toHaveTextContent('HUD player-hud');expect(onView).not.toHaveBeenCalled();
  expect(view.container.querySelector('button button')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Xem Bàn hud'}));expect(onView).toHaveBeenCalledWith('hud');
});

describe("simultaneous public tables", () => {
  it("updates each table's board, pot and action independently, keeping history scoped", () => {
    const tables = [makeTable("2"), makeTable("5"), makeTable("7"), makeTable("9")];
    const props = { tables, catalog: tables.map(t => ({ tableId: t.tableId, name: t.name, playerCount: 1, searchPlayers: [] })),
      onVisibleTableIds: vi.fn(), onView: vi.fn(), onHistory: vi.fn() };
    const { rerender } = render(<RealtimeTablesGrid {...props} />);
    const table2 = within(screen.getByRole("article", { name: "Bàn 2" }));
    const table5 = within(screen.getByRole("article", { name: "Bàn 5" }));
    rerender(<RealtimeTablesGrid {...props} tables={[{ ...tables[0], board: ["AS", "KH", "2C", "TD"], pot: 1500,
      latestAction: { ...tables[0].latestAction!, actionType: "bet", amount: 500 } }, tables[1], tables[2], tables[3]]} />);
    expect(table2.getByText("TD")).toBeInTheDocument();
    expect(table2.getByText("POT 1.5k (7,5 BB)")).toBeInTheDocument();
    expect(table2.getByText(/bet 2.5 BB/)).toBeInTheDocument();
    expect(table5.queryByText("TD")).not.toBeInTheDocument();
    expect(table5.getByText("POT 1k (5 BB)")).toBeInTheDocument();
    table2.getByRole("button", { name: "Lịch sử" }).click();
    expect(props.onHistory).toHaveBeenCalledWith("2");
    expect(props.onVisibleTableIds).toHaveBeenCalledWith(["2", "5", "7", "9"]);
  });
});

it("shows four simultaneous actions without opening a table and restores folded avatars", () => {
  const tables = ["1", "2", "3", "4"].map(makeTable);
  const props = { catalog: tables.map(t => ({ tableId: t.tableId, name: t.name, playerCount: 1, searchPlayers: [] })), onVisibleTableIds: vi.fn(), onView: vi.fn(), onHistory: vi.fn() };
  const { rerender } = render(<RealtimeTablesGrid {...props} tables={tables} />);
  const actions = ["fold", "call", "all_in", "raise"];
  rerender(<RealtimeTablesGrid {...props} tables={tables.map((table, i) => ({ ...table,
    pot: 1000 + i * 200, latestAction: { ...table.latestAction!, actionType: actions[i], amount: i * 200 },
    players: [{ ...table.players[0], isFolded: i === 0, isAllIn: i === 2, lastAction: { actionType: actions[i], amount: i * 200 } }],
  }))} />);
  for (let i = 0; i < 4; i++) {
    const article = screen.getByRole("article", { name: 'Bàn ' + (i + 1) });
    expect(article.querySelector('[data-action="' + actions[i] + '"]')).not.toBeNull();
    expect(within(article).getByText(`POT ${1 + i * 0.2}k (${5 + i} BB)`)).toBeInTheDocument();
    expect(within(article).queryAllByTestId('card-back')).toHaveLength(i === 0 ? 0 : 2);
    expect(article.querySelector('.spectator-mini-avatar')).not.toBeNull();
  }
  expect(props.onView).not.toHaveBeenCalled();
});

it("renders a completed hand as a static historical snapshot with raw-chip fallback", () => {
  const table = {
    ...makeTable("completed"),
    trackerState: "last_completed" as const,
    pot: 300,
    bigBlind: null,
    players: [{ ...makeTable("completed").players[0], stack: 0, holeCards: ["AS", "KD"], isFolded: false }],
  };
  render(<RealtimeTablesGrid catalog={[{ tableId: table.tableId, name: table.name, playerCount: 1, searchPlayers: [] }]} tables={[table]} onVisibleTableIds={vi.fn()} onView={vi.fn()} onHistory={vi.fn()} />);
  const article = screen.getByRole("article", { name: "Bàn completed" });
  expect(within(article).queryByText("Ván gần nhất")).not.toBeInTheDocument();
  expect(within(article).getByText("POT 300 (— BB)")).toBeInTheDocument();
  expect(within(article).getByText("0 · — BB")).toBeInTheDocument();
  expect(within(article).queryAllByTestId("card-back")).toHaveLength(0);
});
