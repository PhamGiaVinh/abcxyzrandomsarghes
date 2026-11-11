import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('./maintain-http-response.sh',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../../../.github/workflows/http-response-maintenance.yml',import.meta.url),'utf8');
test('native maintenance has no schema, money or scheduler writer',()=>{
 const executable=script.replace(/^\s*#.*$/gm,'');
 assert.equal((executable.match(/VACUUM \(ANALYZE/g)??[]).length,1);
 assert.match(executable,/TRUNCATE OFF, PARALLEL 0, SKIP_LOCKED/);
 assert.doesNotMatch(executable,/VACUUM\s+FULL|ALTER\s+(?:ROLE|TABLE|DATABASE)|cron\.(?:alter_job|unschedule|schedule)|pg_(?:cancel|terminate)_backend|supabase db push|functions deploy/i);
 assert.match(executable,/statement_timeout=300000/);assert.match(executable,/lock_timeout=1000/);
 assert.match(executable,/source_md5/);assert.match(executable,/active_vacuums,0/);
 assert.match(executable,/VACUUM skipped or completion unproven/);
 assert.match(executable,/mktemp -d/);
 assert.doesNotMatch(executable,/set -x|echo.*PGPASSWORD|printenv|env\s*>/);
});
test('production maintenance is owner-bound, protected, tied to fresh actual recovery',()=>{
 assert.match(workflow,/github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/environment: dealer-swing-production-critical/);
 assert.match(workflow,/INITIAL_ACTOR.*REPOSITORY_OWNER/);assert.match(workflow,/TRIGGERING_ACTOR.*REPOSITORY_OWNER/);
 assert.match(workflow,/RUN_REVIEWED_HTTP_RESPONSE_VACUUM/);assert.match(workflow,/test "\$TARGET_SHA" = "\$GITHUB_SHA"/);
 assert.match(workflow,/floor-v3-restore-verification-\$RECOVERY_RUN/);
 assert.match(workflow,/r\.isolatedRestore,'PASS'/);assert.match(workflow,/r\.tableCountMatch,'PASS'/);
 assert.match(workflow,/databaseOwnerAndEffectiveAclMatch,true/);assert.match(workflow,/age<=2\*3600\*1000/);
 assert.match(workflow,/--is-ancestor/);assert.match(workflow,/cancel-in-progress: false/);
 assert.match(workflow,/secrets\.SUPABASE_DB_PASSWORD/);assert.doesNotMatch(workflow,/vars\.SUPABASE_DB_PASSWORD|contents: write/);
});
