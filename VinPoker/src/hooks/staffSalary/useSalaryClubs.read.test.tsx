import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {PropsWithChildren} from 'react';
const f=vi.hoisted(()=>({read:vi.fn(),auth:{user:{id:'owner-a'},session:{access_token:'TEST_CLUBS_A'},loading:false,isAdmin:true,isClubAdmin:false}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>({select:()=>({order:()=>({limit:()=>f.read(table)}),eq:(column:string,id:string)=>f.read(table,{[column]:id}),in:(_column:string,ids:string[])=>f.read(table,{ids})})})}}));
import {useSalaryClubs} from './useStaffSalary';
const clients:QueryClient[]=[];
const rows=[{id:'club-a',name:'LOCAL TEST'}];
function mount(){const c=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(c);return renderHook(()=>useSalaryClubs('live',true),{wrapper:({children}:PropsWithChildren)=><QueryClientProvider client={c}>{children}</QueryClientProvider>});}
beforeEach(()=>{f.read.mockReset();f.auth={user:{id:'owner-a'},session:{access_token:'TEST_CLUBS_A'},loading:false,isAdmin:true,isClubAdmin:false};});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.useRealTimers();});
it('does not treat null club evidence as a verified empty membership list',async()=>{
 f.read.mockResolvedValue({data:null,error:null});const v=mount();await waitFor(()=>expect(v.result.current.isFetching).toBe(false));
 expect(v.result.current.isError).toBe(true);expect(v.result.current.data).toBeUndefined();
});
it('masks clubs during same-actor session refresh and refuses a captured old refetch',async()=>{
 f.read.mockResolvedValueOnce({data:rows,error:null}).mockReturnValueOnce(new Promise(()=>{}));const v=mount();
 await waitFor(()=>expect(v.result.current.data).toHaveLength(1));const stale=v.result.current.refetch;
 f.auth={...f.auth,session:{access_token:'TEST_CLUBS_B'}};v.rerender();expect(v.result.current.data).toBeUndefined();
 await expect(stale()).rejects.toThrow();await waitFor(()=>expect(f.read).toHaveBeenCalledTimes(2));
});
it('bounds a stalled membership read and automatically recovers',async()=>{
 vi.useFakeTimers();f.read.mockReturnValueOnce(new Promise(()=>{})).mockResolvedValue({data:rows,error:null});const v=mount();
 await act(async()=>vi.advanceTimersByTimeAsync(10001));expect(v.result.current.isError).toBe(true);
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(v.result.current.data).toHaveLength(1);
});
it.each([{data:[{id:'club-a',name:null}]},{data:[{id:'club-a',name:'TEST'},{id:'club-a',name:'DUPLICATE'}]}])('rejects malformed or duplicated club rows %j',async({data})=>{
 f.read.mockResolvedValue({data,error:null});const v=mount();await waitFor(()=>expect(v.result.current.isFetching).toBe(false));
 expect(v.result.current.isError).toBe(true);expect(v.result.current.data).toBeUndefined();
});
it('merges owner and accountant clubs without replacing the stronger owner role',async()=>{
 f.auth={...f.auth,isAdmin:false};f.read.mockImplementation((table,args)=>Promise.resolve({error:null,data:table==='club_accountants'?[{club_id:'club-a'},{club_id:'club-b'}]:args?.owner_id?rows:[{id:'club-b',name:'Accountant TEST'}]}));
 const v=mount();await waitFor(()=>expect(v.result.current.isSuccess).toBe(true));
 expect(v.result.current.data).toEqual([{id:'club-b',name:'Accountant TEST',role:'accountant'},{id:'club-a',name:'LOCAL TEST',role:'owner'}]);
 expect(f.read).toHaveBeenCalledWith('clubs',{owner_id:'owner-a'});expect(f.read).toHaveBeenCalledWith('clubs',{ids:['club-b']});
});
it('rejects a returned accountant club outside the requested membership IDs',async()=>{
 f.auth={...f.auth,isAdmin:false};f.read.mockImplementation((table,args)=>Promise.resolve({error:null,data:table==='club_accountants'?[{club_id:'club-b'}]:args?.owner_id?rows:[{id:'other-club',name:'OUTSIDE'}]}));
 const v=mount();await waitFor(()=>expect(v.result.current.isError).toBe(true));expect(v.result.current.data).toBeUndefined();
});
it('does not fall back to owner-only success when accountant membership is unavailable',async()=>{
 f.auth={...f.auth,isAdmin:false};f.read.mockImplementation(table=>Promise.resolve({error:null,data:table==='club_accountants'?null:rows}));
 const v=mount();await waitFor(()=>expect(v.result.current.isError).toBe(true));expect(v.result.current.data).toBeUndefined();
});
