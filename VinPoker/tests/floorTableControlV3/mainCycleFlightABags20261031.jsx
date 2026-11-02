// Actual source controls over scoped native RPCs; no synthetic bag/read rows.
import React from 'react';import{createRoot}from'react-dom/client';
import{EndFlightControl}from'@/components/floor/EndFlightControl';
import{MultiDayBaggingPanel}from'@/ops/chip-ops/MultiDayBaggingPanel';
import{SupabaseClientProvider}from'@/integrations/supabase/SupabaseClientContext';
import{clientFor}from'virtual:cyclebag-client';import'@/i18n';import'@/index.css';
const scope=new URL(location.href).searchParams.get('view')==='bag'?'chip':'floor';const client=clientFor(scope);
function App(){const[data,setData]=React.useState(null);const load=React.useCallback(()=>fetch('/__fixture').then(r=>r.json()).then(setData),[]);React.useEffect(()=>{load();},[load]);return data?<main style={{maxWidth:900,margin:'0 auto',padding:12}}><h1>Main actual clock LOCAL TEST · Flight A</h1><p>{scope==='chip'?'Independent Chip Master':'Independent Floor'} · actual native RPCs</p><button onClick={load}>Refresh fixture status</button>{scope==='chip'?<MultiDayBaggingPanel tournamentId={data.flight}/>:<EndFlightControl actorId={data.floor} eventId={data.event} flightId={data.flight} ended={data.ended} canStart={true} blocked={!data.ready||!data.autoOff} onPendingChange={()=>{}} onEnded={load}/>}</main>:null;}
createRoot(document.getElementById('root')).render(<SupabaseClientProvider client={client}><App/></SupabaseClientProvider>);
