import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RegistrationQueuePanel } from "./RegistrationQueuePanel";

const fixture = vi.hoisted(() => ({ actor: "actorA", failure: "", pending: null as Promise<unknown> | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: fixture.actor ? { id: fixture.actor } : null }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) query[method] = () => query;
  query.then = (done: (value: unknown) => unknown) => {
    if (fixture.pending) return fixture.pending.then(done);
    const rows = table === "tournament_registrations" ? [{ id: "reg", reference_code: "ref", status: "pending", player_id: "player", committed_at: "2026-10-14", total_pay: 0 }] : [];
    return Promise.resolve({ data: fixture.failure === table ? null : rows, error: fixture.failure === table ? { message: "503" } : null }).then(done);
  };
  return query;
} } }));
vi.mock("./SeatDrawDialog", () => ({ SeatDrawDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Draw TEST</div> : null }));
vi.mock("./MovePlayerDialog", () => ({ MovePlayerDialog: () => null }));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: () => null }));
vi.mock("@/components/cashier/registrations/CancelRegistrationDialog", () => ({ CancelRegistrationDialog: () => null }));
vi.mock("@/components/cashier/registrations/VoidRegistrationDialog", () => ({ VoidRegistrationDialog: () => null }));
afterEach(() => { cleanup(); fixture.actor = "actorA"; fixture.failure = ""; fixture.pending = null; });
const props = { tournamentId: "tourA", tournamentName: "TEST", tournamentDate: null, refreshTrigger: 0 };

it("shows a read error instead of an empty queue and disables bulk actions", async () => {
  fixture.failure = "tournament_entries";
  render(<RegistrationQueuePanel {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được đầy đủ");
  expect(screen.queryByText("Chưa có đăng ký nào cho giải này.")).toBeNull();
  expect(screen.getByRole("button", { name: /Bốc thăm tất cả/ })).toBeDisabled();
});

for (const change of ["actor", "tournament"]) it(`removes previous rows immediately when ${change} changes`, async () => {
  const rendered = render(<RegistrationQueuePanel {...props} />);
  await screen.findByText("ref");
  fixture.pending = new Promise(() => {});
  if (change === "actor") fixture.actor = "actorB";
  rendered.rerender(<RegistrationQueuePanel {...props} tournamentId={change === "tournament" ? "tourB" : "tourA"} />);
  expect(screen.queryByText("ref")).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: /Bốc thăm tất cả/ })).toBeDisabled());
});

it("logout unmounts rows and mutation dialogs", async () => {
  const rendered = render(<RegistrationQueuePanel {...props} />);
  await screen.findByText("ref"); fixture.actor = "";
  rendered.rerender(<RegistrationQueuePanel {...props} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Đăng nhập");
  expect(screen.queryByText("ref")).toBeNull();
});

it("failed refresh closes a previously opened draw intent and keeps last-good rows stale", async () => {
  const rendered = render(<RegistrationQueuePanel {...props} />);
  await screen.findByText("ref");
  fireEvent.click(screen.getByRole("button", { name: "Bốc thăm chỗ" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fixture.failure = "seat_draw_receipts";
  rendered.rerender(<RegistrationQueuePanel {...props} refreshTrigger={1} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("chưa được xác minh lại");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("ref")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Bốc thăm chỗ" })).toBeDisabled();
});
