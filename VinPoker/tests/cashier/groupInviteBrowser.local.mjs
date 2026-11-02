import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export function createGroupInviteBrowser({sql,query,actor,log}) {
  assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
  const group=randomUUID(),token=randomUUID(),owner='a364de8e-06b1-4428-a20d-ac614ec406e5';let drop=true;
  assert.notEqual(actor,owner);
  sql(`BEGIN;INSERT INTO public.chat_groups(id,name,created_by,is_public) VALUES('${group}','LOCAL TEST invite browser recovery','${owner}',false);
    INSERT INTO public.chat_group_invites(group_id,token,created_by,max_uses) VALUES('${group}','${token}','${owner}',1);COMMIT;`);
  return {
    manifest:{group,token},
    route(url,method,body){
      if(method!=='POST')return null;
      if(url.pathname==='/rest/v1/rpc/get_invite_preview'){
        assert.deepEqual(body,{_token:token});
        const value=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.get_invite_preview('${token}') t;`);
        log.push({inviteRead:true,valid:value[0]?.valid,reason:value[0]?.reason});return{status:200,value};
      }
      if(url.pathname==='/rest/v1/rpc/accept_group_invite_v2'){
        assert.deepEqual(Object.keys(body).sort(),['_request_id','_token']);assert.equal(body._token,token);assert.match(body._request_id,/^[a-f0-9-]{36}$/);
        const value=query(`SELECT public.accept_group_invite_v2('${token}','${body._request_id}');`);
        log.push({inviteAccept:true,request:body._request_id,outcome:value.outcome});
        if(drop){drop=false;log.push({inviteFault:'LOCAL_DROP_AFTER_ACCEPT_COMMIT',request:body._request_id});return{status:503,value:{message:'LOCAL_RESPONSE_LOST'}};}
        return{status:200,value};
      }
      return null;
    },
    evidence(){return JSON.parse(sql(`SELECT jsonb_build_object('group','${group}',
      'uses',(SELECT uses FROM public.chat_group_invites WHERE token='${token}'),
      'membership',(SELECT count(*) FROM public.chat_group_members WHERE group_id='${group}' AND user_id='${actor}'),
      'receipts',(SELECT count(*) FROM public.chat_group_invite_accept_receipts_v2 WHERE group_id='${group}' AND actor_id='${actor}'));`));},
  };
}
