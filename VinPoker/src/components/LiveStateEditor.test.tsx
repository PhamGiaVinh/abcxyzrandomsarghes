import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveStateEditor } from "./LiveStateEditor";

const state = vi.hoisted(() => ({ actor: "owner", loading: false, rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc, from: state.from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.actor ? { id: state.actor } : null, loading: state.loading }) }));
afterEach(cleanup);
const summary = (id: string) => ({ tournament_id: id, average_stack: 1000, counts: {
  total_entries: 8, re_entries: 0, remaining: 8, seated: 8, waiting: 0, busted: 0,
  anomaly_entries: 0, anomaly_seats: 0, live_entry_stack: 8000, seated_stack: 8000, waiting_stack: 0,
} });
const clock = (id: string) => ({ tournament_id: id, status: "live", current_level: { level_number: 7, small_blind: 100, big_blind: 200 } });
const view = (id = "a") => <MemoryRouter><LiveStateEditor tournament={{ id, club_id: "club" }} /></MemoryRouter>;
const open = () => fireEvent.click(screen.getByRole("button", { expanded: false }));
beforeEach(() => {
  state.actor = "owner"; state.loading = false; state.from.mockReset(); state.rpc.mockReset();
  state.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => Promise.resolve({
    data: name === "get_tournament_clock" ? clock(args.p_tournament_id) : summary(args.p_tournament_id), error: null,
  }));
});

it("reads lazily and never offers direct duplicate-state writes", async () => {
  const { container } = render(view());
  expect(state.rpc).not.toHaveBeenCalled();
  open();
  await waitFor(() => expect(container.querySelectorAll("dd")).toHaveLength(4));
  expect(Array.from(container.querySelectorAll("dd"), node => node.textContent)).toEqual(["8", "7", "100/200", "live"]);
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(state.from).not.toHaveBeenCalled();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/ops/floor/tournaments/a/clock?club=club");
});

it("removes A state immediately when switching to B, including a late A read", async () => {
  let resolveOld!: (value: unknown) => void;
  state.rpc.mockImplementation((name: string, args: { p_tournament_id: string }) => {
    if (name === "get_tournament_clock" && args.p_tournament_id === "a") return new Promise(resolve => { resolveOld = resolve; });
    return Promise.resolve({ data: name === "get_tournament_clock" ? clock(args.p_tournament_id) : summary(args.p_tournament_id), error: null });
  });
  const { rerender, container } = render(view());
  open();
  await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
  rerender(view("b"));
  expect(container.querySelector("dd")).toBeNull();
  open();
  await waitFor(() => expect(container.querySelectorAll("dd")).toHaveLength(4));
  await act(async () => resolveOld({ data: { ...clock("a"), current_level: { level_number: 99, small_blind: 1, big_blind: 2 } }, error: null }));
  expect(screen.queryByText("99")).not.toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/ops/floor/tournaments/b/clock?club=club");
  expect(state.from).not.toHaveBeenCalled();
});

it("fails closed for a clock from another tournament", async () => {
  state.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "get_tournament_clock" ? clock("foreign") : summary("a"), error: null }));
  const { container } = render(view());
  open();
  await screen.findByRole("alert");
  expect(container.querySelector("dd")).toBeNull();
  expect(state.from).not.toHaveBeenCalled();
});

it("hides old actor state on logout and performs no anonymous reads", async () => {
  const { rerender, container } = render(view());
  open();
  await waitFor(() => expect(container.querySelectorAll("dd")).toHaveLength(4));
  const calls = state.rpc.mock.calls.length;
  state.actor = "";
  rerender(view());
  expect(container.querySelector("dd")).toBeNull();
  expect(screen.getByRole("button")).toBeDisabled();
  expect(state.rpc).toHaveBeenCalledTimes(calls);
});

it("shows unavailable rather than a fabricated zero when the participation read fails", async () => {
  state.rpc.mockImplementation((name: string) => Promise.resolve(name === "get_tournament_clock"
    ? { data: clock("a"), error: null } : { data: null, error: { message: "503" } }));
  const { container } = render(view());
  open();
  await screen.findByRole("alert");
  expect(container.querySelector("dd")).toBeNull();
  expect(state.from).not.toHaveBeenCalled();
});

it("does not resurrect verified state after auth verification or A-B-A navigation", async () => {
  const { rerender, container } = render(view());
  open();
  await waitFor(() => expect(container.querySelectorAll("dd")).toHaveLength(4));
  state.loading = true;
  rerender(view());
  expect(container.querySelector("dd")).toBeNull();
  state.loading = false;
  rerender(view());
  expect(container.querySelector("dd")).toBeNull();
  expect(screen.getByRole("button", { expanded: false })).toBeEnabled();
  open();
  await waitFor(() => expect(container.querySelectorAll("dd")).toHaveLength(4));
  rerender(view("b"));
  rerender(view("a"));
  expect(container.querySelector("dd")).toBeNull();
});

it("requires a new read when closing and reopening the card", async () => {
  const { container } = render(view());
  open();
  await waitFor(() => expect(container.querySelectorAll("dd")).toHaveLength(4));
  fireEvent.click(screen.getByRole("button", { expanded: true }));
  state.rpc.mockImplementation(() => new Promise(() => {}));
  open();
  expect(container.querySelector("dd")).toBeNull();
  await screen.findByRole("status");
});

it("does not guess club scope or read when the parent has no club", async () => {
  render(<MemoryRouter><LiveStateEditor tournament={{ id: "a" }} /></MemoryRouter>);
  open();
  await screen.findByRole("alert");
  expect(state.rpc).not.toHaveBeenCalled();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
