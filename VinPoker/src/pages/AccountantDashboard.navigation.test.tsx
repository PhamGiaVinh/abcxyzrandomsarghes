import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {MemoryRouter,useLocation,useNavigate} from "react-router-dom";
const f=vi.hoisted(()=>({staff:vi.fn(),dealer:vi.fn()}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({loading:false,user:{id:"test"},isAdmin:false})}));
vi.mock("@/hooks/useOperationalCapabilities",()=>({useOperationalCapabilities:()=>({loading:false,allows:()=>true})}));
vi.mock("@/lib/featureFlags",()=>({FEATURES:{accountantWorkspace:true}}));
vi.mock("@/lib/staffSalary/dataSource",()=>({staffSalarySource:()=>"live"}));
vi.mock("@/hooks/staffSalary/useStaffSalary",()=>({useSalaryClubs:()=>({data:[{id:"test-club",name:"TEST",role:"owner"}]})}));
vi.mock("@/hooks/accountant/useAccountantCapabilities",()=>({useAccountantCapabilities:()=>({caps:{state:"ok"}})}));
vi.mock("./StaffSalaryChot",()=>({default:(props:Record<string,unknown>)=>{f.staff(props);return <p>Salary fixture</p>}}));
vi.mock("./ClubExpenses",()=>({default:()=> <p>Expense fixture</p>}));
vi.mock("@/components/cashier/DealerPayrollTab",()=>({default:(props:Record<string,unknown>)=>{f.dealer(props);return <p>Dealer fixture</p>}}));
vi.mock("@/components/accountant/StaffDirectoryManager",()=>({StaffDirectoryManager:({clubId}:{clubId:string})=><p>Directory {clubId}</p>}));
vi.mock("@/components/accountant/AccountantFnbTab",()=>({AccountantFnbTab:()=> <p>FNB fixture</p>}));
vi.mock("@/components/accountant/AccountantFinanceTab",()=>({AccountantFinanceTab:()=> <p>Report fixture</p>}));
import AccountantDashboard from "./AccountantDashboard";
function HistoryProbe(){const location=useLocation(),navigate=useNavigate();return <><output aria-label="Current route">{location.search}</output><button onClick={()=>navigate(-1)}>Back fixture</button></>}
afterEach(()=>{cleanup();vi.clearAllMocks();});
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

it('passes the inherited month to both payroll views rather than silently using today',()=>{
 render(<MemoryRouter initialEntries={['/finance/payroll?club=test-club&from=2024-02-02&to=2024-02-20']}><AccountantDashboard/></MemoryRouter>);
 expect(f.staff.mock.calls.at(-1)?.[0]).toMatchObject({payrollMonth:{year:2024,month:2}});
 fireEvent.click(screen.getByRole('button',{name:'Dealer'}));
 expect(f.dealer.mock.calls.at(-1)?.[0]).toMatchObject({payrollMonth:{year:2024,month:2}});
});
it.each([['2026-10-30','2026-11-02'],['2026-02-30','2026-03-02'],['2026-11-02','']])('does not mount a current-month payroll for unresolved scope %s–%s',(from,to)=>{
 render(<MemoryRouter initialEntries={['/finance/payroll?club=test-club&from='+from+'&to='+to]}><AccountantDashboard/></MemoryRouter>);
 expect(screen.queryByText('Salary fixture')).toBeNull();expect(f.staff).not.toHaveBeenCalled();expect(f.dealer).not.toHaveBeenCalled();
});
it('selects one full month, preserves the club, removes an old payment link and follows browser history',()=>{
 render(<MemoryRouter initialEntries={['/finance/payroll?club=test-club&from=2024-02-02&to=2024-02-20&payment_id=old']}><AccountantDashboard/><HistoryProbe/></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Kỳ lương'),{target:{value:'2024-03'}});
 expect(f.staff.mock.calls.at(-1)?.[0]).toMatchObject({scopedClubId:'test-club',payrollMonth:{year:2024,month:3}});
 expect(screen.getByLabelText('Current route').textContent).toBe('?club=test-club&from=2024-03-01&to=2024-03-31');
 fireEvent.click(screen.getByText('Back fixture'));
 expect(f.staff.mock.calls.at(-1)?.[0]).toMatchObject({payrollMonth:{year:2024,month:2}});
 expect(screen.getByText(/không tính lại lương theo khoảng ngày/)).toBeVisible();
});
