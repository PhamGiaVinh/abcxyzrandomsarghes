import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({actor:'actor-a',reads:[] as ((value:unknown)=>void)[],tables:[] as string[],selects:[] as string[],tourIds:[] as string[],tours:[] as {id:string;name:string;start_time:string;buy_in:number|null;club:{name:string}}[],tourError:false,hideTours:false,deferTours:false,tourReads:[] as ((value:unknown)=>void)[]}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},session:null,loading:false})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
 h.tables.push(table);
 const q={select:(columns:string)=>{h.selects.push(table+':'+columns);return q;},eq:()=>q,order:()=>q,abortSignal:()=>q,in:(_key:string,ids:string[])=>{h.tourIds=ids;return q;},
 then:(resolve:(v:unknown)=>unknown,reject:(v:unknown)=>unknown)=>(table==='tournaments'?(h.deferTours?new Promise(done=>h.tourReads.push(done)):Promise.resolve({data:h.hideTours?[]:h.tours.filter(t=>h.tourIds.includes(t.id)),error:h.tourError?{message:'TEST503'}:null})):new Promise(done=>h.reads.push(done))).then(resolve,reject)};return q;
}}}));
import MyStacks from './MyStacks';
afterEach(()=>{cleanup();h.actor='actor-a';h.reads=[];h.tables=[];h.selects=[];h.tours=[];h.tourIds=[];h.tourError=false;h.hideTours=false;h.deferTours=false;h.tourReads=[];});
const page=()=> <MemoryRouter><MyStacks/></MemoryRouter>;
const row=(name:string)=>{const tournament={id:'tour-'+name,name,start_time:'2026-10-21T00:00:00Z',buy_in:100000,club:{name:'TEST'}};h.tours.push(tournament);return{id:name,status:'confirmed',tournament_id:tournament.id};};
it.each([null,undefined,-1,1.5,Number.MAX_SAFE_INTEGER+1])('does not render invalid frozen total %s as a valid price',async(total)=>{
 render(page());await waitFor(()=>expect(h.reads).toHaveLength(2));
 await act(async()=>{h.reads[0]({data:[],error:null});h.reads[1]({data:[{...row('Invalid price TEST'),total_pay:total,reference_code:'TEST322'}],error:null});});
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách đăng ký');
 expect(screen.queryByText('Invalid price TEST')).toBeNull();
});
it('keeps an explicitly priced zero valid rather than treating it as missing',async()=>{
 render(page());await waitFor(()=>expect(h.reads).toHaveLength(2));
 await act(async()=>{h.reads[0]({data:[],error:null});h.reads[1]({data:[{...row('Zero TEST'),total_pay:0,reference_code:'ZERO322'}],error:null});});
 expect(screen.getByText(/Tổng phải trả:/)).toHaveTextContent('0');
 expect(screen.queryByRole('alert')).toBeNull();
});
it('does not fabricate zero from a missing legacy tournament price',async()=>{
 render(page());await waitFor(()=>expect(h.reads).toHaveLength(2));
 const legacy=row('Legacy missing price TEST');h.tours[0].buy_in=null;await act(async()=>{h.reads[0]({data:[legacy],error:null});h.reads[1]({data:[],error:null});});
 expect(screen.getByText(/Chưa xác minh giá/)).toBeInTheDocument();
});
it('reads current Cashier registrations as well as legacy registrations',async()=>{
 render(page());await waitFor(()=>expect(h.tables).toContain('tournament_registrations'));
 await waitFor(()=>expect(h.reads).toHaveLength(2));
 await act(async()=>{h.reads[0]({data:[],error:null});h.reads[1]({data:[{...row('Paid Cashier TEST'),total_pay:125000,reference_code:'TEST321'}],error:null});});
 expect(await screen.findByText('Paid Cashier TEST')).toBeInTheDocument();
 expect(screen.getByText('Mã đăng ký: TEST321')).toBeInTheDocument();
 expect(screen.getByText(/Tổng phải trả:/)).toHaveTextContent('125.000');
 expect(screen.queryByRole('button',{name:'myStacks.cancelReg'})).toBeNull();
});
it('shows a read error rather than empty registration history and offers retry',async()=>{
 render(page());await waitFor(()=>expect(h.reads).toHaveLength(2));
 await act(async()=>{h.reads[0]({data:null,error:{message:'TEST 503'}});h.reads[1]({data:[],error:null});});
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách đăng ký');
 expect(screen.queryByText('myStacks.empty')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
 await waitFor(()=>expect(h.reads).toHaveLength(4));
 await act(async()=>{h.reads[2]({data:[],error:null});h.reads[3]({data:[],error:null});});
 expect(screen.getByText('myStacks.empty')).toBeInTheDocument();
});
it('does not show the old actor registration after account switch and late response',async()=>{
 const view=render(page());await waitFor(()=>expect(h.reads).toHaveLength(2));
 h.actor='actor-b';view.rerender(page());await waitFor(()=>expect(h.reads).toHaveLength(4));
 await act(async()=>{h.reads[2]({data:[row('Current TEST')],error:null});h.reads[3]({data:[],error:null});});
 await screen.findByText('Current TEST');
 await act(async()=>{h.reads[0]({data:[row('Old private TEST')],error:null});h.reads[1]({data:[],error:null});});
 expect(screen.queryByText('Old private TEST')).toBeNull();
 expect(screen.getByText('Current TEST')).toBeInTheDocument();
});
it('reads referenced tournaments once without requiring registration foreign keys',async()=>{
 render(page());await waitFor(()=>expect(h.reads).toHaveLength(2));
 const registration=row('Referenced TEST');
 await act(async()=>{h.reads[0]({data:[registration],error:null});h.reads[1]({data:[{...registration,id:'cashier-2',total_pay:125000,reference_code:'REF-2'}],error:null});});
 expect(screen.getAllByText('Referenced TEST')).toHaveLength(2);
 expect(h.selects.filter(s=>s.startsWith('stack_registrations:')||s.startsWith('tournament_registrations:')).every(s=>!s.includes('tournaments('))).toBe(true);
 expect(h.tables.filter(t=>t==='tournaments')).toHaveLength(1);
 expect(h.tourIds).toEqual([registration.tournament_id]);
});
it.each(['error','missing'] as const)('does not render a partial registration when its tournament read is %s',async mode=>{
 h.tourError=mode==='error';h.hideTours=mode==='missing';render(page());await waitFor(()=>expect(h.reads).toHaveLength(2));
 await act(async()=>{h.reads[0]({data:[row('Unavailable TEST')],error:null});h.reads[1]({data:[],error:null});});
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách đăng ký');
 expect(screen.queryByText('Unavailable TEST')).toBeNull();
});
it('rejects an unknown status before rendering StatusBadge',async()=>{
 render(page());await waitFor(()=>expect(h.reads).toHaveLength(2));
 await act(async()=>{h.reads[0]({data:[{...row('Unknown status TEST'),status:'invented'}],error:null});h.reads[1]({data:[],error:null});});
 expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách đăng ký');
 expect(h.tables).not.toContain('tournaments');
});
it('ignores a late tournament response after switching actor',async()=>{
 h.deferTours=true;const view=render(page());await waitFor(()=>expect(h.reads).toHaveLength(2));
 const old=row('Old joined TEST');await act(async()=>{h.reads[0]({data:[old],error:null});h.reads[1]({data:[],error:null});});
 await waitFor(()=>expect(h.tourReads).toHaveLength(1));
 h.actor='actor-b';view.rerender(page());await waitFor(()=>expect(h.reads).toHaveLength(4));
 await act(async()=>{h.reads[2]({data:[],error:null});h.reads[3]({data:[],error:null});});
 expect(screen.getByText('myStacks.empty')).toBeInTheDocument();
 await act(async()=>{h.tourReads[0]({data:h.tours,error:null});});
 expect(screen.getByText('myStacks.empty')).toBeInTheDocument();expect(screen.queryByText('Old joined TEST')).toBeNull();
});
