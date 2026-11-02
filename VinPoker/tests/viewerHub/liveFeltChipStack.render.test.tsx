// RPT committed-bet chip STACK on the felt (viewerLayout only): a pointer-events-none
// layer places a 3-disc pile + amount in front of each betting/all-in seat, toward the
// pot (collision-guarded). Operator/TV (viewerLayout off) render NO stack → byte-identical.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {cleanup,render,screen} from '@testing-library/react';
import { LiveFelt, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";

const noBB = () => null;

function seat(over: Partial<SeatInfo>): SeatInfo {
  return {
    player_id: over.player_id ?? "p",
    display_name: over.display_name ?? "P",
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
  formatBB: noBB,
};

const stackCount = (html: string) => (html.match(/z-\[15\]/g) || []).length;

describe("LiveFelt committed-bet chip stack (viewerLayout)", () => {
  it("renders the felt stack layer ONLY under viewerLayout (none for operator/TV)", () => {
    const s = [seat({ player_id: "a", seat_number: 1, current_bet: 200000 })];
    expect(stackCount(renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} />))).toBe(0);
    expect(stackCount(renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} portrait viewerLayout />))).toBe(1);
  });

  it("renders only live seat-side contributions, not folded or already swept whole-hand totals", () => {
    const s = [
      seat({ player_id: "a", seat_number: 1, current_bet: 200000 }), // bet → stack
      seat({ player_id: "b", seat_number: 2, is_all_in: true, current_bet: 5_000_000 }), // all-in → stack
      seat({ player_id: "c", seat_number: 3 }), // no bet → none
      seat({ player_id: "d", seat_number: 4, is_folded: true, current_bet: 100 }), // canonical viewer excludes folded seat-side piles
    ];
    expect(stackCount(renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} portrait viewerLayout />))).toBe(2);
  });

  it("all-in stack is RED (#d33), a regular stack is GOLD (#f5b340)", () => {
    const allin = renderToStaticMarkup(
      <LiveFelt seats={[seat({ player_id: "a", seat_number: 1, is_all_in: true, current_bet: 5_000_000 })]} {...baseProps} portrait viewerLayout />
    ).toLowerCase();
    expect(allin).toContain("#d33");
    expect(allin).not.toContain("#f5b340");
    const reg = renderToStaticMarkup(
      <LiveFelt seats={[seat({ player_id: "a", seat_number: 1, current_bet: 200000 })]} {...baseProps} portrait viewerLayout />
    ).toLowerCase();
    expect(reg).toContain("#f5b340");
  });

  it("the amount label is real text; the decorative discs are aria-hidden", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={[seat({ player_id: "a", seat_number: 1, current_bet: 200000 })]} {...baseProps} portrait viewerLayout />
    );
    expect(html).toContain("200k"); // the amount label
    expect(html).toContain('aria-hidden="true"'); // the discs
  });

  it("places the stack BETWEEN the seat and the pot center (toward-center lerp)", () => {
    // Seat 5 portrait-V2 sits at t≈8%; the pot center ≈42%. Its stack must land between.
    const html = renderToStaticMarkup(
      <LiveFelt seats={[seat({ player_id: "a", seat_number: 5, current_bet: 200000 })]} {...baseProps} portrait viewerLayout />
    );
    const m = html.match(/z-\[15\][^>]*top:([0-9.]+)%/);
    expect(m).toBeTruthy();
    const top = parseFloat(m![1]);
    expect(top).toBeGreaterThan(8); // moved down from the seat toward the pot
    expect(top).toBeLessThan(42); // but kept clear of the pot/board
  });

  // ── Compact disc lerp (re-tuned 2026-07-06 with the tall 3:4 portrait oval) ──
  it("compact portrait: seat 5's stack clears its own ~125px showdown pod (K=0.42) but stays off the board", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={[seat({ player_id: "a", seat_number: 5, current_bet: 200000 })]} {...baseProps} portrait viewerLayout compact />
    );
    const m = html.match(/z-\[15\][^>]*top:([0-9.]+)%/);
    expect(m).toBeTruthy();
    const top = parseFloat(m![1]);
    // V2 seat 5 t=8 → 8 + (46−8)×0.42 = 23.96: BELOW the pod block (K=0.30 landed the
    // disc on the pod's own revealed cards), ABOVE the board band (top ≈40%).
    expect(top).toBeGreaterThan(20);
    expect(top).toBeLessThan(30);
  });

  it("compact portrait: middle-SIDE seats keep the short 0.30 lerp so discs stop before the board's edge", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={[seat({ player_id: "a", seat_number: 3, current_bet: 200000 })]} {...baseProps} portrait viewerLayout compact />
    );
    // V2 seat 3 l=6, t=50 (inside the board band |50−46|<12) → l = 6 + (50−6)×0.30 = 19.2:
    // a horizontal-traveling disc at 0.42 (l≈24.5) overlapped the board's left edge.
    const m = html.match(/z-\[15\][^>]*left:([0-9.]+)%/);
    expect(m).toBeTruthy();
    const left = parseFloat(m![1]);
    expect(left).toBeGreaterThan(15);
    expect(left).toBeLessThan(22);
  });

  it("compact: adjacent all-in seats keep DISTINCT seat-side positions (no center-ring pileup)", () => {
    const html = renderToStaticMarkup(
      <LiveFelt
        seats={[
          seat({ player_id: "a", seat_number: 4, is_all_in: true, current_bet: 800000 }),
          seat({ player_id: "b", seat_number: 5, is_all_in: true, current_bet: 800000 }),
          seat({ player_id: "c", seat_number: 6, is_all_in: true, current_bet: 800000 }),
        ]}
        {...baseProps}
        portrait
        viewerLayout
        compact
      />
    );
    const lefts = [...html.matchAll(/z-\[15\][^>]*left:([0-9.]+)%/g)].map((m) => parseFloat(m[1]));
    expect(lefts.length).toBe(3);
    expect(new Set(lefts.map((l) => Math.round(l))).size).toBe(3); // three distinct columns
    // No MINGAP center-ring snap in compact: the top-row stacks stay in their own lanes
    // between pod (≤ ~16% bottom edge) and board (top ≈40%).
    const tops = [...html.matchAll(/z-\[15\][^>]*top:([0-9.]+)%/g)].map((m) => parseFloat(m[1]));
    expect(Math.max(...tops)).toBeLessThan(32);
  });

  it.each([false,true])('keeps an explicit ALL-IN status after street sweep without recreating committed chips (compact=%s)',compact=>{
    try{render(
      <LiveFelt
        seats={[seat({ player_id: "a", seat_number: 1, is_all_in: true, current_bet: 0, total_committed: 19_900_000 })]}
        {...baseProps}
        portrait
        viewerLayout
        compact={compact}
      />
    );
    expect(screen.getByTestId('felt-all-in-status-a')).toHaveTextContent('ALL IN');
    expect(screen.getByTestId('felt-all-in-status-a')).toHaveTextContent('19.9M');
    expect(document.querySelectorAll('.z-\\[15\\]')).toHaveLength(0);
    }finally{cleanup();}
  });

  it("non-compact retains the authoritative total after current_bet is swept", () => {
    const html = renderToStaticMarkup(
      <LiveFelt
        seats={[seat({ player_id: "a", seat_number: 1, is_all_in: true, current_bet: 0, total_committed: 19_900_000 })]}
        {...baseProps}
        portrait
        viewerLayout
      />
    );
    expect(html).toContain("ALL IN");
    expect(html).toContain("19.9M");
    expect(stackCount(html)).toBe(0);
  });
  it.each([undefined,NaN,Infinity])('does not invent an amount for a swept ALL-IN with unknown total %s',total=>{
    const html=renderToStaticMarkup(<LiveFelt {...baseProps} viewerLayout portrait
      seats={[seat({player_id:'a',seat_number:1,is_all_in:true,current_bet:0,total_committed:total})]}/>);
    expect(html).toContain('felt-all-in-status-a');expect(html).toContain('ALL IN');
    expect(html).not.toContain('NaN');expect(html).not.toContain('Infinity');
    expect(html).not.toContain('ALL IN · 0');expect(stackCount(html)).toBe(0);
  });
  it('does not label a folded seat ALL-IN from a stale all-in bit',()=>{
    const html=renderToStaticMarkup(<LiveFelt {...baseProps} viewerLayout portrait
      seats={[seat({player_id:'a',seat_number:1,is_all_in:true,is_folded:true,current_bet:0,total_committed:500})]}/>);
    expect(html).not.toContain('felt-all-in-status-a');expect(stackCount(html)).toBe(0);
  });
});
