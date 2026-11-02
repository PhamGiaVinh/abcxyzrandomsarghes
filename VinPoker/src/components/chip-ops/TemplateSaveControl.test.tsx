import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {StrictMode} from 'react';
const h=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));
import {TemplateSaveControl} from './TemplateSaveControl';
import {createChipSetupWriteGate} from '@/lib/chipSetupWriteGate';
import {persistChipTemplateSaveIntent,readChipTemplateSaveIntent,type ChipTemplateSaveIntent} from '@/lib/chipTemplateSaveIntent';
const scope={actorId:'11111111-1111-4111-8111-111111111111',clubId:'22222222-2222-4222-8222-222222222222',tournamentId:'33333333-3333-4333-8333-333333333333'},set='44444444-4444-4444-8444-444444444444',denom='55555555-5555-4555-8555-555555555555';
const draft={chipSetId:set,name:'TEST',stackValue:20000,lines:[{denomination_id:denom,count:200}]};
const receipt=(i:ChipTemplateSaveIntent,outcome='saved')=>({status:outcome==='rejected'?'rejected':'ok',outcome,actor_id:i.actorId,club_id:i.clubId,tournament_id:i.tournamentId,request_id:i.requestId,chip_set_id:i.chipSetId,error:outcome==='rejected'?'NAME_EXISTS':null,result:outcome==='saved'?{status:'ok',stack_template_id:denom,stack_value:i.stackValue,sum:i.stackValue}:null});
const props=()=>({scope,chipSetId:set,denoms:[{id:denom,value:100,color:'red'}],busy:false,acquireWrite:createChipSetupWriteGate(vi.fn()),onPendingChange:vi.fn(),onCommitted:vi.fn()});
async function fill(){fireEvent.change(await screen.findByPlaceholderText('VD: 30K mix'),{target:{value:'TEST'}});fireEvent.change(screen.getByPlaceholderText('VD: 30000'),{target:{value:'20000'}});fireEvent.change(screen.getByLabelText('Số chip 100'),{target:{value:'200'}});}
beforeEach(()=>{sessionStorage.clear();vi.restoreAllMocks();vi.clearAllMocks();h.rpc.mockResolvedValue({data:null,error:null});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('persists before one synchronous-gated RPC and preserves the exact payload on double-click',async()=>{
 const p=props();let finish!:(v:unknown)=>void;h.rpc.mockImplementation(()=>{expect(readChipTemplateSaveIntent(sessionStorage,scope)?.name).toBe('TEST');return new Promise(resolve=>{finish=resolve;});});
 render(<TemplateSaveControl {...p}/>);await fill();const save=screen.getByRole('button',{name:'Lưu mẫu'});
 act(()=>{fireEvent.click(save);fireEvent.click(save);});expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.rpc.mock.calls[0][0]).toBe('chip_ops_save_stack_template_v2');
 const i=readChipTemplateSaveIntent(sessionStorage,scope)!;await act(async()=>finish({data:receipt(i),error:null}));
 expect(p.onCommitted).toHaveBeenCalledTimes(1);expect(readChipTemplateSaveIntent(sessionStorage,scope)).toBeNull();
});
it('recovers a lost response after remount by lookup without saving again',async()=>{
 const p=props();h.rpc.mockResolvedValue({data:null,error:{code:'503'}});const mounted=render(<TemplateSaveControl {...p}/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Lưu mẫu'}));
 await screen.findByRole('alert');const i=readChipTemplateSaveIntent(sessionStorage,scope)!;mounted.unmount();h.rpc.mockClear();h.rpc.mockResolvedValue({data:receipt(i),error:null});
 render(<TemplateSaveControl {...p}/>);await waitFor(()=>expect(p.onCommitted).toHaveBeenCalledTimes(1));
 expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.rpc.mock.calls[0][0]).toBe('get_chip_template_save_receipt_v1');expect(h.rpc.mock.calls[0][1].p_request_id).toBe(i.requestId);
 expect(readChipTemplateSaveIntent(sessionStorage,scope)).toBeNull();
});
it('keeps an unknown lookup pending and retries only the original payload even if binding changed',async()=>{
 const i=persistChipTemplateSaveIntent(sessionStorage,scope,draft),p=props();render(<TemplateSaveControl {...p} chipSetId={null} denoms={[]}/>);await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Gửi lại nguyên mẫu stack'}));await act(async()=>{});
 expect(h.rpc).toHaveBeenCalledTimes(2);expect(h.rpc.mock.calls[1][1]).toEqual(h.rpc.mock.calls[0][1]);expect(h.rpc.mock.calls[1][1].p_request_id).toBe(i.requestId);
 expect(readChipTemplateSaveIntent(sessionStorage,scope)).toEqual(i);expect(p.onCommitted).not.toHaveBeenCalled();
});
it('does not persist or dispatch when another Setup writer owns the gate',async()=>{
 const p=props(),release=p.acquireWrite()!;render(<TemplateSaveControl {...p}/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Lưu mẫu'}));expect(h.rpc).not.toHaveBeenCalled();expect(readChipTemplateSaveIntent(sessionStorage,scope)).toBeNull();release();
});
it('ignores old saved results after switching actors and does not clear their journal',async()=>{
 const p=props();let finish!:(v:unknown)=>void;h.rpc.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const mounted=render(<TemplateSaveControl {...p}/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Lưu mẫu'}));const i=readChipTemplateSaveIntent(sessionStorage,scope)!;
 mounted.rerender(<TemplateSaveControl {...p} scope={{...scope,actorId:denom}}/>);h.success.mockClear();h.error.mockClear();
 await act(async()=>finish({data:receipt(i),error:null}));expect(h.success).not.toHaveBeenCalled();expect(h.error).not.toHaveBeenCalled();expect(p.onCommitted).not.toHaveBeenCalled();expect(readChipTemplateSaveIntent(sessionStorage,scope)).toEqual(i);
});
it('cancel uses a terminal receipt, not optimistic local removal',async()=>{
 const i=persistChipTemplateSaveIntent(sessionStorage,scope,draft),p=props();render(<TemplateSaveControl {...p}/>);await screen.findByRole('alert');h.rpc.mockResolvedValue({data:receipt(i,'cancelled'),error:null});fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu lưu mẫu'}));
 await waitFor(()=>expect(readChipTemplateSaveIntent(sessionStorage,scope)).toBeNull());expect(p.onCommitted).not.toHaveBeenCalled();expect(h.rpc.mock.calls.at(-1)?.[0]).toBe('cancel_chip_template_save_v1');
});
it('blocks all writes when journal persistence fails',async()=>{
 const p=props();render(<TemplateSaveControl {...p}/>);await fill();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage denied');});fireEvent.click(screen.getByRole('button',{name:'Lưu mẫu'}));
 await screen.findByRole('alert');expect(h.rpc).not.toHaveBeenCalled();expect(p.onPendingChange).toHaveBeenLastCalledWith(true);
});
it('does not accept a lookup from a disposed StrictMode effect lifetime',async()=>{
 const i=persistChipTemplateSaveIntent(sessionStorage,scope,draft),p=props();let finish!:(v:unknown)=>void;
 h.rpc.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValue({data:null,error:{code:'503'}});
 render(<StrictMode><TemplateSaveControl {...p}/></StrictMode>);await screen.findByRole('alert');expect(h.rpc).toHaveBeenCalledTimes(2);
 await act(async()=>finish({data:receipt(i),error:null}));
 expect(p.onCommitted).not.toHaveBeenCalled();expect(readChipTemplateSaveIntent(sessionStorage,scope)).toEqual(i);expect(h.success).not.toHaveBeenCalled();
});
