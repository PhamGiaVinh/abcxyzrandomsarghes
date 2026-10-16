import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function verifyPaidMemberHistory(sql,tour){
 assert.equal(process.env.VINPOKER_NATIVE_PAID_TOUR,'1');
 assert.ok(process.env.VINPOKER_NATIVE_PAID_HISTORY==='1'||process.env.VINPOKER_NATIVE_PAID_MEMBER==='1');
 assert.match(tour,/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
 for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}))assert.equal(process.env[k],v);
 for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|17');
 const dir=sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 const scope=JSON.parse(sql(`SELECT jsonb_build_object('actor',c.owner_id,'club',c.id) FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
  JOIN public.club_settings s ON s.club_id=c.id AND s.player_history_enabled AND NOT s.auto_swing_enabled
  WHERE t.id='${tour}' AND t.status='completed' AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST';`));assert.ok(scope.actor&&scope.club);
 const rows=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',e.id,'player',e.player_id,'member',e.member_id,'place',e.finished_place,
  'buy_in',r.buy_in,'total_paid',r.total_pay,'prize',(SELECT p.amount FROM public.tournament_prizes p WHERE p.tournament_id=e.tournament_id AND p.position=e.finished_place)) ORDER BY e.finished_place)
  FROM public.tournament_entries e JOIN public.tournament_registrations r ON r.id=e.registration_id AND r.tournament_id=e.tournament_id
  JOIN public.club_members m ON m.id=e.member_id AND m.club_id='${scope.club}' AND m.player_user_id=e.player_id
  WHERE e.tournament_id='${tour}' AND EXISTS(SELECT 1 FROM public.cashier_buyin_movements p WHERE p.registration_id=r.id AND p.amount>0);`));
 const reentry=process.env.VINPOKER_NATIVE_PAID_REENTRY==='1';
 assert.equal(rows.length,reentry?9:8);assert.deepEqual(rows.filter(r=>r.place!==null).map(r=>r.place),[1,2,3,4,5,6,7,8]);assert.equal(new Set(rows.map(r=>r.member)).size,8);
 if(reentry){
  assert.equal(rows.filter(r=>r.place===null).length,1,'prior bullet must not acquire a second official finishing place');
  const counts=new Map();for(const r of rows)counts.set(r.member,(counts.get(r.member)??0)+1);
  assert.deepEqual([...counts.values()].sort(),[1,1,1,1,1,1,1,2]);
 }
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${tour}'),
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${tour}'),
  'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='${tour}'),
  'proofs',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.tournament_settlement_outcomes o JOIN public.tournament_hands h ON h.id=o.hand_id WHERE h.tournament_id='${tour}'),
  'report',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_close_report r WHERE tournament_id='${tour}'),
  'ledger',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_inventory_ledger l WHERE tournament_id='${tour}'))::text);`),before=fingerprint();
 const read=(actor,member)=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;SELECT public.get_member_history('${member}');COMMIT;`));
 for(let i=0;i<rows.length;i++){
  const expected=rows[i];
  for(const actor of [scope.actor,expected.player]){
   const history=read(actor,expected.member);assert.equal(history.ok,true);assert.ok(Array.isArray(history.entries));
   const entry=history.entries.find(e=>e.entry_id===expected.id);assert.ok(entry,'paid member history must contain exact participation');
   assert.equal(entry.tournament_id,tour);assert.equal(entry.finished_place,expected.place);assert.equal(entry.buy_in,expected.buy_in);assert.equal(entry.total_paid,expected.total_paid);
   assert.equal(entry.prize,expected.prize,'missing official prize must not be invented as zero');
  }
  const other=rows.find(r=>r.member!==expected.member);assert.ok(other);
  const denied=read(expected.player,other.member);assert.equal(denied.ok,false);assert.equal(denied.error,'actor_not_allowed');
 }
 // Foreign club fixture must exist; do not silently omit the tenant negative.
 const foreignRaw=sql(`SELECT jsonb_build_object('member',m.id,'club',c.id) FROM public.club_members m JOIN public.clubs c ON c.id=m.club_id
  JOIN public.profiles p ON p.user_id=m.player_user_id WHERE c.id<>'${scope.club}' AND c.name='Cash identity local TEST' AND p.display_name LIKE 'Paid TEST %' ORDER BY m.id LIMIT 1;`);
 assert.ok(foreignRaw,'owned_cross_club_member_fixture_required');const foreign=JSON.parse(foreignRaw);
 assert.ok(foreign.member&&foreign.club);const cross=read(scope.actor,foreign.member);assert.equal(cross.ok,false);assert.equal(cross.error,'actor_not_allowed');
 assert.equal(sql("SELECT has_function_privilege('anon','public.get_member_history(uuid)','EXECUTE');"),'f');
 assert.equal(fingerprint(),before,'history reads must not mutate entries, cash, hands/proofs/report or chip ledger');
 const observation=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('hand',h.id,'seat',p.seat_number,'starting_stack',p.starting_stack,'ending_stack',p.ending_stack,'bust_order',e.bust_order,'place',e.finished_place) ORDER BY p.seat_number)
  FROM public.tournament_hands h JOIN public.hand_players p ON p.hand_id=h.id JOIN public.tournament_entries e ON e.tournament_id=h.tournament_id AND e.player_id=p.player_id AND e.entry_no=p.entry_number
  WHERE h.tournament_id='${tour}' AND jsonb_array_length(h.community_cards)=5;`));assert.equal(observation.length,8);
 assert.equal(observation.reduce((n,r)=>n+r.starting_stack,0),160000);assert.equal(observation.reduce((n,r)=>n+r.ending_stack,0),160000);
 console.log('NATIVE_SIMULTANEOUS_ELIMINATION_OBSERVATION_NOT_POLICY_ACCEPTANCE',JSON.stringify(observation));
 console.log('NATIVE_PAID_EIGHT_MEMBER_HISTORY_OWNER_SELF_OTHER_MEMBER_TENANT_READONLY_PASS',tour);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.equal(process.env.VINPOKER_NATIVE_PAID_MEMBER,'1');
 const tour=process.argv.find(s=>s.startsWith('--tour='))?.slice('--tour='.length);assert.ok(tour);
 const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql']:[];
 const sql=q=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
 verifyPaidMemberHistory(sql,tour);
}
