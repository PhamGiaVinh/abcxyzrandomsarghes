import React from 'react';
import {createRoot} from 'react-dom/client';
import {PtStatementControl} from '../../src/components/cashier/PtStatementControl';
import {binding} from './http.preview-state';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<main className="operations-typography mx-auto max-w-3xl p-4">
  <p className="mb-4 text-xs">TEST tách biệt · gói chỉ đọc trên schema gốc · không phải production</p>
  <PtStatementControl clubId={binding.club_id} dealerId={binding.dealer_id} dealerName="PT read TEST" canFinalize={false} onFinalized={()=>{throw Error('BROWSER_MUST_NOT_WRITE');}}/>
</main>);
