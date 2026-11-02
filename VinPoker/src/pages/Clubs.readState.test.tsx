import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import Clubs from './Clubs';
const h=vi.hoisted(()=>({read:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{expect(table).toBe('clubs');const q={select:()=>q,eq:()=>q,order:()=>q,abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},then:(resolve:(x:unknown)=>unknown,reject:(e:unknown)=>unknown)=>h.read().then(resolve,reject)};return q;}}}));
beforeEach(()=>{h.read.mockReset().mockResolvedValue({data:[],error:null});h.signals=[];});
afterEach(()=>{cleanup();vi.useRealTimers();});
const mount=()=>render(<MemoryRouter><Clubs/></MemoryRouter>);
it.each([null,{error:{message:'offline'},data:[]}])('does not turn failed or null club reads into an empty list: %j',async(value)=>{
 h.read.mockResolvedValue(value===null?{data:null,error:null}:value);mount();expect(await screen.findByRole('alert')).toBeInTheDocument();
 expect(screen.queryByText('Không có CLB phù hợp với bộ lọc.')).not.toBeInTheDocument();
});
it('distinguishes a valid empty club snapshot',async()=>{mount();expect(await screen.findByText('Không có CLB phù hợp với bộ lọc.')).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();});
it('explicitly retries a rejected read and recovers the original club link',async()=>{
 h.read.mockRejectedValueOnce(new Error('network'));mount();await screen.findByRole('alert');
 h.read.mockResolvedValue({data:[{id:'club-test',name:'Recovered club TEST',address:null,region:null,cover_url:null,rating:0,schedule_sort_order:0}],error:null});
 fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));expect(await screen.findByRole('link')).toHaveAttribute('href','/club/club-test');expect(h.read).toHaveBeenCalledTimes(2);
});
it('times out a hung read and ignores its late snapshot',async()=>{
 vi.useFakeTimers();let resolve!:(x:unknown)=>void;h.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));mount();await act(async()=>{});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(screen.getByRole('alert')).toBeInTheDocument();expect(h.signals[0]?.aborted).toBe(true);
 await act(async()=>{resolve({data:[{id:'late',name:'Late club TEST'}],error:null});});expect(screen.queryByText('Late club TEST')).not.toBeInTheDocument();
});
it('aborts the owned club read after unmount',async()=>{h.read.mockImplementationOnce(()=>new Promise(()=>{}));const view=mount();await act(async()=>{});view.unmount();expect(h.signals[0]?.aborted).toBe(true);});
