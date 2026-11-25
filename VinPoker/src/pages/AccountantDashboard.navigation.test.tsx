import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {MemoryRouter} from "react-router-dom";
const financeFlags = vi.hoisted(()=>({ptRead:false}));
vi.mock("@/components/accountant/FinanceDealerPtWages",()=>({FinanceDealerPtWages:({club}:{club:{id:string}})=><p>PT finance {club.id}</p>}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({loading:false,user:{id:"test"},isAdmin:false})}));
vi.mock("@/hooks/useOperationalCapabilities",()=>({useOperationalCapabilities:()=>({loading:false,allows:()=>true})}));
vi.mock("@/lib/featureFlags",()=>({FEATURES:{accountantWorkspace:true,get financeDealerPtRead(){return financeFlags.ptRead;}}}));
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
afterEach(()=>{cleanup();financeFlags.ptRead=false;});
it("keeps three work tabs and loads personnel settings only on demand",async()=>{
 render(<MemoryRouter><AccountantDashboard/></MemoryRouter>);
 expect(screen.getAllByRole("tab")).toHaveLength(3);
 expect(screen.queryByText("Directory test-club")).toBeNull();
 fireEvent.click(screen.getByText("Danh sách nhân viên và mức lương"));
 await waitFor(()=>expect(screen.getByText("Directory test-club")).toBeVisible());
 expect(screen.queryByText("FNB fixture")).toBeNull();
});

it.each([["report","Report fixture"],["expenses","Expense fixture"],["salary","Salary fixture"]])("opens requested %s work without another tab click",(tab,text)=>{render(<MemoryRouter initialEntries={["/accountant?tab="+tab]}><AccountantDashboard/></MemoryRouter>);expect(screen.getByText(text)).toBeVisible();});

it("does not fall back to the first club when a linked club is unavailable",()=>{render(<MemoryRouter initialEntries={["/accountant?club=other-club&tab=salary"]}><AccountantDashboard/></MemoryRouter>);expect(screen.queryByText("Salary fixture")).toBeNull();expect(screen.queryByText("Dealer fixture")).toBeNull();});

it('keeps the new PT finance reader off until its server rollout is enabled',()=>{render(<MemoryRouter><AccountantDashboard/></MemoryRouter>);expect(screen.queryByRole('button',{name:'Dealer PT'})).toBeNull();});
it('opens the PT reader for the exact selected club when enabled',()=>{financeFlags.ptRead=true;render(<MemoryRouter initialEntries={['/finance/payroll?club=test-club']}><AccountantDashboard/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'Dealer PT'}));expect(screen.getByText('PT finance test-club')).toBeVisible();expect(screen.queryByText('Dealer fixture')).toBeNull();});
