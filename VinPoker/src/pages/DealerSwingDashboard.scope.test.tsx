import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

const state = vi.hoisted(() => ({ actorId: "actor-a", ids: ["center", "quads"], payrollIds:["quads"],liveAdmin:false, v2: true,error:null as string|null,refresh:vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.actorId }, loading: false, isAdmin: false, isClubAdmin: false, isClubOwner: false }) }));
vi.mock("@/hooks/useOperatorClubs", () => ({ useOperatorClubs: () => ({ clubs: [{ id: "center", name: "CenterPoint" }, { id: "quads", name: "Quads" }], clubIds: ["center", "quads"], dealerClubIds: state.ids,error:state.error,scopeVerified:!state.error,refresh:state.refresh }) }));
vi.mock("@/hooks/useDealerControlClubScope", () => ({ useDealerControlClubScope: () => ({ clubs: state.liveAdmin?[]:[{ id: "center", name: "CenterPoint" }, { id: "quads", name: "Quads" }],dealerClubIds:state.ids,payrollClubIds:state.payrollIds.filter(id=>state.ids.includes(id)),isAdmin:state.liveAdmin,error:state.error,scopeVerified:!state.error,refresh:state.refresh }) }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { dealerShiftPlanner: true, get shiftPlannerV2() { return state.v2; } } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/cashier/DealerSwingTab", () => ({ default: ({clubIds,clubs}:{clubIds:string[];clubs:{id:string}[]}) => <div data-testid="swing" data-clubs={clubs.map(c=>c.id).join(',')}>{clubIds.join(',')} Swing</div> }));
vi.mock("@/components/cashier/DealerPayrollTab", () => ({ default: ({clubIds,clubs}:{clubIds:string[];clubs:{id:string}[]}) => <div data-testid="payroll" data-clubs={clubs.map(c=>c.id).join(',')}>{clubIds.join(',')} Payroll</div> }));
vi.mock("@/components/cashier/DealerPayrollTabV2", () => ({ default: ({clubIds,clubs}:{clubIds:string[];clubs:{id:string}[]}) => <div data-testid="payroll" data-clubs={clubs.map(c=>c.id).join(',')}>{clubIds.join(',')} Payroll V2</div> }));
function Planner({ clubIds, clubs }: { clubIds: string[]; clubs: { id: string }[] }) {
  const [draft, setDraft] = useState("");
  return <div data-testid="planner" data-clubs={clubs.map(c => c.id).join(",")}>{clubIds.join(",")}<input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} /></div>;
}
vi.mock("@/components/cashier/ShiftPlannerTab", () => ({ default: Planner }));
vi.mock("@/components/cashier/shift-planner-v2/ShiftPlannerV2Tab", () => ({ default: Planner }));
import DealerSwingDashboard from "./DealerSwingDashboard";

function Page() { return <MemoryRouter><DealerSwingDashboard /></MemoryRouter>; }
function openPlanner() { fireEvent.mouseDown(screen.getByRole("tab", { name: "Xếp lịch dealer" }), { button: 0, ctrlKey: false }); }
function selectClub(id: string) { fireEvent.change(screen.getByRole("combobox", { name: "dealerPlannerScope.club" }), { target: { value: id } }); }

describe("Dealer planner exact club scope", () => {
  beforeEach(() => { state.actorId = "actor-a"; state.ids = ["center", "quads"];state.payrollIds=['quads'];state.liveAdmin=false; state.v2 = true;state.error=null;state.refresh.mockClear(); });
  it('preserves the verified superadmin global payroll path without membership, then removes it on withdrawal',()=>{
    state.ids=[];state.payrollIds=[];state.liveAdmin=true;const view=render(<Page/>);
    fireEvent.mouseDown(screen.getByRole('tab',{name:'Bảng lương'}),{button:0,ctrlKey:false});
    expect(screen.getByTestId('payroll')).toBeVisible();
    state.liveAdmin=false;view.rerender(<Page/>);
    expect(screen.queryByTestId('payroll')).toBeNull();expect(screen.getByText('Bạn chưa được phân công CLB nào')).toBeVisible();
  });
  it('does not offer Cashier B as a Dealer Control A workspace or grant payroll A',()=>{
    state.ids=['center'];render(<Page/>);
    expect(screen.getByTestId('swing')).toHaveAttribute('data-clubs','center');
    expect(screen.queryByRole('tab',{name:'Bảng lương'})).toBeNull();
    expect(screen.queryByTestId('payroll')).toBeNull();
  });
  it('keeps payroll available when the same Dealer Swing club has independent payroll authority',()=>{
    state.ids=['center'];state.payrollIds=['center'];render(<Page/>);
    fireEvent.mouseDown(screen.getByRole('tab',{name:'Bảng lương'}),{button:0,ctrlKey:false});
    expect(screen.getByTestId('payroll')).toHaveAttribute('data-clubs','center');
  });
  it('shows unknown scope with retry, not missing assignment or operational content, on a scope read error',()=>{
    state.error='Không tải được phạm vi CLB';state.ids=[];
    render(<Page/>);
    expect(screen.queryByText('Bạn chưa được phân công CLB nào')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được phạm vi CLB');
    expect(screen.queryByText('Swing')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));expect(state.refresh).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("requires an explicit club and passes only that club to V2=%s", (v2) => {
    state.v2 = v2;
    render(<Page />); openPlanner();
    expect(screen.queryByTestId("planner")).not.toBeInTheDocument();
    selectClub("quads");
    expect(screen.getByTestId("planner")).toHaveTextContent("quads");
    expect(screen.getByTestId("planner")).toHaveAttribute("data-clubs", "quads");
  });
  it("discards draft state when switching club, including A-B-A", () => {
    render(<Page />); openPlanner(); selectClub("quads");
    fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), { target: { value: "old draft" } });
    selectClub("center"); selectClub("quads");
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("");
  });
  it("does not carry a selection into another actor or a revoked scope", () => {
    const view = render(<Page />); openPlanner(); selectClub("quads");
    state.actorId = "actor-b"; view.rerender(<Page />);
    expect(screen.queryByTestId("planner")).not.toBeInTheDocument();
    selectClub("quads"); state.ids = ["center"]; view.rerender(<Page />);
    expect(screen.getByTestId("planner")).toHaveTextContent("center");
    expect(screen.queryByRole("option", { name: "Quads" })).not.toBeInTheDocument();
  });
});
