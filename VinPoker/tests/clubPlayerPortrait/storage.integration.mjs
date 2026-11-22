import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const env = JSON.parse(readFileSync(process.argv[2], "utf8"));
const base = new URL(env.API_URL);
const database = new URL(env.DB_URL);
for (const url of [base, database]) assert.equal(url.hostname, "127.0.0.1", "loopback fixture required");
const jpeg = readFileSync(new URL("./swatch.jpg", import.meta.url));
const club = randomUUID(), member = randomUUID(), upload = randomUUID();
const headers = { apikey: env.ANON_KEY, "Content-Type": "application/json" };
const signup = await fetch(new URL("/auth/v1/signup",base), {method:"POST",headers,body:JSON.stringify({
  email:"portrait-fixture@example.test",password:randomBytes(24).toString("hex")
})});
assert.ok(signup.ok, `local signup HTTP ${signup.status}`);
const session = await signup.json();
assert.match(session.user.id,/^[0-9a-f-]{36}$/);assert.ok(session.access_token);
headers.Authorization = "Bearer " + session.access_token;
execFileSync("psql",[database.href,"-X","-v","ON_ERROR_STOP=1","-c",`
 INSERT INTO public.clubs(id,owner_id) VALUES('${club}',NULL);
 INSERT INTO public.club_cashiers VALUES('${club}','${session.user.id}');
 INSERT INTO public.club_members VALUES('${member}','${club}','Photo fixture',NULL);
`],{stdio:["ignore","ignore","inherit"]});
async function rpc(action) {
 const r=await fetch(new URL("/rest/v1/rpc/club_player_portrait_v1",base),{method:"POST",headers,body:JSON.stringify({
  p_context:{kind:"member",club,member,expected_member:member},p_action:action,p_expected:null,p_upload:upload
 })});
 assert.ok(r.ok, `photo ${action} HTTP ${r.status}`);return r.json();
}
await rpc("prepare");
const object="/storage/v1/object/club-player-portraits/"+upload+".jpg";
const result=await fetch(new URL(object,base),{method:"POST",headers:{...headers,"Content-Type":"image/jpeg","x-upsert":"false"},body:jpeg});
assert.ok(result.ok,`real JPEG upload HTTP ${result.status}`);
const receipt=await rpc("publish");
assert.equal(receipt.version,upload);
assert.equal(new URL(receipt.url).origin,base.origin);
const image=await fetch(receipt.url);
assert.equal(image.status,200);
assert.match(image.headers.get("Content-Type"),/image\/jpeg/);
assert.deepEqual(Buffer.from(await image.arrayBuffer()),jpeg);
const retry=await rpc("publish");
assert.equal(retry.version,upload);
const list=await fetch(new URL("/storage/v1/object/list/club-player-portraits",base),{
 method:"POST",headers,body:JSON.stringify({prefix:"",limit:10})
});
assert.ok(list.ok);assert.deepEqual(await list.json(),[]);
const other=await fetch(new URL(object.replace(upload,randomUUID()),base),{method:"POST",headers:{...headers,"Content-Type":"image/jpeg"},body:jpeg});
assert.ok(!other.ok,"unreserved upload must be rejected");
console.log("Local Supabase Auth → PostgREST → Storage → public thumbnail: bytes match. Directory listing empty; unreserved upload denied.");
