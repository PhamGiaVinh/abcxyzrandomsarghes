import React from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/integrations/supabase/types';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {SupabaseClientProvider} from '@/integrations/supabase/SupabaseClientContext';
import '@/index.css';
declare global {interface Window {__expenseCashInput:{club:string;actor:string;jwt:string;from:string;to:string}}}
const input=window.__expenseCashInput;
const auth={user:{id:input.actor},session:{access_token:input.jwt},loading:false};
export const useAuth=()=>auth;
export const supabase=createClient<Database>('http://127.0.0.1:23870','synthetic-loopback-key',{
 global:{headers:{Authorization:`Bearer ${input.jwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
});
async function start(){
 // Only this owned, loopback fixture adopts the client presentation flag.
 const {FEATURES}=await import('../../src/lib/featureFlags');
 if(!Reflect.set(FEATURES,'clubExpenseCashSource',true))throw Error('TEST presentation adoption failed');
 const {default:CashierExpenseEntry}=await import('../../src/components/clubExpenses/CashierExpenseEntry');
 const {default:CashierCashflowPanel}=await import('../../src/ops/finance/CashierCashflowPanel');
 const {useClubExpenses}=await import('../../src/hooks/clubExpenses/useClubExpenses');
 const ExpenseSummary=()=>{const query=useClubExpenses('live',input.club,input.from,input.to);return <section aria-label="Chi phí đã ghi nhận">{query.error?<p role="alert">Không xác minh được chi phí</p>:query.data?<p data-testid="expense-total">{query.data.totalVnd}</p>:<p>Đang đọc chi phí</p>}</section>;};
 const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
 createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><SupabaseClientProvider client={supabase}>
  <main className="mx-auto max-w-xl p-3"><h1 className="mb-4 text-lg font-bold">TEST · Khoản chi mới từ két</h1>
   <CashierExpenseEntry clubId={input.club} allowNew/>
   <ExpenseSummary/>
   <CashierCashflowPanel clubId={input.club} range={{from:input.from,to:input.to}}/>
  </main>
 </SupabaseClientProvider></QueryClientProvider>);
}
void start();
