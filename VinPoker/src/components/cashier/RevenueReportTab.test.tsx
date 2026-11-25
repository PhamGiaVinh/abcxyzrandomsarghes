import {render,screen,cleanup} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
const f=vi.hoisted(()=>({owner:false}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({isClubOwner:f.owner})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{}}));
vi.mock("@/integrations/supabase/SupabaseClientContext",()=>({SupabaseClientProvider:({children}:{children:React.ReactNode})=>children}));
vi.mock("@/components/accountant/AccountantFinanceTab",()=>({AccountantFinanceTab:({clubId,dateRange}:{clubId:string;dateRange?:{from:string;to:string}})=><p data-testid="finance-range" data-range={JSON.stringify(dateRange)}>Finance {clubId}</p>}));
vi.mock("@/ops/finance/CashierCashflowPanel",()=>({default:({clubId,range}:{clubId:string;range:{from:string;to:string}})=><p data-testid="cashflow-range" data-range={JSON.stringify(range)}>Cashflow {clubId}</p>}));
import RevenueReportTab from "./RevenueReportTab";
afterEach(()=>{cleanup();f.owner=false;});
it("shows verified cashier scope without exposing owner reporting",()=>{
 render(<RevenueReportTab clubIds={["a"]} clubs={[{id:"a",name:"A"}]}/>);
 expect(screen.getByText("Cashflow a")).toBeVisible();expect(screen.queryByText("Finance a")).toBeNull();
});
it("asks a multi-club cashier to select scope before reading",()=>{
 render(<RevenueReportTab clubIds={["a","b"]} clubs={[{id:"a",name:"A"},{id:"b",name:"B"}]}/>);
 expect(screen.getByText("Chọn CLB để xem báo cáo.")).toBeVisible();expect(screen.queryByText(/Cashflow /)).toBeNull();
});
it("uses the shared finance report for an owner",()=>{
 f.owner=true;render(<RevenueReportTab clubIds={["a"]} clubs={[{id:"a",name:"A"}]}/>);
 expect(screen.getByText("Finance a")).toBeVisible();
});

it('uses the same inherited dates for owner P&L and the cashier cashflow',()=>{f.owner=true;render(<RevenueReportTab clubIds={["a"]} clubs={[{id:"a",name:"A"}]} dateRange={{from:"2026-10-01",to:"2026-10-20"}}/>);expect(screen.getByTestId('finance-range')).toHaveAttribute('data-range',JSON.stringify({from:'2026-10-01',to:'2026-10-20'}));expect(screen.getByTestId('cashflow-range')).toHaveAttribute('data-range',JSON.stringify({from:'2026-09-30T17:00:00.000Z',to:'2026-10-20T17:00:00.000Z'}));});
it('does not read either report with an invalid inherited range',()=>{f.owner=true;render(<RevenueReportTab clubIds={["a"]} clubs={[{id:"a",name:"A"}]} dateRange={{from:"2026-02-30",to:"2026-03-01"}}/>);expect(screen.getByRole('alert')).toBeVisible();expect(screen.queryByTestId('cashflow-range')).toBeNull();expect(screen.queryByTestId('finance-range')).toBeNull();});
