import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ShowdownInputPanel, type ShowdownPlayer } from "@/components/cashier/tournament-live/handinput/ShowdownInputPanel";
import type { Card } from "@/components/shared/CardSlotPicker";

vi.mock("@/components/shared/CardSlotPicker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/shared/CardSlotPicker")>();
  return {
    ...actual,
    CardSlotPicker: () => <button type="button" aria-label="card slot" />,
  };
});

const players: ShowdownPlayer[] = [
  { player_id: "p1", seat_number: 1, display_name: "An", is_folded: false },
  { player_id: "p2", seat_number: 3, display_name: "Binh", is_folded: false },
  { player_id: "p3", seat_number: 5, display_name: "Cuong", is_folded: true },
];
const board: (Card | null)[] = ["As", "Kh", "7s", "2c", "9h"] as (Card | null)[];
const noop = () => {};

const common = {
  players,
  board,
  holeCards: {},
  usedCards: new Set<Card>(),
  onHoleCardChange: noop,
  onReveal: noop,
  onToggleWinner: noop,
  onConfirmResult: noop,
};

describe("ShowdownInputPanel", () => {
  it("shows the showdown header, the MANUAL winner label, and only still-in players", () => {
    const html = renderToStaticMarkup(<ShowdownInputPanel {...common} selectedWinners={[]} />);
    expect(html).toContain("Showdown");
    // Manual-winner label. The old "hệ thống chưa tự đánh giá bài" copy was dropped
    // once the engine gained auto-ranking (settleShowdown); the section header is now
    // "…hoặc chọn người thắng thủ công".
    expect(html).toContain("chọn người thắng thủ công");
    expect(html).toContain("An");
    expect(html).toContain("Binh");
    expect(html).not.toContain("Cuong"); // folded → not at showdown
  });

  it("'Xác nhận thủ công → Review' is DISABLED until a winner is selected", () => {
    const none = renderToStaticMarkup(<ShowdownInputPanel {...common} selectedWinners={[]} />);
    // the confirm button carries the disabled attribute when no winner chosen
    expect(none).toContain("Xác nhận thủ công → Review");
    expect(none).toContain('disabled=""');

    const picked = renderToStaticMarkup(<ShowdownInputPanel {...common} selectedWinners={["p1"]} />);
    expect(picked).not.toContain('disabled=""');
  });
});

// ── UAT wave 2 (trackerCoverCallRunout): skip-reveal escape on the runout panel ──
// Needs interactivity (2-tap confirm) → testing-library, not static markup.
afterEach(() => cleanup());

describe("ShowdownInputPanel — revealOnly skip escape (UAT wave 2)", () => {
  const revealCommon = { ...common, selectedWinners: [] as string[], revealOnly: true, onRevealAndContinue: noop };

  it("does not claim every contender is all-in when a covering player retains chips", () => {
    const html = renderToStaticMarkup(<ShowdownInputPanel {...revealCommon} />);
    expect(html).not.toContain("Tất cả đã all-in");
    expect(html).toContain("Đã hết lượt cược");
    expect(html).toContain("chạy nốt board");
  });

  it("no onSkipReveal → markup byte-identical to today's revealOnly panel (tripwire)", () => {
    const plain = renderToStaticMarkup(<ShowdownInputPanel {...revealCommon} />);
    expect(plain).not.toContain("Tiếp tục không lật");
    expect(plain).not.toContain("Bài sẽ không hiển thị trên viewer");
  });

  it("with onSkipReveal → the amber escape block + exact warning copy render", () => {
    const html = renderToStaticMarkup(<ShowdownInputPanel {...revealCommon} onSkipReveal={noop} />);
    expect(html).toContain("Nếu chọn");
    expect(html).toContain("Tiếp tục không lật (không có thông tin bài)");
    expect(html).toContain("Bài sẽ không hiển thị trên viewer. Bạn vẫn phải chấm kết quả thủ công ở Showdown.");
  });

  it("2-tap confirm: first tap arms (no fire), second tap fires the handler", () => {
    const onSkip = vi.fn();
    const { getByText } = render(<ShowdownInputPanel {...revealCommon} onSkipReveal={onSkip} />);
    const btn = getByText("Tiếp tục không lật (không có thông tin bài)");
    fireEvent.click(btn);
    expect(onSkip).not.toHaveBeenCalled();
    expect(getByText("Xác nhận: tiếp tục không lật")).toBeTruthy();
    expect(getByText("Bấm Xác nhận trong 8 giây để chạy board mà không hiện bài tẩy.")).toHaveAttribute("aria-live", "polite");
    fireEvent.click(getByText("Xác nhận: tiếp tục không lật"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("keeps the second-tap confirmation armed for 8 seconds", () => {
    vi.useFakeTimers();
    const { getByText, queryByText } = render(<ShowdownInputPanel {...revealCommon} onSkipReveal={noop} />);
    fireEvent.click(getByText("Tiếp tục không lật (không có thông tin bài)"));
    act(() => vi.advanceTimersByTime(7999));
    expect(getByText("Xác nhận: tiếp tục không lật")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(queryByText("Xác nhận: tiếp tục không lật")).toBeNull();
    expect(getByText("Tiếp tục không lật (không có thông tin bài)")).toBeTruthy();
    vi.useRealTimers();
  });

  it("disabled while submitting", () => {
    const {getByRole}=render(<ShowdownInputPanel {...revealCommon} onSkipReveal={noop} submitting />);
    expect(getByRole('button',{name:'Tiếp tục không lật (không có thông tin bài)',exact:true})).toBeDisabled();
  });

  it("escape stays available even when the live players are NOT resolved (its purpose)", () => {
    // holeCards empty → allLiveResolved=false → primary reveal disabled, escape enabled.
    const html = renderToStaticMarkup(<ShowdownInputPanel {...revealCommon} onSkipReveal={noop} />);
    expect(html).toContain("Cần đủ 2 lá tẩy cho mỗi người còn bài");
    expect(html).toContain("Tiếp tục không lật (không có thông tin bài)");
  });
});

// ── trackerShowdownRevealOrder: operator panel lists players in reveal order ──
describe("ShowdownInputPanel — reveal-order list (operator hint)", () => {
  it("revealOrder absent → original players order (byte-identical)", () => {
    const html = renderToStaticMarkup(<ShowdownInputPanel {...common} selectedWinners={[]} />);
    // An/Binh in the players[] order; no ①②③ position badge.
    expect(html.indexOf("An")).toBeLessThan(html.indexOf("Binh"));
    expect(html).not.toContain('title="Thứ tự lật bài"');
  });

  it("revealOrder present → still-in list sorted to it + a position badge", () => {
    // players are p1(An), p2(Binh) [p3 folded]; reveal order Binh-first.
    const html = renderToStaticMarkup(
      <ShowdownInputPanel {...common} selectedWinners={[]} revealOrder={["p2", "p1"]} />
    );
    expect(html.indexOf("Binh")).toBeLessThan(html.indexOf("An")); // reordered
    expect(html).toContain('title="Thứ tự lật bài"'); // badge present
  });
});
