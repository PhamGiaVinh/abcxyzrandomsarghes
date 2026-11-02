import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ actor: 'owner-a', read: vi.fn(), select: vi.fn(), update: vi.fn(), write: vi.fn(), success: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.actor }, loading: false }) }));
vi.mock('sonner',()=>({toast:{success:state.success,error:vi.fn()}}));
vi.mock("@/lib/onesignal", () => ({ isOneSignalSupported: () => false, getSubscriptionState: vi.fn(), requestPushPermission: vi.fn(), optOutPush: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({
  select: (...args: unknown[]) => { state.select(...args); return { eq: () => ({ maybeSingle: state.read }) }; },
  update: (payload:unknown) => { state.update(payload);let actor:string;const q={eq:(_key:string,id:string)=>{actor=id;return q;},select:()=>q,maybeSingle:()=>state.write(payload,actor),then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>Promise.resolve(state.write(payload,actor)).then(resolve,reject)};return q; },
}) } }));
import NotificationSettings from "./NotificationSettings";
beforeEach(() => {vi.clearAllMocks();state.actor='owner-a';state.read.mockResolvedValue({data:{push_prefs:{news:true}},error:null});state.write.mockResolvedValue({data:{user_id:'owner-a'},error:null});});
afterEach(cleanup);
describe("notification preferences schema availability", () => {
  it('does not invent editable push categories when the actual profile has no push column',async()=>{
    state.read.mockResolvedValue({data:{user_id:'owner-a'},error:null});render(<NotificationSettings/>);
    await screen.findByText(/Tùy chọn email chưa có backend/);
    const switches=screen.getAllByRole('switch').slice(0,5);
    for(const control of switches){expect(control).toBeDisabled();expect(control).toHaveAttribute('aria-checked','false');fireEvent.click(control);}
    expect(state.update).not.toHaveBeenCalled();
    expect(screen.getByText(/Tùy chọn loại push chưa có backend/)).toBeInTheDocument();
  });
  it.each([[],true,0,'false',{news:'false'},{news:null}])('rejects malformed push preferences without treating them as enabled: %j',async push_prefs=>{
    state.read.mockResolvedValue({data:{push_prefs},error:null});render(<NotificationSettings/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được tùy chọn loại push');
    for(const control of screen.getAllByRole('switch').slice(0,5)){expect(control).toBeDisabled();expect(control).toHaveAttribute('aria-checked','false');fireEvent.click(control);}
    expect(state.update).not.toHaveBeenCalled();
  });
  it('preserves the explicit null default when the push column exists',async()=>{
    state.read.mockResolvedValue({data:{push_prefs:null},error:null});render(<NotificationSettings/>);
    await screen.findByText(/Tùy chọn email chưa có backend/);
    expect(screen.getAllByRole('switch')[0]).toBeEnabled();
    expect(screen.getAllByRole('switch')[0]).toHaveAttribute('aria-checked','true');
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(()=>expect(state.write).toHaveBeenCalledWith({push_prefs:{news:false}},'owner-a'));
  });
  it('does not invent editable preferences when the profile is absent',async()=>{
    state.read.mockResolvedValue({data:null,error:null});render(<NotificationSettings/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tìm thấy hồ sơ');
    expect(screen.getAllByRole('switch')[0]).toBeDisabled();
    expect(state.update).not.toHaveBeenCalled();
  });
  it('applies a preference only after the matching actor row is returned',async()=>{
    render(<NotificationSettings/>);await screen.findByText(/Tùy chọn email chưa có backend/);
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(()=>expect(screen.getAllByRole('switch')[0]).toHaveAttribute('aria-checked','false'));
    expect(state.write).toHaveBeenCalledWith({push_prefs:{news:false}},'owner-a');
  });
  it('ignores a late save failure after switching accounts',async()=>{
    let resolve!:(value:unknown)=>void;state.write.mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const view=render(<NotificationSettings/>);await screen.findByText(/Tùy chọn email chưa có backend/);
    fireEvent.click(screen.getAllByRole('switch')[0]);await waitFor(()=>expect(state.write).toHaveBeenCalledTimes(1));
    state.actor='owner-b';view.rerender(<NotificationSettings/>);await screen.findByText(/Tùy chọn email chưa có backend/);
    await act(async()=>resolve({data:null,error:{message:'late owner-a failure'}}));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('switch')[0]).toHaveAttribute('aria-checked','true');
  });
  it('does not accept a receipt belonging to another actor',async()=>{
    state.write.mockResolvedValue({data:{user_id:'owner-b'},error:null});
    render(<NotificationSettings/>);await screen.findByText(/Tùy chọn email chưa có backend/);
    fireEvent.click(screen.getAllByRole('switch')[0]);await screen.findByRole('alert');
    expect(screen.getAllByRole('switch')[0]).toHaveAttribute('aria-checked','true');
  });
  it('a failed save does not leave the switch displaying an uncommitted preference',async()=>{
    state.write.mockResolvedValue({data:null,error:{message:'LOCAL 503'}});render(<NotificationSettings/>);await screen.findByText(/Tùy chọn email chưa có backend/);
    fireEvent.click(screen.getAllByRole('switch')[0]);await waitFor(()=>expect(state.write).toHaveBeenCalled());
    expect(screen.getAllByRole('switch')[0]).toHaveAttribute('aria-checked','true');
  });
  it('zero updated rows are not accepted as a saved preference',async()=>{
    state.write.mockResolvedValue({data:null,error:null});render(<NotificationSettings/>);await screen.findByText(/Tùy chọn email chưa có backend/);
    fireEvent.click(screen.getAllByRole('switch')[0]);await screen.findByRole('alert');expect(state.success).not.toHaveBeenCalled();
  });
  it('serializes saves so two switches cannot overwrite the same stale JSON snapshot',async()=>{
    let resolve!:(value:unknown)=>void;state.write.mockImplementation(()=>new Promise(done=>{resolve=done;}));render(<NotificationSettings/>);await screen.findByText(/Tùy chọn email chưa có backend/);
    act(()=>{fireEvent.click(screen.getAllByRole('switch')[0]);fireEvent.click(screen.getAllByRole('switch')[1]);});expect(state.update).toHaveBeenCalledTimes(1);
    await act(async()=>resolve({data:{user_id:'owner-a'},error:null}));
  });
  it("does not let missing email columns break push preferences", async () => {
    state.read.mockResolvedValue({ data: { push_prefs: { news: false } }, error: null });
    render(<NotificationSettings />);
    await screen.findByText(/Tùy chọn email chưa có backend/);
    expect(state.select).toHaveBeenCalledWith("*");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("ends loading and reports a failed read rather than inventing settings", async () => {
    state.read.mockRejectedValue(new Error("503"));
    render(<NotificationSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không kết nối được");
    expect(state.update).not.toHaveBeenCalled();
  });
});
