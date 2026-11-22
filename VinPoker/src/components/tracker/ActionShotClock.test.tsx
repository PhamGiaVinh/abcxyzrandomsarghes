import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ActionShotClock } from "./ActionShotClock";

it("counts down, pauses, and restarts on reset or a new turn", () => {
  vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval"] });
  const view = render(<ActionShotClock key="first-turn" />);
  try {
    const timer = screen.getByRole("timer");
    expect(timer).toHaveTextContent("00:30");
    act(() => vi.advanceTimersByTime(3000));
    expect(timer).toHaveTextContent("00:27");
    fireEvent.click(screen.getByRole("button", { name: "Tạm dừng" }));
    act(() => vi.advanceTimersByTime(3000));
    expect(timer).toHaveTextContent("00:27");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(timer).toHaveTextContent("00:30");
    expect(screen.getByRole("button", { name: "Tạm dừng" })).toBeVisible();
    act(() => vi.advanceTimersByTime(30_000));
    expect(timer).toHaveTextContent("00:00");
    view.rerender(<ActionShotClock key="next-turn" />);
    expect(screen.getByRole("timer")).toHaveTextContent("00:30");
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
