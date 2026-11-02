import {describe,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';

describe('installed SDK mutation HTTP retry behavior',()=>{
 for(const failure of ['network','503','520'] as const) {
  it(`does not resubmit an RPC POST after ${failure}`,async()=>{
   const fetch=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({p_request_id:'saved-request'});
    if(failure==='network')throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({message:'Outcome unknown'}),{status:Number(failure),headers:{'content-type':'application/json'}});
   });
   const client=createClient('http://127.0.0.1:54329','LOCAL_TEST_KEY',{
    auth:{storageKey:`local-mutation-transport-${failure}`,persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch}});
   const result=await client.rpc('multi_day_record_bag_v1',{p_request_id:'saved-request'});
   expect(result.error).not.toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
  });
 }
});
