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
 auth.isClubOwner=true;mount();fireEvent.click(screen.getByRole("link",{name:"Quầy"}));
 expect(screen.getByText("Counter page")).toBeVisible();
 fireEvent.click(screen.getByRole("link",{name:"Báo cáo"}));expect(screen.getByText("Report page")).toBeVisible();
});
it("keeps a legacy cashier deep link open without redirecting to the role default",()=>{
 auth.isCashier=true;mount("/cashier?tab=tournament_payouts");expect(screen.getByText("Counter page")).toBeVisible();
 expect(screen.queryByRole("link",{name:"Báo cáo"})).toBeNull();
});
it("waits for role loading before choosing a destination",()=>{
 auth.loading=true;mount();expect(screen.queryByText("Home page")).toBeNull();
});

it("shows exactly three main destinations to the owner",()=>{
 auth.isClubOwner=true;mount();
 const navigation=screen.getByRole("navigation",{name:"Quầy & Tài chính"});
 expect(navigation.querySelectorAll("a")).toHaveLength(3);
 expect(navigation.textContent).toContain("Quầy");
 expect(navigation.textContent).toContain("Đối soát");
 expect(navigation.textContent).toContain("Báo cáo");
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
