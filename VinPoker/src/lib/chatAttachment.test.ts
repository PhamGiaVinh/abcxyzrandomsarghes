import {describe,it,expect} from 'vitest';
import {privateChatAttachmentPath,privateChatAttachmentReference,isPrivateChatAttachment,safeChatAttachmentUrl} from './chatAttachment';
const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',chat='a0000000-0000-4000-8000-000000000001';
describe('private chat object reference boundary',()=>{
 it('keeps a stable reference scoped to the exact conversation',()=>{
  const path=`${actor}/dm/${chat}/asset.png`,ref=privateChatAttachmentReference(path);
  expect(isPrivateChatAttachment(ref)).toBe(true);expect(privateChatAttachmentPath(ref,{kind:'dm',id:chat})).toBe(path);
  expect(privateChatAttachmentPath(ref,{kind:'groups',id:chat})).toBeNull();
  expect(privateChatAttachmentPath(ref,{kind:'dm',id:'a0000000-0000-4000-8000-000000000002'})).toBeNull();
 });
 it.each([`bad/dm/${chat}/x.png`,`${actor}/dm/${chat}/../x.png`,`${actor}/dm/${chat}/%2e.png`,`${actor}/dm/${chat}/x.png?token=secret`])('rejects unsafe object reference %s',path=>{
  expect(privateChatAttachmentPath(privateChatAttachmentReference(path),{kind:'dm',id:chat})).toBeNull();
 });
 it.each(['javascript:alert(1)','data:text/html,bad','//host/path','https://user:pass@example.test/asset',null])('does not render unsafe legacy/signed link %s',url=>expect(safeChatAttachmentUrl(url)).toBeNull());
 it('preserves a valid legacy HTTPS URL without pretending it is private',()=>{
  expect(safeChatAttachmentUrl('https://test.invalid/old.png')).toBe('https://test.invalid/old.png');
  expect(isPrivateChatAttachment('https://test.invalid/old.png')).toBe(false);
 });
});
