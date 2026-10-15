import {beforeEach,expect,it,vi} from 'vitest';

const transport=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@/integrations/supabase/client',async()=>{
  const {createClient}=await import('@supabase/supabase-js');
  // Actual SDK, entirely synthetic HTTP transport; never a production project/session.
  return {supabase:createClient('http://127.0.0.1:54321','local-readiness-test-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:transport.fetch},
  })};
});
import {getDealerTourCloseReadiness,getTournamentCloseReadiness} from './feltLifecycleReadiness';

beforeEach(()=>{transport.fetch.mockReset();});
const readiness={ok:true,ready:false,already_closed:false,blockers:['active_hand'],
  entry_count:2,buy_in_total:2000000,cash_in_total:0,prize_total:0,
  club_revenue:-2000000,cashier_balance:0,reconcile_delta:2000000,reconciled:false};

it.each(['dealer','tournament'] as const)('sends %s readiness through the actual SDK without losing receiver',async(kind)=>{
  transport.fetch.mockResolvedValue(new Response(JSON.stringify(readiness),{status:200,headers:{'Content-Type':'application/json'}}));
  const result=kind==='dealer'?await getDealerTourCloseReadiness('tour-test','club-test')
    :await getTournamentCloseReadiness('tour-test');
  expect(result).toMatchObject({ok:true,ready:false,blockers:['active_hand']});
  expect(transport.fetch).toHaveBeenCalledTimes(1);
  const [url,options]=transport.fetch.mock.calls[0] as [string,RequestInit];
  expect(new URL(url).origin).toBe('http://127.0.0.1:54321');
  expect(new URL(url).pathname).toBe(`/rest/v1/rpc/${kind==='dealer'?'get_dealer_tour_close_readiness_v1':'get_tournament_close_readiness_v1'}`);
  expect(options.method).toBe('POST');
  expect(JSON.parse(String(options.body))).toEqual(kind==='dealer'?{p_tour_id:'tour-test',p_club_id:'club-test'}:{p_tournament_id:'tour-test'});
  if(kind==='tournament') expect(result).toMatchObject({clubRevenue:-2000000,reconcileDelta:2000000,reconciled:false});
});

it('preserves server denial and does not retry a denied readiness read',async()=>{
  transport.fetch.mockResolvedValue(new Response(JSON.stringify({message:'permission denied',code:'42501'}),{
    status:403,headers:{'Content-Type':'application/json'},
  }));
  await expect(getDealerTourCloseReadiness('tour-test','club-test')).rejects.toThrow('permission denied');
  expect(transport.fetch).toHaveBeenCalledTimes(1);
});
