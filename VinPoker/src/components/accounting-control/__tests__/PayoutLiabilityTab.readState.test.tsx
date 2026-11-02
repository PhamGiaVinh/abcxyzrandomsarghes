import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PayoutLiabilityTab, type LivePayoutData } from "../tabs/PayoutLiabilityTab";
afterEach(cleanup);
describe("payout report uncertainty", () => {
  it.each([0,100000])('labels individual liability as partial and never all-paid: %s',amount=>{
    const data:LivePayoutData={periodLabel:'TEST',owedTotal:amount,paidTotal:0,outstandingTotal:amount,
      aging:{d0_1:amount,d2_7:0,d8p:0},perTournament:[{tournamentId:'individual',name:'Individual TEST',closeDate:null,
       isClosed:false,hasFinishedPlace:true,owed:amount,paid:0,outstanding:amount,finishersCount:1,liabilityScope:'INDIVIDUAL',isPartial:true}]};
    render(<PayoutLiabilityTab live={{active:true,loading:false,error:null,notApplied:false,data}}/>);
    expect(screen.getByText('Chốt từng người — chưa chốt toàn giải')).toBeInTheDocument();
    expect(screen.getByText('Báo cáo gồm các nghĩa vụ đã chốt từng người; phần còn lại của giải chưa được chốt.')).toBeInTheDocument();
    expect(screen.queryByText('Đã ghi nhận trả đủ')).not.toBeInTheDocument();
  });
  it('does not label total prizes as remaining debt after full payment',()=>{
    render(<PayoutLiabilityTab live={{active:true,loading:false,error:null,notApplied:false,
      data:{periodLabel:'TEST',owedTotal:400000,paidTotal:400000,outstandingTotal:0,
        aging:{d0_1:0,d2_7:0,d8p:0},perTournament:[{tournamentId:'paid',name:'Paid TEST',closeDate:'2026-10-18',
          isClosed:true,hasFinishedPlace:true,owed:400000,paid:400000,outstanding:0,finishersCount:4}]}}}/>);
    expect(screen.getByText('Tổng nghĩa vụ thưởng')).toBeInTheDocument();
    expect(screen.queryByText('Còn phải trả (nghĩa vụ)')).toBeNull();
    expect(screen.getByText('Đã ghi nhận trả đủ')).toBeInTheDocument();
  });
  it.each([
    { loading: true, error: null, text: "Đang tải phải-trả giải" },
    { loading: false, error: "503", text: "503" },
  ])("does not show sample money while live read is $text", ({ loading, error, text }) => {
    render(<PayoutLiabilityTab live={{ active: true, loading, error, notApplied: false, data: null }} />);
    expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
    expect(screen.queryByText("Còn nợ người chơi")).not.toBeInTheDocument();
    expect(screen.queryByText("Còn phải trả")).not.toBeInTheDocument();
  });
  it("does not report all-paid when an unfinished tournament has unknown liability", () => {
    const data: LivePayoutData = { periodLabel: "TEST", owedTotal: 0, paidTotal: 0, outstandingTotal: 0,
      aging: { d0_1: 0, d2_7: 0, d8p: 0 }, perTournament: [{ tournamentId: "test", name: "Tour chưa chốt",
        closeDate: null, isClosed: false, hasFinishedPlace: false, owed: null, outstanding: null, paid: 0, finishersCount: 0 }] };
    render(<PayoutLiabilityTab live={{ active: true, loading: false, error: null, notApplied: false, data }} />);
    expect(screen.queryByText("Đã ghi nhận trả đủ")).not.toBeInTheDocument();
    expect(screen.getByText(/Chưa xác định đầy đủ/)).toBeInTheDocument();
  });
  it("distinguishes a successful empty period from incomplete results and all-paid", () => {
    render(<PayoutLiabilityTab live={{ active: true, loading: false, error: null, notApplied: false,
      data: { periodLabel: "TEST", owedTotal: 0, paidTotal: 0, outstandingTotal: 0,
        aging: { d0_1: 0, d2_7: 0, d8p: 0 }, perTournament: [] } }} />);
    expect(screen.getByText("Chưa có giải trong kỳ")).toBeInTheDocument();
    expect(screen.queryByText("Đã ghi nhận trả đủ")).not.toBeInTheDocument();
    expect(screen.queryByText("Chưa xác định đầy đủ")).not.toBeInTheDocument();
  });
});
