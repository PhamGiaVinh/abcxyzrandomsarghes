import {createClient} from '@supabase/supabase-js';
import type {PtStatementBinding} from '../../src/lib/ptStatementDetails';
import type {PtStatementPaymentIntent} from '../../src/lib/ptStatementPayment';
declare global {
  interface Window {__ptHttp:{actor:string;token:string;binding:PtStatementBinding;oldIntent?:PtStatementPaymentIntent;salaryOnly?:boolean}}
}
const context=window.__ptHttp;
if(location.hostname!=='127.0.0.1' || !context) throw Error('ISOLATED_PT_BROWSER_REQUIRED');
export const binding=context.binding;
// Synthetic runner identity only. Real authorization remains in PostgREST/DB.
const auth={user:{id:context.actor},session:{access_token:context.token},loading:false};
export function useAuth(){return auth;}
export function useDealerLink(){return {dealer:{dealerId:binding.dealer_id,clubId:binding.club_id,
  clubName:'PT HTTP TEST',fullName:'PT HTTP TEST dealer'},isDealer:true,loading:false,source:'live'};}
export const supabase=createClient(location.origin,'isolated-public-key',{
  accessToken:async()=>context.token,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
});
