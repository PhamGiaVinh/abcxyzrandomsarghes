import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PtStatementDetailsDialog} from '../../src/components/cashier/PtStatementDetailsDialog';
import {binding} from './http.preview-state';
import '../../src/index.css';
export function Preview(){
  const [open,setOpen]=useState(false);
  return <main className="operations-typography p-4">
    <p>TEST tách biệt · trình duyệt → RPC → DB · không phải xác minh web production</p>
    <button className="min-h-11 border px-4" onClick={()=>setOpen(true)}>Xem phiếu &amp; lịch sử chi</button>
    <PtStatementDetailsDialog statement={binding} open={open} onOpenChange={setOpen}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
