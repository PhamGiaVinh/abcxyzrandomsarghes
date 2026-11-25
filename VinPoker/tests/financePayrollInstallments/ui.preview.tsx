import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PtStatementDetailsDialog} from '../../src/components/cashier/PtStatementDetailsDialog';
import {binding,fixture} from './ui.fixture-state';
import '../../src/index.css';

Object.assign(window,{__ptDetailsFixture:fixture});
export function Preview(){
  const [open,setOpen]=useState(false);
  return <main className="operations-typography mx-auto max-w-3xl space-y-4 p-6">
    <p className="text-sm text-muted-foreground">TEST MÔ PHỎNG · chỉ kiểm giao diện · không ghi tiền</p>
    <h1 className="text-xl font-semibold">Tài chính &amp; Đối soát · Lương</h1>
    <button className="min-h-11 rounded border border-border px-4" onClick={()=>setOpen(true)}>Xem phiếu &amp; lịch sử chi</button>
    <PtStatementDetailsDialog statement={binding} open={open} onOpenChange={setOpen}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
