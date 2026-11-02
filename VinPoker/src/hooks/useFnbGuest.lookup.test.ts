import {createElement,type PropsWithChildren} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{fnbGuestOrder:true}}));
import {useFnbGuestLookup} from './useFnbGuest';
const item={id:'10000000-0000-4000-8000-000000000003',name:'TEST coffee',category_id:null,image_url:null,price_vnd:10000,sort_order:0};
const valid={status:'ok',club_name:'TEST club',table_name:'TEST table',bank_available:false,categories:[],items:[item]};
let client:QueryClient;
function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0,retryDelay:1}}});return renderHook(()=>useFnbGuestLookup('LOCAL-TEST344'),{wrapper:({children}:PropsWithChildren)=>createElement(QueryClientProvider,{client},children)});}
afterEach(()=>{cleanup();client?.clear();rpc.mockReset();});
it.each([null,{...valid,items:null},{...valid,items:[{...item,price_vnd:null}]},{...valid,items:[{...item,price_vnd:1.5}]},{...valid,items:[item,item]},{...valid,status:'error'}])('rejects unverified menu %j',async data=>{
 rpc.mockResolvedValue({data,error:null});const {result}=mount();
 await waitFor(()=>expect(result.current.isError).toBe(true));expect(result.current.data).toBeUndefined();
});
it('keeps valid zero distinct from invalid price and permits empty menu',async()=>{
 rpc.mockResolvedValueOnce({data:{...valid,items:[{...item,price_vnd:0}]},error:null});const {result}=mount();
 await waitFor(()=>expect(result.current.isSuccess).toBe(true));expect(result.current.data?.items[0].price_vnd).toBe(0);
 rpc.mockResolvedValueOnce({data:{...valid,items:[]},error:null});await result.current.refetch();
 await waitFor(()=>expect(result.current.data?.items).toEqual([]));
});
