import {useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {Button} from '@/components/ui/button';
import {fnbStockInJournalKey} from '@/lib/fnbStockInIntent';

/** Explicit DEV-only browser lock barrier; never changes a journal or submits a stock RPC. */
export function StockInLockTestGate({clubId}:{clubId:string}){
  const {user}=useAuth();
  let name='';try{if(user)name=fnbStockInJournalKey(user.id,clubId,import.meta.env.VITE_SUPABASE_URL);}catch{/* Show unavailable below. */}
  const gate=useMemo(()=>({name,live:false,release:null as null|(()=>void)}),[name]);
  const [phase,setPhase]=useState('idle'),[snapshot,setSnapshot]=useState<{held:number;pending:number}|null>(null);
  useEffect(()=>{gate.live=true;return()=>{gate.live=false;gate.release?.();gate.release=null;};},[gate]);
  const take=async()=>{
    if(!name||!navigator.locks?.request||phase==='held'||phase==='waiting')return;
    setPhase('waiting');
    try{await navigator.locks.request(name,async()=>{
      if(!gate.live)return;setPhase('held');
      await new Promise<void>(resolve=>{gate.release=resolve;});gate.release=null;
      if(gate.live)setPhase('released');
    });}catch{if(gate.live)setPhase('unavailable');}
  };
  const inspect=async()=>{
    if(!name||!navigator.locks?.query)return;
    try{const result=await navigator.locks.query();if(gate.live)setSnapshot({held:result.held?.filter(x=>x.name===name).length??0,pending:result.pending?.filter(x=>x.name===name).length??0});}
    catch{if(gate.live)setPhase('unavailable');}
  };
  return <section className="space-y-2 rounded border border-border p-3 text-sm">
    <p>Điểm đồng bộ khóa nhập kho TEST local · {phase}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={!name||phase==='held'||phase==='waiting'} onClick={()=>void take()}>Giữ khóa nhập kho TEST local</Button>
      <Button variant="outline" disabled={phase!=='held'} onClick={()=>gate.release?.()}>Thả khóa nhập kho TEST local</Button>
      <Button variant="outline" onClick={()=>void inspect()}>Đọc trạng thái khóa TEST</Button>
    </div>
    {snapshot&&<p data-testid="stock-lock-counts">Khóa đang giữ: {snapshot.held} · Đang chờ: {snapshot.pending}</p>}
  </section>;
}
