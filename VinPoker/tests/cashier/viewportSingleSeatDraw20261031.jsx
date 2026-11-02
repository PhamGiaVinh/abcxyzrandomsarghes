// Local opt-in native rollback host only. No product route or mocked results.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SeatDrawDialog} from '@/components/cashier/tournament-live/SeatDrawDialog';
import {SupabaseClientProvider} from '@/integrations/supabase/SupabaseClientContext';
import {supabase} from '@/integrations/supabase/client';
import '@/index.css';
function App(){
 const[d,setD]=React.useState(null);const[open,setOpen]=React.useState(true);
 React.useEffect(()=>{fetch('/__fixture').then(r=>r.json()).then(setD);},[]);
 return d?<><p>LOCAL TEST · native PostgreSQL · rollback after verification</p><SeatDrawDialog open={open} onOpenChange={setOpen} tournamentId={d.tour} tournamentName={d.name} tournamentDate={d.start} registrations={d.registrations} onDone={()=>{}}/></>:null;
}
createRoot(document.getElementById('root')).render(<SupabaseClientProvider client={supabase}><App/></SupabaseClientProvider>);
