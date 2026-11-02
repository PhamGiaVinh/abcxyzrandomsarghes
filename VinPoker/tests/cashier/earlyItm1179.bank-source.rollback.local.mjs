import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

assert.equal(process.env.VINPOKER_EARLYITM1179_LOCAL, '1');
const attempt = process.env.VINPOKER_EARLYITM1179_ATTEMPT;
assert.match(attempt ?? '', /^[a-z0-9]+$/);
const base = `D:/Quy trình/output/reports/earlyitm1179-bank-source-${attempt}-local-20261028`;
assert.equal(existsSync(base + '.sql'), false);
let sql = readFileSync('D:/Quy trình/output/reports/earlyitm1171-global-payment-bridge-6-local-20261028.sql', 'utf8');
assert.ok(sql.includes(readFileSync('supabase/pending-migrations/20261027172548_multiday_individual_verified_payment_v1.sql', 'utf8')));
const bankFingerprint = `SELECT md5(jsonb_build_array(${['public.bank_transactions', 'public.platform_bank_accounts', 'public.multi_day_overlay_funding_v1'].map(table => `(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM ${table} x)`).join(',')})::text)`;
const begin = "BEGIN;\nSET LOCAL statement_timeout='20s';";
assert.equal(sql.split(begin).length, 2);
sql = sql.replace(begin, () => `CREATE TEMP TABLE bank1179_protected AS ${bankFingerprint};\n` + begin);
const anchor = '  -- Fail the actual public marker INSERT after the private proof was inserted.';
assert.equal(sql.split(anchor).length, 2);
const probe = String.raw`
  -- Additional isolated source qualification; no invalid allocation is forged.
  DECLARE bank uuid:=gen_random_uuid();account uuid:=gen_random_uuid();
   label text:='LOCAL1179-'||gen_random_uuid()::text;case_no integer;overlay_result jsonb;
   old_funding jsonb;new_funding jsonb;fresh jsonb;stale jsonb;paid jsonb;
   stale_request uuid:=gen_random_uuid();fresh_request uuid:=gen_random_uuid();before_probe text;
  BEGIN
   PERFORM set_config('role','none',true);
   before_probe:=pg_temp.d2_789_fingerprint();
   BEGIN
    INSERT INTO public.platform_bank_accounts(id,bank_name,account_number,account_holder,club_id,is_active)
     VALUES(account,'LOCAL TEST BANK',label,'LOCAL TEST ONLY',club,true);
    INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,club_id,amount,transfer_type,status,api_verified_at,api_verified_source)
     VALUES(bank,'sepay',label,label,club,50000,'in','unmatched',clock_timestamp(),'LOCAL TEST FIXTURE');
    old_funding:=private.multi_day_payment_verified_funding_v1(event);
    FOR case_no IN 1..7 LOOP
     UPDATE public.bank_transactions SET provider='sepay',api_verified_at=clock_timestamp(),transfer_type='in',
      status='unmatched',amount=50000,club_id=club,account_number=label WHERE id=bank;
     CASE case_no
      WHEN 1 THEN UPDATE public.bank_transactions SET provider='LOCAL_INVALID' WHERE id=bank;
      WHEN 2 THEN UPDATE public.bank_transactions SET api_verified_at=NULL WHERE id=bank;
      WHEN 3 THEN UPDATE public.bank_transactions SET transfer_type='out' WHERE id=bank;
      WHEN 4 THEN UPDATE public.bank_transactions SET status='quarantined' WHERE id=bank;
      WHEN 5 THEN UPDATE public.bank_transactions SET amount=49999 WHERE id=bank;
      WHEN 6 THEN UPDATE public.bank_transactions SET amount=NULL WHERE id=bank;
      WHEN 7 THEN UPDATE public.bank_transactions SET account_number=label||'-unknown' WHERE id=bank;
     END CASE;
     PERFORM set_config('role','authenticated',true);
     BEGIN
      PERFORM public.multi_day_record_overlay_v1(event,'RECORDED',50000,label,'LOCAL1179 negative bank source',NULL,NULL,gen_random_uuid(),bank);
      RAISE EXCEPTION 'invalid bank source accepted: %',case_no;
     EXCEPTION WHEN check_violation THEN
      IF SQLERRM<>'multi_day_overlay_bank_unverified_or_allocated' THEN RAISE;END IF;
     END;
     PERFORM set_config('role','none',true);
     ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 WHERE event_id=event);
     ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=final);
     ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_individual_payment_commits_v1 WHERE event_id=event);
     ASSERT NOT EXISTS(SELECT 1 FROM floor_private.payout_payment_receipts_v1 WHERE actor_id=actor AND request_id IN(stale_request,fresh_request));
     ASSERT private.multi_day_payment_verified_funding_v1(event)=old_funding,'rejected overlay changed verified funds';
    END LOOP;
    UPDATE public.bank_transactions SET provider='sepay',api_verified_at=clock_timestamp(),transfer_type='in',
     status='unmatched',amount=50000,club_id=club,account_number=label WHERE id=bank;
    PERFORM set_config('role','authenticated',true);
    overlay_result:=public.multi_day_record_overlay_v1(event,'RECORDED',50000,label,'LOCAL1179 verified source control',NULL,NULL,gen_random_uuid(),bank);
    ASSERT overlay_result->>'ok'='true',overlay_result::text;
    PERFORM set_config('role','none',true);
    ASSERT (SELECT status='matched' FROM public.bank_transactions WHERE id=bank);
    BEGIN
     UPDATE public.bank_transactions SET api_verified_at=NULL WHERE id=bank;
     RAISE EXCEPTION 'allocated bank update accepted';
    EXCEPTION WHEN check_violation THEN IF SQLERRM<>'multi_day_allocated_bank_immutable' THEN RAISE;END IF;END;
    BEGIN
     DELETE FROM public.bank_transactions WHERE id=bank;
     RAISE EXCEPTION 'allocated bank deletion accepted';
    EXCEPTION WHEN check_violation THEN IF SQLERRM<>'multi_day_allocated_bank_immutable' THEN RAISE;END IF;END;
    new_funding:=private.multi_day_payment_verified_funding_v1(event);
    ASSERT (new_funding->>'recordedOverlayVnd')::bigint=50000;
    ASSERT new_funding->>'sourceInputHash' IS DISTINCT FROM old_funding->>'sourceInputHash';
    ASSERT jsonb_array_length(new_funding->'sourceSnapshot'->'bankProof')=1;
    PERFORM set_config('role','authenticated',true);
    stale:=public.record_multi_day_prize_payment_v1(event,p,'cash',original_token,stale_request);
    ASSERT stale->>'ok'='false' AND stale->>'error'='payout_confirmation_stale',stale::text;
    PERFORM set_config('role','none',true);
    ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=final);
    ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_individual_payment_commits_v1 WHERE event_id=event);
    ASSERT (SELECT receipt_row.result=stale FROM floor_private.payout_payment_receipts_v1 receipt_row WHERE actor_id=actor AND request_id=stale_request);
    ASSERT NOT EXISTS(SELECT 1 FROM floor_private.payout_payment_receipts_v1 receipt_row WHERE actor_id=actor AND request_id=stale_request AND receipt_row.result->>'ok'='true');
    PERFORM set_config('role','authenticated',true);
    SELECT x INTO STRICT fresh FROM jsonb_array_elements(public.get_tournament_payout_recipients(final)->'places')x WHERE x->>'multiDayParticipationId'=p::text;
    ASSERT fresh->>'confirmationToken' IS DISTINCT FROM original_token;
    paid:=public.record_multi_day_prize_payment_v1(event,p,'cash',fresh->>'confirmationToken',fresh_request);
    ASSERT paid->>'ok'='true' AND (paid->>'prize_amount')::bigint=100000,paid::text;
    PERFORM set_config('role','none',true);
    ASSERT (SELECT count(*)=1 AND sum(prize_amount)=100000 FROM public.tournament_prize_payments WHERE tournament_id=final);
    ASSERT (SELECT count(*)=1 FROM private.multi_day_individual_payment_commits_v1 WHERE event_id=event);
    SET CONSTRAINTS ALL IMMEDIATE;SET CONSTRAINTS ALL DEFERRED;
    RAISE EXCEPTION 'LOCAL1179_PROBE_ROLLBACK' USING ERRCODE='ZX179';
   EXCEPTION WHEN SQLSTATE 'ZX179' THEN ASSERT SQLERRM='LOCAL1179_PROBE_ROLLBACK';END;
   ASSERT pg_temp.d2_789_fingerprint()=before_probe,'bank probe changed protected facts';
   ASSERT NOT EXISTS(SELECT 1 FROM public.bank_transactions WHERE id=bank);
   ASSERT NOT EXISTS(SELECT 1 FROM public.platform_bank_accounts WHERE id=account);
   ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 WHERE event_id=event);
   ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_individual_payment_commits_v1 WHERE event_id=event);
   ASSERT NOT EXISTS(SELECT 1 FROM floor_private.payout_payment_receipts_v1 WHERE actor_id=actor AND request_id IN(stale_request,fresh_request));
   PERFORM set_config('test.e1179',jsonb_build_object('invalidBankSourcesRejected',7,'verifiedOverlayVnd',50000,
    'allocatedBankUpdateDeleteDenied',true,'changedSourceOldPaymentTokenRejected',true,'staleAttemptPayments',0,
    'freshReadPaymentVnd',100000,'nestedRollbackProtectedGroupsUnchanged',true,'syntheticBankAccountRemovedByRollback',true)::text,true);
   PERFORM set_config('role','authenticated',true);
  END;
`;
sql = sql.replace(anchor, () => probe + '\n' + anchor);
const output = "SELECT current_setting('test.e1170')::jsonb;";
assert.equal(sql.split(output).length, 2);
sql = sql.replace(output, () => "SELECT current_setting('test.e1179')::jsonb;" + output);
sql += `\nDO $$ BEGIN ASSERT (SELECT md5 FROM bank1179_protected)=(${bankFingerprint}),'bank source history changed after outer rollback';END $$;\nSELECT jsonb_build_object('bankSourceTablesUnchanged',3,'bankSourceFingerprint',(${bankFingerprint}));\n`;
writeFileSync(base + '.sql', sql);
try {
  const raw = execFileSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', 'PGHOST=127.0.0.1', 'PGPORT=55441',
    'PGUSER=postgres', 'PGDATABASE=vinpoker_ranking860_local', 'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', timeout: 60000, maxBuffer: 5e6 });
  writeFileSync(base + '.raw.log', raw);
  const observations = raw.split(/\r?\n/).filter(line => line.startsWith('{')).map(JSON.parse);
  assert.equal(observations.find(row => row.invalidBankSourcesRejected)?.invalidBankSourcesRejected, 7);
  assert.equal(observations.find(row => row.paymentBaselineFunctionsRestored)?.paymentBaselineFunctionsRestored, true);
  assert.equal(observations.at(-1).bankSourceTablesUnchanged, 3);
  assert.ok(observations.some(row => row.rollbackProtectedGroups === 41 && row.unchanged));
  writeFileSync(base + '.json', JSON.stringify({ kind: 'CANONICAL_OVERLAY_BANK_REJECTION_AND_EARLY_PAYMENT_SOURCE_CAS_ROLLBACK',
    observations, durablyApplied: false, fullR03Accepted: false }, null, 2));
  console.log('EARLYITM1179_BANK7_NEGATIVE_VALID_OVERLAY_IMMUTABLE_SOURCE_CAS_FRESH_PAYMENT_ROLLBACK_PASS');
} catch (error) {
  writeFileSync(base + '.failure.log', String(error.stderr ?? error.stack));
  throw error;
}
