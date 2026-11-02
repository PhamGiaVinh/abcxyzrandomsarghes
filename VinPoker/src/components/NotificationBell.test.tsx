import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  items: [] as Array<{ id: string; title: string; body: string; is_read: boolean }>,
  unreadCount: 0,
  notify: undefined as undefined | ((row: { title: string; body: string }) => void),
  toast: vi.fn(),
  error: null as string | null,
  loading: false,
  refresh: vi.fn(),
  markRead: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: (_limit: number, notify?: typeof state.notify) => {
    state.notify = notify;
    return { items: state.items, unreadCount: state.unreadCount, loading: state.loading, error: state.error, markRead: state.markRead, markAllRead: vi.fn(), refresh: state.refresh };
  },
  ICON_FOR: {}, routeForNotification: () => "/notifications", timeAgo: () => "now",
}));
import { NotificationBell } from "./NotificationBell";
import Notifications from "@/pages/Notifications";

function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }

describe("notification toast freshness", () => {
  beforeEach(() => { state.items = []; state.unreadCount = 0; state.notify = undefined; state.toast.mockReset(); state.error = null; state.loading = false; state.refresh.mockReset(); state.markRead.mockReset(); state.markRead.mockResolvedValue(false); });

  it.each(["bell", "page"])("exposes each %s notification as a native keyboard-focusable action", async (surface) => {
    state.items = [{ id: "keyboard", title: "Keyboard TEST", body: "Open safely", is_read: false }];
    state.markRead.mockResolvedValue(true);
    render(<MemoryRouter initialEntries={["/tracker"]}>{surface === "bell" ? <NotificationBell /> : <Notifications />}<Location /></MemoryRouter>);
    if (surface === "bell") fireEvent.click(screen.getByRole("button", { name: /^Thông báo$/ }));
    const action = await screen.findByRole("button", { name: /Keyboard TEST/ });
    expect(action.tagName).toBe("BUTTON");expect(action).toHaveAttribute("type", "button");
    action.focus();expect(action).toHaveFocus();
    fireEvent.click(action);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/notifications"));
    expect(state.markRead).toHaveBeenCalledOnce();expect(state.markRead).toHaveBeenCalledWith("keyboard");
  });

  it("does not announce historical unread records loaded on page entry", async () => {
    const view = render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    state.items = [{ id: "historical", title: "Registration confirmed", body: "Old registration", is_read: false }];
    state.unreadCount = 6;
    view.rerender(<MemoryRouter><NotificationBell /></MemoryRouter>);
    await waitFor(() => expect(state.toast).not.toHaveBeenCalled());
  });

  it("announces a new scoped INSERT independently of historical unread count", () => {
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    expect(state.notify).toBeTypeOf("function");
    act(() => state.notify?.({ title: "New notification", body: "Fresh event" }));
    expect(state.toast).toHaveBeenCalledOnce();
    expect(state.toast).toHaveBeenCalledWith("New notification", { description: "Fresh event" });
  });

  it("shows a retryable read error rather than a false empty list", async () => {
    state.error = "503";
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /^Thông báo$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không xác minh được thông báo");
    expect(screen.queryByText("Chưa có thông báo")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Thử lại$/ }));
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the bell open and does not navigate when marking read is rejected", async () => {
    state.items = [{ id: "test", title: "Test unread", body: "Test", is_read: false }];
    render(<MemoryRouter initialEntries={["/tracker"]}><NotificationBell /><Location /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /^Thông báo$/ }));
    fireEvent.click(await screen.findByText("Test unread"));
    await waitFor(() => expect(state.markRead).toHaveBeenCalledWith("test"));
    expect(screen.getByTestId("location")).toHaveTextContent("/tracker");
    expect(screen.getByText("Test unread")).toBeVisible();
  });

  it("shows page read errors with retry and blocks rejected notification navigation", async () => {
    state.items = [{ id: "test", title: "Test unread", body: "Test", is_read: false }];
    state.unreadCount = 1;
    state.error = "503";
    render(<MemoryRouter initialEntries={["/tracker"]}><Notifications /><Location /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("Không xác minh được thông báo");
    fireEvent.click(screen.getByRole("button", { name: /^Thử lại$/ }));
    expect(state.refresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Test unread"));
    await waitFor(() => expect(state.markRead).toHaveBeenCalledWith("test"));
    expect(screen.getByTestId("location")).toHaveTextContent("/tracker");
  });
});
