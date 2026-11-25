import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: {user: {id: "actor-a"} as {id: string} | null, session: null, loading: false, rolesLoading: false, authError: null as string | null, rolesError: null as string | null,
    isAdmin: false, isClubAdmin: false, isClubOwner: false},
}));
vi.mock("@/hooks/useAuth", () => ({useAuth: () => fixture.auth}));
vi.mock("@/integrations/supabase/client", () => ({supabase: {rpc: fixture.rpc}}));
import { FinanceDealerPtWages } from "./FinanceDealerPtWages";

function packet(club: string, name: string) {
  return {data: {club_id: club, as_of: "2026-11-25T15:00:00Z", dealers: [{
    dealer_id: "33333333-3333-4333-8333-333333333333", full_name: name,
    hourly_rate_vnd: 60000, accrued_minutes: 1, balance_vnd: 1000,
    last_reset_at: null, current_shift_open: false, current_shift_start: null, last_payment: null,
  }]}, error: null};
}
beforeEach(() => {
  fixture.rpc.mockReset();
  fixture.auth.user = {id: "actor-a"};
  fixture.auth.loading = false;
  fixture.auth.rolesLoading = false;
  fixture.auth.authError = null;
  fixture.auth.rolesError = null;
});
afterEach(cleanup);

it("discards a late previous-club response after switching club", async () => {
  let resolveOld!: (value: unknown) => void;
  fixture.rpc.mockImplementationOnce(() => new Promise(resolve => {resolveOld = resolve;}))
    .mockResolvedValue(packet("B", "PT B"));
  const view = render(<FinanceDealerPtWages club={{id: "A", name: "A"}} />);
  view.rerender(<FinanceDealerPtWages club={{id: "B", name: "B"}} />);
  await screen.findByText("PT B");
  await act(async () => resolveOld(packet("A", "PT A")));
  expect(screen.queryByText("PT A")).toBeNull();
  expect(screen.getByText("PT B")).toBeVisible();
});

it("revalidates the same club after an actor change and hides data during auth loading", async () => {
  fixture.rpc.mockResolvedValueOnce(packet("A", "Actor A view"))
    .mockResolvedValue(packet("A", "Actor B view"));
  const view = render(<FinanceDealerPtWages club={{id: "A", name: "A"}} />);
  await screen.findByText("Actor A view");
  fixture.auth.user = {id: "actor-b"};
  view.rerender(<FinanceDealerPtWages club={{id: "A", name: "A"}} />);
  expect(screen.queryByText("Actor A view")).toBeNull();
  await screen.findByText("Actor B view");
  fixture.auth.loading = true;
  view.rerender(<FinanceDealerPtWages club={{id: "A", name: "A"}} />);
  expect(screen.queryByText("Actor B view")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Đang xác minh");
});

it('hides the wage view when club role verification fails',()=>{fixture.auth.rolesError='unavailable';render(<FinanceDealerPtWages club={{id:'A',name:'A'}}/>);expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh');expect(fixture.rpc).not.toHaveBeenCalled();});
