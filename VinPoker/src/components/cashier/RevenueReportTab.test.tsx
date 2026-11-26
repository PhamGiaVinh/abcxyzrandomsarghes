import {render,screen,cleanup} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
const f=vi.hoisted(()=>({owner:false}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({isClubOwner:f.owner})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{}}));
vi.mock("@/integrations/supabase/SupabaseClientContext",()=>({SupabaseClientProvider:({children}:{children:React.ReactNode})=>children}));
vi.mock("@/components/accountant/AccountantFinanceTab",()=>({AccountantFinanceTab:({clubId}:{clubId:string})=><p>Finance {clubId}</p>}));
vi.mock("@/ops/finance/CashierCashflowPanel",()=>({default:({clubId}:{clubId:string})=><p>Cashflow {clubId}</p>}));
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
