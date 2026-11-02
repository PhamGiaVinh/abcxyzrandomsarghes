import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({id:'a',actor:'actor',dynamic:false,read:vi.fn(),rpc:vi.fn(),signals:[] as AbortSignal[],events:[] as Array<()=>void>,tables:[] as string[]}));
vi.mock('react-router-dom',()=>({useParams:()=>({id:h.id}),useNavigate:()=>vi.fn(),useSearchParams:()=>[new URLSearchParams()],Link:({children}:{children:React.ReactNode})=><span>{children}</span>}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string,values?:{n:number}|string)=>typeof values==='string'?values:key==='tournamentDetail.registrationCount'?`Registrations ${values?.n}`:key})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:h.actor?{id:h.actor}:null})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{get dynamicReentry(){return h.dynamic;}}}));
vi.mock('@/components/TournamentRegisterModal',()=>({TournamentRegisterModal:({open,mode}:{open:boolean;mode:string})=>open?<p data-testid="registration-modal" data-mode={mode}/>:null}));
vi.mock('@/components/LivestreamPlayer',()=>({LivestreamPlayer:()=>null}));
vi.mock('@/components/BackButton',()=>({BackButton:()=>null}));
vi.mock('@/components/FomoPrice',()=>({FomoPrice:()=>null}));
vi.mock('@/components/LiveStateBanner',()=>({LiveStateBanner:()=>null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>{const value=Promise.resolve(h.rpc(...args));return Object.assign(value,{abortSignal:()=>value});},from:(table:string)=>{
 const filters:Record<string,unknown>={};const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q;},in:()=>q,is:(key:string,value:unknown)=>{filters[`is:${key}`]=value;return q;},not:(key:string,op:string)=>{filters[`not:${key}`]=op;return q;},order:()=>q,limit:()=>q,maybeSingle:()=>q,
 abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},then:(resolve:(v:unknown)=>unknown,reject?:(v:unknown)=>unknown)=>Promise.resolve(h.read(table,filters)).then(resolve,reject)};return q;
},channel:()=>{const channel={on:(_event:unknown,filter:{table:string},callback:()=>void)=>{h.tables.push(filter.table);h.events.push(callback);return channel;},subscribe:()=>channel};return channel;},removeChannel:vi.fn()}}));
import TournamentDetail from './TournamentDetail';
beforeEach(()=>{h.id='a';h.actor='actor';h.dynamic=false;h.signals=[];h.events=[];h.tables=[];h.rpc.mockReset().mockImplementation(async()=>({data:{ok:true,tournament_id:h.id,registration_count:8,source:'canonical_registration_v1'},error:null}));h.read.mockReset().mockImplementation(async(table:string,filters:Record<string,unknown>)=>({data:table==='tournaments'?{id:filters.id,name:`Tour ${filters.id}`,status:'upcoming',buy_in:100000,starting_stack:20000,start_time:'2026-10-21T10:00:00+07:00'}:null,count:0,error:null}));});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('does not replace the current tournament with a late prior tournament',async()=>{
 const normal=h.read.getMockImplementation()!;let resolve!:(v:unknown)=>void;
 h.read.mockImplementation((table:string,filters:Record<string,unknown>)=>table==='tournaments'&&filters.id==='a'?new Promise(r=>{resolve=r;}):normal(table,filters));
 const view=render(<TournamentDetail/>);await waitFor(()=>expect(h.read).toHaveBeenCalled());
 h.id='b';view.rerender(<TournamentDetail/>);await screen.findByRole('heading',{name:'Tour b'});
 await act(async()=>{resolve({data:{id:'a',name:'Old private a',status:'upcoming',start_time:'2026-10-21'},error:null});});
 expect(screen.getByRole('heading',{name:'Tour b'})).toBeTruthy();expect(screen.queryByText('Old private a')).toBeNull();
});
it('shows read failure instead of claiming a tournament does not exist and can retry',async()=>{
 h.read.mockResolvedValueOnce({data:null,error:{message:'503'}});render(<TournamentDetail/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được thông tin giải');
 expect(screen.queryByText('tournamentDetail.notFound')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));await screen.findByRole('heading',{name:'Tour a'});
});
it('removes prior account registration status immediately on logout',async()=>{
 const normal=h.read.getMockImplementation()!;
 h.read.mockImplementation((table:string,filters:Record<string,unknown>)=>table==='tournament_registrations'?Promise.resolve({data:{id:'reg',status:'confirmed'},error:null}):normal(table,filters));
 const view=render(<TournamentDetail/>);await screen.findByRole('button',{name:/registeredCheckin/});
 h.actor='';view.rerender(<TournamentDetail/>);
 await screen.findByRole('button',{name:'tournamentDetailPage.registerTournament'});
 expect(screen.queryByRole('button',{name:/registeredCheckin/})).toBeNull();
});
it('does not substitute zero for an unavailable registration count',async()=>{
 h.rpc.mockResolvedValueOnce({data:{ok:true,tournament_id:'a',registration_count:null,source:'canonical_registration_v1'},error:null});
 render(<TournamentDetail/>);await screen.findByRole('alert');
 expect(screen.queryByRole('button',{name:'tournamentDetailPage.registerTournament'})).toBeNull();
});
it('shows the server aggregate8 even when the legacy count/manual counter are zero',async()=>{
 render(<TournamentDetail/>);await screen.findByText('Registrations 8');
 expect(h.rpc).toHaveBeenCalledWith('get_public_tournament_registration_summary_v1',{p_tournament_id:'a'});
 expect(h.read.mock.calls.some(([table])=>table==='stack_registrations')).toBe(false);
});
it.each([null,{ok:true,tournament_id:'other',registration_count:8,source:'canonical_registration_v1'},
 {ok:true,tournament_id:'a',registration_count:-1,source:'canonical_registration_v1'},
 {ok:true,tournament_id:'a',registration_count:1.5,source:'canonical_registration_v1'},
 {ok:true,tournament_id:'a',registration_count:8,source:'unknown'}])('rejects an unverified aggregate %j without falling back to legacy zero',async(data)=>{
 h.rpc.mockResolvedValueOnce({data,error:null});render(<TournamentDetail/>);await screen.findByRole('alert');
 expect(screen.queryByText('Registrations 0')).toBeNull();
});
it('shows an unavailable aggregate RPC as a read error, not zero',async()=>{
 h.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202',message:'missing RPC'}});
 render(<TournamentDetail/>);await screen.findByRole('alert');expect(screen.queryByText('Registrations 0')).toBeNull();
});
it('does not offer a new registration when its existing registration read fails',async()=>{
 const normal=h.read.getMockImplementation()!;
 h.read.mockImplementation((table:string,filters:Record<string,unknown>)=>table==='tournament_registrations'?Promise.resolve({data:null,error:{message:'503'}}):normal(table,filters));
 render(<TournamentDetail/>);await screen.findByRole('alert');
 expect(screen.queryByRole('button',{name:'tournamentDetailPage.registerTournament'})).toBeNull();
});
it('shows not-found only after a successful absent tournament response',async()=>{
 h.read.mockResolvedValueOnce({data:null,error:null});render(<TournamentDetail/>);
 await screen.findByText('tournamentDetail.notFound');expect(screen.queryByRole('alert')).toBeNull();expect(h.read).toHaveBeenCalledTimes(1);
});
it('bounds hanging reads, aborts transport and ignores a late result',async()=>{
 vi.useFakeTimers();let resolve!:(value:unknown)=>void;
 h.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 render(<TournamentDetail/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được thông tin giải');
 expect(h.signals[0]?.aborted).toBe(true);
 await act(async()=>{resolve({data:{id:'a',name:'Late tour'},error:null});});
 expect(screen.queryByRole('heading',{name:'Late tour'})).toBeNull();
});
it('coalesces realtime bursts behind the current canonical read',async()=>{
 let resolve!:(value:unknown)=>void;h.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 render(<TournamentDetail/>);await waitFor(()=>expect(h.read).toHaveBeenCalledTimes(1));
 await act(async()=>{h.events[1]();h.events[1]();h.events[1]();});
 expect(h.read).toHaveBeenCalledTimes(1);
 await act(async()=>{resolve({data:{id:'a',name:'Initial a',status:'upcoming',start_time:'2026-10-21'},error:null});});
 await screen.findByRole('heading',{name:'Tour a'});
 expect(h.read.mock.calls.filter(([table])=>table==='tournaments')).toHaveLength(2);
});
it('recovers correctly through StrictMode effect cleanup and setup',async()=>{
 render(<StrictMode><TournamentDetail/></StrictMode>);
 await screen.findByRole('heading',{name:'Tour a'});
});
it('does not require an unused private legacy registration lookup',async()=>{
 const normal=h.read.getMockImplementation()!;
 h.read.mockImplementation((table:string,filters:Record<string,unknown>)=>table==='stack_registrations'&&filters.user_id?Promise.resolve({data:null,error:{message:'legacy unavailable'}}):normal(table,filters));
 render(<TournamentDetail/>);await screen.findByRole('button',{name:'tournamentDetailPage.registerTournament'});
 expect(h.read.mock.calls.some(([table,filters])=>table==='stack_registrations'&&filters.user_id)).toBe(false);
});
it('refreshes canonical registration status after a cashier confirmation notification',async()=>{
 const normal=h.read.getMockImplementation()!;let status='pending';
 h.read.mockImplementation((table:string,filters:Record<string,unknown>)=>table==='tournament_registrations'?Promise.resolve({data:{id:'reg',status},error:null}):normal(table,filters));
 render(<TournamentDetail/>);await screen.findByRole('button',{name:/continuePayment/});
 const index=h.tables.indexOf('tournament_registrations');expect(index).toBeGreaterThanOrEqual(0);
 status='confirmed';await act(async()=>{h.events[index]();});
 await screen.findByRole('button',{name:/registeredCheckin/});expect(screen.queryByRole('button',{name:/continuePayment/})).toBeNull();
});
function reentryState(tour:Record<string,unknown>,pending=false){
 h.dynamic=true;const normal=h.read.getMockImplementation()!;
 h.read.mockImplementation(async(table:string,filters:Record<string,unknown>)=>{
  if(table==='tournaments'){const result=await normal(table,filters);return {...result,data:{...result.data,...tour}};}
  if(table==='tournament_registrations')return {data:filters['not:source_entry_id']?(pending?{id:'pending-reentry',status:'pending'}:null):{id:'initial',status:'confirmed'},error:null};
  if(table==='tournament_entries')return {data:{status:'busted'},error:null};
  return normal(table,filters);
 });
}
it.each([{registration_closed_at:'2026-10-21T12:00:00+07:00'},{live_status:'finished'},{status:'completed'},{status:'cancelled'},{current_level:7,late_reg_close_level:6}])('does not offer new reentry after server-recognized closure %j',async(tour)=>{
 reentryState(tour);render(<TournamentDetail/>);
 expect(await screen.findByRole('status')).toHaveTextContent('Cửa mua lại đã đóng');
 expect(screen.queryByRole('button',{name:'Mua lại'})).toBeNull();
 expect(screen.queryByRole('button',{name:/registeredCheckin/})).toBeNull();
});
it('keeps an existing pending reentry visible but blocks payment bootstrap after closure',async()=>{
 reentryState({registration_closed_at:'2026-10-21T12:00:00+07:00'},true);render(<TournamentDetail/>);
 expect(await screen.findByRole('status')).toHaveTextContent('Yêu cầu mua lại đang chờ');
 expect(screen.queryByRole('button',{name:/Tiếp tục thanh toán/})).toBeNull();
 expect(screen.queryByTestId('registration-modal')).toBeNull();
});
it('preserves open-window reentry and opens the existing modal in reentry mode',async()=>{
 reentryState({current_level:6,late_reg_close_level:6});render(<TournamentDetail/>);
 fireEvent.click(await screen.findByRole('button',{name:'Mua lại'}));
 expect(screen.getByTestId('registration-modal')).toHaveAttribute('data-mode','reentry');
});
it('preserves the existing pending reentry payment bootstrap while the window is open',async()=>{
 reentryState({current_level:2,late_reg_close_level:6},true);render(<TournamentDetail/>);
 fireEvent.click(await screen.findByRole('button',{name:/Tiếp tục thanh toán \(mua lại\)/}));
 expect(screen.getByTestId('registration-modal')).toHaveAttribute('data-mode','reentry');
});
