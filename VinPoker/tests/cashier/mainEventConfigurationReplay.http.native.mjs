import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
assert.equal(process.env.VINPOKER_MAIN_EVENT_CONFIG_REPLAY,'1');
const endpoint='http://127.0.0.1:54329',event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
const request='eb6a2a90-5c92-4f9a-bda8-74b8adc936ea';
const manifest=await (await fetch(endpoint+'/__local/manifest')).json();
assert.equal(manifest.d2Event,event);assert.equal(manifest.tour,'4cd3af4d-7e1d-4042-855f-04fb6777e580');
assert.equal(manifest.actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
const client=createClient(endpoint,'LOCAL_TEST_ONLY',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
try{
 const login=await client.auth.signInWithPassword({email:manifest.email,password:'LOCAL_TEST_ONLY'});
 assert.equal(login.error,null);assert.equal(login.data.user?.id,manifest.actor);
 const lookup=await client.rpc('multi_day_prize_configuration_receipt_v1',{p_event_id:event,p_request_id:request});
 assert.equal(lookup.error,null);assert.equal(lookup.data.state,'CONFIGURED');assert.equal(lookup.data.requestId,request);
 const p=lookup.data.requestPayload;
 const replay=await client.rpc('multi_day_save_prize_configuration_v1',{
  p_event_id:event,p_rows:p.rows,p_expected_configuration_revision:p.configuration,p_expected_rules_version:p.rules,
  p_expected_funding_revision:p.funding,p_expected_qualification_revision:p.qualification,
  p_expected_payout_input_hash:p.proposal,p_request_id:request,p_reason:p.reason});
 assert.equal(replay.error,null);assert.equal(replay.data.idempotent,true);
 assert.equal(replay.data.configurationRevision,lookup.data.configurationRevision);
 console.log('LINKED_MAIN_EVENT_ACTUAL_SDK_HTTP_CONFIG_RECEIPT_EXACT_REPLAY_AFTER_FINALIZATION_PASS');
}finally{await client.auth.signOut();}
