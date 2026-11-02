import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Narrow extension of the existing browser/PG transport, never a hosted service.
export function createStream579Browser({sql,query,fixture,actor,log}) {
 assert.equal(fixture.tour,'4cd3af4d-7e1d-4042-855f-04fb6777e580');
 assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
 assert.equal(sql(`SELECT count(*) FROM tournaments t JOIN clubs c ON c.id=t.club_id WHERE t.id='${fixture.tour}' AND c.id='${fixture.club}' AND c.owner_id='${actor}';`),'1');
 const id=process.env.VINPOKER_STREAM579_ID??randomUUID();
 assert.match(id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
 const quote=value=>`'${String(value).replaceAll("'","''")}'`;
 const baseline=()=>sql(`SELECT md5(jsonb_build_object(
  'tour',(SELECT to_jsonb(t) FROM tournaments t WHERE id='${fixture.tour}'),
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM cashier_buyin_movements m WHERE tournament_id='${fixture.tour}'),
  'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM tournament_entries e WHERE tournament_id='${fixture.tour}'),
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM tournament_seats s WHERE tournament_id='${fixture.tour}'),
  'prizes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM tournament_prize_payments p WHERE tournament_id='${fixture.tour}'),
  'otherStreams',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM tournament_streams s WHERE id<>'${id}')
 )::text);`);
 const before=baseline();
 const authUsage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
 assert.ok(['t','f'].includes(authUsage));
 // Main Event runFinal is deliberately SELECT-only. Do not weaken it for
 // unrelated stream metadata; execute this one exact RLS update independently.
 const updateAsOwner=statement=>JSON.parse(sql(`BEGIN;
  ${authUsage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
  SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
  ${statement}RESET ROLE;${authUsage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));
 const created=process.env.VINPOKER_STREAM579_ID?query(`SELECT coalesce(jsonb_agg(s),'[]'::jsonb) FROM (SELECT id FROM tournament_streams WHERE id='${id}' AND tournament_id='${fixture.tour}' AND created_by='${actor}' AND title='LOCAL579 stream schedule TEST' AND NOT is_live AND scheduled_at='2026-10-24T10:15:22.123Z') s;`):query(`WITH created AS (INSERT INTO public.tournament_streams(id,tournament_id,platform,stream_url,embed_id,title,is_live,scheduled_at)
  VALUES('${id}','${fixture.tour}','youtube','https://youtube.com/watch?v=abcdefghijk','abcdefghijk','LOCAL579 stream schedule TEST',false,'2026-10-24T10:15:22.123Z') RETURNING id)
  SELECT coalesce(jsonb_agg(created),'[]'::jsonb) FROM created;`);
 assert.deepEqual(created,[{id}]);
 let fault=true;
 return {
  id,
  handle(url,method,body) {
   const table=url.pathname.split('/').at(-1);
   if(!['tournaments','clubs','tournament_streams'].includes(table))return null;
   if(method==='GET'){
    const value=table==='tournaments'?query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (SELECT id,name,club_id,current_players FROM tournaments WHERE id='${fixture.tour}') t;`)
     :table==='clubs'?query(`SELECT coalesce(jsonb_agg(c),'[]'::jsonb) FROM (SELECT id,name FROM clubs WHERE id='${fixture.club}') c;`)
     :query(`SELECT coalesce(jsonb_agg(s),'[]'::jsonb) FROM tournament_streams s WHERE id='${id}';`);
    if(table==='tournament_streams'&&fault){fault=false;log.push({stream579:'read_after_native_503',rows:value.length});return {status:503,value:{message:'LOCAL579_READ_FAULT_AFTER_SQL'}};}
    log.push({stream579:'read',table,rows:value.length});return {status:200,value};
   }
   assert.equal(table,'tournament_streams');assert.equal(method,'PATCH');
   assert.equal(url.searchParams.get('id'),`eq.${id}`);assert.equal(url.searchParams.get('select'),'id');
   assert.deepEqual(Object.keys(body).sort(),['title','stream_url','platform','embed_id','is_live','match_title','scheduled_at','thumbnail_url','tournament_id','custom_tournament_name'].sort());
   assert.equal(body.tournament_id,fixture.tour);assert.equal(body.platform,'youtube');assert.equal(body.is_live,false);
   assert.equal(body.stream_url,'https://youtube.com/watch?v=abcdefghijk');assert.equal(body.thumbnail_url,null);
   assert.equal(body.custom_tournament_name,null);assert.equal(Date.parse(body.scheduled_at),Date.parse('2026-10-24T10:15:22.123Z'));
   const payload=quote(JSON.stringify(body));
   const value=updateAsOwner(`WITH input AS (SELECT * FROM jsonb_populate_record(NULL::public.tournament_streams,${payload}::jsonb)), changed AS (
    UPDATE public.tournament_streams s SET title=i.title,stream_url=i.stream_url,platform=i.platform,embed_id=i.embed_id,is_live=i.is_live,
     match_title=i.match_title,scheduled_at=i.scheduled_at,thumbnail_url=i.thumbnail_url,tournament_id=i.tournament_id,custom_tournament_name=i.custom_tournament_name
    FROM input i WHERE s.id='${id}' RETURNING s.id) SELECT coalesce(jsonb_agg(changed),'[]'::jsonb) FROM changed;`);
   log.push({stream579:'update_native',id,rows:value.length,scheduledAt:body.scheduled_at});return {status:200,value};
  },
  verify(){
   assert.equal(sql("SELECT has_schema_privilege('authenticated','auth','USAGE');"),authUsage);
   assert.equal(baseline(),before,'Main journey/other streams unchanged');
   assert.equal(sql(`SELECT count(*) FROM tournament_streams WHERE id='${id}' AND NOT is_live AND scheduled_at='2026-10-24T10:15:22.123Z' AND created_by='${actor}';`),'1');
   console.log('LOCAL579_MAIN_INVARIANT_STREAM_OFF_EXACT_INSTANT_PASS',id);
  },
 };
}
