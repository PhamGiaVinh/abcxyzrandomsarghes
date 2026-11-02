import {useEffect,useState} from 'react';
import {createClient,type Session} from '@supabase/supabase-js';
import type {Database} from '@/integrations/supabase/types';
import {SupabaseClientProvider} from '@/integrations/supabase/SupabaseClientContext';
import {MultiDayFloorEventWorkspace} from '@/components/floor/MultiDayFloorEventPanel';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {Button} from '@/components/ui/button';
const endpoint='http://127.0.0.1:54330',event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
const actor='675fe35e-60a8-4452-bb90-e79486d54da6';
/** Explicit disposable clone, separate SDK storage/endpoint; no production auth or payment. */
export default function PrizeConfigurationNativePreview(){
 const [client]=useState(()=>createClient<Database>(endpoint,'native-config217-clone-test-key',{
  auth:{storageKey:'vinpoker-config217-disposable-clone',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},
 }));
 const [session,setSession]=useState<Session|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 useEffect(()=>{let live=true;void (async()=>{
  const {data,error}=await client.auth.getSession();
  if(error){if(live)setError(error.message);return;}
  if(!data.session)return;
  const verified=await client.auth.getUser();
  if(live)setSession(verified.data.user?.id===actor&&!verified.error?data.session:null);
 })().catch(()=>{if(live)setError('Không xác minh được session clone; đăng nhập lại TEST.');});return()=>{live=false;};},[client]);
 const login=async()=>{
  if(busy)return;setBusy(true);setError(null);
  try{
   const response=await fetch(endpoint+'/__local/session',{method:'POST'});if(!response.ok)throw Error('Clone session unavailable');
   const packet=await response.json();const {data,error}=await client.auth.setSession(packet);
   if(error)throw error;if(data.session?.user.id!==actor)throw Error('Clone actor mismatch');setSession(data.session);
  }catch(cause){setError(cause instanceof Error?cause.message:'Không kết nối được clone local.');}
  finally{setBusy(false);}
 };
 const dropNext=async()=>{
  if(!session)return;
  const response=await fetch(endpoint+'/__local/drop-next',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}});
  if(response.ok)setNotice('Chỉ phản hồi lần lưu kế tiếp sẽ bị ngắt SAU COMMIT trên clone.');else setError('Không bật được fault local.');
 };
 if(!import.meta.env.DEV||window.location.hostname!=='127.0.0.1'||import.meta.env.VITE_SUPABASE_URL!=='http://127.0.0.1:54329')
  return <p role="alert">Disposable clone chỉ được dùng trong local TEST.</p>;
 return <main className="mx-auto max-w-3xl space-y-3 p-4">
  <h1>Payout · disposable clone local</h1>
  <p>DB bản sao riêng; đăng nhập và chứng từ ngân hàng (nếu bật fixture GTD) được mô hình hóa, không có chuyển tiền thật. RPC cấu hình/overlay/chốt nghĩa vụ dùng PostgreSQL thật. Không thanh toán.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!session?<Button type="button" disabled={busy} onClick={()=>void login()}>Đăng nhập owner TEST clone</Button>
   :session.user.id!==actor?<p role="alert">Sai actor TEST; không mở writer.</p>:<>
    <Button type="button" variant="outline" onClick={()=>void dropNext().catch(()=>setError('Fault local unavailable'))}>Ngắt phản hồi lưu kế tiếp sau commit</Button>
    <SupabaseClientProvider client={client} backendScope={endpoint}>
     <MultiDayFloorEventWorkspace eventId={event} actorId={actor} sessionEpoch={sessionReadEpoch(session)} surface="payout"/>
    </SupabaseClientProvider>
   </>}
 </main>;
}
