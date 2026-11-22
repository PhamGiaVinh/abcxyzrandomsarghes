import { test, expect, devices } from "@playwright/test";
import { build } from "esbuild";

let bundle: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, jsx: "automatic", stdin: {
    loader: "tsx", resolveDir: process.cwd(), contents: `
import {createRoot} from "react-dom/client";
import {ClubPlayerPortrait} from "./src/components/players/ClubPlayerPortrait";
let version=null, exists=false, firstPublish=true;
const client={
 rpc:async (_,args)=>{
  window.calls.push(args.p_action);
  if(args.p_action==="publish"){
    if(firstPublish){firstPublish=false;return {error:{message:"lost"},data:null}}
    version=args.p_upload;
  }
  return {data:{member:"m",club:"c",name:"Người chơi TEST",version,url:null},error:null};
 },
 storage:{from:()=>({upload:async(path,blob,opts)=>{
  window.uploads.push({path,type:blob.type,bytes:blob.size,overwrite:opts.upsert});
  if(exists)return {error:{statusCode:"409",message:"already exists"}};
  exists=true;return {error:null}
 }})}
};
window.calls=[];window.uploads=[];
createRoot(document.getElementById("root")).render(<ClubPlayerPortrait client={client} name="TEST" target={{kind:"member",club:"c",member:"m"}}/>);
` }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_CLUB_PLAYER_PORTRAITS": '"true"' } });
  bundle = result.outputFiles[0].text;
});
for (const [label, device] of [["iPad", devices["iPad (gen 7) landscape"]], ["iPhone", devices["iPhone 13"]]] as const) {
  test(`${label} captures a scoped photo and recovers a lost confirmation`, async ({ browser }) => {
    const context = await browser.newContext({ ...device });
    try {
      const page = await context.newPage();
      await page.route("https://portrait.test/**", route => route.fulfill(
        route.request().url().endsWith("fixture.js")
          ? { contentType: "text/javascript", body: bundle }
          : { contentType: "text/html", body: '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script>' }));
      await page.goto("https://portrait.test");
      await page.getByRole("button", { name: "Ảnh người chơi của CLB" }).tap();
      await expect(page.getByText("Chưa có ảnh tại CLB")).toBeVisible();
      await expect(page.locator('input[capture]')).toHaveAttribute("capture","environment");
      const bytes = await page.evaluate(() => {
        const canvas = document.createElement("canvas"); canvas.width=640; canvas.height=480;
        const ctx=canvas.getContext("2d")!;ctx.fillStyle="#195e4a";ctx.fillRect(0,0,640,480);
        return canvas.toDataURL("image/png").split(",")[1];
      });
      const picker=page.waitForEvent("filechooser");
      await page.getByRole("button",{name:"Chọn từ máy"}).tap();
      await (await picker).setFiles({name:"fixture.png",mimeType:"image/png",buffer:Buffer.from(bytes,"base64")});
      await expect(page.getByAltText("Ảnh của Người chơi TEST")).toBeVisible();
      // A failed replacement must discard the earlier draft before consent can be given.
      await page.locator('input:not([capture])[type=file]').setInputFiles({name:"bad.png",mimeType:"image/png",buffer:Buffer.from("broken")});
      await expect(page.getByRole("status")).not.toBeEmpty();
      await expect(page.getByRole("button",{name:"Lưu ảnh cho Người chơi TEST"})).toHaveCount(0);
      await page.locator('input:not([capture])[type=file]').setInputFiles({name:"retry.png",mimeType:"image/png",buffer:Buffer.from(bytes,"base64")});
      await expect(page.getByAltText("Ảnh của Người chơi TEST")).toBeVisible();
      expect(await page.evaluate(()=>(window as any).uploads.length)).toBe(0);
      const save=page.getByRole("button",{name:"Lưu ảnh cho Người chơi TEST"});
      await expect(save).toBeDisabled();
      await page.getByRole("checkbox").check();
      await save.tap();
      await expect(page.getByRole("status")).toContainText("Chưa xác nhận");
      await save.tap();
      await expect(page.getByRole("status")).toContainText("Đã lưu ảnh");
      const records=await page.evaluate(()=>(window as any).uploads);
      expect(records).toHaveLength(2);
      expect(records[0].path).toBe(records[1].path);
      expect(records[0]).toMatchObject({type:"image/jpeg",overwrite:false});
      expect(records[0].bytes).toBeLessThanOrEqual(131072);
    } finally { await context.close(); }
  });
}
