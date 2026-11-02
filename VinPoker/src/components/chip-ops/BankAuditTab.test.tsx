import { afterAll,beforeAll,beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), success:vi.fn(),error:vi.fn(),signals:[] as AbortSignal[],
  auth:{user:{id:'actor-a'},session:{access_token:'local-session-a'},loading:false,rolesLoading:false,authError:null as string|null,rolesError:null as string|null} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args:unknown[])=>{
  const promise=Promise.resolve(h.rpc(...args));return Object.assign(promise,{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return promise;}});
}, from: h.from } }));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>h.auth}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));

import { BankAuditTab } from "./BankAuditTab";
const WRITE='chip_ops_bank_adjust_v2',LOOKUP='get_chip_bank_adjust_receipt_v2';
function appliedReceipt(args:Record<string,unknown>){
  return {status:'ok',outcome:'applied',actor_id:args.p_expected_actor,request_id:args.p_idempotency_key,
    payload:{club_id:args.p_club_id,denomination_id:args.p_denomination_id,direction:args.p_direction,count:args.p_count,
      tournament_id:args.p_tournament_id,expected_version:args.p_old_version},
    ledger_id:'e2730000-0000-4000-8000-000000000001',error:null,idempotent:true,
    result:{status:'ok',direction:args.p_direction,count:args.p_count,on_hand_count:20,balance_after:20}};
}

const originalScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
beforeAll(()=>Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()}));
afterAll(()=>{
  if(originalScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');
});

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
  h.success.mockReset();h.error.mockReset();
  h.signals=[];
  h.auth={user:{id:'actor-a'},session:{access_token:'local-session-a'},loading:false,rolesLoading:false,authError:null,rolesError:null};
  sessionStorage.clear();
  h.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ order: () => ({ limit: () => Object.assign(Promise.resolve({ data: [], error: null }),{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return Promise.resolve({data:[],error:null});}}) }) }) }),
  }));
});

describe("BankAuditTab", () => {
  it.each(['bank','ledger'])('bounds a hung %s snapshot, aborts it and requires explicit read recovery',async(kind)=>{
    h.rpc.mockImplementation(()=>kind==='bank'?new Promise(()=>{}):Promise.resolve({data:{denominations:[],coupling_enabled:false},error:null}));
    if(kind==='ledger')h.from.mockImplementation(()=>({select:()=>({eq:()=>({order:()=>({limit:()=>{
      const promise=new Promise(()=>{});return Object.assign(promise,{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return promise;}});
    }})})})}));
    vi.useFakeTimers();
    try{
      render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
      await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
      expect(screen.getByText(/Không tải được dữ liệu két chip\. Số tồn/)).toBeTruthy();
      expect(screen.getByRole('button',{name:'Thử lại'})).not.toBeDisabled();
      expect(screen.getByRole('switch',{name:'Bật két tự động'})).toBeDisabled();
      expect(h.signals.length).toBeGreaterThan(0);expect(h.signals.every(signal=>signal.aborted)).toBe(true);
      await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
      expect(h.rpc).toHaveBeenCalledTimes(1);
    }finally{vi.useRealTimers();}
    h.rpc.mockResolvedValue({data:{denominations:[],coupling_enabled:false},error:null});
    h.from.mockImplementation(()=>({select:()=>({eq:()=>({order:()=>({limit:()=>{
      const promise=Promise.resolve({data:[],error:null});return Object.assign(promise,{abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return promise;}});
    }})})})}));
    fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
    await screen.findByText(/Chưa có mệnh giá trong CLB/);expect(h.rpc).toHaveBeenCalledTimes(2);
  });
  it('keeps a timed-out write intent and resolves it only through the matching receipt',async()=>{
    let finish!:(value:unknown)=>void;let writeArgs:Record<string,unknown>={};
    h.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
      if(name==='get_chip_bank')return Promise.resolve({data:{denominations:[{denomination_id:'denom-a',value:100,color:null,on_hand_count:8,version:3}],coupling_enabled:false},error:null});
      if(name===LOOKUP)return Promise.resolve({data:appliedReceipt(args),error:null});
      writeArgs=args;return new Promise(resolve=>{finish=resolve;});
    });
    render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    await screen.findByText('T100');fireEvent.keyDown(screen.getAllByRole('combobox')[0],{key:'Enter'});
    fireEvent.click(await screen.findByRole('option',{name:'T100 · tồn 8'}));
    fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'12'}});
    vi.useFakeTimers();
    try{
      fireEvent.click(screen.getByRole('button',{name:'Thu'}));
      const raw=sessionStorage.getItem('vinpoker:chip-bank-pending:club-a');expect(raw).not.toBeNull();
      await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
      expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBe(raw);
      expect(screen.getByRole('button',{name:'Đối chiếu lệnh cũ'})).not.toBeDisabled();
      expect(h.success).not.toHaveBeenCalled();
    }finally{vi.useRealTimers();}
    fireEvent.click(screen.getByRole('button',{name:'Đối chiếu lệnh cũ'}));
    await waitFor(()=>expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBeNull());
    expect(h.success).toHaveBeenCalledTimes(1);
    await act(async()=>{finish({data:appliedReceipt(writeArgs),error:null});});
    expect(h.success).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls.filter(([name])=>name===WRITE)).toHaveLength(1);
  });
  it.each(['found','missing','unavailable','changed-journal'])('looks up the old receipt without issuing a mutation: %s',async(kind)=>{
    const command={actorId:'actor-a',clubId:'club-a',tournamentId:'tour-a',denominationId:'denom-a',direction:'thu',count:12,oldVersion:3,requestId:'original-request'};
    const raw=JSON.stringify(command);sessionStorage.setItem('vinpoker:chip-bank-pending:club-a',raw);
    let replacement=raw;
    h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
      if(name==='get_chip_bank')return {data:{denominations:[],coupling_enabled:false},error:null};
      if(kind==='changed-journal'){replacement=JSON.stringify({...command,requestId:'newer-request'});sessionStorage.setItem('vinpoker:chip-bank-pending:club-a',replacement);}
      return {data:kind==='missing'?null:appliedReceipt(args),error:kind==='unavailable'?{code:'PGRST202'}:null};
    });
    render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Đối chiếu lệnh cũ'}));
    await act(async()=>{});
    expect(h.rpc.mock.calls.some(([name])=>name===LOOKUP)).toBe(true);
    expect(h.rpc.mock.calls.some(([name])=>name===WRITE||name==='chip_ops_bank_adjust')).toBe(false);
    if(kind==='found')expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBeNull();
    else{expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBe(replacement);expect(h.success).not.toHaveBeenCalled();}
  });
  it('releases a hung receipt read after its deadline without retrying the mutation',async()=>{
    const raw=JSON.stringify({actorId:'actor-a',clubId:'club-a',tournamentId:'tour-a',denominationId:'denom-a',direction:'thu',count:12,oldVersion:3,requestId:'original-request'});
    sessionStorage.setItem('vinpoker:chip-bank-pending:club-a',raw);
    h.rpc.mockImplementation((name:string)=>name==='get_chip_bank'?Promise.resolve({data:{denominations:[],coupling_enabled:false},error:null}):new Promise(()=>{}));
    render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    const read=await screen.findByRole('button',{name:'Đối chiếu lệnh cũ'});
    vi.useFakeTimers();
    try{
      fireEvent.click(read);expect(read).toBeDisabled();
      await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
      expect(read).not.toBeDisabled();expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBe(raw);
      expect(h.rpc.mock.calls.filter(([name])=>name===LOOKUP)).toHaveLength(1);
      expect(h.rpc.mock.calls.some(([name])=>name===WRITE)).toBe(false);expect(h.success).not.toHaveBeenCalled();
    }finally{vi.useRealTimers();}
  });
  it.each(['bare-ok','wrong-actor','wrong-key','wrong-payload','invalid-balance'])('retains the journal on an unverified receipt: %s',async(kind)=>{
    const command={actorId:'actor-a',clubId:'club-a',tournamentId:'tour-a',denominationId:'denom-a',direction:'thu',count:12,oldVersion:3,requestId:'original-request'};
    const raw=JSON.stringify(command);sessionStorage.setItem('vinpoker:chip-bank-pending:club-a',raw);
    const receipt:Record<string,unknown>={status:'ok',outcome:'applied',actor_id:'actor-a',request_id:'original-request',
      payload:{club_id:'club-a',denomination_id:'denom-a',direction:'thu',count:12,tournament_id:'tour-a',expected_version:3},
      ledger_id:'e2730000-0000-4000-8000-000000000001',error:null,idempotent:true,
      result:{status:'ok',direction:'thu',count:12,on_hand_count:20,balance_after:20}};
    if(kind==='wrong-actor')receipt.actor_id='other';
    if(kind==='wrong-key')receipt.request_id='other-key';
    if(kind==='wrong-payload')receipt.payload={...(receipt.payload as object),count:13};
    if(kind==='invalid-balance')receipt.result={...(receipt.result as object),balance_after:-1};
    h.rpc.mockImplementation(async(name:string)=>name==='get_chip_bank'?{data:{denominations:[],coupling_enabled:false},error:null}
      :{data:kind==='bare-ok'?{status:'ok'}:receipt,error:null});
    render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Thử lại lệnh cũ'}));
    await act(async()=>{});
    expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBe(raw);
    expect(h.success).not.toHaveBeenCalled();
  });
  it('persists the actor before dispatch and keeps the same request after same-actor session renewal',async()=>{
    let saved:Record<string,unknown>|null=null;
    h.rpc.mockImplementation(async(name:string)=>{
      if(name==='get_chip_bank')return {data:{denominations:[{denomination_id:'denom-a',value:100,color:null,on_hand_count:8,version:3}],coupling_enabled:false},error:null};
      if(name===LOOKUP)return {data:null,error:null};
      saved=JSON.parse(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')!);
      return {data:null,error:{code:'503'}};
    });
    const view=render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    await screen.findByText('T100');
    fireEvent.keyDown(screen.getAllByRole('combobox')[0],{key:'Enter'});
    fireEvent.click(await screen.findByRole('option',{name:'T100 · tồn 8'}));
    fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'12'}});
    fireEvent.click(screen.getByRole('button',{name:'Thu'}));
    await waitFor(()=>expect(saved).toMatchObject({actorId:'actor-a',clubId:'club-a',tournamentId:'tour-a',count:12,oldVersion:3}));
    const original=sessionStorage.getItem('vinpoker:chip-bank-pending:club-a');
    h.auth={...h.auth,session:{access_token:'local-session-renewed'}};
    view.rerender(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Thử lại lệnh cũ'}));
    await waitFor(()=>expect(h.rpc.mock.calls.filter(([name])=>name===WRITE)).toHaveLength(2));
    const calls=h.rpc.mock.calls.filter(([name])=>name===WRITE);
    expect(calls[1][1]).toEqual(calls[0][1]);
    expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBe(original);
  });
  it.each(['loading','rolesLoading','authError','rolesError'])('does not read or write while %s is unresolved',async(field)=>{
    h.auth={...h.auth,[field]:field.endsWith('Error')?'UNVERIFIED':true};
    render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh phiên đăng nhập');
    expect(h.rpc).not.toHaveBeenCalled();expect(h.from).not.toHaveBeenCalled();
  });
  it.each([undefined,'actor-other'])('does not adopt an uncertain command owned by %s',async(actorId)=>{
    const raw=JSON.stringify({actorId,clubId:'club-a',tournamentId:'tour-a',denominationId:'denom-a',direction:'thu',count:12,oldVersion:3,requestId:'original-request'});
    sessionStorage.setItem('vinpoker:chip-bank-pending:club-a',raw);
    h.rpc.mockResolvedValue({data:{denominations:[],coupling_enabled:false},error:null});
    render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button',{name:'Thử lại lệnh cũ'})).toBeNull();
    expect(screen.getByRole('button',{name:'Thu'})).toBeDisabled();
    expect(screen.getByRole('switch',{name:'Bật két tự động'})).toBeDisabled();
    expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBe(raw);
    expect(h.rpc.mock.calls.every(([name])=>name==='get_chip_bank')).toBe(true);
  });
  it('lets only the original actor resume the unchanged command after switching accounts back',async()=>{
    const raw=JSON.stringify({actorId:'actor-a',clubId:'club-a',tournamentId:'tour-a',denominationId:'denom-a',direction:'thu',count:12,oldVersion:3,requestId:'original-request'});
    sessionStorage.setItem('vinpoker:chip-bank-pending:club-a',raw);
    h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='get_chip_bank'
      ?{data:{denominations:[],coupling_enabled:false},error:null}
      :name===LOOKUP?{data:null,error:null}:{data:appliedReceipt(args),error:null});
    h.auth={...h.auth,user:{id:'actor-b'}};
    const view=render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button',{name:'Thử lại lệnh cũ'})).toBeNull();
    h.auth={...h.auth,user:{id:'actor-a'},session:{access_token:'local-session-a-returned'}};
    view.rerender(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Thử lại lệnh cũ'}));
    await waitFor(()=>expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBeNull());
    const calls=h.rpc.mock.calls.filter(([name])=>name===WRITE);
    expect(calls).toHaveLength(1);expect(calls[0][1].p_idempotency_key).toBe('original-request');
  });
  it('does not toast a stale permission error from the previous session',async()=>{
    let finish!:(value:unknown)=>void;let reads=0;
    h.rpc.mockImplementation(()=>++reads===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve({data:{denominations:[],coupling_enabled:false},error:null}));
    const view=render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    h.auth={...h.auth,session:{access_token:'local-session-b'}};
    view.rerender(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    await act(async()=>{finish({data:{error:'Forbidden'},error:null});});
    await screen.findByText(/Chưa có mệnh giá trong CLB/);
    expect(h.error).not.toHaveBeenCalled();
  });
  it.each(['actor','session','unmount'])('ignores a late adjustment completion after %s changes',async(change)=>{
    const raw=JSON.stringify({actorId:'actor-a',clubId:'club-a',tournamentId:'tour-a',denominationId:'denom-a',direction:'thu',count:12,oldVersion:3,requestId:'original-request'});
    sessionStorage.setItem('vinpoker:chip-bank-pending:club-a',raw);
    let finish!:(value:unknown)=>void;
    h.rpc.mockImplementation((name:string)=>name==='get_chip_bank'
      ?Promise.resolve({data:{denominations:[],coupling_enabled:false},error:null})
      :name===LOOKUP?Promise.resolve({data:null,error:null}):new Promise(resolve=>{finish=resolve;}));
    const view=render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Thử lại lệnh cũ'}));
    await waitFor(()=>expect(h.rpc.mock.calls.some(([name])=>name===WRITE)).toBe(true));
    if(change==='unmount')view.unmount();
    else{
      h.auth={...h.auth,user:{id:change==='actor'?'actor-b':'actor-a'},session:{access_token:'local-session-b'}};
      view.rerender(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    }
    await act(async()=>{finish({data:{status:'ok'},error:null});});
    expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBe(raw);
    expect(h.success).not.toHaveBeenCalled();
  });
  it('hides previous bank data and ignores the old read after a session changes',async()=>{
    let finish!:(value:unknown)=>void;let reads=0;
    h.rpc.mockImplementation(()=>++reads===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve({data:{denominations:[],coupling_enabled:false},error:null}));
    const view=render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    h.auth={...h.auth,session:{access_token:'local-session-b'}};
    view.rerender(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    await act(async()=>{finish({data:{denominations:[{denomination_id:'old-private',value:987654,color:null,on_hand_count:99,version:1}],coupling_enabled:true},error:null});});
    await screen.findByText(/Chưa có mệnh giá trong CLB/);
    expect(screen.queryByText('T987.654')).toBeNull();
    expect(screen.getByRole('switch',{name:'Bật két tự động'})).not.toBeChecked();
  });
  it('preserves the original uncertain intent when the server reports an idempotency conflict',async()=>{
    const raw=JSON.stringify({actorId:'actor-a',clubId:'club-a',tournamentId:'tour-a',denominationId:'denom-a',direction:'thu',count:12,oldVersion:3,requestId:'original-request'});
    sessionStorage.setItem('vinpoker:chip-bank-pending:club-a',raw);
    h.rpc.mockImplementation(async(name:string)=>name==='get_chip_bank'
      ?{data:{denominations:[],coupling_enabled:false},error:null}
      :{data:{error:'IDEMPOTENCY_CONFLICT'},error:null});
    render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Thử lại lệnh cũ'}));
    await waitFor(()=>expect(h.rpc.mock.calls.some(([name])=>name===LOOKUP)).toBe(true));
    expect(h.rpc.mock.calls.some(([name])=>name===WRITE)).toBe(false);
    await act(async()=>{});
    expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBe(raw);
    expect(screen.getByRole('switch',{name:'Bật két tự động'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Đồng bộ kho két'})).toBeDisabled();
  });
  it.each([
    {tournamentId:undefined}, {oldVersion:-1}, {count:'12'}, {clubId:'club-other'}, {requestId:''},
  ])('preserves and blocks an invalid persisted command %j',async(change)=>{
    const value={actorId:'actor-a',clubId:'club-a',tournamentId:'tour-a',denominationId:'denom-a',direction:'thu',count:12,oldVersion:3,requestId:'original-request',...change};
    const raw=JSON.stringify(value);sessionStorage.setItem('vinpoker:chip-bank-pending:club-a',raw);
    h.rpc.mockResolvedValue({data:{denominations:[],coupling_enabled:false},error:null});
    render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
    await screen.findByText(/Không đọc được mã lệnh két đã lưu/);
    expect(screen.getByRole('button',{name:'Thu'})).toBeDisabled();
    expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBe(raw);
    expect(h.rpc.mock.calls.every(([name])=>name==='get_chip_bank')).toBe(true);
  });
  it.each(['malformed','unavailable'])('blocks all new bank writes when the pending journal is %s',async(kind)=>{
    const raw='{BROKEN_UNCERTAIN_BANK_COMMAND';
    if(kind==='malformed')sessionStorage.setItem('vinpoker:chip-bank-pending:club-a',raw);
    const read=Storage.prototype.getItem;
    const spy=kind==='unavailable'?vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(key){
      if(key==='vinpoker:chip-bank-pending:club-a')throw Error('LOCAL_STORAGE_UNAVAILABLE');return read.call(this,key);
    }):null;
    try{
      h.rpc.mockResolvedValue({data:{denominations:[],coupling_enabled:false},error:null});
      render(<BankAuditTab clubId="club-a" tournamentId="tour-a"/>);
      await screen.findByText(/Không đọc được mã lệnh két đã lưu/);
      expect(screen.getByRole('switch',{name:'Bật két tự động'})).toBeDisabled();
      expect(screen.getByRole('button',{name:'Đồng bộ kho két'})).toBeDisabled();
      expect(screen.queryByRole('button',{name:'Thử lại lệnh cũ'})).toBeNull();
      expect(h.rpc.mock.calls.every(([name])=>name==='get_chip_bank')).toBe(true);
      if(kind==='malformed')expect(sessionStorage.getItem('vinpoker:chip-bank-pending:club-a')).toBe(raw);
    }finally{spy?.mockRestore();}
  });
  it("does not present an authorization failure as an empty chip bank", async () => {
    h.rpc.mockResolvedValue({ data: { error: "Forbidden" }, error: null });
    render(<BankAuditTab clubId="club-a" tournamentId="tour-a" />);

    await screen.findByText(/Không tải được dữ liệu két chip\. Số tồn/);
    expect(screen.getByText(/Không thể xác nhận tồn kho/)).toBeTruthy();
    expect(screen.queryByText(/Chưa có mệnh giá trong CLB/)).toBeNull();
    expect(screen.getByRole("switch", { name: "Bật két tự động" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Đồng bộ kho két" }).hasAttribute("disabled")).toBe(true);
  });

  it("ignores a late bank response from a previously selected club", async () => {
    let resolveOld!: (value: unknown) => void;
    h.rpc.mockImplementation((_name: string, args: { p_club_id: string }) =>
      args.p_club_id === "club-a"
        ? new Promise((resolve) => { resolveOld = resolve; })
        : Promise.resolve({ data: { denominations: [], coupling_enabled: false }, error: null }));

    const view = render(<BankAuditTab clubId="club-a" tournamentId="tour-a" />);
    view.rerender(<BankAuditTab clubId="club-b" tournamentId="tour-b" />);
    await screen.findByText(/Chưa có mệnh giá trong CLB/);

    await act(async () => { resolveOld({ data: { error: "Forbidden" }, error: null }); });
    expect(screen.queryByText(/Không tải được dữ liệu két chip\. Số tồn/)).toBeNull();
  });

  it("retries a persisted uncertain adjustment with the original request and payload", async () => {
    sessionStorage.setItem("vinpoker:chip-bank-pending:club-a", JSON.stringify({
      actorId:'actor-a',clubId: "club-a", tournamentId: "tour-a", denominationId: "denom-a",
      direction: "thu", count: 12, oldVersion: 3, requestId: "original-request",
    }));
    h.rpc.mockImplementation(async (name: string,args:Record<string,unknown>) => name === "get_chip_bank"
      ? { data: { denominations: [{ denomination_id: "denom-a", value: 100, color: null,
        on_hand_count: 8, version: 3 }], coupling_enabled: false }, error: null }
      :name===LOOKUP?{data:null,error:null}: { data: appliedReceipt(args), error: null });

    render(<BankAuditTab clubId="club-a" tournamentId="tour-a" />);
    await screen.findByText(/Có lệnh Thu 12 chip chưa rõ kết quả/);
    expect(screen.getByRole('switch',{name:'Bật két tự động'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Đồng bộ kho két'})).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại lệnh cũ" }));

    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith(WRITE, {
      p_club_id: "club-a", p_denomination_id: "denom-a", p_direction: "thu", p_count: 12,
      p_tournament_id: "tour-a", p_old_version: 3, p_idempotency_key: "original-request",p_expected_actor:'actor-a',
    }));
    await waitFor(() => expect(sessionStorage.getItem("vinpoker:chip-bank-pending:club-a")).toBeNull());
  });

  it("does not dispatch the same pending adjustment twice on a rapid double-click", async () => {
    sessionStorage.setItem("vinpoker:chip-bank-pending:club-a", JSON.stringify({
      actorId:'actor-a',clubId: "club-a", tournamentId: null, denominationId: "denom-a",
      direction: "xuat", count: 2, oldVersion: 1, requestId: "one-request",
    }));
    let resolveAdjust!: (value: unknown) => void;
    h.rpc.mockImplementation((name: string) => name === "get_chip_bank"
      ? Promise.resolve({ data: { denominations: [], coupling_enabled: false }, error: null })
      :name===LOOKUP?Promise.resolve({data:null,error:null}): new Promise((resolve) => { resolveAdjust = resolve; }));

    render(<BankAuditTab clubId="club-a" tournamentId="tour-a" />);
    await screen.findByText(/Có lệnh Xuất 2 chip chưa rõ kết quả/);
    const retry = screen.getByRole("button", { name: "Thử lại lệnh cũ" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(()=>expect(h.rpc.mock.calls.filter(([name]) => name===WRITE)).toHaveLength(1));
    const args=h.rpc.mock.calls.find(([name])=>name===WRITE)![1];
    await act(async () => { resolveAdjust({ data: appliedReceipt(args), error: null }); });
  });
});
