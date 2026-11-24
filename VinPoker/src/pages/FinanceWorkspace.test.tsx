import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ loading:false, isCashier:false, isAccountant:false, isClubOwner:false, isAdmin:false, isClubAdmin:false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { accountingControl:true } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t:(key:string)=>key }) }));
import FinanceWorkspace from "./FinanceWorkspace";

beforeEach(()=>Object.assign(auth,{loading:false,isCashier:false,isAccountant:false,isClubOwner:false,isAdmin:false,isClubAdmin:false}));
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
