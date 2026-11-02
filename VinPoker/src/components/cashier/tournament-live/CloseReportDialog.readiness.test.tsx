import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCloseReport } from "@/lib/closeReport";

const { useReport, reload, closeTournament } = vi.hoisted(() => ({
  useReport: vi.fn(), reload: vi.fn(), closeTournament: vi.fn(),
}));
const ranking=vi.hoisted(()=>({blocked:false}));
vi.mock('./TournamentRankingReviewPanel',async()=>{
  const {useLayoutEffect}=await import('react');
  function MockRankingPanel({onBlockingChange}:{onBlockingChange:(value:boolean)=>void}){
    const blocked=ranking.blocked;useLayoutEffect(()=>onBlockingChange(blocked),[onBlockingChange,blocked]);return null;
  }
  return {TournamentRankingReviewPanel:MockRankingPanel};
});
vi.mock("@/hooks/useCloseReport", () => ({ useCloseReport: useReport }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import CloseReportDialog from "./CloseReportDialog";

const props = { open: true, onOpenChange: vi.fn(), tournamentId: "tour-test", tournamentName: "Close TEST" };
const state = (blockers: string[]) => ({
  report: computeCloseReport({ entries: [], payouts: [] }), loading: false,
  error: null, alreadyClosed: false, reload, closeTournament,
  readiness: { ok: true, ready: blockers.length === 0, alreadyClosed: false, blockers },
});

describe("CloseReportDialog official-result blockers", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.clearAllMocks();ranking.blocked=false; });

  it('labels registration accounting separately from qualified Final Day entries',()=>{
    useReport.mockReturnValue(state([]));
    render(<CloseReportDialog {...props}/>);
    expect(screen.getByText('Đăng ký đã xác nhận')).toBeInTheDocument();
    expect(screen.queryByText('Tổng entry')).toBeNull();
    expect(screen.getByText(/không gộp tiền các flight/i)).toBeInTheDocument();
  });

  it('labels a closed report as a historical snapshot, not current unpaid prizes',()=>{
    useReport.mockReturnValue({...state([]),alreadyClosed:true,
      report:computeCloseReport({entries:[{buyIn:400000,totalPay:400000,rakeCharged:0,serviceCharged:0,
        source:'online',usedFreeRake:false}],payouts:[]})});
    render(<CloseReportDialog {...props}/>);
    expect(screen.getByText(/không phải số dư quầy hiện tại/i)).toBeInTheDocument();
    expect(screen.getByText('Số dư quầy lúc chốt')).toBeInTheDocument();
    expect(screen.queryByText(/payout chưa nhập đủ/i)).toBeNull();
    expect(screen.queryByText(/Vẫn chốt được/i)).toBeNull();
    expect(screen.getByRole('button',{name:'Đóng'})).toBeEnabled();
  });

  it.each([
    ["official_results_not_finished", "Chưa xác định được duy nhất một người thắng"],
    ["official_results_incomplete", "Thứ hạng đã ghi chưa đầy đủ hoặc không nhất quán"],
    ["official_results_evidence_missing", "Thiếu lịch sử thứ tự bust"],
    ["manual_ranking_review_required", "Floor cần xác nhận thứ hạng"],
  ])("explains %s and cannot enter confirmation", (code, message) => {
    useReport.mockReturnValue(state([code]));
    render(<CloseReportDialog {...props} />);
    expect(screen.getByRole("status").textContent).toContain(message);
    const next = screen.getByRole("button", { name: "Tiếp tục" });
    expect(next).toBeDisabled(); fireEvent.click(next);
    expect(screen.queryByPlaceholderText("CHOT GIAI")).toBeNull();
    expect(closeTournament).not.toHaveBeenCalled();
  });

  it("a previously typed phrase cannot override newly blocked server readiness", () => {
    useReport.mockReturnValue(state([]));
    const { rerender } = render(<CloseReportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.change(screen.getByPlaceholderText("CHOT GIAI"), { target: { value: "CHOT GIAI" } });
    expect(screen.getByRole("button", { name: "Chốt giải" })).toBeEnabled();
    useReport.mockReturnValue(state(["official_results_evidence_missing"]));
    rerender(<CloseReportDialog {...props} />);
    expect(screen.getByRole("status").textContent).toContain("Thiếu lịch sử thứ tự bust");
    const confirm = screen.getByRole("button", { name: "Chốt giải" });
    expect(confirm).toBeDisabled(); fireEvent.click(confirm);
    expect(closeTournament).not.toHaveBeenCalled();
  });
  it('holds a ready close while a ranking journal remains unresolved, including the typed confirmation step',()=>{
    ranking.blocked=true;useReport.mockReturnValue(state([]));const rendered=render(<CloseReportDialog {...props}/>);
    expect(screen.getByRole('button',{name:'Tiếp tục'})).toBeDisabled();
    ranking.blocked=false;rendered.rerender(<CloseReportDialog {...props}/>);
    fireEvent.click(screen.getByRole('button',{name:'Tiếp tục'}));
    fireEvent.change(screen.getByPlaceholderText('CHOT GIAI'),{target:{value:'CHOT GIAI'}});
    expect(screen.getByRole('button',{name:'Chốt giải'})).toBeEnabled();
    ranking.blocked=true;rendered.rerender(<CloseReportDialog {...props}/>);
    const confirm=screen.getByRole('button',{name:'Chốt giải'});expect(confirm).toBeDisabled();fireEvent.click(confirm);
    expect(closeTournament).not.toHaveBeenCalled();
  });
  it('offers an explicit report-read retry without invoking the close writer',()=>{
    useReport.mockReturnValue({...state([]),report:null,error:'Chưa tải được báo cáo chốt',readiness:null});
    render(<CloseReportDialog {...props}/>);reload.mockClear();
    fireEvent.click(screen.getByRole('button',{name:'Thử tải lại báo cáo'}));
    expect(reload).toHaveBeenCalledTimes(1);expect(closeTournament).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Tiếp tục'})).toBeDisabled();
  });

it('requires a fresh review and phrase after a report reload replaces the reviewed figures',()=>{
 useReport.mockReturnValue(state([]));const view=render(<CloseReportDialog {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Tiếp tục'}));
 fireEvent.change(screen.getByPlaceholderText('CHOT GIAI'),{target:{value:'CHOT GIAI'}});
 expect(screen.getByRole('button',{name:'Chốt giải'})).toBeEnabled();
 useReport.mockReturnValue({...state([]),loading:true,report:null,readiness:null});view.rerender(<CloseReportDialog {...props}/>);
 useReport.mockReturnValue({...state([]),report:computeCloseReport({entries:[{buyIn:100000,totalPay:115000,rakeCharged:15000,serviceCharged:0,source:'online',usedFreeRake:false}],payouts:[]})});view.rerender(<CloseReportDialog {...props}/>);
 expect(screen.queryByPlaceholderText('CHOT GIAI')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Tiếp tục'}));
 expect(screen.getByPlaceholderText('CHOT GIAI')).toHaveValue('');
 expect(screen.getByRole('button',{name:'Chốt giải'})).toBeDisabled();
 expect(closeTournament).not.toHaveBeenCalled();
});

});
