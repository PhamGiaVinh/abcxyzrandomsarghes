// Execute the real Undo/restore callbacks. Browser/native qualification is separate.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {parseSync,transformSync} from '@swc/core';
const source=readFileSync('src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts','utf8');
const ast=parseSync(source,{syntax:'typescript'}),callbacks=new Map();
function visit(node){
 if(!node||typeof node!=='object')return;
 if(node.type==='VariableDeclaration')for(const declaration of node.declarations){
  if(['restoreLastSnapshot','handleUndo'].includes(declaration.id.value))callbacks.set(declaration.id.value,node);
 }
 for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
}
visit(ast);assert.equal(callbacks.size,2);
const code=transformSync({...ast,body:[callbacks.get('restoreLastSnapshot'),callbacks.get('handleUndo')]},{jsc:{target:'es2022'}}).code+';return handleUndo;';
function harness(confirmed){
 const snapshot={players:[{player_id:'sb',is_folded:false,current_stack:39900}],actions:[{action_type:'post_sb'}],currentStreet:'preflop',nextActionOrder:4};
 const state={players:[],actions:[],currentStreet:'preflop',nextActionOrder:5,undoStack:[snapshot],endingStacks:{sb:39900,bb:40100},endingStacksManuallyEdited:true,betAmount:'',selectedActorId:null};
 const deps={isReadOnly:false,streetRollbackRef:{current:null},handId:'test-hand',undoStack:state.undoStack,revealDone:false,holeCardsBroadcastRef:{current:false},setRevealDone:()=>{},toast:{error:()=>{},success:()=>{}},requestDurableUndo:async()=>({ok:confirmed,error:'Unconfirmed'})};
 for(const key of Object.keys(state))deps['set'+key[0].toUpperCase()+key.slice(1)]=value=>{state[key]=typeof value==='function'?value(state[key]):value;};
 return {state,snapshot,undo:new Function(...Object.keys(deps),code)(...Object.values(deps))};
}
test('confirmed Undo invalidates computed and manually edited Review results',async()=>{
 const h=harness(true);await h.undo();
 assert.deepEqual(h.state.endingStacks,{});assert.equal(h.state.endingStacksManuallyEdited,false);
 assert.deepEqual(h.state.players,h.snapshot.players);assert.deepEqual(h.state.actions,h.snapshot.actions);
 assert.equal(h.state.nextActionOrder,4);assert.equal(h.state.undoStack.length,0);
});
test('unconfirmed Undo preserves Review and the undo snapshot',async()=>{
 const h=harness(false);await h.undo();
 assert.deepEqual(h.state.endingStacks,{sb:39900,bb:40100});assert.equal(h.state.endingStacksManuallyEdited,true);
 assert.equal(h.state.nextActionOrder,5);assert.equal(h.state.undoStack.length,1);
});
