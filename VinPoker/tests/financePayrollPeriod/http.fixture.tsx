import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {BrowserRouter} from 'react-router-dom';
import {createClient} from '@supabase/supabase-js';
import '@/index.css';

declare global {interface Window {__payrollPeriodInput:{owner:string;jwt:string}}}
const input=window.__payrollPeriodInput;
// Only the login/session bootstrap is synthetic; all rights and financial reads use real RPC/RLS.
const auth={user:{id:input.owner},session:{access_token:input.jwt},loading:false,authError:null,
 isClubOwner:true,isAccountant:true,isAdmin:false,isClubAdmin:false,isCashier:false};
export const useAuth=()=>auth;
export const supabase=createClient('http://127.0.0.1:23867','synthetic-local-key',{
 global:{headers:{Authorization:`Bearer ${input.jwt}`}},
 auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
});
export async function start(){
 const {default:AccountantDashboard}=await import('../../src/pages/AccountantDashboard');
 const queryClient=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><BrowserRouter><AccountantDashboard/></BrowserRouter></QueryClientProvider>);
}
