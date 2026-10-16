import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HandEditPanel } from "@/components/cashier/tournament-live/HandEditPanel";

const props = {
  board: [],
  buttonSeat: 1,
  players: [
    { player_id: "p1", entry_number: 1, display_name: "Ghế 1", seat_number: 1, starting_stack: 1_000, ending_stack: 900, hole_cards: [] },
    { player_id: "p2", entry_number: 1, display_name: "Ghế 2", seat_number: 2, starting_stack: 1_000, ending_stack: 1_100, hole_cards: [] },
  ],
  actions: [
    { player_id: "p1", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 50, action_order: 1 },
    { player_id: "p2", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 100, action_order: 2 },
    { player_id: "p1", entry_number: 1, street: "preflop", action_type: "call", action_amount: 50, action_order: 3 },
    { player_id: "p2", entry_number: 1, street: "preflop", action_type: "check", action_amount: 0, action_order: 4 },
  ],
  onCancel: vi.fn(),
  onSave: vi.fn(),
  onResettle: vi.fn(),
  resettleEnabled: true,
};

describe("HandEditPanel action amounts", () => {
  it("shows the exact call requirement and prevents an invalid action correction", () => {
    render(<HandEditPanel {...props} />);

    expect(screen.getByText(/Call hợp lệ: thêm 50/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Số chip action 3" }), { target: { value: "25" } });

    expect(screen.getByText(/Call phải thêm đúng 50/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xem trước tính chip" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Xem lại & lưu" })).not.toBeInTheDocument();
  });

  it("labels a missing recorded pot without showing a verified zero", () => {
    render(<HandEditPanel {...props} potSize={null} />);
    expect(screen.getByText("Chưa có dữ liệu")).toBeInTheDocument();
    expect(screen.getByText(/Đường lưu hiển thị riêng đang tắt/)).toBeInTheDocument();
    expect(screen.getByText(/chỉ lưu sau khi máy chủ xác nhận đường sửa nguyên tử/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Lý do sửa — bắt buộc" })).toBeInTheDocument();
  });

  it("offers the canonical next BB action when an edited SB call leaves the draft incomplete", () => {
    render(<HandEditPanel {...props} actions={props.actions.slice(0, 3)} />);

    expect(screen.getByText(/INCOMPLETE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nhập lượt Ghế 2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xem trước tính chip" })).toBeDisabled();
  });
});
