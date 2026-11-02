// PR-A1 (liveFeltCompact → LiveFelt `compact` + `blinds`) — the compact viewer felt.
// REDESIGNED 2026-07-06 (owner UAT: the 2.2:1 stadium overlapped everything at 9-max
// showdown): compact portrait = TALL 3:4 oval on the PROVEN V2 portrait rim anchors +
// V as watermark + viewer board showing only dealt cards; BB-FIRST nameplates (chips
// demoted) that fall back to chips-only when formatBB is null (never a fake BB); the
// persistent status bar (blinds · to-act · pot) with every segment hidden when its
// data is missing; landscape keeps its 13/6 geometry (only the bar is added).
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveFelt, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";

const bb200 = (n: number) => `${(n / 200).toFixed(1).replace(/\.0$/, "")} BB`;
const noBB = () => null;

function seat(over: Partial<SeatInfo>): SeatInfo {
  return {
    player_id: over.player_id ?? "p",
    display_name: over.display_name ?? "Player",
    seat_number: over.seat_number ?? 1,
    chip_count: over.chip_count ?? 1000,
    is_active: true,
    table_id: "t",
    position: "",
    ...over,
  };
}

const baseProps = {
  lastActorId: null,
  toActId: null,
  displayCards: ["", "", "", "", ""],
  potSize: 0,
  potBreakdown: null,
  multiTableUnresolved: false,
  handNumber: 1,
  latestAction: null,
  formatBB: bb200,
};

const twoSeats = [seat({ player_id: "a", seat_number: 1, chip_count: 2500 }), seat({ player_id: "b", seat_number: 5 })];
const nineSeats = Array.from({ length: 9 }, (_, i) =>
  seat({ player_id: `p${i + 1}`, seat_number: i + 1, display_name: `Player ${i + 1}` })
);

describe("LiveFelt compact (PR-A1, viewer-only)", () => {
  it("compact portrait → tall 3:4 oval on the V2 rim anchors, V as watermark", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={twoSeats} {...baseProps} portrait viewerLayout compact />
    );
    expect(html).toContain("3 / 4");
    expect(html).not.toContain("2.2 / 1"); // the short stadium is gone (it overlapped at showdown)
    expect(html).toContain("left:50%;top:8%"); // seat 5 on the V2 top rim
    expect(html).toContain("felt-v"); // brand V still present (as watermark)
    expect(html).toContain("20cqi"); // watermark sizing, not the stacked V row
  });

  it("compact portrait shows only DEALT community cards (undealt slots render nothing on the viewer)", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={[]} {...baseProps} portrait viewerLayout compact displayCards={["As", "Kd", "", "", ""]} />
    );
    // The viewer drops undealt board slots (the face-down backs sat in front of the top-center
    // pods). No seats → any card-back would be a BOARD back → none; only the 2 dealt faces show.
    expect(html).toContain('data-testid="board-cards"');
    expect((html.match(/data-testid="card-back"/g) || []).length).toBe(0);
  });

  it("nameplates go BB-FIRST with chips demoted (2500 chips @ bb200 → 12.5 BB primary)", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={twoSeats} {...baseProps} portrait viewerLayout compact />
    );
    expect(html).toContain("12.5 BB");
    expect(html).toContain("2.5k"); // chips still present as the secondary line
    // BB line is the larger text, chips the smaller one
    expect(html.indexOf("12.5 BB")).toBeLessThan(html.indexOf("2.5k"));
  });

  it("formatBB null → chips-only nameplate, never a fake BB", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={twoSeats} {...baseProps} formatBB={noBB} portrait viewerLayout compact />
    );
    expect(html).not.toContain(" BB");
    expect(html).toContain("2.5k");
  });

  it("status bar renders blinds · to-act · pot, each hidden without data", () => {
    const full = renderToStaticMarkup(
      <LiveFelt
        seats={twoSeats}
        {...baseProps}
        toActId="b"
        potSize={1500}
        portrait
        viewerLayout
        compact
        blinds={{ sb: 100, bb: 200, ante: 25 }}
      />
    );
    expect(full).toContain("felt-status-bar");
    expect(full).toContain("100/200");
    expect(full).toContain("Ante 25");
    expect(full).toContain("Player"); // to-act display name (seat b)
    expect(full).toContain("1.5k"); // pot chips
    expect(full).toContain("7.5 BB"); // pot in BB

    const noBlinds = renderToStaticMarkup(
      <LiveFelt seats={twoSeats} {...baseProps} potSize={1500} portrait viewerLayout compact blinds={null} />
    );
    expect(noBlinds).toContain("felt-status-bar"); // pot alone keeps the bar
    expect(noBlinds).not.toContain("100/200");

    const nothing = renderToStaticMarkup(
      <LiveFelt seats={twoSeats} {...baseProps} portrait viewerLayout compact blinds={null} />
    );
    expect(nothing).not.toContain("felt-status-bar"); // no data → no bar at all
  });

  it("shows the replay settlement state below the total pot without changing operator markup", () => {
    const html = renderToStaticMarkup(
      <LiveFelt
        seats={twoSeats}
        {...baseProps}
        potSize={17_400_000}
        portrait
        viewerLayout
        compact
        showdownResult="chop"
      />,
    );
    expect(html).toContain('data-testid="felt-showdown-result"');
    expect(html).toMatch(/Chop pot|Chia/);
    expect(html).toContain("17.4M");
  });

  it("landscape + compact keeps the 13/6 landscape geometry (bar only, no reflow)", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={twoSeats} {...baseProps} potSize={900} viewerLayout compact blinds={{ sb: 100, bb: 200, ante: 0 }} />
    );
    expect(html).toContain("13 / 6");
    expect(html).not.toContain("3 / 4");
    expect(html).toContain("felt-status-bar");
  });

  it("9-max compact renders all nine pods on compact anchors", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={nineSeats} {...baseProps} portrait viewerLayout compact />
    );
    for (let i = 1; i <= 9; i++) expect(html).toContain(`Player ${i}`);
    expect(html).toContain("left:6%;top:50%"); // seat 3 far-left (V2 anchors)
    expect(html).toContain("left:94%;top:50%"); // seat 7 far-right (V2 anchors)
  });
});
