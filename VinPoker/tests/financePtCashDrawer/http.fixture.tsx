import React from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/integrations/supabase/types';
import {SupabaseClientProvider} from '@/integrations/supabase/SupabaseClientContext';
import CashierCashflowPanel from '@/ops/finance/CashierCashflowPanel';
import '@/index.css';
declare global{interface Window{__ptCashInput:{club:string;jwt:string;from:string;to:string}}}
const input=window.__ptCashInput;
const client=createClient<Database>('http://127.0.0.1:23868','synthetic-loopback-key',{
 global:{headers:{Authorization:`Bearer ${input.jwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
});
createRoot(document.getElementById('root')!).render(<SupabaseClientProvider client={client}><main className="mx-auto max-w-5xl p-3"><CashierCashflowPanel clubId={input.club} range={{from:input.from,to:input.to}}/></main></SupabaseClientProvider>);
