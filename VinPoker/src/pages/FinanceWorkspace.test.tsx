import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ loading:false, rolesLoading:false, rolesError:null as string|null, isCashier:false, isAccountant:false, isClubOwner:false, isAdmin:false, isClubAdmin:false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { accountingControl:true } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t:(key:string)=>key }) }));
import FinanceWorkspace from "./FinanceWorkspace";

beforeEach(()=>Object.assign(auth,{loading:false,rolesLoading:false,rolesError:null,isCashier:false,isAccountant:false,isClubOwner:false,isAdmin:false,isClubAdmin:false}));
afterEach(cleanup);
function mount(path="/finance"){
 return render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route element={<FinanceWorkspace/>}>
   <Route path="/finance" element={null}/>
   <Route path="/finance/overview" element={<p>Report page</p>}/>
   <Route path="/finance/transactions" element={<p>Counter page</p>}/>
   <Route path="/finance/payroll" element={<p>Accountant page</p>}/>
   <Route path="/finance/reconciliation" element={<p>Accountant page</p>}/>
   <Route path="/cashier" element={<p>Counter page</p>}/>
   <Route path="/accountant" element={<p>Accountant page</p>}/>
   <Route path="/club/admin/finance" element={<p>Report page</p>}/>
  </Route>
  <Route path="/" element={<p>Home page</p>}/>
 </Routes></MemoryRouter>);
}
it.each([["isCashier","Counter page"],["isAccountant","Accountant page"],["isClubOwner","Report page"],["isAdmin","Report page"]])("opens the role destination for %s",(role,text)=>{
 Object.assign(auth,{[role]:true});mount();expect(screen.getByText(text)).toBeVisible();
});
it("keeps the counter and reports reachable for an owner with both responsibilities",()=>{
 auth.isClubOwner=true;mount();fireEvent.click(screen.getByRole("link",{name:"Thu–chi"}));
 expect(screen.getByText("Counter page")).toBeVisible();
 fireEvent.click(screen.getByRole("link",{name:"Tổng quan"}));expect(screen.getByText("Report page")).toBeVisible();
});
it("keeps a legacy cashier deep link open without redirecting to the role default",()=>{
 auth.isCashier=true;mount("/cashier?tab=tournament_payouts");expect(screen.getByText("Counter page")).toBeVisible();
 expect(screen.queryByRole("link",{name:"Tổng quan"})).toBeNull();
});
it("waits for role loading before choosing a destination",()=>{
 auth.loading=true;mount();expect(screen.queryByText("Home page")).toBeNull();
});

it("shows exactly four main destinations to the owner",()=>{
 auth.isClubOwner=true;mount();
 const navigation=screen.getByRole("navigation",{name:"Tài chính & Đối soát"});
 expect(navigation.querySelectorAll("a")).toHaveLength(4);
 expect(navigation.textContent).toContain("Thu–chi");
 expect(navigation.textContent).toContain("Đối soát");
 expect(navigation.textContent).toContain("Tổng quan");
 expect(screen.getByText("Tra cứu chi tiết").closest("details")).not.toHaveAttribute("open");
});
it("waits for club roles after the auth session has loaded",()=>{
 auth.rolesLoading=true;mount();
 expect(screen.queryByText("Home page")).toBeNull();
 expect(screen.queryByText("Report page")).toBeNull();
});
it("shows a role read failure without sending the user home",()=>{
 auth.rolesError="roles unavailable";mount();
 expect(screen.getByRole("alert")).toBeVisible();
 expect(screen.queryByText("Home page")).toBeNull();
});

it("opens payroll directly and excludes demo reports",()=>{auth.isClubOwner=true;mount();expect(screen.getByRole("link",{name:"Lương"})).toHaveAttribute("href","/finance/payroll");expect(screen.queryByRole("link",{name:"Các báo cáo đối soát hiện có"})).toBeNull();});

it("marks only the selected accountant task as current",()=>{auth.isClubOwner=true;mount("/finance/reconciliation");expect(screen.getByRole("link",{name:"Đối soát"})).toHaveAttribute("aria-current","page");expect(screen.getByRole("link",{name:"Lương"})).not.toHaveAttribute("aria-current");});

it("carries the selected club and dates to another task without its old payment",()=>{auth.isClubOwner=true;mount("/club/admin/finance?club=B&from=2026-11-01&to=2026-11-25&payment_id=old");expect(screen.getByRole("link",{name:"Lương"})).toHaveAttribute("href","/finance/payroll?club=B&from=2026-11-01&to=2026-11-25");});
