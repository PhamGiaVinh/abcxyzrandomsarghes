import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RealtimePayoutPanel } from "./RealtimePayoutPanel";
import type { PublicFreshness, PublicPayoutRow } from "./publicSnapshotTypes";

afterEach(cleanup);
const rows: PublicPayoutRow[] = [{ fromPlace: 1, toPlace: 1, amountPerPlayer: 4000000, playerName: "Người thắng", avatarUrl: null, resultStatus: "official" }];
const current: PublicFreshness = { state: "current", sourceRevision: "1", projectedSourceRevision: "1", sourceChangedAt: null, publishedAt: null, serverCheckedAt: "2026-11-03T00:00:00Z", oldestPendingAt: null };
describe("published payout champion", () => {
  it("shows the server-confirmed champion and amount", () => {
    render(<RealtimePayoutPanel rows={rows} freshness={current} loading={false} published />);
    expect(screen.getByText("Nhà vô địch")).toBeInTheDocument();
    expect(screen.getByText("4.000.000 đ")).toBeInTheDocument();
    expect(screen.getAllByText("Người thắng")).toHaveLength(2);
  });
  it.each(["open", "stale", "unpublished"])("does not announce a champion for %s results", (state) => {
    render(<RealtimePayoutPanel rows={state === "open" ? [{ ...rows[0], resultStatus: "open" }] : rows}
      freshness={state === "stale" ? undefined : current} loading={false} published={state !== "unpublished"} />);
    expect(screen.queryByText("Nhà vô địch")).not.toBeInTheDocument();
  });
});
