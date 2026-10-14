import assert from 'node:assert/strict';
import {fingerprintManualCards,normalizeManualCards,parseManualCardIntent,isConfirmedManualCardProof}
 from '../../src/components/cashier/tournament-live/handinput/manualCardIntent.ts';
const cards=[{player_id:'p2',entry_number:2,hole_cards:['Qh','Qs']},{player_id:'p1',entry_number:1,hole_cards:['Jh','Js']}];
const fingerprint=await fingerprintManualCards(cards);
assert.match(fingerprint,/^[a-f0-9]{64}$/u);
assert.equal(await fingerprintManualCards([...cards].reverse()),fingerprint);
assert.notEqual(await fingerprintManualCards([{...cards[0],hole_cards:['Kh','Ks']},cards[1]]),fingerprint);
assert.equal(cards[0].player_id,'p2');assert.equal(normalizeManualCards(cards)[0].player_id,'p1');
const scope={actorId:'actor',tournamentId:'tour',tournamentTableId:'logical',handId:'hand'};
const intent={...scope,tableSessionId:'session',controlEpoch:1,sourceRevision:12,
 requestId:'manual-policy-request-0001',cardsFingerprint:fingerprint};
const parsed=parseManualCardIntent({...intent,hole_cards:cards},scope);
assert.deepEqual(parsed,intent);assert.ok(!JSON.stringify(parsed).includes('Qh'));
assert.equal(parseManualCardIntent(intent,{...scope,actorId:'outsider'}),null);
assert.equal(parseManualCardIntent({...intent,controlEpoch:0},scope),null);
const proof={status:'success',hand_id:'hand',table_session_id:'session',control_epoch:1,
 expected_source_revision:12,committed_source_revision:14,request_key:intent.requestId,entry_count:2};
assert.ok(isConfirmedManualCardProof(proof,intent,2,'write'));
assert.ok(!isConfirmedManualCardProof({...proof,hand_id:'new-hand'},intent,2,'write'));
assert.ok(!isConfirmedManualCardProof({...proof,control_epoch:2},intent,2,'write'));
assert.ok(!isConfirmedManualCardProof({...proof,committed_source_revision:12},intent,2,'write'));
assert.ok(isConfirmedManualCardProof({...proof,status:'committed',request_hash:'a'.repeat(64)},intent,2,'lookup'));
assert.ok(!isConfirmedManualCardProof({...proof,status:'committed'},intent,2,'lookup'));
console.log('MANUAL75_PENDING_METADATA_NO_RAW_CARDS_AND_PROOF_POLICY_PASS');
