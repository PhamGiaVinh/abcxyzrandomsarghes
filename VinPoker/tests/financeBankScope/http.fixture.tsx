import React,{useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import type {SupabaseClient} from '@supabase/supabase-js';
type Input={clubA:string;clubB:string;admin:string;owner:string;adminToken:string;ownerToken:string};
declare global{interface Window{__bankInput:Input}}
const input=window.__bankInput;
let auth={user:{id:input.admin},session:{access_token:input.adminToken},loading:false,
 isAdmin:true,isClubAdmin:false,isClubOwner:false,isCashier:false,isAccountant:false};
const listeners=new Set<()=>void>();
export function useAuth(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>{listeners.delete(cb);};},()=>auth);}
let client:SupabaseClient|undefined,lastToken='';
function currentClient(){
 const token=auth.session.access_token;
 if(!client||lastToken!==token){lastToken=token;client=createClient('http://127.0.0.1:23865','synthetic-local-key',{
  global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
 });}return client;
}
export const supabase={from:(name:string)=>currentClient().from(name)};
export const compressImage=()=>{throw Error('real storage upload outside bank scope fixture');};
export const toast={success:()=>{document.getElementById('result')!.textContent='Đã lưu';},error:()=>{document.getElementById('result')!.textContent='Chưa lưu';}};
// Exported aliases above are fixture-only. The actual component talks to real
// PostgREST through Vite's loopback proxy; no mocked account data is provided.
export async function start(){
 const {ClubBankAccountManager}=await import('../../src/components/ClubBankAccountManager');
 const App=()=>{
  const [club,setClub]=useState(input.clubA);
  return <main className="p-3 max-w-3xl mx-auto">
   <p>TEST tách biệt · cấu hình nhận tiền · API/DB thật</p>
   <nav className="flex flex-wrap gap-3 my-3">
    <button onClick={()=>setClub(input.clubA)}>CLB A</button><button onClick={()=>setClub(input.clubB)}>CLB B</button>
    <button onClick={()=>{auth={...auth,user:{id:input.owner},session:{access_token:input.ownerToken},isAdmin:false,isClubOwner:true};listeners.forEach(cb=>cb());}}>Đăng nhập chủ A</button>
   </nav><output id="result"/><ClubBankAccountManager clubId={club}/>
  </main>;
 };
 createRoot(document.getElementById('root')!).render(<App/>);
}
