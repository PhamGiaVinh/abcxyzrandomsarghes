import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {createClient} from '@supabase/supabase-js';
import '@/index.css';
declare global{interface Window{__expenseInput:{club:string;owner:string;jwt:string}}}
const input=window.__expenseInput;
const auth={user:{id:input.owner},session:{access_token:input.jwt},loading:false,isClubOwner:true,isAdmin:false,isClubAdmin:false,isCashier:false,isAccountant:false};
export const useAuth=()=>auth;
export const FEATURES={clubExpenses:true,clubExpenseAttribution:true};
export const supabase=createClient('http://127.0.0.1:23866','synthetic-local-key',{global:{headers:{Authorization:`Bearer ${input.jwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
export const toast={success:()=>{document.getElementById('result')!.textContent='Đã ghi';},error:()=>{document.getElementById('result')!.textContent='Chưa xác minh';}};
export async function start(){
 const {ExpenseAttributionSummary}=await import('../../src/components/ExpenseAttributionFields');
 const {ExpenseEntryForm}=await import('../../src/pages/ClubExpenses');
 const {useClubExpenses,useRecordClubExpense}=await import('../../src/hooks/clubExpenses/useClubExpenses');
 const App=()=>{
  const from='2026-11-01T00:00:00Z',to='2026-12-01T00:00:00Z';
  const summary=useClubExpenses('live',input.club,from,to),record=useRecordClubExpense('live',input.club,from,to);
  return <main className="mx-auto max-w-xl p-3"><p className="mb-3 text-sm">TEST tách biệt · chi phí và liên kết</p>
   <output id="result"/><p>Sổ chi phí: <output id="total">{summary.data?.totalVnd??'Chưa xác minh'}</output></p>
   <ExpenseEntryForm key={record.contextKey} clubId={input.club} disabled={!summary.data} pending={record.isPending} preview={false} initialInput={record.pendingInput} onSubmit={record.mutateAsync}/>
   <ul>{summary.data?.rows.map(row=><li key={row.id} className="my-3 break-words text-sm">{row.description}<ExpenseAttributionSummary row={{tournamentId:row.tournamentId??undefined,seriesId:row.seriesId??undefined,attachmentUrl:row.attachmentUrl??undefined}}/></li>)}</ul>
  </main>;
 };
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
}
