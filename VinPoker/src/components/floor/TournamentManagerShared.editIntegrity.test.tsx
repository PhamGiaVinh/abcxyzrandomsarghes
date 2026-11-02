import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({
  auth:{user:{id:'e1200000-0000-4000-8000-000000000001'},session:{access_token:'TEST-edit-session'}},
  error:vi.fn(),success:vi.fn(),rpc:vi.fn(),updates:[] as Record<string,unknown>[],
  saved:{name:'TEST original'},hang:false,canEditBlinds:true,
}));
vi.mock('sonner',()=>({toast:{error:h.error,success:h.success}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{blindTemplates:true,blindEditorSave:true,tournamentServiceFee:true}}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>h.auth}));
vi.mock('@/components/FomoPrice',()=>({FomoPrice:()=>null}));
vi.mock('@/components/LiveStateEditor',()=>({LiveStateEditor:()=>null}));
vi.mock('@/components/cashier/tournament-live/BlindEditorPanel',()=>({BlindEditorPanel:()=>null}));
vi.mock('@/components/cashier/tournament-live/BlindDraftBuilder',()=>({BlindDraftBuilder:()=>null}));
vi.mock('@/lib/blindPresets',()=>({BLIND_PRESETS:[{key:'test',name:'TEST edit levels',levels:[{level_number:1,small_blind:100,big_blind:200,ante:0,duration_minutes:20,is_break:false}]}]}));
vi.mock('@/components/ui/select',()=>({
  Select:({value,onValueChange,children}:{value:string;onValueChange:(value:string)=>void;children:React.ReactNode})=><select value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>,
  SelectItem:({value,children}:{value:string;children:React.ReactNode})=><option value={value}>{children}</option>,
  SelectContent:({children}:{children:React.ReactNode})=><>{children}</>,SelectGroup:({children}:{children:React.ReactNode})=><>{children}</>,
  SelectTrigger:()=>null,SelectValue:()=>null,SelectLabel:()=>null,
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>{const result=Promise.resolve(h.rpc(...args));return Object.assign(result,{abortSignal:()=>result});},from:(table:string)=>{
  let payload:Record<string,unknown>|null=null;
  const query={select:()=>query,eq:()=>query,abortSignal:()=>query,
    update:(value:Record<string,unknown>)=>{payload=value;h.updates.push(value);return query;},
    then:(resolve:(value:unknown)=>unknown,reject?:(reason:unknown)=>unknown)=>{
      if(payload){if(h.hang)return new Promise(()=>{}).then(resolve,reject);Object.assign(h.saved,payload);}
      return Promise.resolve({data:table==='blind_structure_templates'?[]:null,error:null}).then(resolve,reject);
    }};return query;
}}}));
import {EditTournamentDialog} from './TournamentManagerShared';
const tour={id:'e1200000-0000-4000-8000-000000000002',club_id:'e1200000-0000-4000-8000-000000000003',name:'TEST original',
  start_time:'2026-12-20T12:00:00+07:00',buy_in:100000,rake_amount:10000,service_fee_amount:5000,starting_stack:20000,
  minutes_per_level:20,late_reg_close_level:6,game_type:'nlh',status:'upcoming',updated_at:'2026-10-20T01:00:00Z'};
const contextState={config:{name:tour.name,start_time:tour.start_time,buy_in:tour.buy_in,rake_amount:tour.rake_amount,service_fee_amount:tour.service_fee_amount,
 guarantee_amount:null,starting_stack:tour.starting_stack,location:'',description:'',game_type:tour.game_type,minutes_per_level:tour.minutes_per_level,late_reg_close_level:tour.late_reg_close_level},
 levels:[],lifecycle:{club_id:tour.club_id,status:'active',live_status:'registering'}};
const contextReply=(args:Record<string,unknown>)=>({data:{ok:true,tournament_id:args.p_tournament_id,club_id:tour.club_id,actor_id:args.p_expected_actor_id,can_edit_blinds:h.canEditBlinds,state:contextState},error:null});
const ack=(r:Record<string,unknown>)=>({ok:true,tournament_id:r.p_tournament_id,club_id:r.p_club_id,actor_id:r.p_expected_actor_id,request_id:r.p_request_id,
 state:{...contextState,config:r.p_config,levels:r.p_levels===null?[]:(r.p_levels as object[]).map((level,i)=>({...level,tournament_id:tour.id,id:`e1200000-0000-4000-8000-${String(i+11).padStart(12,'0')}`}))}});
beforeEach(()=>{localStorage.clear();h.updates=[];h.saved={name:'TEST original'};h.hang=false;h.canEditBlinds=true;h.error.mockClear();h.success.mockClear();h.rpc.mockReset();
  h.rpc.mockImplementation((name,args)=>name==='get_tournament_edit_context_v1'?Promise.resolve(contextReply(args))
   :name==='get_tournament_edit_receipt_v1'?Promise.resolve({data:{ok:false,error:'receipt_not_found'},error:null})
   :h.hang?new Promise(()=>{}):Promise.resolve({data:null,error:{code:'P0001',message:'TEST blind replacement failure'}}));
  h.auth={user:{id:'e1200000-0000-4000-8000-000000000001'},session:{access_token:'TEST-edit-session'}};
});
afterEach(cleanup);
async function open(ready=true){fireEvent.click(screen.getByRole('button',{name:'Sửa thông tin giải'}));
 if(ready)await waitFor(()=>expect(screen.getByRole('button',{name:/Save Changes|Kiểm tra lần lưu trước/})).toBeEnabled());
 return screen.getByRole('dialog');}
describe('actual shared tournament edit integrity',()=>{
  it('allows verified config-only authority without exposing or replacing blind levels',async()=>{
    h.canEditBlinds=false;const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation((name,args)=>name==='edit_tournament_with_levels_v1'?Promise.resolve({data:ack(args),error:null}):normal(name,args));
    const saved=vi.fn();render(<EditTournamentDialog tournament={tour} onSaved={saved}/>);await open();
    expect(screen.queryByRole('option',{name:'TEST edit levels'})).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'),{target:{value:'TEST admin config only'}});
    fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    const request=h.rpc.mock.calls.find(([name])=>name==='edit_tournament_with_levels_v1')![1];
    expect(request.p_levels).toBeNull();expect(request.p_config).toMatchObject({buy_in:100000,rake_amount:10000,service_fee_amount:5000,starting_stack:20000});
    expect(h.rpc.mock.calls.some(([name])=>name==='update_blind_structure')).toBe(false);expect(h.updates).toHaveLength(0);
  });
  it('does not leave edited tournament fields saved when blind replacement fails',async()=>{
    const saved=vi.fn();render(<EditTournamentDialog tournament={tour} onSaved={saved}/>);
    const dialog=await open();fireEvent.change(dialog.querySelectorAll('input')[0],{target:{value:'TEST partially saved'}});
    const selects=screen.getAllByRole('combobox');fireEvent.change(selects[selects.length-1],{target:{value:'preset:test'}});
    fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await waitFor(()=>expect(h.error).toHaveBeenCalled());
    expect(h.saved.name).toBe('TEST original');expect(saved).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
    expect(h.rpc.mock.calls.filter(([name])=>name==='edit_tournament_with_levels_v1')).toHaveLength(1);
    expect(h.rpc.mock.calls.some(([name])=>name==='update_blind_structure')).toBe(false);
  });
  it('fences same-tick double submit before the first response',async()=>{
    h.hang=true;render(<EditTournamentDialog tournament={tour} onSaved={vi.fn()}/>);await open();
    const save=screen.getByRole('button',{name:'Save Changes'});act(()=>{fireEvent.click(save);fireEvent.click(save);});
    await waitFor(()=>expect(h.updates.length+h.rpc.mock.calls.filter(([name])=>!String(name).startsWith('get_')).length).toBe(1));
  });
  it('retires the open edit form immediately when the tournament changes',async()=>{
    const view=render(<EditTournamentDialog tournament={tour} onSaved={vi.fn()}/>);const dialog=await open();
    fireEvent.change(dialog.querySelectorAll('input')[0],{target:{value:'OLD private edit'}});
    view.rerender(<EditTournamentDialog tournament={{...tour,id:'e1200000-0000-4000-8000-000000000099',name:'New tour'}} onSaved={vi.fn()}/>);
    expect(screen.queryByRole('dialog')===null).toBe(true);expect(h.updates).toHaveLength(0);
  });
  it('retires the open edit form on same-actor replacement session',async()=>{
    const view=render(<EditTournamentDialog tournament={tour} onSaved={vi.fn()}/>);await open();
    h.auth={...h.auth,session:{access_token:'TEST-replaced-edit-session'}};
    view.rerender(<EditTournamentDialog tournament={tour} onSaved={vi.fn()}/>);
    expect(screen.queryByRole('dialog')===null).toBe(true);expect(h.updates).toHaveLength(0);
  });
  it('successfully saves every form field and selected blind levels through the atomic receipt',async()=>{
    const normal=h.rpc.getMockImplementation()!;h.rpc.mockImplementation((name,args)=>name==='edit_tournament_with_levels_v1'?Promise.resolve({data:ack(args),error:null}):normal(name,args));
    const saved=vi.fn();render(<EditTournamentDialog tournament={tour} onSaved={saved}/>);await open();
    fireEvent.change(screen.getByLabelText('Name'),{target:{value:'TEST successful edit'}});
    fireEvent.change(screen.getByLabelText('Buy-in (VND)'),{target:{value:'220000'}});
    fireEvent.change(screen.getByLabelText('Rake / phí giải (VND)'),{target:{value:'20000'}});
    fireEvent.change(screen.getByLabelText('Phí dịch vụ (VND)'),{target:{value:'7000'}});
    const selectors=screen.getAllByRole('combobox');fireEvent.change(selectors[selectors.length-1],{target:{value:'preset:test'}});
    fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    const request=h.rpc.mock.calls.find(([name])=>name==='edit_tournament_with_levels_v1')![1];
    expect(request.p_config).toMatchObject({name:'TEST successful edit',buy_in:220000,rake_amount:20000,service_fee_amount:7000,guarantee_amount:null,
      starting_stack:20000,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6,location:'',description:''});
    expect(request.p_levels).toHaveLength(1);expect(h.updates).toHaveLength(0);expect(localStorage.length).toBe(0);
  });
  it('recovers a lost response after remount by reading the same frozen request, without another writer',async()=>{
    let request:Record<string,unknown>|undefined;const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation((name,args)=>{if(name==='edit_tournament_with_levels_v1'){request=args;return Promise.resolve({data:null,error:{message:'lost response'}});}return normal(name,args);});
    const view=render(<EditTournamentDialog tournament={tour} onSaved={vi.fn()}/>);await open();
    fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra lần lưu trước'})).toBeEnabled());
    expect(screen.getByLabelText('Name')).toBeDisabled();expect(localStorage.length).toBe(1);view.unmount();
    h.rpc.mockClear().mockResolvedValue({data:ack(request!),error:null});const saved=vi.fn();
    render(<EditTournamentDialog tournament={tour} onSaved={saved}/>);await open();
    fireEvent.click(screen.getByRole('button',{name:'Kiểm tra lần lưu trước'}));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('get_tournament_edit_receipt_v1',request);expect(h.updates).toHaveLength(0);expect(localStorage.length).toBe(0);
  });
  it('does not convert a blank buy-in to zero or start a writer without a durable journal',async()=>{
    render(<EditTournamentDialog tournament={tour} onSaved={vi.fn()}/>);await open();
    fireEvent.change(screen.getByLabelText('Buy-in (VND)'),{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
    await waitFor(()=>expect(h.error).toHaveBeenCalled());
    expect(h.rpc.mock.calls.filter(([name])=>name==='edit_tournament_with_levels_v1')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Buy-in (VND)'),{target:{value:'100000'}});
    const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('TEST quota blocked');});
    fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await screen.findByRole('alert');spy.mockRestore();
    expect(h.rpc.mock.calls.filter(([name])=>name==='edit_tournament_with_levels_v1')).toHaveLength(0);
  });
  it('keeps a failed context read distinct from an editable empty configuration',async()=>{
    h.rpc.mockResolvedValue({data:null,error:{message:'TEST 503'}});
    render(<EditTournamentDialog tournament={tour} onSaved={vi.fn()}/>);await open(false);
    await screen.findByRole('alert');expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button',{name:'Save Changes'})).toBeDisabled();
    expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['get_tournament_edit_context_v1']);
    h.rpc.mockImplementation((name,args)=>Promise.resolve(contextReply(args)));
    fireEvent.click(screen.getByRole('button',{name:'Tải lại thông tin'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Save Changes'})).toBeEnabled());
    expect(screen.getByLabelText('Name')).toHaveValue('TEST original');expect(h.updates).toHaveLength(0);
  });
  it('reads an existing receipt even when storage cannot accept another write',async()=>{
    let request:Record<string,unknown>|undefined;const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation((name,args)=>{if(name==='edit_tournament_with_levels_v1'){request=args;return Promise.resolve({data:null,error:{message:'lost'}});}return normal(name,args);});
    const saved=vi.fn();render(<EditTournamentDialog tournament={tour} onSaved={saved}/>);await open();
    fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra lần lưu trước'})).toBeEnabled());
    h.rpc.mockClear().mockResolvedValue({data:ack(request!),error:null});
    const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('TEST quota');});
    try{fireEvent.click(screen.getByRole('button',{name:'Kiểm tra lần lưu trước'}));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
      expect(spy).not.toHaveBeenCalled();expect(h.rpc).toHaveBeenCalledExactlyOnceWith('get_tournament_edit_receipt_v1',request);
    }finally{spy.mockRestore();}
  });
  it('only resubmits the exact frozen request on an explicit manual retry',async()=>{
    let request:Record<string,unknown>|undefined;const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation((name,args)=>{if(name==='edit_tournament_with_levels_v1'){request=args;return Promise.resolve({data:null,error:{message:'lost'}});}return normal(name,args);});
    const saved=vi.fn();render(<EditTournamentDialog tournament={tour} onSaved={saved}/>);await open();
    fireEvent.change(screen.getByLabelText('Name'),{target:{value:'TEST frozen intent'}});
    fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Gửi lại đúng yêu cầu cũ'})).toBeEnabled());
    const original=structuredClone(request);h.rpc.mockClear().mockResolvedValue({data:ack(original!),error:null});
    fireEvent.click(screen.getByRole('button',{name:'Gửi lại đúng yêu cầu cũ'}));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('edit_tournament_with_levels_v1',original);expect(localStorage.length).toBe(0);
  });
});
