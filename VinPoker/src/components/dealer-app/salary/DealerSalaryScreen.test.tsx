import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DealerSalaryScreen } from "./DealerSalaryScreen";

const testState = vi.hoisted(() => ({
  rpc: vi.fn(),
  dealerId: 'dealer-1' as string|null,
  actor: 'actor-1' as string|null,
  session:{access_token:'salary-test-A'},
}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:testState.actor?{id:testState.actor}:null,session:testState.session,loading:false})}));

vi.mock("@/hooks/dealer/useDealerLink", () => ({
  useDealerLink: () => ({
    dealer: testState.dealerId?{
      dealerId: testState.dealerId,
      clubId: 'club',
      clubName: "HSOP",
      fullName: "Dealer Demo",
    }:null,
    isDealer: !!testState.dealerId,
    loading: false,
    source: "live",
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => testState.rpc(...args) },
}));
const closedPt={dealer_id:'dealer-1',club_id:'club',employment_type:'part_time',hourly_rate_vnd:50000,
  accrued_minutes:0,balance_vnd:0,current_shift_open:false,current_shift_start:null,recent_payments:[]};

describe("DealerSalaryScreen live PT balance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T08:00:00.000Z"));
    testState.rpc.mockReset();
    testState.dealerId='dealer-1';testState.actor='actor-1';
    testState.session={access_token:'salary-test-A'};
    testState.rpc.mockImplementation(async()=>({
      data: {
        dealer_id: testState.dealerId,club_id:'club',
        employment_type: "part_time",
        hourly_rate_vnd: 100_000,
        accrued_minutes: 60,
        balance_vnd: 100_000,
        current_shift_open: true,
        current_shift_start: "2026-08-10T07:00:00.000Z",
        accrual_mode: "continuous_standby",
        standby_accrual_enabled: true,
        live_accrual_active: true,
        recent_payments: [],
      },
      error: null,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-renders the server-backed wage after one second", async () => {
    render(<DealerSalaryScreen />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("dealer-live-wage-balance")).toHaveTextContent("100.000");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByTestId("dealer-live-wage-balance")).toHaveTextContent("100.027");
    expect(screen.getByText(/Đang tăng khoảng/)).toHaveTextContent("28");
  });
  it('removes salary from the previous session before verifying a replacement session for the same actor',async()=>{
    const view=render(<DealerSalaryScreen/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByTestId('dealer-live-wage-balance')).toBeInTheDocument();
    testState.rpc.mockReturnValue(new Promise(()=>{}));testState.session={access_token:'salary-test-B'};
    view.rerender(<DealerSalaryScreen/>);
    expect(screen.queryByTestId('dealer-live-wage-balance')).toBeNull();
  });
  it('shows an unlinked state rather than an endless salary skeleton',async()=>{
    testState.dealerId=null;render(<DealerSalaryScreen/>);
    await act(async()=>{await Promise.resolve();});
    expect(screen.getByText('Tài khoản chưa liên kết với hồ sơ dealer nào.')).toBeInTheDocument();
    expect(testState.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {dealer_id:'dealer-1',club_id:'club',employment_type:'part_time',hourly_rate_vnd:50000,accrued_minutes:0,balance_vnd:null,current_shift_open:false,recent_payments:[]},
    {error:'dealer not found or inactive'},
  ])('does not display malformed salary evidence as zero or infer Full-time',async(data)=>{
    testState.rpc.mockResolvedValueOnce({data,error:null});render(<DealerSalaryScreen/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh');
    expect(screen.queryByTestId('dealer-live-wage-balance')).not.toBeInTheDocument();
    expect(testState.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{dealer_id:'other'},{club_id:'other'},{balance_vnd:'0'},{balance_vnd:NaN},
    {current_shift_open:'false'},{recent_payments:[{amount_vnd:null,paid_at:'2026-08-10T07:00:00Z'}]}])('rejects wrong-scope or malformed PT financial fields',async(overrides)=>{
    testState.rpc.mockResolvedValueOnce({data:{...closedPt,...overrides},error:null});render(<DealerSalaryScreen/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh');expect(testState.rpc).toHaveBeenCalledTimes(1);
  });
  it('preserves a genuine server-confirmed zero PT balance',async()=>{
    testState.rpc.mockResolvedValueOnce({data:closedPt,error:null});render(<DealerSalaryScreen/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByTestId('dealer-live-wage-balance')).toHaveTextContent('0 ₫');expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each([{net_pay_vnd:null},{dealer_id:'other'},{has_data:undefined}])('does not invent a saved FT amount or identity',async(overrides)=>{
    testState.rpc.mockResolvedValueOnce({data:{dealer_id:'dealer-1',club_id:'club',employment_type:'full_time'},error:null})
      .mockResolvedValueOnce({data:{dealer_id:'dealer-1',has_data:true,net_pay_vnd:400000,...overrides},error:null});
    render(<DealerSalaryScreen/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh');expect(testState.rpc).toHaveBeenCalledTimes(2);
  });
  it('preserves an explicit no-saved-payslip response',async()=>{
    testState.rpc.mockResolvedValueOnce({data:{dealer_id:'dealer-1',club_id:'club',employment_type:'full_time'},error:null})
      .mockResolvedValueOnce({data:{dealer_id:'dealer-1',has_data:false},error:null});
    render(<DealerSalaryScreen/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByText('Chưa chốt bảng lương tháng này')).toBeInTheDocument();
  });
  it('ignores an old membership response after switching dealer clubs',async()=>{
    let finish!:(value:unknown)=>void;
    testState.rpc.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    const view=render(<DealerSalaryScreen/>);
    testState.dealerId='dealer-2';view.rerender(<DealerSalaryScreen/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByTestId('dealer-live-wage-balance')).toHaveTextContent('100.000');
    await act(async()=>finish({data:{employment_type:'part_time',balance_vnd:999000,hourly_rate_vnd:0,recent_payments:[]},error:null}));
    expect(screen.getByTestId('dealer-live-wage-balance')).not.toHaveTextContent('999.000');
  });
  it('clears private salary immediately on logout',async()=>{
    const view=render(<DealerSalaryScreen/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByTestId('dealer-live-wage-balance')).toBeInTheDocument();
    testState.actor=null;view.rerender(<DealerSalaryScreen/>);
    expect(screen.queryByTestId('dealer-live-wage-balance')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Đăng nhập');
  });
  it('does not label a saved draft as a finalized FT payslip',async()=>{
    testState.rpc.mockResolvedValueOnce({data:{dealer_id:'dealer-1',club_id:'club',employment_type:'full_time'},error:null})
      .mockResolvedValueOnce({data:{dealer_id:'dealer-1',has_data:true,employment_type:'full_time',period_status:'draft',period_year:2026,period_month:8,net_pay_vnd:400000},error:null});
    render(<DealerSalaryScreen/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.queryByText('Full-time · đã chốt')).not.toBeInTheDocument();
    expect(screen.getByText('Full-time · chưa chốt')).toBeInTheDocument();
  });
  it('keeps missing FT salary and hours distinct from verified zero',async()=>{
    testState.rpc.mockResolvedValueOnce({data:{dealer_id:'dealer-1',club_id:'club',employment_type:'full_time'},error:null})
      .mockResolvedValueOnce({data:{dealer_id:'dealer-1',has_data:true,net_pay_vnd:400000,monthly_salary_vnd:null,total_hours:null},error:null});
    render(<DealerSalaryScreen/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByText('Lương tháng').parentElement).toHaveTextContent('Chưa có dữ liệu');
    expect(screen.getByText('Giờ làm').parentElement).toHaveTextContent('Chưa có dữ liệu');
  });
  it.each([{monthly_salary_vnd:'bad'},{total_hours:Infinity}])('rejects malformed optional FT display fields: %j',async(overrides)=>{
    testState.rpc.mockResolvedValueOnce({data:{dealer_id:'dealer-1',club_id:'club',employment_type:'full_time'},error:null})
      .mockResolvedValueOnce({data:{dealer_id:'dealer-1',has_data:true,net_pay_vnd:400000,monthly_salary_vnd:400000,total_hours:8,...overrides},error:null});
    render(<DealerSalaryScreen/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh');
  });
  it('preserves explicit zero FT salary and hours',async()=>{
    testState.rpc.mockResolvedValueOnce({data:{dealer_id:'dealer-1',club_id:'club',employment_type:'full_time'},error:null})
      .mockResolvedValueOnce({data:{dealer_id:'dealer-1',has_data:true,net_pay_vnd:0,monthly_salary_vnd:0,total_hours:0},error:null});
    render(<DealerSalaryScreen/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByText('Lương tháng').parentElement).toHaveTextContent('0 ₫');
    expect(screen.getByText('Giờ làm').parentElement).toHaveTextContent('0.0h');
  });
  it('shows saved final net including adjustments rather than the separate after-tax subtotal',async()=>{
    testState.rpc.mockResolvedValueOnce({data:{dealer_id:'dealer-1',club_id:'club',employment_type:'full_time'},error:null})
      .mockResolvedValueOnce({data:{dealer_id:'dealer-1',has_data:true,period_status:'locked',net_pay_vnd:400000,
        net_pay_after_tax_vnd:350000,total_adjustments_vnd:50000,monthly_salary_vnd:400000,total_hours:8},error:null});
    render(<DealerSalaryScreen/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
    for(const label of screen.getAllByText('Thực lãnh'))expect(label.parentElement).toHaveTextContent('400.000');
    expect(screen.getByText('Điều chỉnh').parentElement).toHaveTextContent('+50.000');
  });
  it.each(['locked','payment_prepared','paid','reconciled'])('preserves the finalized label for %s',async(status)=>{
    testState.rpc.mockResolvedValueOnce({data:{dealer_id:'dealer-1',club_id:'club',employment_type:'full_time'},error:null})
      .mockResolvedValueOnce({data:{dealer_id:'dealer-1',has_data:true,period_status:status,net_pay_vnd:400000},error:null});
    render(<DealerSalaryScreen/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByText('Full-time · đã chốt')).toBeInTheDocument();
  });
  it('does not infer finalization from a missing status',async()=>{
    testState.rpc.mockResolvedValueOnce({data:{dealer_id:'dealer-1',club_id:'club',employment_type:'full_time'},error:null})
      .mockResolvedValueOnce({data:{dealer_id:'dealer-1',has_data:true,net_pay_vnd:400000},error:null});
    render(<DealerSalaryScreen/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByText('Full-time · chưa xác minh trạng thái chốt')).toBeInTheDocument();
  });
  it('bounds a hanging read, ignores late success, and supports explicit retry',async()=>{
    let finish!:(value:unknown)=>void;testState.rpc.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    render(<DealerSalaryScreen/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(screen.getByRole('alert')).toHaveTextContent('Quá thời gian tải lương');
    await act(async()=>finish({data:{employment_type:'part_time',balance_vnd:999000},error:null}));
    expect(screen.queryByTestId('dealer-live-wage-balance')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByTestId('dealer-live-wage-balance')).toHaveTextContent('100.000');expect(testState.rpc).toHaveBeenCalledTimes(2);
  });
  it('does not publish an old FT second-stage read into a new PT membership',async()=>{
    let finish!:(value:unknown)=>void;
    testState.rpc.mockResolvedValueOnce({data:{dealer_id:'dealer-1',club_id:'club',employment_type:'full_time'},error:null})
      .mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    const view=render(<DealerSalaryScreen/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(testState.rpc).toHaveBeenCalledTimes(2);
    testState.dealerId='dealer-2';view.rerender(<DealerSalaryScreen/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    await act(async()=>finish({data:{has_data:true,net_pay_vnd:999000},error:null}));
    expect(screen.getByTestId('dealer-live-wage-balance')).toHaveTextContent('100.000');
  });
});
