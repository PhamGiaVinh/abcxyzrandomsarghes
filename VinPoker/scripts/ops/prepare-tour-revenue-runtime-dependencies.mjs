import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';

// Disposable current-schema fixture only. Restore the exact private receipt
// classifier dependency without replaying an unrelated legacy Finance wrapper.
// The original Finance migration is not applied or represented as qualified.
const output=process.argv[2];assert.ok(output&&isAbsolute(output),'absolute disposable output required');
const source=readFileSync(new URL('../../supabase/migrations/20261029100837_finance_receipt_snapshot_revenue_v1.sql',import.meta.url),'utf8').replaceAll('\r','');
const pick=pattern=>{const matches=[...source.matchAll(pattern)];assert.equal(matches.length,1,'unique classifier source anchor');return matches[0][1];};
const oldSum=pick(/old_sum text:='([^']+)';/g);
const newSum=pick(/new_sum text:=\$sums\$([\s\S]*?)\$sums\$;/g);
const oldJson=pick(/old_json text:=\$key\$([\s\S]*?)\$key\$;/g);
const newJson=pick(/new_json text:=\$keys\$([\s\S]*?)\$keys\$;/g);
for(const value of [oldSum,newSum,oldJson,newJson])assert.ok(!value.includes('$dependency$'),'SQL delimiter collision');
writeFileSync(output,`BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $restore$ DECLARE before_row pg_proc%ROWTYPE;after_row pg_proc%ROWTYPE;definition text;patched text;
 old_sum text:=$dependency$${oldSum}$dependency$;new_sum text:=$dependency$${newSum}$dependency$;
 old_json text:=$dependency$${oldJson}$dependency$;new_json text:=$dependency$${newJson}$dependency$;
BEGIN
 SELECT * INTO STRICT before_row FROM pg_proc WHERE oid='floor_private.tour_revenue_live_source_v1(uuid)'::regprocedure;
 IF current_user<>'postgres' OR md5(replace(before_row.prosrc,chr(13),''))<>'67ea8cc36824b34ef7006b9a8b36e923'
 OR before_row.proowner<>'postgres'::regrole OR NOT before_row.prosecdef OR before_row.provolatile<>'s'
 OR has_function_privilege('anon',before_row.oid,'EXECUTE')
 OR has_function_privilege('authenticated',before_row.oid,'EXECUTE')
 OR has_function_privilege('service_role',before_row.oid,'EXECUTE')
 THEN RAISE EXCEPTION 'isolated_revenue_classifier_dependency_drift';END IF;
 IF cardinality(string_to_array(before_row.prosrc,old_sum))<>2 OR cardinality(string_to_array(before_row.prosrc,old_json))<>2
 THEN RAISE EXCEPTION 'isolated_revenue_classifier_anchor_drift';END IF;
 patched:=replace(replace(before_row.prosrc,old_sum,new_sum),old_json,new_json);
 IF md5(patched)<>'8e1643276e7e3efe7f151cd62504b129' THEN RAISE EXCEPTION 'isolated_revenue_classifier_source_mismatch';END IF;
 definition:=pg_get_functiondef(before_row.oid);
 EXECUTE replace(definition,before_row.prosrc,patched);
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=before_row.oid;
 IF after_row.prosrc IS DISTINCT FROM patched OR after_row.proowner<>before_row.proowner
 OR after_row.proacl IS DISTINCT FROM before_row.proacl OR after_row.proconfig IS DISTINCT FROM before_row.proconfig
 OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef OR after_row.provolatile IS DISTINCT FROM before_row.provolatile
 THEN RAISE EXCEPTION 'isolated_revenue_classifier_metadata_drift';END IF;
END $restore$;
COMMIT;
`,{mode:0o600});
console.log('EXACT_PRIVATE_TOUR_REVENUE_CLASSIFIER_DEPENDENCY_PREPARED');
