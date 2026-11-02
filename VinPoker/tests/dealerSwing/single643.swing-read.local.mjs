import assert from 'node:assert/strict';
// Read transport for the actual product tab, exact retained local club only.
// No mutation routes or synthetic empty/success fallbacks.
export function createSingle643Reads({sql,query,club,log,checkout814=false}){
 assert.equal(club,'d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 assert.equal(sql('SELECT current_database();'),checkout814?'vinpoker_checkout814_race_local':'vinpoker_ops_cash115_qualified_c');
 if(checkout814)assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948');
 const quote=v=>`'${String(v).replaceAll("'","''")}'`;
 const tables=new Set(['dealers','dealer_attendance','dealer_assignments','dealer_rotation_schedule','swing_config','swing_configs','swing_metrics','shift_break_policies','special_dates','audit_logs','dealer_shifts','club_settings','tournaments']);
 const functions=new Set(['get_club_table_inventory','get_dealer_swing_health','get_table_assignments_with_next',...(checkout814?['get_table_dealer_rules','get_dealer_mass_open_rollout']:[])]);
 return (method,url,body)=>{
  const name=url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
  if(method==='GET'&&tables.has(name)){
   let join='',scope=`r.club_id=${quote(club)}`,value='to_jsonb(r)';
   const alias={dealers:'d',game_tables:'g',dealer_attendance:'a'};
   if(name==='tournaments'){
    value=`to_jsonb(r)||jsonb_build_object('tournament_tables',(SELECT coalesce(jsonb_agg(to_jsonb(tt)||jsonb_build_object(
      'canonical_game_table',(SELECT to_jsonb(g) FROM public.game_tables g WHERE g.id=tt.game_table_id AND g.club_id=${quote(club)}),
      'game_tables',(SELECT to_jsonb(g) FROM public.game_tables g WHERE g.id=tt.table_id AND g.club_id=${quote(club)})
    )),'[]'::jsonb) FROM public.tournament_tables tt WHERE tt.tournament_id=r.id))`;
   }else if(name==='dealer_attendance'){
    join=' JOIN public.dealers d ON d.id=r.dealer_id';scope=`d.club_id=${quote(club)}`;
    value="to_jsonb(r)||jsonb_build_object('dealers',to_jsonb(d))";
   }else if(name==='dealer_assignments'){
    join=' JOIN public.game_tables g ON g.id=r.table_id JOIN public.dealer_attendance a ON a.id=r.attendance_id JOIN public.dealers d ON d.id=a.dealer_id LEFT JOIN public.dealer_attendance pa ON pa.id=r.pre_assigned_attendance_id LEFT JOIN public.dealers pd ON pd.id=pa.dealer_id';
    scope=`g.club_id=${quote(club)} AND d.club_id=${quote(club)}`;
    value="to_jsonb(r)||jsonb_build_object('game_tables',to_jsonb(g),'dealer_attendance',to_jsonb(a)||jsonb_build_object('dealers',to_jsonb(d)),'pre_assigned',CASE WHEN pa.id IS NULL THEN NULL ELSE to_jsonb(pa)||jsonb_build_object('dealers',to_jsonb(pd)) END)";
   }
   const field=k=>{
    assert.match(k,/^[a-z_]+(?:\.[a-z_]+)?$/);
    if(!k.includes('.'))return 'r.'+k;
    const [part,col]=k.split('.');assert.ok(join&&alias[part]);return alias[part]+'.'+col;
   };
   const where=[scope];let order='',limit='';
   for(const [key,v] of url.searchParams){
    if(key==='select')continue;
    if(key==='order'){
     order=' ORDER BY '+v.split(',').map(x=>{const [col,direction='asc']=x.split('.');assert.ok(['asc','desc'].includes(direction));return field(col)+' '+direction;}).join(',');continue;
    }
    if(key==='limit'){assert.match(v,/^\d{1,4}$/);limit=' LIMIT '+Number(v);continue;}
    const col=field(key);
    if(v==='is.null'){where.push(col+' IS NULL');continue;}
    if(v==='not.is.null'){where.push(col+' IS NOT NULL');continue;}
    const list=v.match(/^in\.\(([^()]*)\)$/);
    if(list){const vals=list[1].split(',');where.push(col+' IN ('+vals.map(quote).join(',')+')');continue;}
    const excluded=v.match(/^not\.in\.\(([^()]*)\)$/);
    if(excluded){const vals=excluded[1].split(',');where.push(col+' NOT IN ('+vals.map(quote).join(',')+')');continue;}
    const op=v.match(/^(eq|neq|gt|gte|lt|lte)\.(.*)$/s);assert.ok(op,`unsupported read filter ${key}`);
    where.push(col+({eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}[op[1]])+quote(op[2]));
   }
   const result=query(`SELECT coalesce(jsonb_agg(x.value),'[]'::jsonb) FROM(SELECT ${value} value FROM public.${name} r${join} WHERE ${where.join(' AND ')}${order}${limit})x;`);
   log.push({single643Read:name,rows:result.length});
   const singular=url.searchParams.get('select')&&url.searchParams.get('limit')==='1';
   return {matched:true,value:result,singular};
  }
  const rpc=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
  if(method==='POST'&&functions.has(rpc)){
   const keys=Object.keys(body);assert.equal(keys.length,1);
   assert.ok(['p_club_id','p_club_ids',...(checkout814?['p_expected_club_id']:[])].includes(keys[0]));
   const v=body[keys[0]];assert.ok(v===club||Array.isArray(v)&&v.length===1&&v[0]===club);
   const args=keys[0]+'=>'+(Array.isArray(v)?`ARRAY[${quote(club)}]::uuid[]`:quote(club)+'::uuid');
   const set=sql(`SELECT proretset FROM pg_proc WHERE oid=to_regprocedure(${quote('public.'+rpc+'('+(Array.isArray(v)?'uuid[]':'uuid')+')')});`)==='t';
   const result=query(set?`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM public.${rpc}(${args})x;`:`SELECT to_jsonb(public.${rpc}(${args}));`);
   log.push({single643Read:rpc});return {matched:true,value:result};
  }
  return {matched:false};
 };
}
