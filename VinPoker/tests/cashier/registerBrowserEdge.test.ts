import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {runRegisterBrowserEdge} from './registerBrowserEdge.local.mjs';
const tour='11111111-1111-4111-8111-111111111111',club='22222222-2222-4222-8222-222222222222';
const bank='33333333-3333-4333-8333-333333333333';
beforeEach(()=>vi.stubEnv('VINPOKER_NATIVE_BROWSER','1'));
afterEach(()=>vi.unstubAllEnvs());
it.each(['exclusive','cross-club-duplicate','foreign-only'])('models global SePay account exclusivity (%s)',async(mode)=>{
 const queries:string[]=[];
 const sql=(query:string)=>{
  queries.push(query);
  if(query==='SELECT current_database();')return 'vinpoker_ops_cash115_qualified_c';
  if(query.includes("extname='pg_net'"))return 'f';
  if(query.includes('FROM public.tournaments'))return JSON.stringify([{id:tour,club_id:club,name:'TEST',buy_in:100000,rake_amount:0}]);
  if(query.includes('FROM public.cashier_tour_settings'))return JSON.stringify([{enabled:true}]);
  if(query.includes('FROM public.club_payment_config'))return JSON.stringify([{master_account_number:'LOCAL_TEST_ACCOUNT'}]);
  if(query.includes('FROM public.platform_bank_accounts')){
   if(query.includes('SELECT bank_bin'))return JSON.stringify([{bank_bin:'LOCAL_TEST_BIN'}]);
   const own={id:bank,club_id:club,bank_name:'LOCAL_TEST',account_number:'LOCAL_TEST_ACCOUNT',account_holder:'TEST',qr_code_url:null};
   return JSON.stringify(mode==='exclusive'?[own]:mode==='foreign-only'?[{...own,club_id:'44444444-4444-4444-8444-444444444444'}]
    :[own,{...own,id:'55555555-5555-4555-8555-555555555555',club_id:'44444444-4444-4444-8444-444444444444'}]);
  }
  if(query.includes('cashier_create_app_registration_v1'))return JSON.stringify({ok:true,already_registered:true,registration_id:'existing-test',status:'pending',reference_code:'FROZEN_TEST',total_pay:100000,buy_in:100000,platform_fixed_fee:0,price_snapshot:{rake:0,service_fee:0}});
  throw new Error('Unexpected TEST SQL shape');
 };
 const result=await runRegisterBrowserEdge({body:{tournament_id:tour},fixture:{tour,club},user:{id:'local-test-player'},sql,log:[]});
 expect(result.status).toBe(mode==='exclusive'?200:500);
 const body=await result.json();
 if(mode==='exclusive')expect(body).toMatchObject({success:true,already_registered:true,registration_id:'existing-test',total_pay:100000});
 else expect(body.error).toBe('SePay master account is not exclusive to this club');
 const accountQuery=queries.find(query=>query.includes('FROM public.platform_bank_accounts')&&query.includes('account_number='));
 expect(accountQuery).toBeDefined();
 expect(accountQuery).not.toContain(`club_id='${club}'`);
 expect(queries.filter(query=>query.includes('cashier_create_app_registration_v1'))).toHaveLength(mode==='exclusive'?1:0);
});
