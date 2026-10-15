import {expect,test} from '@playwright/test';

for(const width of [375,1280]) test(`retired GTO does not bootstrap on operational routes at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:850});
 const gtoRequests:string[]=[];
 page.on('request',request=>{
  if(request.url().includes('gto_spot_ranges'))gtoRequests.push(request.url());
 });
 // Local mocked backend only. No real auth, operations writes or database calls.
 await page.route('http://127.0.0.1:54321/**',async route=>{
  await route.fulfill({status:200,contentType:'application/json',body:'[]'});
 });
 for(const path of ['/floor','/tracker','/dealer-swing','/chip-ops','/admin/gto-ranges']){
  await page.goto(path);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.locator('body')).not.toContainText('Chỉ Super Admin mới được chỉnh sửa');
 }
 expect(gtoRequests).toEqual([]);
});
