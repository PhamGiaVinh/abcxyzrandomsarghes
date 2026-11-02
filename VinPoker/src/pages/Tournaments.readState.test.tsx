import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {ErrorBoundary} from 'react-error-boundary';
const h=vi.hoisted(()=>({read:vi.fn(),signals:[] as AbortSignal[],features:{clubSeriesSchedule:false}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
 const q={select:()=>q,order:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>q,
  abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},
  then:(resolve:(value:unknown)=>unknown,reject?:(error:unknown)=>unknown)=>Promise.resolve(h.read(table)).then(resolve,reject)};return q;
}}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:null,isAdmin:false})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:h.features}));
vi.mock('@/components/TournamentRegisterModal',()=>({TournamentRegisterModal:()=>null}));
vi.mock('@/components/LivestreamSection',()=>({LivestreamSection:()=>null}));
vi.mock('./News',()=>({default:()=>null}));
vi.mock('@/hooks/useTournamentPackages',()=>({useTournamentPackages:()=>({data:[],isLoading:false})}));
vi.mock('@/components/packages/PackageCard',()=>({default:()=>null}));
vi.mock('@/components/packages/PackageCardSkeleton',()=>({default:()=>null}));
import Tournaments from './Tournaments';
const empty='Chưa có CLB nào tải lên lịch thi đấu.';
beforeEach(()=>{h.features.clubSeriesSchedule=false;h.signals=[];h.read.mockReset().mockImplementation((table:string)=>({data:table==='app_settings'?null:[],error:null}));});
afterEach(()=>{cleanup();vi.useRealTimers();});
const mount=()=>render(<MemoryRouter><Tournaments/></MemoryRouter>);
const validTour={id:'df1e686f-9250-4688-a185-4b8dce5cfc7c',name:'Readable public TEST',start_time:new Date(Date.now()+3600000).toISOString(),
 buy_in:100000,rake_amount:0,starting_stack:20000,current_players:0,current_blinds:null,live_status:'upcoming',clock_started_at:null,
 location:null,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6,club:{id:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',name:'TEST',region:'TEST'}};
it.each([['null',null],['primitive',42],['numeric name',{...validTour,name:42}],['object name',{...validTour,name:{invalid:true}}],['object player count',{...validTour,current_players:{invalid:true}}],['string player count',{...validTour,current_players:'12'}],['array player count',{...validTour,current_players:[12]}]])('rejects a successful tournament array containing %s and recovers on explicit retry',async(_label,badRow)=>{
 h.read.mockImplementation((table:string)=>({data:table==='tournaments'?[badRow]:table==='app_settings'?null:[],error:null}));
 render(<MemoryRouter><ErrorBoundary fallback={<p>schedule-render-crashed</p>}><Tournaments/></ErrorBoundary></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'tournamentsPage.daily'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('publicScheduleRead.error');
 expect(screen.queryByText('schedule-render-crashed')).toBeNull();
 h.read.mockImplementation((table:string)=>({data:table==='tournaments'?[validTour]:table==='app_settings'?null:[],error:null}));
 fireEvent.click(screen.getByRole('button',{name:'publicScheduleRead.retry'}));
 expect(await screen.findByRole('link',{name:validTour.name})).toBeInTheDocument();
 expect(screen.queryByRole('alert')).toBeNull();
});
it('keeps valid public rows usable alongside a legacy null start time',async()=>{
 h.read.mockImplementation((table:string)=>({data:table==='tournaments'?[{...validTour,id:'379abd10-e28f-48c4-b2f4-38aa58554a86',name:'Legacy null time TEST',start_time:null},validTour]:table==='app_settings'?null:[],error:null}));
 mount();fireEvent.click(screen.getByRole('button',{name:'tournamentsPage.daily'}));
 expect(await screen.findByRole('link',{name:validTour.name})).toBeInTheDocument();expect(screen.queryByRole('alert')).toBeNull();
});
it.each(['error','null','reject'])('keeps verified daily and series reads usable after gallery %s',async(failure)=>{
 h.features.clubSeriesSchedule=true;
 h.read.mockImplementation((table:string)=>{
  if(table==='club_series_images'){
   if(failure==='reject')return Promise.reject(new TypeError('offline gallery'));
   return {data:null,error:failure==='error'?{message:'503'}:null};
  }
  return {data:table==='clubs'?[{id:'club',name:'TEST',region:'TEST',daily_schedule_image_url:null,weekly_schedule_image_url:null,schedule_sort_order:1}]:table==='app_settings'?null:[],error:null};
 });
 mount();await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'tournamentsPage.daily'}));
 expect(screen.queryByRole('alert')).toBeNull();
 fireEvent.keyDown(screen.getByRole('button',{name:'tournamentsPage.more'}),{key:'ArrowDown'});
 fireEvent.click(await screen.findByRole('menuitem',{name:'tournamentsPage.series'}));
 expect(screen.queryByRole('alert')).toBeNull();
 expect(h.read.mock.calls.filter(([table])=>table==='tournaments')).toHaveLength(1);
});
it('does not present unavailable clubs as an empty schedule and can retry',async()=>{
 h.read.mockImplementation((table:string)=>table==='clubs'?{data:null,error:{message:'503'}}:{data:table==='app_settings'?null:[],error:null});
 mount();expect(await screen.findByRole('alert')).toHaveTextContent('publicScheduleRead.error');
 expect(screen.queryByText(empty)).toBeNull();
 h.read.mockImplementation((table:string)=>({data:table==='app_settings'?null:[],error:null}));
 fireEvent.click(screen.getByRole('button',{name:'publicScheduleRead.retry'}));
 expect(await screen.findByText(empty)).toBeInTheDocument();expect(screen.queryByRole('alert')).toBeNull();
});
it('reserves the empty schedule for a verified empty response',async()=>{
 mount();expect(await screen.findByText(empty)).toBeInTheDocument();expect(screen.queryByRole('alert')).toBeNull();
});
it('does not let unavailable tournament rows hide a verified weekly club image',async()=>{
 h.read.mockImplementation((table:string)=>table==='tournaments'?{data:null,error:{message:'503'}}:
  {data:table==='clubs'?[{id:'test',name:'TEST CLUB',region:'TEST',weekly_schedule_image_url:'/test.png',daily_schedule_image_url:null,schedule_sort_order:1}]:table==='app_settings'?null:[],error:null});
 mount();expect(await screen.findByText('TEST CLUB')).toBeInTheDocument();expect(screen.queryByRole('alert')).toBeNull();
});
it('bounds a hung read, aborts it and refuses its late empty result',async()=>{
 vi.useFakeTimers();let finish!:(value:unknown)=>void;
 h.read.mockImplementation((table:string)=>table==='clubs'?new Promise(resolve=>{finish=resolve;}):{data:table==='app_settings'?null:[],error:null});
 mount();await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
 expect(screen.getByRole('alert')).toHaveTextContent('publicScheduleRead.error');
 expect(h.signals.some(signal=>signal.aborted)).toBe(true);
 await act(async()=>finish({data:[],error:null}));expect(screen.queryByText(empty)).toBeNull();
});
it('keeps malformed successful club data unavailable',async()=>{
 h.read.mockImplementation((table:string)=>({data:table==='clubs'?null:table==='app_settings'?null:[],error:null}));
 mount();expect(await screen.findByRole('alert')).toHaveTextContent('publicScheduleRead.error');expect(screen.queryByText(empty)).toBeNull();
});
it('catches a rejected transport and allows an explicit successful retry',async()=>{
 h.read.mockRejectedValueOnce(new TypeError('Failed to fetch'));
 mount();expect(await screen.findByRole('alert')).toHaveTextContent('publicScheduleRead.error');
 fireEvent.click(screen.getByRole('button',{name:'publicScheduleRead.retry'}));
 expect(await screen.findByText(empty)).toBeInTheDocument();
});
it('does not flash the empty schedule before the first read resolves',async()=>{
 let finish!:(value:unknown)=>void;
 h.read.mockImplementation((table:string)=>table==='clubs'?new Promise(resolve=>{finish=resolve;}):{data:table==='app_settings'?null:[],error:null});
 mount();expect(screen.queryByText(empty)).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('publicScheduleRead.loading');
 await act(async()=>{await Promise.resolve();finish({data:[],error:null});});
 expect(await screen.findByText(empty)).toBeInTheDocument();
});
it('aborts owned reads on unmount',async()=>{
 h.read.mockImplementation(()=>new Promise(()=>{}));
 const view=mount();view.unmount();expect(h.signals.length).toBe(5);expect(h.signals.every(signal=>signal.aborted)).toBe(true);
});

it('preserves a legacy null player count without converting it to a confirmed zero',async()=>{
 h.read.mockImplementation((table:string)=>({data:table==='tournaments'?[{...validTour,current_players:null}]:table==='app_settings'?null:[],error:null}));
 mount();fireEvent.click(screen.getByRole('button',{name:'tournamentsPage.daily'}));
 expect(await screen.findByRole('link',{name:validTour.name})).toBeInTheDocument();
 expect(screen.queryByRole('alert')).toBeNull();
});
