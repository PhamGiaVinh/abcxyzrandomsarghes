import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicReplayDiagnostic as diagnostic} from './public-replay-diagnostic.mjs';
test('replay diagnostics distinguish public catalog readiness without exporting private fields',()=>{
 const secret='PRIVATE-name-phone-token',scope={tour:'tour-id',table:'table-id',hand:'hand-id'};
 const row=diagnostic('get_public_tournament_viewer_snapshot_v2',{ok:true,access:'public',tournamentId:scope.tour,
  sections:{tables:{catalog:[{tableId:scope.table,name:secret}]}},message:secret,token:secret},200,scope);
 assert.deepEqual(row,{rpc:'get_public_tournament_viewer_snapshot_v2',httpStatus:200,errorCode:null,ok:true,access:'public',tourMatches:true,tablesSection:true,catalogCount:1});
 assert.equal(JSON.stringify(row).includes(secret),false);assert.equal(JSON.stringify(row).includes(scope.tour),false);
 assert.equal(diagnostic('get_public_tournament_viewer_snapshot_v2',{ok:true,access:'preparing'},200,scope).catalogCount,null);
 assert.deepEqual(diagnostic('get_public_tournament_clock_summary',[{tournament_id:scope.tour,is_running:false,name:secret}],200,scope),
  {rpc:'get_public_tournament_clock_summary',httpStatus:200,errorCode:null,rows:1,tourMatches:true,runningFieldValid:true});
});
test('replay diagnostics retain only known codes, statuses and fixed source-shape flags',()=>{
 const scope={tour:'tour',table:'table',hand:'hand'};
 assert.equal(diagnostic('arbitrary-private-name',{},200,scope),null);
 const row=diagnostic('get_public_tournament_table_hand_v2',{id:'hand',tableId:'table',actions:[{private:'secret'}],players:[],state:'PRIVATE',code:'PRIVATE-error',message:'secret'},NaN,scope);
 assert.deepEqual(row,{rpc:'get_public_tournament_table_hand_v2',httpStatus:null,errorCode:null,access:'other',tableMatches:true,handMatches:true,state:'other',actions:1,players:0});
 for(const code of ['42501','PGRST202'])assert.equal(diagnostic('get_public_tournament_table_hand_v2',{code},403,scope).errorCode,code);
 assert.equal(diagnostic('get_public_tournament_clock_summary',[{tournament_id:'tour',is_running:'true'}],200,scope).runningFieldValid,false);
});
