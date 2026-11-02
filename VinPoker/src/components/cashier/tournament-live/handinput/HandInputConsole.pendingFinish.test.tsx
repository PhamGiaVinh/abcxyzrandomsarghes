import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HandInputConsole } from "./HandInputConsole";

const fixture = vi.hoisted(() => ({
  flags: { trackerRacetrackUi: true },
  hook: { pendingFinish: {request_id:'finish-console-test'} as object | null, pendingFinishError: null as string | null,
    submitting: false, handleCancelPendingFinish: vi.fn(), handleReconcilePendingFinish: vi.fn() },
}));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: fixture.flags }));
vi.mock("./useStandaloneHandInput", () => ({ useStandaloneHandInput: () => fixture.hook }));
vi.mock("./StandaloneHandInputConsole", () => ({ StandaloneHandInputConsole: () => <div>Standalone</div> }));
vi.mock("./RacetrackHandInputConsole", () => ({ RacetrackHandInputConsole: () => <div>Racetrack</div> }));
vi.mock("@/components/tracker/TrackerCardStyle", () => ({ TrackerInputCardProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
afterEach(() => { cleanup(); fixture.hook.pendingFinish = {request_id:'finish-console-test'}; fixture.hook.pendingFinishError = null;
  fixture.hook.submitting = false; fixture.hook.handleCancelPendingFinish.mockClear(); fixture.hook.handleReconcilePendingFinish.mockClear(); });
describe("shared pending Finish controls", () => {
  for (const racetrack of [true, false]) it(`provides receipt-only recovery in layout ${racetrack}`, () => {
    fixture.flags.trackerRacetrackUi = racetrack;render(<HandInputConsole tournamentId="test" />);
    fireEvent.click(screen.getByRole('button',{name:'Đối chiếu Finish đã gửi'}));
    expect(fixture.hook.handleReconcilePendingFinish).toHaveBeenCalledOnce();
    expect(fixture.hook.handleCancelPendingFinish).not.toHaveBeenCalled();
  });
  for (const racetrack of [true, false]) it(`provides explicit cancellation in layout ${racetrack}`, () => {
    fixture.flags.trackerRacetrackUi = racetrack;
    render(<HandInputConsole tournamentId="test" />);
    expect(screen.getByText(racetrack ? "Racetrack" : "Standalone")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Hủy yêu cầu Finish (không void hand)" });
    fireEvent.click(button); expect(fixture.hook.handleCancelPendingFinish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Xác nhận hủy yêu cầu Finish'}));
    expect(fixture.hook.handleCancelPendingFinish).toHaveBeenCalledExactlyOnceWith('finish-console-test');
  });
  it("does not allow another cancellation while submitting", () => {
    fixture.hook.submitting = true; render(<HandInputConsole tournamentId="test" />);
    const button = screen.getByRole("button", { name: /Hủy yêu cầu Finish/ });
    expect(button).toBeDisabled(); fireEvent.click(button);
    expect(fixture.hook.handleCancelPendingFinish).not.toHaveBeenCalled();
  });
  it("shows corrupt-journal failure rather than an empty pending state", () => {
    fixture.hook.pendingFinish = null; fixture.hook.pendingFinishError = "Không đọc được yêu cầu Finish đang chờ.";
    render(<HandInputConsole tournamentId="test" />);
    expect(screen.getByRole("alert")).toHaveTextContent(fixture.hook.pendingFinishError);
    expect(screen.queryByRole("button", { name: /Hủy yêu cầu Finish/ })).not.toBeInTheDocument();
  });
});
