import {useEffect,useState} from 'react';
import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

type Kind='club'|'tournament'|'series';
export type ExpenseAttribution={tournamentId?:string;seriesId?:string;attachmentUrl?:string};
const targetsPacket=z.array(z.object({id:z.string().uuid(),club_id:z.string().uuid(),name:z.string().min(1)}));

export function ExpenseAttributionFields({clubId,value,onChange,locked=false,onReadyChange}:{
 clubId:string;value:ExpenseAttribution;onChange:(value:ExpenseAttribution)=>void;locked?:boolean;onReadyChange?:(ready:boolean)=>void;
}){
 const {user,session,loading}=useAuth();
 const kind:Kind=value.tournamentId?'tournament':value.seriesId?'series':'club';
 const [requestedKind,setRequestedKind]=useState<Kind>(kind),[search,setSearch]=useState('');
 const [result,setResult]=useState<{scope:string;rows:z.infer<typeof targetsPacket>;error:boolean}|null>(null);
 const scope=JSON.stringify([clubId,user?.id,sessionReadEpoch(session),requestedKind,search,loading]);
 useEffect(()=>{
  if(requestedKind==='club'||locked||loading||!user?.id||!session?.access_token)return;
  let current=true;
  const timer=setTimeout(()=>{void(async()=>{
   try{
    if(!z.string().uuid().safeParse(clubId).success)throw Error('invalid club');
    const table=requestedKind==='tournament'?'tournaments':'tournament_series';
    const {data,error}=await supabase.from(table).select('id,club_id,name').eq('club_id',clubId)
     .ilike('name',`%${search.trim().replace(/[\\%_]/g,'\\$&')}%`).order('name').limit(51);
    if(error)throw Error('target read refused');
    const rows=targetsPacket.parse(data);
    if(rows.some(row=>row.club_id!==clubId)||new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('target scope invalid');
    if(current)setResult({scope,rows,error:false});
   }catch{if(current)setResult({scope,rows:[],error:true});}
  })();},250);
  return()=>{current=false;clearTimeout(timer);};
 },[clubId,user?.id,session,loading,requestedKind,search,scope,locked]);
 const ready=result?.scope===scope,resultRows=ready?result.rows:[],selected=value.tournamentId??value.seriesId??'';
 const canSubmit=requestedKind==='club'||(locked&&!!selected)||(ready&&!result?.error&&resultRows.some(row=>row.id===selected));
 useEffect(()=>{onReadyChange?.(canSubmit);},[onReadyChange,canSubmit]);
 return <div className="min-w-0 space-y-3 rounded-lg border border-border p-3">
  <p className="text-sm font-semibold">Liên kết khoản chi</p>
  <p className="text-xs text-muted-foreground">Chi phí chung giữ ở CLB. Chỉ chọn giải hoặc series khi có chứng từ cho phạm vi đó.</p>
  <div className="space-y-1.5">
   <Label htmlFor="expense-allocation">Phạm vi khoản chi</Label>
   <select id="expense-allocation" className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm" disabled={locked}
    value={requestedKind} onChange={event=>{onReadyChange?.(event.target.value==='club');setRequestedKind(event.target.value as Kind);setSearch('');onChange({attachmentUrl:value.attachmentUrl});}}>
    <option value="club">Chi phí chung của CLB</option><option value="tournament">Một giải</option><option value="series">Một series</option>
   </select>
  </div>
  {requestedKind!=='club'&&<>
   {!locked&&<div className="space-y-1.5"><Label htmlFor="expense-target-search">Tìm tên {requestedKind==='tournament'?'giải':'series'}</Label>
    <Input id="expense-target-search" value={search} maxLength={60} onChange={event=>setSearch(event.target.value)} placeholder="Nhập tên để tìm trong CLB này"/></div>}
   <div className="space-y-1.5"><Label htmlFor="expense-target">{requestedKind==='tournament'?'Giải nhận chi phí':'Series nhận chi phí'}</Label>
    <select id="expense-target" required disabled={locked||!ready||!!result?.error} className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
     value={selected} onChange={event=>onChange({...value,tournamentId:requestedKind==='tournament'?event.target.value||undefined:undefined,seriesId:requestedKind==='series'?event.target.value||undefined:undefined})}>
     <option value="">{!ready?'Đang tải danh sách…':'Chọn phạm vi có chứng từ'}</option>
     {locked&&selected&&<option value={selected}>Liên kết đã giữ trong yêu cầu chờ</option>}
     {resultRows.slice(0,50).map(row=><option value={row.id} key={row.id}>{row.name}</option>)}
    </select>
   </div>
   {ready&&result?.error&&<p role="alert" className="text-sm text-destructive">Chưa xác minh được danh sách. Không chọn dữ liệu từ CLB khác; đổi phạm vi rồi thử lại.</p>}
   {ready&&!result?.error&&resultRows.length===0&&<p className="text-xs text-muted-foreground">Không tìm thấy tên phù hợp trong CLB này.</p>}
   {resultRows.length>50&&<p className="text-xs text-muted-foreground">Có hơn 50 kết quả; nhập thêm tên để thu hẹp.</p>}
  </>}
  <div className="space-y-1.5"><Label htmlFor="expense-evidence">Đường dẫn chứng từ (nếu có)</Label>
   <Input id="expense-evidence" type="url" inputMode="url" disabled={locked} value={value.attachmentUrl??''} onChange={event=>onChange({...value,attachmentUrl:event.target.value||undefined})} placeholder="https://…"/>
   <p className="text-xs text-muted-foreground">Lưu liên kết HTTPS, không tự tải chứng từ hoặc xác nhận đã thanh toán.</p>
  </div>
 </div>;
}
export function ExpenseAttributionSummary({row}:{row:ExpenseAttribution}){
 const validId=(value:string|undefined)=>value&&z.string().uuid().safeParse(value).success;
 let evidence:string|null=null;
 try{if(row.attachmentUrl){const url=new URL(row.attachmentUrl);if(url.protocol==='https:'&&!url.username&&!url.password)evidence=url.href;}}catch{/* Legacy unsafe links are not opened. */}
 return <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs">
  {validId(row.tournamentId)&&<a className="text-primary underline underline-offset-2" href={`/tournament/${row.tournamentId}`}>Mở giải đã liên kết</a>}
  {validId(row.seriesId)&&<a className="text-primary underline underline-offset-2" href={`/series/${row.seriesId}`}>Mở series đã liên kết</a>}
  {evidence&&<a className="text-primary underline underline-offset-2" href={evidence} target="_blank" rel="noopener noreferrer">Xem chứng từ</a>}
  {row.attachmentUrl&&!evidence&&<span className="text-muted-foreground">Liên kết chứng từ cần kiểm tra</span>}
 </div>;
}
