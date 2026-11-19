import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import OnlinePokerTable from '@/pages/OnlinePokerTable';

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/poker/table/:tableId" element={<OnlinePokerTable />} />
      </Routes>
    </BrowserRouter>
  </AuthProvider>,
);
