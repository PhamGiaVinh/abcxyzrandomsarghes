// GET-only anonymous alias/shape probe on the designated campaign TEST tournament.
// No tokens, connection strings, row contents, player or financial data are logged.
import {readFileSync} from 'node:fs';

const target='https://orlesggcjamwuknxwcpk.supabase.co';
const tournament='5540693c-5701-41e8-85d3-601d9f1a8812';
try {
  const base=new URL(process.env.VITE_SUPABASE_URL ?? '');
  const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  if(base.origin!==target||base.protocol!=='https:')throw Error('wrong_project');
  const legacy=key.split('.');
  const anon=key.startsWith('sb_publishable_') || (legacy.length===3
    && JSON.parse(Buffer.from(legacy[1],'base64url').toString()).role==='anon');
  if(!anon)throw Error('anonymous_public_key_required');
  const source=readFileSync(new URL('../../src/hooks/useTournaments.ts',import.meta.url),'utf8');
  const projections=[...source.matchAll(/\.select\(\s*`([\s\S]*?)`\s*\)/g)].slice(0,2);
  if(projections.length!==2)throw Error('actual_reader_projections_missing');
  for(const [index,match] of projections.entries()){
    const url=new URL('/rest/v1/tournaments',target);
    url.search=new URLSearchParams({select:match[1].replace(/\s+/g,''),id:`eq.${tournament}`,limit:'1'}).toString();
    const response=await fetch(url,{method:'GET',headers:{apikey:key},signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok){
      console.log(JSON.stringify({reader:index,status:response.status,code:typeof data.code==='string'?data.code:'unavailable'}));
      process.exitCode=1;continue;
    }
    if(!Array.isArray(data)||data.length!==1||!Array.isArray(data[0].tournament_tables))throw Error('test_tournament_not_visible_or_malformed');
    const links=data[0].tournament_tables;
    const canonical=links.filter(link=>link.game_table_id!=null);
    const matched=canonical.filter(link=>link.canonical_game_table?.id===link.game_table_id);
    console.log(JSON.stringify({reader:index,status:response.status,tournaments:data.length,links:links.length,
      canonicalLinks:canonical.length,matchedCanonicalJoins:matched.length,legacyNullLinks:links.filter(link=>link.table_id==null).length}));
    if(!canonical.length||matched.length!==canonical.length)process.exitCode=1;
  }
  const backend=readFileSync(new URL('../../supabase/functions/process-swing/passes/passR-rotation-planner.ts',import.meta.url),'utf8');
  const projection=backend.match(/\.select\("(id, table_id, game_table_id, table_session_id, status, tournament_id, tournaments!inner[^\"]+)"\)/)?.[1];
  if(!projection)throw Error('actual_backend_projection_missing');
  const url=new URL('/rest/v1/tournament_tables',target);
  url.search=new URLSearchParams({select:projection,tournament_id:`eq.${tournament}`,status:'eq.active',limit:'3'}).toString();
  const response=await fetch(url,{method:'GET',headers:{apikey:key},signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok||!Array.isArray(data)||!data.length)throw Error('backend_test_projection_unavailable');
  const valid=data.filter(row=>row.table_session_id&&row.game_table_id&&row.status==='active'
    &&!Array.isArray(row.tournaments)&&row.tournaments?.id===tournament&&row.tournaments?.club_id);
  console.log(JSON.stringify({reader:'backend-inner',status:response.status,links:data.length,validSessionJoinShapes:valid.length}));
  if(valid.length!==data.length)process.exitCode=1;
}catch{
  console.error('Anonymous read probe unavailable; no credentials or response data printed.');
  process.exitCode=1;
}
