import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupHandPanel } from "./SetupHandPanel";

afterEach(cleanup);
const base = { handNumber: 1 as const, onHandNumberChange: vi.fn(), seats: [], positions: new Map<number, string>(),
  buttonSeat: 1, buttonConfirmed: true, onTapSeat: vi.fn(), onResetButton: vi.fn(),
  submitting: false, lastHandId: null, onVoid: vi.fn() };
describe("start capability presentation", () => {
  it("explains refusal and blocks only start, preserving setup controls", () => {
    const start = vi.fn();
    render(<SetupHandPanel {...base} onStartHand={start} startDisabledReason="Cần quyền Tracker của CLB" />);
    expect(screen.getByRole("status")).toHaveTextContent("Cần quyền Tracker của CLB");
    const button = screen.getByRole("button", { name: "Bắt đầu Hand" });
    expect(button).toBeDisabled(); fireEvent.click(button); expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("spinbutton")).toBeEnabled();
  });
  it("allows the qualified start without changing existing payload callbacks", () => {
    const start = vi.fn();
    render(<SetupHandPanel {...base} onStartHand={start} startDisabledReason={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu Hand" }));
    expect(start).toHaveBeenCalledOnce(); expect(screen.queryByRole("status")).toBeNull();
  });
});
