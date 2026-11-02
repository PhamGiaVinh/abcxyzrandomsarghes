import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Link,MemoryRouter,Route,Routes} from 'react-router-dom';
import {ErrorBoundary} from 'react-error-boundary';
const h=vi.hoisted(()=>({read:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
 const filters:Record<string,string>={};const q={select:()=>q,eq:(key:string,value:string)=>{filters[key]=value;return q;},gte:()=>q,order:()=>q,maybeSingle:()=>q,abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve(h.read(table,filters)).then(resolve,reject)};return q;
}}}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{clubSeriesSchedule:true}}));
import ClubDetail from './ClubDetail';
const row=(id='club-a')=>({id,name:id==='club-a'?'Club A':'Club B',region:'TEST',daily_schedule_image_url:null,weekly_schedule_image_url:null});
const normal=(table:string,filters:Record<string,string>)=>({data:table==='clubs'?row(filters.id):[],error:null});
beforeEach(()=>{h.signals=[];h.read.mockReset().mockImplementation(normal);});afterEach(()=>{cleanup();vi.useRealTimers();});
const mount=()=>render(<MemoryRouter initialEntries={['/club/club-a']}><Link to="/club/club-b">Other club</Link><ErrorBoundary fallback={<div data-testid="club-render-crash"/>}><Routes><Route path="/club/:id" element={<ClubDetail/>}/></Routes></ErrorBoundary></MemoryRouter>);
const tour=()=>({id:'tour-a',club_id:'club-a',name:'Tour TEST',start_time:'2026-10-27T12:00:00Z',buy_in:100000});
it.each([null,{...tour(),id:''},{...tour(),name:{bad:true}},{...tour(),start_time:'bad-date'},{...tour(),club_id:'club-b'}])('rejects a malformed or mis-scoped tour row: %j',async(value)=>{
 h.read.mockImplementation((table:string,filters:Record<string,string>)=>table==='tournaments'?{data:[value],error:null}:normal(table,filters));mount();await screen.findByRole('alert');expect(screen.queryByTestId('club-render-crash')).toBeNull();expect(screen.queryByText('clubsPage.noTournaments')).toBeNull();expect(screen.queryByRole('link',{name:/Tour TEST/})).toBeNull();expect(screen.getByText('Club A')).toBeInTheDocument();
});
it('keeps a valid native-shaped tour and its deep link available',async()=>{
 h.read.mockImplementation((table:string,filters:Record<string,string>)=>table==='tournaments'?{data:[tour()],error:null}:normal(table,filters));mount();expect(await screen.findByRole('link',{name:/Tour TEST/})).toHaveAttribute('href','/tournament/tour-a');expect(screen.queryByRole('alert')).toBeNull();
});
it('shows unavailable rather than not-found for a failed club read, then retries',async()=>{
 h.read.mockImplementation((table:string,filters:Record<string,string>)=>table==='clubs'?{data:null,error:{message:'503'}}:normal(table,filters));mount();
 await screen.findByRole('alert');expect(screen.queryByText('clubsPage.clubNotFound')).toBeNull();
 h.read.mockImplementation(normal);fireEvent.click(screen.getByRole('button',{name:'clubDetailRead.retry'}));await screen.findByText('Club A');expect(screen.queryByRole('alert')).toBeNull();
});
it('keeps a verified club visible when tours fail and does not claim an empty tour list',async()=>{
 h.read.mockImplementation((table:string,filters:Record<string,string>)=>table==='tournaments'?{data:null,error:{message:'503'}}:normal(table,filters));mount();
 await screen.findByText('Club A');await screen.findByRole('alert');expect(screen.queryByText('clubsPage.noTournaments')).toBeNull();
});
it('reports malformed tours instead of an empty list',async()=>{
 h.read.mockImplementation((table:string,filters:Record<string,string>)=>table==='tournaments'?{data:null,error:null}:normal(table,filters));mount();await screen.findByRole('alert');expect(screen.queryByText('clubsPage.noTournaments')).toBeNull();
});
it('reports a gallery failure without hiding the verified club and tour result',async()=>{
 h.read.mockImplementation((table:string,filters:Record<string,string>)=>table==='club_series_images'?{data:null,error:{message:'503'}}:normal(table,filters));mount();await screen.findByText('Club A');await screen.findByRole('alert');expect(screen.getByText('clubsPage.noTournaments')).toBeInTheDocument();
});
it('bounds a hung club read and aborts owned requests',async()=>{
 vi.useFakeTimers();h.read.mockImplementation((table:string,filters:Record<string,string>)=>table==='clubs'?new Promise(()=>{}):normal(table,filters));mount();await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(screen.getByRole('alert')).toBeInTheDocument();expect(h.signals.some(s=>s.aborted)).toBe(true);expect(screen.queryByText('clubsPage.clubNotFound')).toBeNull();
});
it('clears the old club on navigation and ignores its late gallery response',async()=>{
 let oldGallery!:(value:unknown)=>void,newClub!:(value:unknown)=>void;
 h.read.mockImplementation((table:string,filters:Record<string,string>)=>table==='club_series_images'&&filters.club_id==='club-a'?new Promise(resolve=>{oldGallery=resolve;}):table==='clubs'&&filters.id==='club-b'?new Promise(resolve=>{newClub=resolve;}):normal(table,filters));
 mount();await screen.findByText('Club A');fireEvent.click(screen.getByRole('link',{name:'Other club'}));expect(screen.queryByText('Club A')).toBeNull();
 await act(async()=>{});await act(async()=>{newClub({data:row('club-b'),error:null});});await screen.findByText('Club B');await act(async()=>{oldGallery({data:[{image_url:'/stale.png',caption:'Old gallery'}],error:null});});expect(screen.queryByText('Club A')).toBeNull();expect(screen.queryByText('Old gallery')).toBeNull();
});
it('reserves not-found for a verified null club response',async()=>{
 h.read.mockImplementation((table:string,filters:Record<string,string>)=>table==='clubs'?{data:null,error:null}:normal(table,filters));mount();await screen.findByText('clubsPage.clubNotFound');expect(screen.queryByRole('alert')).toBeNull();
});
