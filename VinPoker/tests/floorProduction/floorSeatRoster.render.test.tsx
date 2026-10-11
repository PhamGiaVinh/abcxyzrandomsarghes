import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FloorSeatRoster } from "../../src/components/ops/shared/FloorSeatRoster";

afterEach(cleanup);

describe("FloorSeatRoster", () => {
  it("preserves anomalous occupancy but never opens player or empty-seat actions", () => {
    const onSeatTap = vi.fn();
    const onEmptySeatTap = vi.fn();
    render(<FloorSeatRoster seats={[{ seatNumber: 3, playerName: "Test 4", chipsLabel: "2.400.000",
      entryNumber: 1, integrityStatus: "invalid_participation" }]}
      onSeatTap={onSeatTap} onEmptySeatTap={onEmptySeatTap} />);
    const row = screen.getByRole("button", { name: "Ghế 3, cần sửa dữ liệu" });
    expect(row).toBeDisabled();
    expect(within(row).getByText("Test 4")).toBeInTheDocument();
    expect(within(row).getByText("Cần sửa dữ liệu · thông tin chưa khớp")).toBeInTheDocument();
    fireEvent.click(row);
    expect(onSeatTap).not.toHaveBeenCalled();
    expect(onEmptySeatTap).not.toHaveBeenCalled();
  });
  it("keeps all nine seats visible and exposes empty seats as intentional actions", () => {
    const onSeatTap = vi.fn();
    const onEmptySeatTap = vi.fn();

    render(
      <FloorSeatRoster
        seats={[
          { seatNumber: 1, playerName: "Player A", chipsLabel: "30.000", entryNumber: 1 },
          { seatNumber: 9, playerName: "Player I", chipsLabel: "0", entryNumber: 2 },
        ]}
        onSeatTap={onSeatTap}
        onEmptySeatTap={onEmptySeatTap}
      />,
    );

    expect(screen.getAllByTestId(/floor-seat-row-/)).toHaveLength(9);
    expect(screen.getAllByRole("button", { name: /Ghế [2-8], trống/ })).toHaveLength(7);

    fireEvent.click(screen.getByTestId("floor-seat-row-1"));
    fireEvent.click(screen.getByTestId("floor-seat-row-2"));
    expect(onSeatTap).toHaveBeenCalledWith(1);
    expect(onEmptySeatTap).toHaveBeenCalledWith(2);
  });

  it("shows a missing-entry seat as a data repair issue instead of an empty seat", () => {
    const onSeatTap = vi.fn();

    render(
      <FloorSeatRoster
        seats={[{
          seatNumber: 4,
          playerName: "Dữ liệu người chơi cũ",
          chipsLabel: "15.000",
          entryId: null,
          entryNumber: null,
          integrityStatus: "missing_entry",
        }]}
        onSeatTap={onSeatTap}
        onEmptySeatTap={() => {}}
      />,
    );

    expect(screen.getByText("Cần sửa dữ liệu · thiếu hồ sơ dự giải")).toBeInTheDocument();
    expect(screen.getByTestId("floor-seat-row-4")).toBeDisabled();
    expect(screen.getByTestId("floor-seat-row-4")).toHaveAccessibleName(/Ghế 4, cần sửa dữ liệu/);
    fireEvent.click(screen.getByTestId("floor-seat-row-4"));
    expect(onSeatTap).not.toHaveBeenCalled();
  });

  it("disables every row when the server projection contains duplicate seats", () => {
    render(
      <FloorSeatRoster
        seats={[
          { seatNumber: 3, playerName: "First", chipsLabel: "10" },
          { seatNumber: 3, playerName: "Second", chipsLabel: "20" },
        ]}
        onSeatTap={() => {}}
        onEmptySeatTap={() => {}}
      />,
    );

    expect(screen.getByText(/Trùng dữ liệu ghế 3/)).toBeInTheDocument();
    for (const row of screen.getAllByTestId(/floor-seat-row-/)) {
      expect(row).toBeDisabled();
    }
  });

  it("keeps a locked seat actionable for the unlock flow", () => {
    const onLockedSeatTap = vi.fn();
    render(
      <FloorSeatRoster
        seats={[]}
        seatLocks={[{ seatNumber: 6, reason: "Giữ ghế cho người chơi" }]}
        onEmptySeatTap={() => {}}
        onLockedSeatTap={onLockedSeatTap}
      />,
    );

    const lockedSeat = screen.getByRole("button", { name: /Ghế 6, đang khóa/ });
    expect(lockedSeat).not.toBeDisabled();
    expect(within(lockedSeat).getByText("Mở khóa")).toBeInTheDocument();
    fireEvent.click(lockedSeat);
    expect(onLockedSeatTap).toHaveBeenCalledWith(6);
  });
});
