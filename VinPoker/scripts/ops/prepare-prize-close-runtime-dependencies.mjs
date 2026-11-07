// Reconstruct only missing current payout APIs in the owned HTTP fixture.
// Never replace a captured function or replay the historical migration family.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
const output=process.argv[2];assert.equal(process.argv.length,3);assert.ok(output&&isAbsolute(output));assert.ok(output.endsWith('/prize-close-dependencies.sql'));
const read=file=>readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8').replace(/\r\n?/g,'\n');
const hash=(s,algorithm='sha256')=>createHash(algorithm).update(s).digest('hex');
const source=read('20270128000124_payout_confirmation_integrity_v1.sql');assert.equal(hash(source),'7d92dd475fc6679550bb2d93495fc84452f6867b3a1d280cf8b4baac00268495');
const routeSource=read('20270128000147_multiday_frozen_obligation_payment_v1.sql');assert.equal(hash(routeSource),'5e1768faab611c8688129ee4645a083ec85eb337fe5221183f1d8b402a97be98');
const functions=[
 ['public.get_tournament_payout_recipients','9d03dbdfef22bf26f18aa252261238e6','public.get_tournament_payout_recipients(uuid)','13e7c254ebf5eabe622246759d772c0c','s'],
 ['floor_private.record_prize_payment_v1','283dcf3841b908ee562b08bce77a8920','floor_private.record_prize_payment_v1(uuid,integer,text,text,text,text)','5e7f9c0fbeb616b0473bbacd8e4202fe','v'],
 ['public.record_tournament_prize_payment_v2','9e0a7911a96fee589423e1a3adfd0799','public.record_tournament_prize_payment_v2(uuid,integer,text,text,uuid)','bab738dd1a069939fd960067effa4cfe','v'],
 ['public.get_tournament_prize_payment_receipt_v2','fe387d83fb63969a0a6009ed504ec7d2','public.get_tournament_prize_payment_receipt_v2(uuid)','ef13f8bf6a3c811f4be1e78fd6283281','s']
];
const definitions=functions.map(([name,bodyHash])=>{
 const pattern=new RegExp('CREATE FUNCTION '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1\\s*;','g');
 const matches=[...source.matchAll(pattern)];assert.equal(matches.length,1);assert.equal(hash(matches[0][2],'md5'),bodyHash);return matches[0][0];
});
const tables=[...source.matchAll(/CREATE TABLE floor_private\.payout_payment_receipts_v1 \([\s\S]*?\n\);/g)];assert.equal(tables.length,1);
const routes=[...routeSource.matchAll(/DO \$\$\nDECLARE target regprocedure:='public\.get_tournament_payout_recipients\(uuid\)'::regprocedure;[\s\S]*?END \$\$;/g)];assert.equal(routes.length,1);
const sql=`BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' OR current_database()<>'postgres'
 OR current_setting('vinpoker.isolated_prize_close',true) IS DISTINCT FROM 'current-full34-only'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='a3000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST Tour')
 THEN RAISE EXCEPTION 'prize_dependency_owned_context_required';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('floor_private.payout_place_context_v1(uuid,integer)')
  AND md5(replace(pg_get_functiondef(oid),chr(13),''))='0ff8786f320a9435e75e764b737b191e'
  AND proowner='postgres'::regrole AND NOT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres}')
 THEN RAISE EXCEPTION 'prize_dependency_context_drift';END IF;
 IF to_regclass('floor_private.payout_payment_receipts_v1') IS NOT NULL
 OR ${functions.map(f=>"to_regprocedure('"+f[2]+"') IS NOT NULL").join('\n OR ')}
 THEN RAISE EXCEPTION 'prize_dependency_catalog_collision';END IF;
END $$;
${tables[0][0]}
ALTER TABLE floor_private.payout_payment_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.payout_payment_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;
${definitions.join('\n')}
${functions.map(f=>`ALTER FUNCTION ${f[2]} OWNER TO postgres;
REVOKE ALL ON FUNCTION ${f[2]} FROM PUBLIC,anon,authenticated,service_role;
${f[0].startsWith('public.')?'GRANT EXECUTE ON FUNCTION '+f[2]+' TO authenticated;':''}`).join('\n')}
${routes[0][0]}
DO $$ DECLARE item record;BEGIN
 FOR item IN SELECT * FROM (VALUES ${functions.map(f=>"('"+f[2]+"','"+f[3]+"','"+f[4]+"',"+f[0].startsWith('public.')+")").join(',')}) x(signature,hash,volatility,public_api) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=to_regprocedure(item.signature)
   AND md5(replace(pg_get_functiondef(oid),chr(13),''))=item.hash AND proowner='postgres'::regrole AND prosecdef
   AND provolatile=item.volatility::"char" AND proconfig=ARRAY['search_path=""']::text[]
   AND (SELECT array_agg(pg_get_userbyid(a.grantee)::text ORDER BY pg_get_userbyid(a.grantee)::text) FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.privilege_type='EXECUTE')=
    CASE WHEN item.public_api THEN ARRAY['authenticated','postgres']::text[] ELSE ARRAY['postgres']::text[] END
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee=0 OR a.is_grantable OR a.grantor<>p.proowner))
  THEN RAISE EXCEPTION 'prize_dependency_object_drift';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='floor_private.payout_payment_receipts_v1'::regclass AND relowner='postgres'::regrole AND relrowsecurity)
 OR EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='floor_private' AND table_name='payout_payment_receipts_v1' AND grantee IN('PUBLIC','anon','authenticated','service_role'))
 THEN RAISE EXCEPTION 'prize_dependency_receipt_privileges';END IF;
END $$;
NOTIFY pgrst,'reload schema';COMMIT;`;
writeFileSync(output,sql,{flag:'wx'});
console.log(JSON.stringify({kind:'OWNED_PRIZE_CLOSE_CURRENT_API_DEPENDENCIES',functions:4,emptyPrivateReceiptTables:1,productionChanged:false,limits:'Exact repository bodies plus original147 route patch,matching read-only hosted metadata. Isolated fixture only;not production apply or multiday qualification.'}));
