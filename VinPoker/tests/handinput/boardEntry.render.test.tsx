import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BoardEntryPanel } from "@/components/cashier/tournament-live/handinput/BoardEntryPanel";
import type { Card } from "@/components/shared/CardSlotPicker";

const empty: (Card | null)[] = [null, null, null, null, null];
const flopFilled: (Card | null)[] = ["As", "Kh", "Td", null, null] as (Card | null)[];

const noop = () => {};

describe("BoardEntryPanel (Street Gate board entry)", () => {
  it("flop: header, helper, Gửi Flop button — disabled until 3 cards filled", () => {
    const html = renderToStaticMarkup(
      <BoardEntryPanel street="flop" communityCards={empty} usedCards={new Set()} onCardChange={noop} onSubmit={noop} />
    );
    expect(html).toContain("Nhập Flop");
    expect(html).toContain("Preflop đã hoàn tất. Nhập 3 lá flop để chuyển sang vòng Flop.");
    expect(html).toContain("Gửi Flop");
    expect(html).toContain('disabled=""'); // Gửi disabled (attribute) while empty
  });

  it("flop: Gửi enabled once the 3 flop cards are filled", () => {
    const html = renderToStaticMarkup(
      <BoardEntryPanel street="flop" communityCards={flopFilled} usedCards={new Set()} onCardChange={noop} onSubmit={noop} />
    );
    expect(html).toContain("Gửi Flop");
    expect(html).not.toContain('disabled=""'); // submit no longer disabled
  });

  it("turn + river have their own labels/helpers", () => {
    const turn = renderToStaticMarkup(
      <BoardEntryPanel street="turn" communityCards={empty} usedCards={new Set()} onCardChange={noop} onSubmit={noop} />
    );
    expect(turn).toContain("Nhập Turn");
    expect(turn).toContain("Gửi Turn");
    expect(turn).toContain("Vòng Flop đã hoàn tất. Nhập Turn để tiếp tục.");

    const river = renderToStaticMarkup(
      <BoardEntryPanel street="river" communityCards={empty} usedCards={new Set()} onCardChange={noop} onSubmit={noop} />
    );
    expect(river).toContain("Nhập River");
    expect(river).toContain("Gửi River");
  });

  it("shows the all-in runout note when flagged", () => {
    const html = renderToStaticMarkup(
      <BoardEntryPanel street="turn" communityCards={empty} usedCards={new Set()} onCardChange={noop} onSubmit={noop} allInRunout />
    );
    expect(html).not.toContain("All-in nhiều người");
    expect(html).toContain("Runout sau all-in");
    expect(html).toContain("Nhập từng street để cập nhật viewer");
  });
});
