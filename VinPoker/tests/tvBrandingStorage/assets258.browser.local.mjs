import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export function createTv258Assets({sql,query,actor,club,tour,log}){
 assert.equal(tour,'c367013a-3ed3-48af-ad48-3915acadc50e');
 assert.equal(club,'d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 assert.equal(actor,'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql("SELECT obj_description('floor_private.tv258_blob_fixture'::regclass,'pg_class');"),'LOCAL_TV258_BLOB_PROVIDER_MODEL_NOT_HOSTED');
 assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.get_tv_tournament_branding_v1(uuid)'::regprocedure),chr(13),''));"),'3d4d6c43f1a3987568a376897a1b74e7');
 assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.save_tv_tournament_layout_v1(uuid,bigint,text,text,text,jsonb)'::regprocedure),chr(13),''));"),'c1dc34bb649fe67df29c12666d3b91d0');
 assert.equal(sql("SELECT public FROM storage.buckets WHERE id='backing-proofs';"),'t');
 const gate=sql('SELECT to_jsonb(r) FROM public.centerpoint_tournament_ops_release r WHERE id;');
 assert.equal(JSON.parse(gate).enabled,false);
 const quote=value=>`'${String(value).replaceAll("'","''")}'`;
 const pathPattern=new RegExp(`^${actor}/tv/(branding-logo|branding-background)/v1/[a-f0-9-]{36}\\.(png|jpg)$`);
 const gated=statement=>query(`RESET ROLE;
  CREATE TEMP TABLE tv258_gate ON COMMIT DROP AS SELECT * FROM public.centerpoint_tournament_ops_release WHERE id FOR UPDATE;
  UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;
  SET LOCAL ROLE authenticated;${statement}RESET ROLE;
  UPDATE public.centerpoint_tournament_ops_release SET(enabled,allowed_club_ids,updated_at)=(SELECT enabled,allowed_club_ids,updated_at FROM tv258_gate) WHERE id;`);
 const priorIds=JSON.parse(sql(`SELECT coalesce(jsonb_agg(id),'[]') FROM storage.objects WHERE name LIKE '${actor}/tv/%';`));
 const protectedAssets=()=>sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]')::text) FROM storage.objects o
  WHERE name NOT LIKE '${actor}/tv/%' OR id IN(${priorIds.length?priorIds.map(id=>quote(id)+'::uuid').join(','):'NULL::uuid'});`);
 const prior=protectedAssets();
 return {
  async upload(req,path){
   assert.match(path,pathPattern);assert.equal(String(req.headers['x-upsert']),'false');
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;assert.ok(size<=5242880+65536,'local asset request too large');chunks.push(Buffer.from(chunk));}
   const contentType=req.headers['content-type']??'';let bytes=Buffer.concat(chunks),mimetype=contentType;
   if(contentType.startsWith('multipart/form-data')){
    const form=await new Response(bytes,{headers:{'Content-Type':contentType}}).formData();
    assert.equal(form.get('cacheControl'),'31536000');
    const files=Array.from(form.values()).filter(value=>typeof value!=='string');assert.equal(files.length,1);
    mimetype=files[0].type;bytes=Buffer.from(await files[0].arrayBuffer());
   }
   assert.ok(bytes.length>0&&bytes.length<=5242880);
   assert.ok(mimetype==='image/png'||mimetype==='image/jpeg');
   assert.ok(mimetype==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')));
   assert.ok(path.endsWith(mimetype==='image/png'?'.png':'.jpg'));
   const sha=createHash('sha256').update(bytes).digest('hex');
   const value=gated(`INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('backing-proofs',${quote(path)},jsonb_build_object('size',${bytes.length},'mimetype',${quote(mimetype)}));
    RESET ROLE;INSERT INTO floor_private.tv258_blob_fixture(name,bytes,mimetype,sha256) VALUES(${quote(path)},decode('${bytes.toString('hex')}','hex'),${quote(mimetype)},'${sha}');
    SELECT jsonb_build_object('Id',id,'Key','backing-proofs/'||name) FROM storage.objects WHERE bucket_id='backing-proofs' AND name=${quote(path)};`);
   log.push({storage:'upload258',path,size:bytes.length,mimetype,sha256:sha,metadataId:value.Id});return value;
  },
  publicImage(path){
   assert.match(path,pathPattern);
   const value=JSON.parse(sql(`SELECT jsonb_build_object('base64',encode(b.bytes,'base64'),'mimetype',b.mimetype,'sha256',b.sha256)
    FROM floor_private.tv258_blob_fixture b JOIN storage.objects o ON o.name=b.name AND o.bucket_id='backing-proofs' WHERE b.name=${quote(path)};`)||'null');
   if(!value)return null;const bytes=Buffer.from(value.base64,'base64');assert.equal(createHash('sha256').update(bytes).digest('hex'),value.sha256);
   log.push({storage:'public258',path,size:bytes.length,sha256:value.sha256});return {bytes,mimetype:value.mimetype};
  },
  rpc(name,args){
   assert.ok(['get_tv_tournament_branding_v1','save_tv_tournament_layout_v1'].includes(name));assert.equal(args.p_tournament_id,tour);
   const write=name==='save_tv_tournament_layout_v1';
   const types=write?{p_tournament_id:'uuid',p_expected_revision:'bigint',p_brand_name:'text',p_logo_url:'text',p_bg_url:'text',p_layout:'jsonb'}:{p_tournament_id:'uuid'};
   assert.deepEqual(Object.keys(args).sort(),Object.keys(types).sort());
   if(write){assert.ok(Number.isSafeInteger(args.p_expected_revision)&&args.p_expected_revision>=0);assert.ok(typeof args.p_brand_name==='string'&&args.p_brand_name.length<=128);}
   const params=Object.entries(types).map(([key,type])=>`${key}=>${quote(type==='jsonb'?JSON.stringify(args[key]):args[key])}::${type}`);
   const value=gated(`SELECT public.${name}(${params.join(',')});`);
   log.push({rpc:name,scope:'tv258',expectedRevision:args.p_expected_revision??null,revision:value.revision,logo:value.logo_url,background:value.background_url});
   return {value,write};
  },
  cleanup(){
   assert.equal(sql('SELECT to_jsonb(r) FROM public.centerpoint_tournament_ops_release r WHERE id;'),gate);
   assert.equal(protectedAssets(),prior);
   console.log('TV258_GATE_OTHER_ASSETS_UNCHANGED_LOCAL_BLOB_MODEL_PASS');
  },
 };
}
