import React from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import CashierDashboard from'@/pages/CashierDashboard';import'@/i18n';import'@/index.css';
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/cashier?tab=pt_wages']}><CashierDashboard/></MemoryRouter>);
