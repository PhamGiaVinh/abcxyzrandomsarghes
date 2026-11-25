import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {MemoryRouter} from "react-router-dom";
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({loading:false,user:{id:"test"},isAdmin:false})}));
vi.mock("@/hooks/useOperationalCapabilities",()=>({useOperationalCapabilities:()=>({loading:false,allows:()=>true})}));
vi.mock("@/lib/featureFlags",()=>({FEATURES:{accountantWorkspace:true}}));
vi.mock("@/lib/staffSalary/dataSource",()=>({staffSalarySource:()=>"live"}));
vi.mock("@/hooks/staffSalary/useStaffSalary",()=>({useSalaryClubs:()=>({data:[{id:"test-club",name:"TEST",role:"owner"}]})}));
vi.mock("@/hooks/accountant/useAccountantCapabilities",()=>({useAccountantCapabilities:()=>({caps:{state:"ok"}})}));
vi.mock("./StaffSalaryChot",()=>({default:()=> <p>Salary fixture</p>}));
vi.mock("./ClubExpenses",()=>({default:()=> <p>Expense fixture</p>}));
vi.mock("@/components/cashier/DealerPayrollTab",()=>({default:()=> <p>Dealer fixture</p>}));
vi.mock("@/components/accountant/StaffDirectoryManager",()=>({StaffDirectoryManager:({clubId}:{clubId:string})=><p>Directory {clubId}</p>}));
vi.mock("@/components/accountant/AccountantFnbTab",()=>({AccountantFnbTab:()=> <p>FNB fixture</p>}));
vi.mock("@/components/accountant/AccountantFinanceTab",()=>({AccountantFinanceTab:()=> <p>Report fixture</p>}));
import AccountantDashboard from "./AccountantDashboard";
afterEach(cleanup);
it("keeps three work tabs and loads personnel settings only on demand",async()=>{
 render(<MemoryRouter><AccountantDashboard/></MemoryRouter>);
 expect(screen.getAllByRole("tab")).toHaveLength(3);
 expect(screen.queryByText("Directory test-club")).toBeNull();
 fireEvent.click(screen.getByText("Danh sách nhân viên và mức lương"));
 await waitFor(()=>expect(screen.getByText("Directory test-club")).toBeVisible());
 expect(screen.queryByText("FNB fixture")).toBeNull();
});

it.each([["report","Report fixture"],["expenses","Expense fixture"],["salary","Salary fixture"]])("opens requested %s work without another tab click",(tab,text)=>{render(<MemoryRouter initialEntries={["/accountant?tab="+tab]}><AccountantDashboard/></MemoryRouter>);expect(screen.getByText(text)).toBeVisible();});
