import test from 'node:test';import assert from 'node:assert/strict';
import {cashierWorklistDiagnostic} from './cashier-worklist-diagnostic.mjs';
const scope={clubId:'owned',tournamentId:'tour',registrationId:'target',expectedName:'private-name'};
test('worklist diagnostic distinguishes scope, filter and target without exporting private fields',()=>{
 const value=cashierWorklistDiagnostic({p_club_id:'owned',p_tournament_id:'tour',p_query:'',p_bucket:'counter',p_page:0,p_limit:50,token:'private-token'},
  {ok:true,enabled:true,rows:[{id:'target',status:'pending',bucket:'counter',player_name:'private-name',phone:'private-phone'}],message:'private-message'},200,scope);
 assert.equal(value.targetPresent,true);assert.equal(value.targetNameMatches,true);assert.equal(value.rowCount,1);assert.equal(value.clubMatches,true);assert.equal(value.queryEmpty,true);
 assert.doesNotMatch(JSON.stringify(value),/private-|"target"|"owned"/);
 const missing=cashierWorklistDiagnostic({p_club_id:'other',p_tournament_id:'other',p_query:'target',p_bucket:'counter',p_page:2,p_limit:50},{ok:true,rows:[]},200,scope);
 assert.equal(missing.clubMatches,false);assert.equal(missing.tourMatches,false);assert.equal(missing.queryIsTarget,true);assert.equal(missing.targetStatus,'missing');assert.equal(missing.page,2);
});
test('worklist diagnostic rejects arbitrary strings, invalid shapes and unsafe numeric fields',()=>{
 for(const request of [null,[],{p_bucket:'private-name',p_page:Infinity,p_limit:-1}]){
  const result=cashierWorklistDiagnostic(request,{code:'private-message',rows:[null,{}]},NaN,scope);
  assert.equal(result.errorCode,null);assert.equal(result.httpStatus,null);assert.equal(result.bucket,'other');assert.equal(result.page,null);assert.equal(result.limit,null);
 }
 assert.equal(cashierWorklistDiagnostic({}, {code:'42501'},403,scope).errorCode,'42501');
 assert.equal(cashierWorklistDiagnostic({}, {code:'PGRST202'},404,scope).errorCode,'PGRST202');
});
