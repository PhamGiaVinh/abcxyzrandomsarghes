import React from 'react';
import {createRoot} from 'react-dom/client';
import {DealerSalaryScreen} from '../../src/components/dealer-app/salary/DealerSalaryScreen';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<main className="operations-typography mx-auto max-w-3xl p-4">
  <p className="mb-4 text-xs">TEST tách biệt · màn nhận lương · dữ liệu giả lập qua RPC thật</p>
  <DealerSalaryScreen/>
</main>);
