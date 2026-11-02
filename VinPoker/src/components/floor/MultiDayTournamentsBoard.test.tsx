import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FloorBoardProps } from "./useFloorTournaments";

vi.mock("./TournamentManagerShared", () => ({ NewTournamentDialog: () => null, TournamentCard: () => null }));
vi.mock("./MultiDayFloorEventPanel", () => ({ MultiDayFloorEventPanel: () => null }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { multiDayTournaments: false } }));
import { MultiDayTournamentsBoard } from "./MultiDayTournamentsBoard";
afterEach(cleanup);
const props = {
  tours: [{ id: "flight-a", event_id: "event", phase: "flight", name: "TEST · Flight A" }],
  loading: false, error: null, flightMeta: {}, finalMeta: {}, eventMeta: {},
  reload: vi.fn(), deleteTour: vi.fn(), startTournament: vi.fn(),
  multiClub: false, clubNameMap: {}, clubs: [], clubIds: [], onSelect: vi.fn(),
} satisfies FloorBoardProps;

it("does not display missing readiness as zero entrants", () => {
  render(<MultiDayTournamentsBoard {...props} />);
  expect(screen.queryByText(/0 entrant/)).toBeNull();
  expect(screen.getByText(/Chưa xác minh/)).toBeTruthy();
});

it("still displays a verified zero entrant count", () => {
  render(<MultiDayTournamentsBoard {...props} flightMeta={{ "flight-a": {
    entrants: 0, survivors: 0, itm: 10, target: 0, ready: false,
  } }} />);
  expect(screen.getByText(/0 entrant/)).toBeTruthy();
});

it("does not publish a partial total when one flight has no verified count", () => {
  render(<MultiDayTournamentsBoard {...props} tours={[...props.tours,
    { id: "flight-b", event_id: "event", phase: "flight", name: "TEST · Flight B" },
  ]} flightMeta={{ "flight-a": { entrants: 8, survivors: 2, itm: 10, target: 1, ready: false } }} />);
  expect(screen.queryByText(/8 entrant/)).toBeNull();
  expect(screen.getByText(/Chưa xác minh/)).toBeTruthy();
});

it("shows one whole-event GTD even when the event has two flights",()=>{
 render(<MultiDayTournamentsBoard {...props} tours={[...props.tours,
  {id:'flight-b',event_id:'event',phase:'flight',name:'TEST · Flight B'}]}
  eventMeta={{event:{name:'TEST',itm_percent:15,guarantee_amount:2500000}}}/>);
 expect(screen.getAllByText(/GTD Main Event:/)).toHaveLength(1);
 expect(screen.getByText(/GTD Main Event:/).textContent).toContain('2.500.000');
});

it.each([{value:null,expected:'Chưa có GTD Main Event'},{value:0,expected:'Main Event không cam kết GTD'}])(
 "distinguishes missing event GTD from explicit zero: $expected",({value,expected})=>{
 render(<MultiDayTournamentsBoard {...props} eventMeta={{event:{name:'TEST',itm_percent:15,guarantee_amount:value}}}/>);
 expect(screen.getByText(expected)).toBeInTheDocument();
});
