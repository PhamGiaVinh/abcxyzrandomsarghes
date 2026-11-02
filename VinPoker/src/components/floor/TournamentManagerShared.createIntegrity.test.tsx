import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

const fixture=vi.hoisted(()=>({parents:[] as unknown[],levelWrites:0,error:vi.fn(),success:vi.fn(),rpc:vi.fn(),session:null as {access_token:string}|null,flags:{blindTemplates:true,multiDayTournaments:false,tournamentServiceFee:false}}));
vi.mock('sonner',()=>({toast:{error:fixture.error,success:fixture.success}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:fixture.flags}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor-test'},session:fixture.session})}));
vi.mock('@/components/FomoPrice',()=>({FomoPrice:()=>null}));
vi.mock('@/components/LiveStateEditor',()=>({LiveStateEditor:()=>null}));
vi.mock('@/components/cashier/tournament-live/BlindEditorPanel',()=>({BlindEditorPanel:()=>null}));
vi.mock('@/components/cashier/tournament-live/BlindDraftBuilder',()=>({BlindDraftBuilder:()=>null}));
vi.mock('@/lib/blindPresets',()=>({BLIND_PRESETS:[{key:'test',name:'TEST levels',levels:[{level_number:1,small_blind:100,big_blind:200,ante:0,duration_minutes:20,is_break:false}]}]}));
vi.mock('@/components/ui/select',()=>({
  Select:({value,onValueChange,children}:{value:string;onValueChange:(v:string)=>void;children:React.ReactNode})=><select value={value} onChange={event=>onValueChange(event.target.value)}>{children}</select>,
  SelectItem:({value,children}:{value:string;children:React.ReactNode})=><option value={value}>{children}</option>,
  SelectContent:({children}:{children:React.ReactNode})=><>{children}</>,
  SelectGroup:({children}:{children:React.ReactNode})=><>{children}</>,
  SelectTrigger:()=>null,SelectValue:()=>null,SelectLabel:()=>null,
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:fixture.rpc,from:(table:string)=>{
  const query={select:()=>query,eq:()=>query,order:()=>Promise.resolve({data:[],error:null}),
    insert:(payload:unknown)=>{
      if(table==='tournaments'){fixture.parents.push(payload);return query;}
      fixture.levelWrites++;return Promise.resolve({data:null,error:{message:'injected level insert failure'}});
    },single:()=>Promise.resolve({data:{id:'created-test'},error:null})};return query;
}}}));
import {NewTournamentDialog} from './TournamentManagerShared';

beforeEach(()=>{fixture.parents=[];fixture.levelWrites=0;fixture.session=null;fixture.flags.multiDayTournaments=false;fixture.flags.tournamentServiceFee=false;localStorage.clear();vi.clearAllMocks();
 fixture.rpc.mockReset().mockResolvedValue({data:null,error:{code:'P0001',message:'injected level insert failure'}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

function openForm(onCreated=vi.fn()){
 render(<NewTournamentDialog clubs={[{id:'club-test',name:'TEST'}]} defaultClubId='club-test' multiClub={false} lockMode='single' onCreated={onCreated}/>);
 fireEvent.click(screen.getByRole('button',{name:'Tạo giải thường'}));
 const inputs=screen.getByRole('dialog').querySelectorAll('input');
 fireEvent.change(inputs[0],{target:{value:'TEST atomic creation'}});
 fireEvent.change(inputs[1],{target:{value:'2026-10-20T12:00'}});
 const selectors=screen.getAllByRole('combobox');
 fireEvent.change(selectors[selectors.length-1],{target:{value:'preset:test'}});
 return onCreated;
}
const receipt=(request:Record<string,unknown>)=>({ok:true,tournament_id:'e9100000-0000-4000-8000-000000000031',
 actor_id:request.p_expected_actor_id,club_id:request.p_club_id,request_id:request.p_request_id,
 level_count:(request.p_levels as unknown[]).length});

it('does not leave a tournament parent committed when its selected blind levels fail',async()=>{
  const onCreated=vi.fn();
  render(<NewTournamentDialog clubs={[{id:'club-test',name:'TEST'}]} defaultClubId='club-test' multiClub={false} lockMode='single' onCreated={onCreated}/>);
  fireEvent.click(screen.getByRole('button',{name:'Tạo giải thường'}));
  const dialog=screen.getByRole('dialog');
  const inputs=dialog.querySelectorAll('input');
  fireEvent.change(inputs[0],{target:{value:'TEST atomic creation'}});
  fireEvent.change(inputs[1],{target:{value:'2026-10-20T12:00'}});
  const selectors=screen.getAllByRole('combobox');
  fireEvent.change(selectors[selectors.length-1],{target:{value:'preset:test'}});
  fireEvent.click(screen.getByRole('button',{name:'Create'}));
  await waitFor(()=>expect(fixture.error).toHaveBeenCalled());
  expect(fixture.parents).toHaveLength(0);
  expect(onCreated).not.toHaveBeenCalled();
  expect(fixture.success).not.toHaveBeenCalled();
});

it('creates parent and selected levels through one request and blocks double click',async()=>{
 let respond!:(value:unknown)=>void;
 fixture.rpc.mockReturnValue(new Promise(resolve=>{respond=resolve;}));
 const onCreated=openForm();
 fireEvent.click(screen.getByRole('button',{name:'Create'}));
 fireEvent.click(screen.getByRole('button',{name:'Đang tạo…'}));
 expect(fixture.rpc).toHaveBeenCalledTimes(1);
 const [name,request]=fixture.rpc.mock.calls[0];
 expect(name).toBe('create_tournament_with_levels_v1');
 expect(request.p_config).toMatchObject({buy_in:1000000,rake_amount:0,starting_stack:20000,guarantee_amount:null});
 expect(request.p_levels).toHaveLength(1);expect(fixture.parents).toHaveLength(0);
 respond({data:receipt(request),error:null});
 await waitFor(()=>expect(onCreated).toHaveBeenCalledTimes(1));
 expect(localStorage.length).toBe(0);
});

it('retains an unknown request over remount and reads its original receipt without another writer',async()=>{
 fixture.rpc.mockResolvedValueOnce({data:null,error:{message:'response lost'}})
  .mockResolvedValueOnce({data:{ok:false,error:'receipt_not_found'},error:null});
 const onCreated=openForm();
 fireEvent.click(screen.getByRole('button',{name:'Create'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'createAtomic.check'})).toBeEnabled());
 const request=fixture.rpc.mock.calls[0][1];
 expect(localStorage.length).toBe(1);expect(onCreated).not.toHaveBeenCalled();
 cleanup();fixture.rpc.mockClear().mockResolvedValue({data:receipt(request),error:null});
 render(<NewTournamentDialog clubs={[]} defaultClubId='club-test' multiClub={false} lockMode='single' onCreated={onCreated}/>);
 fireEvent.click(screen.getByRole('button',{name:'Tạo giải thường'}));
 fireEvent.click(screen.getByRole('button',{name:'createAtomic.check'}));
 await waitFor(()=>expect(onCreated).toHaveBeenCalledTimes(1));
 expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('get_tournament_create_receipt_v1',request);
 expect(localStorage.length).toBe(0);
});

it('does not send a writer if the request cannot be durably saved',async()=>{
 openForm();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage blocked');});
 fireEvent.click(screen.getByRole('button',{name:'Create'}));
 await waitFor(()=>expect(fixture.error).toHaveBeenCalledWith('createAtomic.storageError'));
 expect(fixture.rpc).not.toHaveBeenCalled();expect(fixture.parents).toHaveLength(0);
});

it('keeps a confirmed commit successful if journal cleanup fails',async()=>{
 fixture.rpc.mockImplementation(async(_name,request)=>({data:receipt(request),error:null}));
 const onCreated=openForm();
 vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw new Error('cleanup blocked');});
 fireEvent.click(screen.getByRole('button',{name:'Create'}));
 await waitFor(()=>expect(onCreated).toHaveBeenCalledTimes(1));
 expect(fixture.success).toHaveBeenCalled();expect(fixture.error).not.toHaveBeenCalled();
 expect(localStorage.length).toBe(1);expect(fixture.rpc).toHaveBeenCalledTimes(1);
});

it('explicit retry checks the receipt then reuses the original payload despite edited fields',async()=>{
 fixture.rpc.mockResolvedValueOnce({data:null,error:{message:'response lost'}})
  .mockResolvedValueOnce({data:{ok:false,error:'receipt_not_found'},error:null});
 const onCreated=openForm();fireEvent.click(screen.getByRole('button',{name:'Create'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'createAtomic.retry'})).toBeEnabled());
 const request=fixture.rpc.mock.calls[0][1];
 fireEvent.change(screen.getByRole('dialog').querySelectorAll('input')[0],{target:{value:'must not replace original request'}});
 fixture.rpc.mockClear().mockResolvedValueOnce({data:{ok:false,error:'receipt_not_found'},error:null})
  .mockResolvedValueOnce({data:receipt(request),error:null});
 fireEvent.click(screen.getByRole('button',{name:'createAtomic.retry'}));
 await waitFor(()=>expect(onCreated).toHaveBeenCalledTimes(1));
 expect(fixture.rpc.mock.calls).toEqual([
  ['get_tournament_create_receipt_v1',request],['create_tournament_with_levels_v1',request],
 ]);
 expect(localStorage.length).toBe(0);
});

it('discards late success after moving to another club',async()=>{
 let respond!:(value:unknown)=>void;
 fixture.rpc.mockReturnValue(new Promise(resolve=>{respond=resolve;}));
 const onCreated=vi.fn();
 const view=render(<NewTournamentDialog clubs={[]} defaultClubId='club-test' multiClub={false} lockMode='single' onCreated={onCreated}/>);
 fireEvent.click(screen.getByRole('button',{name:'Tạo giải thường'}));
 const inputs=screen.getByRole('dialog').querySelectorAll('input');
 fireEvent.change(inputs[0],{target:{value:'TEST'}});fireEvent.change(inputs[1],{target:{value:'2026-10-20T12:00'}});
 fireEvent.click(screen.getByRole('button',{name:'Create'}));
 const request=fixture.rpc.mock.calls[0][1];
 view.rerender(<NewTournamentDialog clubs={[]} defaultClubId='other-club' multiClub={false} lockMode='single' onCreated={onCreated}/>);
 respond({data:receipt(request),error:null});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Create'})).toBeEnabled());
 expect(onCreated).not.toHaveBeenCalled();expect(fixture.success).not.toHaveBeenCalled();
});

function openMainEvent(onCreated=vi.fn()){
 fixture.flags.multiDayTournaments=true;
 render(<NewTournamentDialog clubs={[]} defaultClubId='club-test' multiClub={false} lockMode='multi' onCreated={onCreated}/>);
 fireEvent.click(screen.getByRole('button',{name:'Create Multi-day'}));
 const dialog=screen.getByRole('dialog');
 fireEvent.change(dialog.querySelectorAll('input')[0],{target:{value:'TEST Main Event'}});
 const dates=dialog.querySelectorAll('input[type="datetime-local"]');
 fireEvent.change(dates[0],{target:{value:'2026-10-20T12:00'}});
 fireEvent.change(dates[1],{target:{value:'2026-10-22T12:00'}});
 return onCreated;
}
const eventReceipt=(request:Record<string,unknown>)=>({ok:true,
 event_id:'e9100000-0000-4000-8000-000000000041',
 final_tournament_id:'e9100000-0000-4000-8000-000000000042',
 actor_id:request.p_expected_actor_id,club_id:request.p_club_id,request_id:request.p_request_id,
 flight_count:(request.p_config as Record<string,unknown>).flight_count,
 level_count:(request.p_levels as unknown[]).length});

it('Main Event uses keyed atomic create and a synchronous guard for two same-tick clicks',async()=>{
 let respond!:(value:unknown)=>void;
 fixture.rpc.mockReturnValue(new Promise(resolve=>{respond=resolve;}));
 const onCreated=openMainEvent();
 const create=screen.getByRole('button',{name:'Create'});
 act(()=>{fireEvent.click(create);fireEvent.click(create);});
 expect(fixture.rpc).toHaveBeenCalledTimes(1);
 const [name,request]=fixture.rpc.mock.calls[0];
 expect(name).toBe('create_tournament_event_with_flights_v2');
 expect(request.p_config).toMatchObject({name:'TEST Main Event',flight_count:3});
 expect(localStorage.length).toBe(1);
 respond({data:eventReceipt(request),error:null});
 await waitFor(()=>expect(onCreated).toHaveBeenCalledOnce());
 expect(localStorage.length).toBe(0);
});

it('Main Event lost response remount reads the original receipt without another create',async()=>{
 fixture.rpc.mockResolvedValueOnce({data:null,error:{message:'response lost'}})
  .mockResolvedValueOnce({data:{ok:false,error:'receipt_not_found'},error:null});
 const onCreated=openMainEvent();
 fireEvent.click(screen.getByRole('button',{name:'Create'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'createAtomic.check'})).toBeEnabled());
 const request=fixture.rpc.mock.calls[0][1];
 expect(localStorage.length).toBe(1);expect(onCreated).not.toHaveBeenCalled();
 cleanup();fixture.rpc.mockClear().mockResolvedValue({data:eventReceipt(request),error:null});
 render(<NewTournamentDialog clubs={[]} defaultClubId='club-test' multiClub={false} lockMode='multi' onCreated={onCreated}/>);
 fireEvent.click(screen.getByRole('button',{name:'Create Multi-day'}));
 fireEvent.click(screen.getByRole('button',{name:'createAtomic.check'}));
 await waitFor(()=>expect(onCreated).toHaveBeenCalledOnce());
 expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('get_tournament_event_create_receipt_v1',request);
 expect(localStorage.length).toBe(0);
});

it('Main Event explicit retry checks receipt then reuses stored flights and dates despite edits',async()=>{
 fixture.rpc.mockResolvedValueOnce({data:null,error:{message:'response lost'}})
  .mockResolvedValueOnce({data:{ok:false,error:'receipt_not_found'},error:null});
 const onCreated=openMainEvent();fireEvent.click(screen.getByRole('button',{name:'Create'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'createAtomic.retry'})).toBeEnabled());
 const request=fixture.rpc.mock.calls[0][1];
 fireEvent.change(screen.getByRole('dialog').querySelectorAll('input')[0],{target:{value:'different event must not be created'}});
 fixture.rpc.mockClear().mockResolvedValueOnce({data:{ok:false,error:'receipt_not_found'},error:null})
  .mockResolvedValueOnce({data:eventReceipt(request),error:null});
 fireEvent.click(screen.getByRole('button',{name:'createAtomic.retry'}));
 await waitFor(()=>expect(onCreated).toHaveBeenCalledOnce());
 expect(fixture.rpc.mock.calls).toEqual([['get_tournament_event_create_receipt_v1',request],['create_tournament_event_with_flights_v2',request]]);
});

it('Main Event old session completion cannot close or report success in a replacement session',async()=>{
 let respond!:(value:unknown)=>void;
 fixture.rpc.mockReturnValue(new Promise(resolve=>{respond=resolve;}));
 const onCreated=openMainEvent();fireEvent.click(screen.getByRole('button',{name:'Create'}));
 const request=fixture.rpc.mock.calls[0][1];
 fixture.session={access_token:'LOCAL_TEST_REPLACEMENT_NOT_A_CREDENTIAL'};
 // Re-render through the same mounted dialog without replacing its local state.
 act(()=>{fireEvent.change(screen.getByRole('dialog').querySelectorAll('input')[0],{target:{value:'replacement session'}});});
 await act(async()=>{respond({data:eventReceipt(request),error:null});});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Create'})).toBeEnabled());
 expect(onCreated).not.toHaveBeenCalled();expect(fixture.success).not.toHaveBeenCalled();
 expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('Main Event retains the visible service fee and descriptive fields in its exact create intent',async()=>{
 fixture.flags.tournamentServiceFee=true;
 fixture.rpc.mockImplementation(async(_name,request)=>({data:eventReceipt(request),error:null}));
 const onCreated=openMainEvent();
 fireEvent.change(screen.getByText('Phí dịch vụ (VND)').nextElementSibling!,{target:{value:'5000'}});
 fireEvent.change(screen.getByText('Location').nextElementSibling!,{target:{value:'TEST room A'}});
 fireEvent.change(screen.getByText('Description').nextElementSibling!,{target:{value:'Two TEST flights and a final'}});
 fireEvent.change(screen.getByText('mainEventCreate.guaranteeLabel').nextElementSibling!,{target:{value:'2500000'}});
 fireEvent.click(screen.getByRole('button',{name:'Create'}));
 await waitFor(()=>expect(onCreated).toHaveBeenCalledOnce());
 expect(fixture.rpc.mock.calls[0][1].p_config).toMatchObject({
  service_fee_amount:5000,guarantee_amount:2500000,location:'TEST room A',description:'Two TEST flights and a final',
 });
});

it.each(['-1','0.5','9007199254740992'])('Main Event rejects invalid whole-VND guarantee %s before saving or writing',async value=>{
 openMainEvent();
 await act(async()=>{
  fireEvent.change(screen.getByText('mainEventCreate.guaranteeLabel').nextElementSibling!,{target:{value}});
  fireEvent.click(screen.getByRole('button',{name:'Create'}));
 });
 expect(fixture.error).toHaveBeenCalledWith('mainEventCreate.invalidMoney');
 expect(fixture.rpc).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});

it.each(['-1','0.5','9007199254740992'])('single-day rejects invalid whole-VND guarantee %s without replacing it with missing GTD',async value=>{
 openForm();
 await act(async()=>{
  fireEvent.change(screen.getByText('GTD cam kết (VND)').nextElementSibling!,{target:{value}});
  fireEvent.click(screen.getByRole('button',{name:'Create'}));
 });
 expect(fixture.rpc).not.toHaveBeenCalled();
 expect(localStorage.length).toBe(0);
 expect(fixture.error).toHaveBeenCalledWith('mainEventCreate.invalidMoney');
 expect(screen.getByText('GTD cam kết (VND)').nextElementSibling).toHaveValue(Number(value));
 expect(screen.getByRole('alert')).toHaveTextContent('mainEventCreate.invalidMoney');
});

it.each([['',null],['0',0],['2500000',2500000]] as const)('single-day preserves the GTD distinction %s',async(value,expected)=>{
 fixture.rpc.mockImplementation(async(_name,request)=>({data:receipt(request),error:null}));
 const onCreated=openForm();
 fireEvent.change(screen.getByText('GTD cam kết (VND)').nextElementSibling!,{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'Create'}));
 await waitFor(()=>expect(onCreated).toHaveBeenCalledOnce());
 expect(fixture.rpc.mock.calls[0][1].p_config.guarantee_amount).toBe(expected);
});
