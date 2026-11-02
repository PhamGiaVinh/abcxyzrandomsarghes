import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({read:vi.fn(),signals:[] as AbortSignal[]}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'existing-test-actor'},session:null,loading:false})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{const q={select:()=>q,eq:()=>q,order:()=>q,abortSignal:(signal:AbortSignal)=>{h.signals.push(signal);return q;},then:(resolve:(x:unknown)=>unknown,reject:(x:unknown)=>unknown)=>h.read(table).then(resolve,reject)};return q;}}}));
import {useFnbMenu} from './useFnbMenu';
const clients:QueryClient[]=[];
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client);return renderHook(()=>useFnbMenu('existing-club'),{wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});}
beforeEach(()=>{h.read.mockReset().mockResolvedValue({data:[],error:null});h.signals=[];});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.useRealTimers();});
it.each(['fnb_categories','fnb_menu_items','fnb_ingredients'])('rejects null catalogue response rather than claiming empty: %s',async(table)=>{
 h.read.mockImplementation(async(name:string)=>({data:name===table?null:[],error:null}));const view=mount();await waitFor(()=>expect(view.result.current.isFetching).toBe(false));expect(view.result.current.isError).toBe(true);expect(view.result.current.data).toBeUndefined();
});
it('preserves a verified empty catalogue',async()=>{const view=mount();await waitFor(()=>expect(view.result.current.isSuccess).toBe(true));expect(view.result.current.data).toEqual({categories:[],items:[],ingredients:[]});});
it('bounds a stalled read and ignores late rows before manual retry',async()=>{
 vi.useFakeTimers();let finish!:(x:unknown)=>void;h.read.mockImplementation((table:string)=>table==='fnb_menu_items'?new Promise(r=>{finish=r;}):Promise.resolve({data:[],error:null}));const view=mount();await act(async()=>{});
 await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(view.result.current.isError).toBe(true);expect(h.signals.every(s=>s.aborted)).toBe(true);
 await act(async()=>{finish({data:[{id:'late-item'}],error:null});await vi.advanceTimersByTimeAsync(1);});expect(view.result.current.data).toBeUndefined();
 h.read.mockResolvedValue({data:[],error:null});await act(async()=>{await view.result.current.refetch();await vi.advanceTimersByTimeAsync(1);});expect(view.result.current.isSuccess).toBe(true);
});
it('aborts catalogue transports on unmount',async()=>{h.read.mockImplementation(()=>new Promise(()=>{}));const view=mount();await act(async()=>{});view.unmount();expect(h.signals).toHaveLength(3);expect(h.signals.every(s=>s.aborted)).toBe(true);});
