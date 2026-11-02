import assert from 'node:assert/strict';
export const direct275Text='LOCAL DM browser send275 TEST recovery';
export function createDirect275Browser({sql,query,actor,chat,ownRead,log,reload277=false}){
 const targetText=reload277?'LOCAL DM browser send277 TEST same-tab recovery':direct275Text;
 const priorCount=reload277?3:2;
 assert.equal(actor,'df6214be-0ba4-4df0-bb4e-3e7a10e126b2');assert.equal(chat,'6cc70861-ad37-4049-932f-eabfb46e8089');
 assert.equal(sql(`SELECT count(*) FROM pg_trigger WHERE tgrelid='public.direct_messages'::regclass AND NOT tgisinternal;`),'1');
 assert.equal(sql(`SELECT proname FROM pg_proc WHERE oid=(SELECT tgfoid FROM pg_trigger WHERE tgrelid='public.direct_messages'::regclass AND NOT tgisinternal);`),'trg_dm_bump_chat');
 assert.equal(sql(`SELECT md5(pg_get_functiondef('public.trg_dm_bump_chat()'::regprocedure));`),'4fa5efbb0150b49f2882d956489eae15');
 const quote=value=>`'${value.replaceAll("'","''")}'`;
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
 const existing=JSON.parse(sql(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.direct_messages WHERE chat_id='${chat}' AND sender_id='${actor}' AND kind='text' AND content=${quote(targetText)};`));
 assert.ok(existing.length<=1);let messageId=existing[0]??null;const fresh=messageId===null;
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'chats',(SELECT jsonb_agg(CASE WHEN c.id='${chat}'::uuid THEN to_jsonb(c)-'${ownRead}'-'last_message_at' ELSE to_jsonb(c) END ORDER BY id) FROM public.direct_chats c),
  'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.direct_messages m WHERE m.id IS DISTINCT FROM ${messageId?`'${messageId}'::uuid`:'NULL::uuid'}),
  'notices',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.notifications n),
  'push',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM private.notification_push_outbox_v1 j),
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
  'prizes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p)
 )::text);`);
 const before=fingerprint();
 return {get messageId(){return messageId;},evidence:()=>log,fingerprint,handle:(url,method,body)=>{
  if(url.pathname!=='/rest/v1/direct_messages')return null;
  if(method==='POST'){
   log.push({dm275:'send_attempt',id:body.id});
   assert.deepEqual(Object.keys(body).sort(),['chat_id','content','id','kind','sender_id']);
   assert.equal(body.chat_id,chat);assert.equal(body.sender_id,actor);assert.equal(body.kind,'text');assert.equal(body.content,targetText);
   assert.ok(uuid(body.id));assert.ok(messageId===null||body.id===messageId,'do not send a different message ID after uncertainty');
   assert.equal(url.searchParams.get('select'),'id,chat_id,sender_id,kind,content,created_at');
   try{
    const value=query(`INSERT INTO public.direct_messages(id,chat_id,sender_id,kind,content)
     VALUES('${body.id}','${chat}','${actor}','text',${quote(body.content)}) RETURNING jsonb_build_object('id',id,'chat_id',chat_id,'sender_id',sender_id,'kind',kind,'content',content,'created_at',created_at);`);
    assert.equal(value.id,body.id);messageId=value.id;log.push({dm275:'insert_committed',id:messageId,role:'authenticated'});
    return {status:201,value,write:true};
   }catch(error){
    if(/duplicate key value violates unique constraint "direct_messages_pkey"/.test(String(error.stderr))){
     log.push({dm275:'actual_native_duplicate',id:body.id});return {status:409,value:{code:'23505',message:'LOCAL duplicate message ID'},write:false};
    }throw error;
   }
  }
  if(method==='GET'&&url.searchParams.has('id')){
   assert.ok(messageId&&uuid(messageId));assert.equal(url.searchParams.get('id'),`eq.${messageId}`);
   assert.equal(url.searchParams.get('chat_id'),`eq.${chat}`);assert.equal(url.searchParams.get('sender_id'),`eq.${actor}`);
   assert.equal(url.searchParams.get('select'),'id,chat_id,sender_id,kind,content,created_at');
   const value=query(`SELECT coalesce((SELECT jsonb_build_object('id',id,'chat_id',chat_id,'sender_id',sender_id,'kind',kind,'content',content,'created_at',created_at)
    FROM public.direct_messages WHERE id='${messageId}' AND chat_id='${chat}' AND sender_id='${actor}'),'null'::jsonb);`);
   log.push({dm275:'receipt_read',id:messageId,found:value!==null,role:'authenticated'});return {status:200,value,write:false};
  }
  return null;
 },verify:()=>{
  assert.ok(messageId);assert.equal(fingerprint(),before,'all prior messages/chat fields/notices/push/cash/prizes unchanged');
  assert.equal(sql(`SELECT count(*) FROM public.direct_messages WHERE chat_id='${chat}';`),String(priorCount+1));
  assert.equal(sql(`SELECT count(*) FROM public.direct_messages WHERE id='${messageId}' AND chat_id='${chat}' AND sender_id='${actor}' AND kind='text' AND content=${quote(targetText)};`),'1');
  assert.equal(sql(`SELECT c.last_message_at=m.created_at FROM public.direct_chats c JOIN public.direct_messages m ON m.id='${messageId}' WHERE c.id='${chat}';`),'t');
  assert.equal(log.filter(row=>row.dm275==='send_attempt').length,fresh?1:0,'lost response must not create a new dispatch');
  console.log('DIRECT275_EXACT_ONE_MESSAGE_BUMP_PRIOR_MESSAGES_OTHER_CHATS_NOTICES_PUSH_CASH_PRIZES_UNCHANGED_PASS');
 }};
}
