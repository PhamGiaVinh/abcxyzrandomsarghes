import { describe, expect, it } from "vitest";
import {mapTvDataToClock} from './mapClockData';
import {
  mapDisplayStateToTvData,
  parseDisplayStatePayload,
  type TvDisplayStatePayload,
} from "./mapDisplayState";

it.each([0,null])('does not replace canonical paired pool %s with recorded buy-ins',prize_pool=>{
 const payload={...PAIRED,tournament:{...PAIRED.tournament!,prize_pool},entries:{total_confirmed:90,total_buy_ins:90000000}};
 const data=mapDisplayStateToTvData(payload,600)!;
 expect(mapTvDataToClock(data).prizePool).toBe(prize_pool===0?'0':'—');
});

// Fixture mirrors the live get_tv_display_state envelope
// (contract: docs/agent-handoffs/tv-display-pairing.md).
const PAIRED: TvDisplayStatePayload = {
  status: "paired",
  display: {
    id: "d-1",
    name: "TV 1 — Sảnh chính",
    zone: "Main hall",
    display_number: 1,
    layout: "clock",
    theme: "dark",
    announcement: null,
    club_name: "VinPoker Club",
    club_logo_url: "https://cdn.example/logo.png",
    club_brand_name: "VIN CLUB",
    club_background_url: "https://cdn.example/background.jpg",
    club_layout: {
      brand_x: 75, brand_y: 40, brand_scale: 110, logo_scale: 90,
      background_x: 20, background_y: 65, font: "sans", custom_text: "Final Table",
    },
  },
  tournament: {
    id: "t-1",
    name: "VinPoker Weekly Deepstack",
    status: "live",
    players_remaining: 42,
    average_stack: 48500,
    prize_pool: 87_300_000,
  },
  clock: {
    tournament_id: "t-1",
    status: "live",
    is_running: true,
    elapsed_seconds: 180,
    remaining_seconds: 1020,
    current_level: {
      level_number: 8,
      small_blind: 1000,
      big_blind: 2000,
      ante: 2000,
      duration_minutes: 20,
      is_break: false,
    },
    is_break: false,
    next_level: null,
  },
  levels: [
    { level_number: 8, small_blind: 1000, big_blind: 2000, ante: 2000, duration_minutes: 20, is_break: false },
    { level_number: 9, small_blind: 0, big_blind: 0, ante: 0, duration_minutes: 10, is_break: true },
  ],
  entries: { total_confirmed: 97, total_buy_ins: 97_000_000 },
  re_entries: 12,
  prizes: [{ position: 1, amount: 35_000_000 }],
};

describe("parseDisplayStatePayload", () => {
  it.each(['completed','cancelled'])('terminal %s overrides a stale running/break clock but preserves results',status=>{
    const data=mapDisplayStateToTvData({...PAIRED,tournament:{...PAIRED.tournament!,status},
      clock:{...PAIRED.clock!,is_running:true,is_break:true}},1199)!;
    expect(data.isRunning).toBe(false);
    expect(data.isBreak).toBe(false);
    expect(data.remainingSeconds).toBe(0);
    expect(data.nextLevel).toBeNull();
    expect(data.nextBreakSeconds).toBeNull();
    expect(data.prizes).toEqual([{position:1,amount:35000000}]);
    expect(data.prizePool).toBe(87300000);
  });
  it("treats malformed payloads as invalid", () => {
    expect(parseDisplayStatePayload(null).status).toBe("invalid");
    expect(parseDisplayStatePayload("nope").status).toBe("invalid");
    expect(parseDisplayStatePayload({}).status).toBe("invalid");
  });

  it("passes well-formed payloads through", () => {
    expect(parseDisplayStatePayload({ status: "unpaired" }).status).toBe("unpaired");
    expect(parseDisplayStatePayload(PAIRED).status).toBe("paired");
  });
});

describe("mapDisplayStateToTvData", () => {
  it('shows shared event GTD separately from the flight prize pool',()=>{
    const data=mapDisplayStateToTvData({...PAIRED,
      main_event:{id:'event-test',name:'Main Event TEST',guarantee_amount:2500000}},100)!;
    expect(data.mainEventGuarantee).toBe(2500000);
    expect(data.guarantee).toBeNull();
    expect(data.prizePool).toBe(PAIRED.tournament!.prize_pool);
    const clock=mapTvDataToClock(data);
    expect(clock.footerNote).toContain('Main Event GTD (all flights): 2.500.000');
    expect(clock.prizePool).toBe('87.300.000');
  });
  it.each([null,0,-1,0.5,'2500000'])('does not invent a positive GTD from %s',value=>{
    const data=mapDisplayStateToTvData({...PAIRED,
      main_event:{id:'event-test',name:'Main Event TEST',guarantee_amount:value as number|null}},100)!;
    expect(data.mainEventGuarantee).toBe(value===0?0:null);
    expect(mapTvDataToClock(data).footerNote).not.toContain('Main Event GTD');
  });
  it("carries the exact canonical total independently of the rounded average", () => {
    const data = mapDisplayStateToTvData({ ...PAIRED,
      participation_counts: { total_entries: 3, live_entry_stack: 100000 },
      tournament: { ...PAIRED.tournament!, players_remaining: 3, average_stack: 33333 } }, 100);
    expect(data?.totalChips).toBe(100000);
  });
  it("maps a paired+assigned payload into the frozen TvData contract", () => {
    const data = mapDisplayStateToTvData(PAIRED, 1015);
    expect(data).not.toBeNull();
    expect(data!.tournamentName).toBe("VinPoker Weekly Deepstack");
    expect(data!.clubName).toBe("VinPoker Club");
    expect(data!.clubLogoUrl).toBe("https://cdn.example/logo.png");
    expect(data!.brandName).toBe("VIN CLUB");
    expect(data!.clubCoverUrl).toBe("https://cdn.example/background.jpg");
    expect(data!.status).toBe("live");
    expect(data!.isRunning).toBe(true);
    expect(data!.remainingSeconds).toBe(1015); // drift-corrected, not the snapshot
    expect(data!.currentLevel?.levelNumber).toBe(8);
    expect(data!.nextBreakSeconds).toBe(1015); // level-9 break is next
    expect(data!.totalEntries).toBe(97);
    expect(data!.totalBuyIns).toBe(97_000_000);
    expect(data!.reEntries).toBe(12);
    expect(data!.prizes).toEqual([{ position: 1, amount: 35_000_000 }]);
  });

  it("clamps total entries to players remaining (walk-ins)", () => {
    const data = mapDisplayStateToTvData(
      { ...PAIRED, entries: { total_confirmed: 10, total_buy_ins: 10_000_000 } },
      1015,
    );
    expect(data!.totalEntries).toBe(42);
  });

  it("returns null for standby (no tournament assigned)", () => {
    expect(mapDisplayStateToTvData({ ...PAIRED, tournament: null, clock: null }, 0)).toBeNull();
  });

  it("returns null for non-paired states", () => {
    expect(mapDisplayStateToTvData({ status: "unpaired" }, 0)).toBeNull();
    expect(mapDisplayStateToTvData({ status: "revoked" }, 0)).toBeNull();
    expect(mapDisplayStateToTvData({ status: "invalid" }, 0)).toBeNull();
  });

  it("survives missing optional collections", () => {
    const data = mapDisplayStateToTvData(
      { ...PAIRED, levels: null, prizes: null, entries: null, re_entries: null },
      1015,
    );
    expect(data!.nextBreakSeconds).toBeNull();
    expect(data!.prizes).toEqual([]);
    expect(data!.totalBuyIns).toBeNull();
    expect(data!.reEntries).toBeNull();
    expect(data!.totalEntries).toBe(42); // falls back to players_remaining
  });
});
