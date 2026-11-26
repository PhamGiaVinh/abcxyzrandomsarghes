import React from 'react';import {createRoot} from 'react-dom/client';import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/integrations/supabase/types';
import {SupabaseClientProvider} from '@/integrations/supabase/SupabaseClientContext';
import '@/index.css';
declare global{interface Window{__ptCashClient:{club:string;dealer:string;actor:string;jwt:string;from:string;to:string}}}
const input=window.__ptCashClient;
const auth={user:{id:input.actor},session:{access_token:input.jwt},loading:false,isCashier:true,isAdmin:false,isClubAdmin:false,isClubOwner:false};
export const useAuth=()=>auth;
export const supabase=createClient<Database>('http://127.0.0.1:23869','synthetic-loopback-key',{
 global:{headers:{Authorization:`Bearer ${input.jwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
});
export async function start(){
 const {PtStatementControl}=await import('../../src/components/cashier/PtStatementControl');
 const {default:CashierCashflowPanel}=await import('../../src/ops/finance/CashierCashflowPanel');
 const App=()=>{const [revision,refresh]=React.useReducer(value=>value+1,0);return <main className="mx-auto max-w-xl p-3">
  <h1 className="text-lg font-bold">TEST · Chi phiếu lương PT</h1>
  <PtStatementControl clubId={input.club} dealerId={input.dealer} dealerName="Dealer TEST" canFinalize={false} onFinalized={refresh}/>
  <CashierCashflowPanel key={revision} clubId={input.club} range={{from:input.from,to:input.to}}/>
 </main>;};
 createRoot(document.getElementById('root')!).render(<SupabaseClientProvider client={supabase}><App/></SupabaseClientProvider>);
}
