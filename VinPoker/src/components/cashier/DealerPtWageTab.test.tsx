import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DealerPtWageTab from "./DealerPtWageTab";

const testState = vi.hoisted(() => ({
  auth: { isAdmin: true, isClubAdmin: false, isClubOwner: false },
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...testState.auth,
  user: { id: '11111111-1111-4111-8111-111111111111' }, session: null }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => testState.rpc(...args) },
}));

const clubs = [{ id: "club-1", name: "HSOP" }];

describe("DealerPtWageTab policy control", () => {
  afterEach(() => {cleanup();vi.useRealTimers();});
  beforeEach(() => {
    testState.auth = { isAdmin: true, isClubAdmin: false, isClubOwner: false };
    testState.rpc.mockReset();
    testState.rpc.mockImplementation((fn: string) => {
      if (fn === "get_club_pt_wages") {
        return Promise.resolve({
          data: {
            dealers: [],
            accrual_mode: "capped_24h",
            standby_accrual_enabled: false,
          },
          error: null,
        });
      }
      if (fn === "get_dealer_pt_wage_global_accrual_policy") {
        return Promise.resolve({ data: { future_club_enabled: false }, error: null });
      }
      if (fn === "set_dealer_pt_wage_accrual_policy") {
        return Promise.resolve({ data: {}, error: null });
      }
      if (fn === "set_all_approved_dealer_pt_wage_accrual") {
        return Promise.resolve({ data: {}, error: null });
      }
      return Promise.resolve({ data: {}, error: null });
    });
  });

  it('uses the statement flow for a cashier and never offers the legacy balance payment when statements are enabled', async () => {
    testState.auth = { isAdmin: false, isClubAdmin: false, isClubOwner: false };
    testState.rpc.mockImplementation(async name => ({ data: name === 'get_club_pt_wages' ? { dealers: [{
      dealer_id: '33333333-3333-4333-8333-333333333333', full_name: 'PT TEST', hourly_rate_vnd: 60000,
      accrued_minutes: 1, balance_vnd: 1000, last_reset_at: null, current_shift_open: false,
      current_shift_start: null, last_payment: null,
    }] } : null, error: null }));
    render(<DealerPtWageTab clubIds={['club-1']} clubs={clubs} finalizeStatements />);
    await screen.findByText('Cần Owner chốt phiếu PT trước khi ghi nhận chi.');
    expect(screen.queryByRole('button', { name: 'Thanh toán' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chốt phiếu PT' })).not.toBeInTheDocument();
  });

  it('never mounts statement mutations in a read-only wage view', async () => {
    testState.rpc.mockImplementation(async name => ({ data: name === 'get_club_pt_wages' ? { dealers: [{
      dealer_id: '33333333-3333-4333-8333-333333333333', full_name: 'PT TEST', hourly_rate_vnd: 60000,
      accrued_minutes: 1, balance_vnd: 1000, last_reset_at: null, current_shift_open: false,
      current_shift_start: null, last_payment: null,
    }] } : {}, error: null }));
    render(<DealerPtWageTab clubIds={['club-1']} clubs={clubs} finalizeStatements readOnly />);
    await screen.findByText('PT TEST');
    expect(testState.rpc.mock.calls.some(([name]) => name === 'get_part_time_payroll_statement_status_v1')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Thanh toán' })).not.toBeInTheDocument();
  });

  it('does not let ownership in another club expose finalization for the selected cashier club', async () => {
    testState.auth = { isAdmin: false, isClubAdmin: false, isClubOwner: true };
    testState.rpc.mockImplementation(async name => ({ data: name === 'get_club_pt_wages' ? { dealers: [{
      dealer_id: '33333333-3333-4333-8333-333333333333', full_name: 'PT TEST', hourly_rate_vnd: 60000,
      accrued_minutes: 1, balance_vnd: 1000, last_reset_at: null, current_shift_open: false,
      current_shift_start: null, last_payment: null,
    }] } : null, error: null }));
    render(<DealerPtWageTab clubIds={['club-1']} clubs={clubs} ownerClubIds={['other-club']} finalizeStatements />);
    await screen.findByText('Cần Owner chốt phiếu PT trước khi ghi nhận chi.');
    expect(screen.queryByRole('button', { name: 'Chốt phiếu PT' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bật tích lũy liên tục' })).not.toBeInTheDocument();
  });

  it("keeps the policy control out of the routine cashier view", async () => {
    testState.auth = { isAdmin: false, isClubAdmin: false, isClubOwner: false };
    render(<DealerPtWageTab clubIds={["club-1"]} clubs={clubs} />);

    await screen.findByText("Chưa có dealer part-time đang hoạt động");
    expect(screen.queryByRole("button", { name: "Bật tích lũy liên tục" })).not
      .toBeInTheDocument();
  });

  it("sends an owner-confirmed continuous policy request without a client balance", async () => {
    render(<DealerPtWageTab clubIds={["club-1"]} clubs={clubs} />);

    await screen.findByText("Chưa có dealer part-time đang hoạt động");
    fireEvent.click(
      screen.getByRole("button", { name: "Bật tích lũy liên tục" }),
    );
    fireEvent.change(screen.getByLabelText("Lý do thay đổi"), {
      target: { value: "Owner UAT for open PT attendance" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận bật" }));

    await waitFor(() => {
      expect(testState.rpc).toHaveBeenCalledWith(
        "set_dealer_pt_wage_accrual_policy",
        {
          p_club_id: "club-1",
          p_standby_accrual_enabled: true,
          p_effective_from: null,
          p_reason: "Owner UAT for open PT attendance",
        },
      );
    });
  });

  it("shows the all-club control only after the super-admin global read succeeds", async () => {
    render(<DealerPtWageTab clubIds={["club-1"]} clubs={clubs} />);

    await screen.findByRole("button", { name: "Bật toàn bộ CLB" });
    fireEvent.click(screen.getByRole("button", { name: "Bật toàn bộ CLB" }));
    fireEvent.change(screen.getByLabelText("Lý do thay đổi"), {
      target: { value: "Activate forward-only PT accrual" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận bật toàn bộ" }));

    await waitFor(() => {
      expect(testState.rpc).toHaveBeenCalledWith(
        "set_all_approved_dealer_pt_wage_accrual",
        {
          p_standby_accrual_enabled: true,
          p_reason: "Activate forward-only PT accrual",
        },
      );
    });
  });

  it("fails closed by hiding the all-club control when the privileged read fails", async () => {
    testState.rpc.mockImplementation((fn: string) => {
      if (fn === "get_club_pt_wages") {
        return Promise.resolve({ data: { dealers: [] }, error: null });
      }
      if (fn === "get_dealer_pt_wage_global_accrual_policy") {
        return Promise.resolve({ data: null, error: { message: "missing migration" } });
      }
      return Promise.resolve({ data: {}, error: null });
    });

    render(<DealerPtWageTab clubIds={["club-1"]} clubs={clubs} />);
    await screen.findByText("Chưa có dealer part-time đang hoạt động");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Bật toàn bộ CLB" })).not.toBeInTheDocument();
    });
  });

  it("keeps the customer preview read-only", async () => {
    testState.rpc.mockImplementation((fn: string) => {
      if (fn === "get_club_pt_wages") {
        return Promise.resolve({
          data: {
            dealers: [{
              dealer_id: "dealer-1",
              full_name: "Dealer Demo",
              hourly_rate_vnd: 100_000,
              accrued_minutes: 60,
              balance_vnd: 100_000,
              last_reset_at: null,
              current_shift_open: true,
              current_shift_start: new Date().toISOString(),
              live_accrual_active: true,
              last_payment: null,
            }],
            accrual_mode: "continuous_standby",
            standby_accrual_enabled: true,
          },
          error: null,
        });
      }
      if (fn === "get_dealer_pt_wage_global_accrual_policy") {
        return Promise.resolve({ data: { future_club_enabled: true }, error: null });
      }
      return Promise.resolve({ data: {}, error: null });
    });

    render(<DealerPtWageTab clubIds={["club-1"]} clubs={clubs} readOnly />);

    await screen.findByText("Dealer Demo");
    expect(screen.queryByRole("button", { name: "Thanh toán" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dừng tích lũy liên tục" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tắt toàn bộ CLB" })).not.toBeInTheDocument();
    expect(testState.rpc).not.toHaveBeenCalledWith("pay_part_time_balance", expect.anything());
  });
  it("automatically observes a wage changed by another operator within five seconds", async () => {
    vi.useFakeTimers();
    let name = 'Before remote payment';
    testState.rpc.mockImplementation(async (rpc: string) => ({data:rpc === 'get_club_pt_wages' ? {
      dealers:[{dealer_id:'dealer-1',full_name:name,hourly_rate_vnd:60000,accrued_minutes:1,balance_vnd:1000,
      last_reset_at:null,current_shift_open:false,current_shift_start:null,last_payment:null}]
    } : {future_club_enabled:false},error:null}));
    const view=render(<DealerPtWageTab clubIds={['club-1']} clubs={clubs} readOnly />);
    await act(async()=>vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('Before remote payment')).toBeInTheDocument();
    name='After remote payment';
    await act(async()=>vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByText('After remote payment')).toBeInTheDocument();
    view.unmount();
  });  it.each([null,{}, {dealers:[{dealer_id:'d',full_name:'TEST',balance_vnd:null}]}])("rejects malformed wage data instead of displaying zero debt: %j", async data => {
    testState.rpc.mockResolvedValue({data,error:null});
    render(<DealerPtWageTab clubIds={['club-1']} clubs={clubs} readOnly />);
    await waitFor(()=>expect(screen.getByText('Không xác minh được dữ liệu lương part-time.')).toBeInTheDocument());
    expect(screen.queryByText('Tổng tạm tính chưa chốt')).not.toBeInTheDocument();
    expect(screen.queryByText('Chưa có dealer part-time đang hoạt động')).not.toBeInTheDocument();
  });  it('preserves an open statement dialog and its reference across a background wage refresh',async()=>{
    vi.useFakeTimers();sessionStorage.clear();
    const club='22222222-2222-4222-8222-222222222222',dealer='33333333-3333-4333-8333-333333333333';
    testState.rpc.mockImplementation(async name=>({data:name==='get_club_pt_wages'?{dealers:[{
      dealer_id:dealer,full_name:'PT TEST',hourly_rate_vnd:60000,accrued_minutes:1,balance_vnd:0,
      last_reset_at:null,current_shift_open:false,current_shift_start:null,last_payment:null}]}:
      name==='get_part_time_payroll_statement_status_v1'?{statement_id:'44444444-4444-4444-8444-444444444444',
      request_id:'55555555-5555-4555-8555-555555555555',club_id:club,dealer_id:dealer,state:'finalized',net_amount_vnd:1000,
      finalized_at:'2026-10-31T10:00:00+07:00',payment_id:null,statement_hash:'a'.repeat(64)}:{},error:null}));
    render(<DealerPtWageTab clubIds={[club]} clubs={[{id:club,name:'TEST'}]} finalizeStatements/>);
    await act(async()=>vi.advanceTimersByTimeAsync(1));
    fireEvent.click(screen.getByRole('button',{name:'Chi phiếu PT'}));
    fireEvent.change(screen.getByLabelText('Mã tham chiếu chi PT'),{target:{value:'KEEP_LOCAL_TEST'}});
    testState.rpc.mockImplementationOnce(()=>new Promise(()=>{}));
    await act(async()=>vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Mã tham chiếu chi PT')).toHaveValue('KEEP_LOCAL_TEST');
    expect(testState.rpc.mock.calls.some(([name])=>name==='pay_finalized_part_time_payroll_statement')).toBe(false);
  });});
