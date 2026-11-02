import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Parent validates isolated PG17 and no external network before invoking this.
// Keep the TEST fixture and compensating audit as evidence; never delete ledger.
export async function runFnbConcurrency({sql,session,until}){
  const club='349ecf35-50ba-4c71-a581-15dc45f1cd01',actor='a364de8e-06b1-4428-a20d-ac614ec406e5';
  const menu=randomUUID(),ingredient=randomUUID(),key=randomUUID(),compKey=randomUUID();
  sql(`BEGIN;
    INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost)
      VALUES('${ingredient}','${club}','LOCAL FNB concurrency ${ingredient}','unit',10,1000);
    INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,tracks_inventory)
      VALUES('${menu}','${club}','LOCAL FNB concurrency ${menu}',5000,true);
    INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES('${club}','${menu}','${ingredient}',2);
    COMMIT;`);
  const auth=`BEGIN;SET LOCAL ROLE authenticated;
    SET LOCAL statement_timeout='15s';
    SELECT set_config('request.jwt.claim.sub','${actor}',true);
    SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}"}',true);`;
  const lines=`jsonb_build_array(jsonb_build_object('menu_item_id','${menu}','qty',1))`;
  const create=`public.fnb_create_order('${club}','counter',NULL,NULL,NULL,${lines},'${key}')`;
  const json=(output)=>output.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).filter(value=>value.status||value.error);
  async function overlap(label,first,second){
    const a=session(`fnb-${label}-a`),b=session(`fnb-${label}-b`);
    try{
      a.child.stdin.write(`${auth} SELECT ${first};SELECT 'FNB_A_READY';\n`);
      await until(()=>a.output().includes('FNB_A_READY'));
      b.child.stdin.end(`${auth} SELECT ${second};COMMIT;\n`);
      await until(()=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='fnb-${label}-b' AND wait_event_type='Lock';`)==='1');
      a.child.stdin.end('COMMIT;\n');
      const [ao,bo]=await Promise.all([a.closed,b.closed]);
      return [json(ao).at(-1),json(bo).at(-1)];
    }finally{
      if(!a.child.stdin.destroyed)a.child.stdin.end('ROLLBACK;\n');
      if(!b.child.stdin.destroyed)b.child.stdin.end('ROLLBACK;\n');
    }
  }
  const [first,replay]=await overlap('create',create,create);
  assert.equal(first.status,'ok');assert.equal(first.idempotent,false);
  assert.equal(replay.order_id,first.order_id);assert.equal(replay.idempotent,true);
  const order=first.order_id;
  const [pay,payReplay]=await overlap('pay',`public.fnb_mark_paid('${order}')`,`public.fnb_mark_paid('${order}')`);
  assert.equal(pay.status,'ok');assert.equal(payReplay.idempotent,true);
  assert.equal(sql(`SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}';`),'8');
  assert.equal(sql(`SELECT count(*) FROM public.fnb_stock_movements WHERE ref_id='${order}' AND reason='sale';`),'1');
  const [cancel,cancelReplay]=await overlap('cancel',`public.fnb_cancel_order('${order}','LOCAL concurrency refund')`,`public.fnb_cancel_order('${order}','LOCAL concurrency replay')`);
  assert.equal(cancel.status,'ok');assert.equal(cancelReplay.idempotent,true);
  assert.equal(sql(`SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}';`),'10');
  const comp=`public.fnb_create_comp_order('${club}','counter',NULL,NULL,NULL,${lines},'LOCAL concurrent comp','${compKey}')`;
  const conflicting=`public.fnb_create_order('${club}','counter',NULL,NULL,NULL,${lines},'${compKey}')`;
  const [compResult,conflict]=await overlap('operation',comp,conflicting);
  assert.equal(compResult.status,'ok');assert.equal(conflict.error,'REQUEST_ID_CONFLICT');
  const undo=json(sql(`${auth} SELECT public.fnb_cancel_order('${compResult.order_id}','LOCAL comp compensation');COMMIT;`)).at(-1);
  assert.equal(undo.status,'ok');
  assert.equal(sql(`SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}';`),'10');
  assert.equal(sql(`SELECT count(*) FROM public.fnb_orders WHERE club_id='${club}' AND client_request_id IN('${key}','${compKey}');`),'2');
  assert.equal(sql(`SELECT count(*) FROM public.fnb_stock_movements WHERE ref_id IN('${order}','${compResult.order_id}');`),'4');
  console.log('FNB_REAL_TWO_SESSION_CREATE_PAY_CANCEL_OPERATION_CONFLICT_PASS',JSON.stringify({club,menu,ingredient,order,compOrder:compResult.order_id,key,compKey,finalStock:10}));
}
