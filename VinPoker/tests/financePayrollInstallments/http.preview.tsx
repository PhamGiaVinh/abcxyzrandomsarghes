import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PtStatementDetailsDialog} from '../../src/components/cashier/PtStatementDetailsDialog';
import {PtStatementControl} from '../../src/components/cashier/PtStatementControl';
import {binding} from './http.preview-state';
import '../../src/index.css';
export function Preview(){
  const [open,setOpen]=useState(false);
  return <main className="operations-typography p-4">
    <p>TEST tách biệt · trình duyệt → RPC → DB · không phải xác minh web production</p>
    <button className="min-h-11 border px-4" onClick={()=>setOpen(true)}>Xem phiếu &amp; lịch sử chi</button>
    <section aria-label="Điều khiển phiếu PT TEST">
      <PtStatementControl clubId={binding.club_id} dealerId={binding.dealer_id} dealerName="PT HTTP TEST dealer" onFinalized={()=>{throw Error('UNEXPECTED_FINANCIAL_ACTION');}}/>
    </section>
    <PtStatementDetailsDialog statement={binding} open={open} onOpenChange={setOpen}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
