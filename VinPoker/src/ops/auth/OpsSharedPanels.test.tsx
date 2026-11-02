import { Component, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OpsAuthProvider, useOpsAuth } from "./OpsAuthProvider";
import { MultiDayFloorEventWorkspace } from "@/components/floor/MultiDayFloorEventPanel";
import { TvBrandingEditorWorkspace } from "@/components/cashier/tournament-live/TvBrandingEditor";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
vi.mock("@/integrations/supabase/client",()=>({supabase:{}}));
vi.mock("@/lib/featureFlags",()=>({FEATURES:{tvLayoutEditorV1:true}}));
const h=vi.hoisted(()=>({session:{user:{id:'81100000-0000-4000-8000-000000000001'},access_token:'LOCAL_TEST_ONLY'},rpc:vi.fn()}));
vi.mock("@/integrations/supabase/opsClient",()=>({opsClient:{rpc:h.rpc,auth:{
  getSession:async()=>({data:{session:h.session},error:null}),getUser:async()=>({data:{user:h.session.user},error:null}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe:vi.fn()}}}),
}}}));
class Boundary extends Component<{children:ReactNode},{message:string|null}> {
  state={message:null as string|null};
  static getDerivedStateFromError(error:Error){return {message:error.message};}
  render(){return this.state.message?<p>SHELL_BOUNDARY_ERROR:{this.state.message}</p>:this.props.children;}
}
function Gate({kind}:{kind:'multi-day'|'tv'}){
  const {loading,user,session}=useOpsAuth();
  if(loading||!user)return <p>Verifying TEST Ops session</p>;
  return <><p>Verified Ops session</p><Boundary>{kind==='multi-day'
    ?<MultiDayFloorEventWorkspace eventId="event" surface="payout" actorId={user.id} sessionEpoch={sessionReadEpoch(session)}/>
    :<TvBrandingEditorWorkspace tournamentId="tour" actorId={user.id} sessionEpoch={sessionReadEpoch(session)}/>}</Boundary></>;
}
afterEach(()=>{cleanup();vi.clearAllMocks();vi.unstubAllGlobals();});
it.each(['multi-day','tv'] as const)('mounts actual %s panel under Ops without the public AuthProvider',async kind=>{
  h.rpc.mockResolvedValue({data:null,error:{message:'LOCAL_TEST_READ_UNAVAILABLE'}});
  render(<OpsAuthProvider><Gate kind={kind}/></OpsAuthProvider>);
  await screen.findByText('Verified Ops session');
  expect(screen.queryByText(/SHELL_BOUNDARY_ERROR/)).toBeNull();
  if(kind==='multi-day')await waitFor(()=>expect(h.rpc).toHaveBeenCalledWith('multi_day_floor_read_v1',{p_event_id:'event'}));
  else expect(screen.getByRole('button',{name:'Edit TV layout'})).toBeInTheDocument();
});
it('opens the real TV editor and both real uploaders with only verified Ops scope',async()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  h.rpc.mockResolvedValue({data:{logo_url:null,background_url:null,brand_name:'OPS TEST',layout:{},revision:7},error:null});
  const view=render(<OpsAuthProvider><Gate kind="tv"/></OpsAuthProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'Edit TV layout'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
  expect(screen.getByText('Tournament logo')).toBeInTheDocument();expect(screen.getByText('TV background')).toBeInTheDocument();
  expect(view.container.ownerDocument.querySelectorAll('input[type="file"]')).toHaveLength(2);
  expect(screen.queryByText(/SHELL_BOUNDARY_ERROR/)).toBeNull();
  expect(h.rpc).toHaveBeenCalledTimes(1);
});
