// Explicit native rollback fixture; actual form, create journal and RPC code.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {NewTournamentDialog} from '@/components/floor/TournamentManagerShared';
import {SupabaseClientProvider} from '@/integrations/supabase/SupabaseClientContext';
import {supabase} from '@/integrations/supabase/client';
import '@/index.css';
function App(){
 const[data,setData]=React.useState(null);
 const load=()=>fetch('/__fixture').then(r=>r.json()).then(setData);
 React.useEffect(()=>{load();},[]);
 return data?<><p>LOCAL TEST · actual owner form · native PostgreSQL rollback</p><NewTournamentDialog clubs={[]} defaultClubId={data.club} multiClub={false} lockMode="single" onCreated={load}/><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(data.created,null,2)}</pre></>:null;
}
createRoot(document.getElementById('root')).render(<SupabaseClientProvider client={supabase}><App/></SupabaseClientProvider>);
