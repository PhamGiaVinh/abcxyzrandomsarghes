import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
const m = vi.hoisted(() => ({ rpc: vi.fn(), actor: "owner-a", session:{access_token:'synthetic-a'}, success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: m.actor },session:m.session }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = { rpc: m.rpc }; return { useSupabaseClient: () => client };
});
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { tvLayoutEditorV1: true } }));
vi.mock("@/components/ProofUploader", () => ({ ProofUploadWorkspace: ({folder,onUploadingChange}:{folder:string;onUploadingChange?:(busy:boolean)=>void}) => <div>
 <button onClick={()=>onUploadingChange?.(true)}>Start {folder}</button><button onClick={()=>onUploadingChange?.(false)}>Finish {folder}</button>
 </div> }));
vi.mock("@/components/tournament-clock/VinPokerTournamentClock", () => ({ VinPokerTournamentClock: ({data}:{data:{brandName:string}}) => <div data-testid="clock-preview">{data.brandName}</div> }));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
import { TvBrandingEditor } from "./TvBrandingEditor";
const branding = { logo_url: null, background_url: null, brand_name: "TEST", layout: {}, revision: 7 };
beforeEach(() => { vi.resetAllMocks(); m.actor = "owner-a";m.session={access_token:'synthetic-a'}; m.rpc.mockResolvedValue({ data: branding, error: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('discards the TV draft after same-actor session replacement',async()=>{
 const view=render(<TvBrandingEditor tournamentId="tour-a"/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 fireEvent.change(screen.getByRole('textbox',{name:'Brand name'}),{target:{value:'OLD SESSION DRAFT'}});
 m.session={access_token:'synthetic-b'};view.rerender(<TvBrandingEditor tournamentId="tour-a"/>);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 expect(screen.getByRole('textbox',{name:'Brand name'})).toHaveValue('TEST');
 expect(m.rpc.mock.calls.filter(([name])=>name==='get_tv_tournament_branding_v1')).toHaveLength(2);
 expect(m.rpc.mock.calls.some(([name])=>name==='save_tv_tournament_layout_v1')).toBe(false);
});
it('ignores an old-session settings response after replacement',async()=>{
 let finish!:(value:unknown)=>void;
 m.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<TvBrandingEditor tournamentId="tour-a"/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 m.session={access_token:'synthetic-b'};view.rerender(<TvBrandingEditor tournamentId="tour-a"/>);
 await act(async()=>finish({data:{...branding,brand_name:'OLD SESSION RESPONSE'},error:null}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 expect(screen.getByRole('textbox',{name:'Brand name'})).toHaveValue('TEST');
});
it('does not acknowledge a valid old-session publish receipt in the new session',async()=>{
 const view=render(<TvBrandingEditor tournamentId="tour-a"/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 let finish!:(value:unknown)=>void;
 m.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'}));
 const submitted=m.rpc.mock.calls.find(([name])=>name==='save_tv_tournament_layout_v1')?.[1];
 expect(submitted).toBeDefined();
 m.session={access_token:'synthetic-b'};view.rerender(<TvBrandingEditor tournamentId="tour-a"/>);
 await act(async()=>finish({data:{revision:8,brand_name:submitted.p_brand_name,configured_brand_name:submitted.p_brand_name||null,
  logo_url:submitted.p_logo_url||null,background_url:submitted.p_bg_url||null,layout:submitted.p_layout},error:null}));
 expect(m.success).not.toHaveBeenCalled();expect(m.error).not.toHaveBeenCalled();
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 expect(m.rpc.mock.calls.filter(([name])=>name==='save_tv_tournament_layout_v1')).toHaveLength(1);
});
it('keeps the draft on an ordinary rerender within the same session',async()=>{
 const view=render(<TvBrandingEditor tournamentId="tour-a"/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 fireEvent.change(screen.getByRole('textbox',{name:'Brand name'}),{target:{value:'CURRENT DRAFT'}});
 view.rerender(<TvBrandingEditor tournamentId="tour-a"/>);
 expect(screen.getByRole('textbox',{name:'Brand name'})).toHaveValue('CURRENT DRAFT');
 expect(m.rpc).toHaveBeenCalledTimes(1);
});
it('retains inherited name intent after reload instead of freezing the rendered club name',async()=>{
 m.rpc.mockResolvedValue({data:{...branding,brand_name:'INHERITED CLUB',configured_brand_name:null,fallback_brand_name:'INHERITED CLUB'},error:null});
 render(<TvBrandingEditor tournamentId="tour-a"/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 expect(screen.getByRole('textbox',{name:'Brand name'})).toHaveValue('');
 expect(screen.getByTestId('clock-preview')).toHaveTextContent('INHERITED CLUB');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'})));
 expect(m.rpc.mock.calls.find(([name])=>name==='save_tv_tournament_layout_v1')?.[1].p_brand_name).toBe('');
});
it('previews the actual club fallback when a custom brand is reset',async()=>{
 m.rpc.mockResolvedValue({data:{...branding,brand_name:'CUSTOM BRAND',configured_brand_name:'CUSTOM BRAND',fallback_brand_name:'INHERITED CLUB'},error:null});
 render(<TvBrandingEditor tournamentId="tour-a"/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Reset draft to defaults'}));
 expect(screen.getByTestId('clock-preview')).toHaveTextContent('INHERITED CLUB');
});
it('preserves effective club defaults before the first publish, then previews reset fallback',async()=>{
 m.rpc.mockResolvedValue({data:{...branding,revision:0,brand_name:'LEGACY CLUB DEFAULT',configured_brand_name:null,fallback_brand_name:'CLUB NAME'},error:null});
 render(<TvBrandingEditor tournamentId="tour-a"/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 expect(screen.getByRole('textbox',{name:'Brand name'})).toHaveValue('LEGACY CLUB DEFAULT');
 fireEvent.click(screen.getByRole('button',{name:'Reset draft to defaults'}));expect(screen.getByTestId('clock-preview')).toHaveTextContent('CLUB NAME');
});
it.each(['configured_brand_name','fallback_brand_name'])('blocks editing when %s metadata is malformed',async(field)=>{
 m.rpc.mockResolvedValue({data:{...branding,[field]:123},error:null});
 render(<TvBrandingEditor tournamentId="tour-a"/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await screen.findByText('Could not load current TV settings. Close and reopen to retry.');
 expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeDisabled();
});
it('does not publish or reset while either image upload is pending',async()=>{
 render(<TvBrandingEditor tournamentId="tour-a"/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Start tv/branding-logo'}));
 fireEvent.click(screen.getByRole('button',{name:'Start tv/branding-background'}));
 expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Reset draft to defaults'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'}));expect(m.rpc).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Finish tv/branding-logo'}));
 expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Finish tv/branding-background'}));
 expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled();
});
for (const changed of ["tournament", "actor"]) it(`ignores late publish after ${changed} changes`, async () => {
  const view = render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  let finish!: (value: unknown) => void;
  m.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" }));
  if (changed === "actor") m.actor = "owner-b";
  view.rerender(<TvBrandingEditor tournamentId={changed === "tournament" ? "tour-b" : "tour-a"} />);
  await act(async () => finish({ data: { revision: 8 }, error: null }));
  expect(m.success).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("ends a stalled settings read and ignores the late draft", async () => {
  vi.useFakeTimers(); let finish!: (value: unknown) => void;
  m.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(screen.queryByText("Loading TV settings…")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeDisabled();
  await act(async () => finish({ data: branding, error: null }));
  expect(screen.queryByLabelText("Brand name")).not.toBeInTheDocument();
});
it("does not acknowledge unchanged content at the old revision after response loss", async () => {
  let submitted: Record<string, unknown> | null = null;
  m.rpc.mockImplementation(async (name, args) => {
    if (name === "save_tv_tournament_layout_v1") { submitted = args; throw new Error("offline"); }
    return { data: submitted ? { brand_name: submitted.p_brand_name, logo_url: submitted.p_logo_url || null,
      background_url: submitted.p_bg_url || null, layout: submitted.p_layout, revision: 7 } : branding, error: null };
  });
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" })));
  expect(m.success).not.toHaveBeenCalled(); expect(m.error).toHaveBeenCalled();
});
it('recovers reset-to-club-name after response loss using configured name, not rendered fallback',async()=>{
 let submitted:Record<string,unknown>|null=null;
 m.rpc.mockImplementation(async(name,args)=>{
  if(name==='save_tv_tournament_layout_v1'){submitted=args;return {data:null,error:{code:'',message:'lost response'}};}
  return {data:submitted?{brand_name:'TEST CLUB fallback',configured_brand_name:null,logo_url:null,background_url:null,layout:submitted.p_layout,revision:8}:branding,error:null};
 });
 render(<TvBrandingEditor tournamentId="tour-a"/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Reset draft to defaults'}));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'})));
 expect(m.success).toHaveBeenCalledOnce();expect(m.error).not.toHaveBeenCalled();
 expect(m.rpc.mock.calls.filter(([name])=>name==='save_tv_tournament_layout_v1')).toHaveLength(1);
});
it.each(['missing','different','malformed'])('does not confirm a reset from %s configured-name evidence',async(kind)=>{
 let submitted:Record<string,unknown>|null=null;
 m.rpc.mockImplementation(async(name,args)=>{
  if(name==='save_tv_tournament_layout_v1'){submitted=args;return {data:null,error:{code:'',message:'lost response'}};}
  return {data:submitted?{brand_name:'TEST CLUB fallback',logo_url:null,background_url:null,layout:submitted.p_layout,revision:8,
   ...(kind==='missing'?{}:{configured_brand_name:kind==='different'?'other operator':123})}:branding,error:null};
 });
 render(<TvBrandingEditor tournamentId="tour-a"/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Reset draft to defaults'}));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'})));
 expect(m.success).not.toHaveBeenCalled();expect(m.error).toHaveBeenCalledOnce();
 expect(m.rpc.mock.calls.filter(([name])=>name==='save_tv_tournament_layout_v1')).toHaveLength(1);
});
it.each(['revision-only','wrong-brand','wrong-logo','wrong-layout','revision-jump'])('does not acknowledge %s save response without matching canonical evidence',async(kind)=>{
 m.rpc.mockImplementation(async(name,args)=>{
  if(name!=='save_tv_tournament_layout_v1')return {data:branding,error:null};
  const result={revision:kind==='revision-jump'?9:8,brand_name:args.p_brand_name,configured_brand_name:args.p_brand_name||null,
   logo_url:args.p_logo_url||null,background_url:args.p_bg_url||null,layout:args.p_layout};
  return {data:kind==='revision-only'?{revision:8}:kind==='wrong-brand'?{...result,configured_brand_name:'OTHER'}
   :kind==='wrong-logo'?{...result,logo_url:'https://test.invalid/other.png'}:kind==='wrong-layout'?{...result,layout:{}}:result,error:null};
 });
 render(<TvBrandingEditor tournamentId="tour-a"/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'})));
 expect(m.success).not.toHaveBeenCalled();expect(m.error).toHaveBeenCalledOnce();expect(screen.getByRole('dialog')).toBeTruthy();
 expect(m.rpc.mock.calls.filter(([name])=>name==='save_tv_tournament_layout_v1')).toHaveLength(1);
});
it("bounds a stalled publish and its readback without retrying the writer", async () => {
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  vi.useFakeTimers(); m.rpc.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
  expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled();
  expect(m.rpc.mock.calls.filter(([name]) => name === "save_tv_tournament_layout_v1")).toHaveLength(1);
  expect(m.success).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it("does not accept an empty success object as proof of publication", async () => {
  m.rpc.mockImplementation(async name => ({ data: name === "save_tv_tournament_layout_v1" ? {} : branding, error: null }));
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" })));
  expect(m.success).not.toHaveBeenCalled(); expect(m.error).toHaveBeenCalled();
});
it("reconciles identical JSONB content even when object key order differs", async () => {
  let submitted: Record<string, unknown> | null = null;
  m.rpc.mockImplementation(async (name, args) => {
    if (name === "save_tv_tournament_layout_v1") { submitted = args; throw new Error("offline"); }
    return { data: submitted ? { brand_name: submitted.p_brand_name, logo_url: submitted.p_logo_url || null,
      background_url: submitted.p_bg_url || null, revision: 8,
      layout: Object.fromEntries(Object.entries(submitted.p_layout as Record<string, unknown>).reverse()) } : branding, error: null };
  });
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" })));
  expect(m.success).toHaveBeenCalledOnce(); expect(m.error).not.toHaveBeenCalled();
});

it.each(["transport-error", "empty-response"])("reconciles a committed publish returned as %s by the SDK", async (kind) => {
  let submitted: Record<string, unknown> | null = null;
  m.rpc.mockImplementation(async (name, args) => {
    if (name === "save_tv_tournament_layout_v1") {
      submitted = args;
      return { data: null, error: kind === "transport-error" ? { code: "", message: "TypeError: Failed to fetch" } : null };
    }
    return { data: submitted ? { brand_name: submitted.p_brand_name, logo_url: submitted.p_logo_url || null,
      background_url: submitted.p_bg_url || null, layout: submitted.p_layout, revision: 8 } : branding, error: null };
  });
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" })));
  expect(m.success).toHaveBeenCalledOnce();expect(m.error).not.toHaveBeenCalled();
  expect(m.rpc.mock.calls.filter(([name]) => name === "save_tv_tournament_layout_v1")).toHaveLength(1);
  expect(m.rpc.mock.calls.filter(([name]) => name === "get_tv_tournament_branding_v1")).toHaveLength(2);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["42501", "22023", "23514", "40001", "P0001"])("does not mask a definite SQL rejection %s with canonical state", async (code) => {
  m.rpc.mockImplementation(async name => name === "save_tv_tournament_layout_v1"
    ? { data: null, error: { code, message: "TEST definite rejection" } } : { data: branding, error: null });
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" })));
  expect(m.error).toHaveBeenCalledWith("TEST definite rejection");expect(m.success).not.toHaveBeenCalled();
  expect(m.rpc.mock.calls.filter(([name]) => name === "save_tv_tournament_layout_v1")).toHaveLength(1);
  expect(m.rpc.mock.calls.filter(([name]) => name === "get_tv_tournament_branding_v1")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled();
});
