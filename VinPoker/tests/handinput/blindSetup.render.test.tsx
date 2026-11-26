import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BlindSetupPanel,
  type BlindSetupPlayer,
} from "@/components/cashier/tournament-live/handinput/BlindSetupPanel";

const players: BlindSetupPlayer[] = [
  { player_id: "p1", seat_number: 7, display_name: "An", current_stack: 10000 },
  { player_id: "p2", seat_number: 8, display_name: "Binh", current_stack: 50 }, // short → BB all-in
];

const baseProps = {
  buttonSeat: 6,
  sbSeat: 7,
  bbSeat: 8,
  firstActorSeat: 9,
  isHeadsUp: false,
  players,
  levelNumber: 3 as number | null,
  ante: 0,
  levelMissing: false,
  sbAmount: 100,
  bbAmount: 200, // ≥ p2 stack 50 → all-in indicator
  onSbAmountChange: () => {},
  onBbAmountChange: () => {},
  sbPosted: false,
  bbPosted: false,
  onPost: () => {},
  onConfirm: () => {},
};

describe("BlindSetupPanel (engine-mode blind setup phase)", () => {
  it("renders the setup header, SB/BB seats, post buttons, confirm + UTG hint", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} />);
    expect(html).toContain("Thiết lập blind");
    expect(html).toContain("Small Blind");
    expect(html).toContain("Big Blind");
    expect(html).toContain("Level 3");
    expect(html).toContain("Ghế 7"); // SB seat
    expect(html).toContain("Ghế 8"); // BB seat
    expect(html).toContain("Post SB");
    expect(html).toContain("Post BB");
    expect(html).toContain("Xác nhận blind");
    expect(html).toContain("UTG (ghế 9)"); // first actor hint
  });

  it("shows an all-in indicator when a blind ≥ that seat's stack", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} />);
    expect(html).toContain("(All-in)"); // BB 200 ≥ Binh's 50
  });

  it("heads-up note replaces the UTG hint", () => {
    const html = renderToStaticMarkup(
      <BlindSetupPanel {...baseProps} isHeadsUp sbSeat={6} bbSeat={8} />
    );
    expect(html).toContain("Heads-up: Button là Small Blind và hành động trước preflop.");
  });

  it("refresh-safe: when SB+BB are already posted it shows 'Đã post' and no duplicate Post buttons", () => {
    const html = renderToStaticMarkup(
      <BlindSetupPanel {...baseProps} sbPosted bbPosted />
    );
    expect((html.match(/Đã post/g) || []).length).toBe(2);
    expect(html).not.toContain("Post SB");
    expect(html).not.toContain("Post BB");
  });

  it("shows a manual-override warning when the Floor level is missing", () => {
    const html = renderToStaticMarkup(
      <BlindSetupPanel {...baseProps} levelMissing levelNumber={null} />
    );
    expect(html).toContain("manual override");
  });
});

// A1 (trackerBlindAutoSeed) — the additive provenance + one-tap props. Absent →
// byte-identical to today (the flag-OFF operator path never passes them).
describe("BlindSetupPanel A1 blind auto-seed (additive props)", () => {
  it("offers one atomic post for frozen BB ante hands and disables individual posts", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} atomicBlinds ante={200}
      lockedAmounts onPostBoth={() => {}} onToggleDeadSb={() => {}} />);
    expect(html).toContain("Đặt blind và ante");
    expect(html).toContain("ante tối đa 200");
    expect(html).toContain("ưu tiên blind khi thiếu chip");
    expect((html.match(/Chờ xác nhận/g) || []).length).toBe(2);
    expect(html).not.toContain("Post SB");
    expect(html).not.toContain("Post BB");
    expect(html).not.toContain('type="checkbox"');
  });
  it("without the new props the panel renders no one-tap button and no provenance line", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} />);
    expect(html).not.toContain("Đăng blind &amp; xác nhận");
    expect(html).not.toContain("Tự lấy từ clock giải");
  });

  it("with provenance + onPostBoth it shows the source line and the one-tap button with amounts", () => {
    const html = renderToStaticMarkup(
      <BlindSetupPanel {...baseProps} provenance="SB 100 · BB 200 · lấy 14:05" onPostBoth={() => {}} />
    );
    expect(html).toContain("Tự lấy từ clock giải");
    expect(html).toContain("SB 100 · BB 200 · lấy 14:05");
    expect(html).toContain("Đăng blind &amp; xác nhận");
    expect(html).toContain("SB 100 / BB 200"); // the operator SEES what will be posted
  });

  it("zero-guard: a 0 BB never shows the one-tap button (manual entry only)", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} bbAmount={0} onPostBoth={() => {}} />);
    expect(html).not.toContain("Đăng blind &amp; xác nhận");
  });

  it("already posted → no one-tap button (nothing to double-post)", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} sbPosted bbPosted onPostBoth={() => {}} />);
    expect(html).not.toContain("Đăng blind &amp; xác nhận");
  });

  it("dead SB: the one-tap button works with only a valid BB and says SB chết", () => {
    const html = renderToStaticMarkup(
      <BlindSetupPanel {...baseProps} deadSb onToggleDeadSb={() => {}} sbAmount={0} onPostBoth={() => {}} />
    );
    expect(html).toContain("Đăng blind &amp; xác nhận");
    expect(html).toContain("SB chết");
  });
});

// A2 (trackerWorkflowAids) — the additive "Lấy blind mới" refresh button. Absent →
// byte-identical; only shown while no blind is posted (never re-seeds posted amounts).
describe("BlindSetupPanel A2 refresh live level (additive prop)", () => {
  it("without onRefreshLevel → no refresh button (byte-identical)", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} />);
    expect(html).not.toContain("Lấy blind mới");
  });

  it("with onRefreshLevel + nothing posted → shows the refresh button", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} onRefreshLevel={() => {}} />);
    expect(html).toContain("Lấy blind mới");
  });

  it("once a blind is posted → the refresh button is hidden (never re-seeds posted amounts)", () => {
    const html = renderToStaticMarkup(<BlindSetupPanel {...baseProps} onRefreshLevel={() => {}} sbPosted bbPosted />);
    expect(html).not.toContain("Lấy blind mới");
  });
});
