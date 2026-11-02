import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1168_DRIFT_BASELINE,'1');
const path='D:/Quy trình/output/reports/earlyitm1168-price-drift-baseline-local-20261028.sql';assert.equal(existsSync(path),false);
let sql=readFileSync('D:/Quy trình/output/reports/earlyitm1168-liability-green3-local-20261028.sql','utf8');
const candidate=readFileSync('supabase/pending-migrations/20261027170011_multiday_individual_global_liability_link_v1.sql','utf8');
assert.equal(sql.split(candidate).length,2);sql=sql.replace(candidate,()=> '-- Baseline1167:1168 reconciliation/read changes intentionally absent.');
// The separate canonical-liability test already proves the missing-debt RED.
// Remove only that earlier test block so this independent RED reaches pricing.
const begin=sql.indexOf(' DECLARE report jsonb;item jsonb;BEGIN');
const end=sql.indexOf(' DECLARE funding jsonb;quote jsonb;BEGIN',begin);
assert.ok(begin>0&&end>begin);sql=sql.slice(0,begin)+sql.slice(end);
const unexpected="    RAISE EXCEPTION 'global finalization silently repriced frozen individual obligation';";
assert.equal(sql.split(unexpected).length,2);
sql=sql.replace(unexpected,()=>String.raw`
    PERFORM set_config('role','none',true);
    RAISE NOTICE '1168 baseline drift: frozen individual100000, global rank8=%',
     (SELECT x->>'totalVnd' FROM public.multi_day_payout_finalizations_v1 f CROSS JOIN LATERAL jsonb_array_elements(f.obligations)x
       WHERE f.event_id=event AND x->>'participationId'=p::text);
`+unexpected);
writeFileSync(path,sql);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
// Expected RED: old canonical writer accepts global200K against frozen100K.
// The raised oracle error aborts the held transaction; never commit this probe.
execFileSync('wsl',args,{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4e6});
