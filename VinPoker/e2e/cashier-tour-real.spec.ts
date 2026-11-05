import { expect, test, type Page } from "@playwright/test";
import {writeFileSync} from 'node:fs';

const required = [
  "LOCAL_SUPABASE_URL",
  "LOCAL_SUPABASE_ANON_KEY",
  "LOCAL_OWNER_EMAIL",
  "LOCAL_OWNER_PASSWORD",
  "LOCAL_SUPABASE_STORAGE_KEY",
  "LOCAL_REFUND_REGISTRATION_ID",
  "LOCAL_REFUND_REFERENCE_CODE",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`missing ${name}`);
}

async function loginOwner(page: Page) {
  const api = process.env.LOCAL_SUPABASE_URL!.replace(/\/$/, "");
  const anon = process.env.LOCAL_SUPABASE_ANON_KEY!;
  const response = await fetch(`${api}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.LOCAL_OWNER_EMAIL,
      password: process.env.LOCAL_OWNER_PASSWORD,
    }),
  });
  const session = await response.json();
  expect(response.ok).toBe(true);
  expect(session.access_token).toBeTruthy();

  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: process.env.LOCAL_SUPABASE_STORAGE_KEY!, value: session });
  return session.access_token as string;
}

test('authenticated Cashier worklist HTTP latency on isolated fixture',async({page})=>{
 test.skip(!process.env.LOCAL_OPERATIONS_LATENCY_REPORT,'Latency output is enabled only by the isolated stack');
 test.setTimeout(120_000);
 expect(process.env.LOCAL_OPERATIONS_SOURCE_SHA).toMatch(/^[a-f0-9]{40}$/);
 const token=await loginOwner(page),samples:number[]=[];
 for(let i=0;i<120;i++){
  const started=performance.now();
  const response=await fetch(process.env.LOCAL_SUPABASE_URL!.replace(/\/$/,'')+'/rest/v1/rpc/cashier_tour_worklist_v1',{
   method:'POST',headers:{apikey:process.env.LOCAL_SUPABASE_ANON_KEY!,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
   body:JSON.stringify({p_club_id:'a2000000-0000-4000-8000-000000000001',p_tournament_id:'a3000000-0000-4000-8000-000000000001',p_query:'',p_bucket:'all',p_page:0,p_limit:50}),signal:AbortSignal.timeout(5000),
  });
  const result=await response.json(),elapsed=performance.now()-started;
  expect(response.ok).toBe(true);expect(result.ok).toBe(true);expect(result.error).toBeUndefined();
  expect(Array.isArray(result.rows)).toBe(true);expect(result.rows.length).toBeGreaterThan(0);
  if(i>=20)samples.push(elapsed);
 }
 const ordered=[...samples].sort((a,b)=>a-b);
 writeFileSync(process.env.LOCAL_OPERATIONS_LATENCY_REPORT!,JSON.stringify({kind:'REAL_AUTHENTICATED_POSTGREST_CASHIER_READ_LATENCY',sha:process.env.LOCAL_OPERATIONS_SOURCE_SHA,operation:'cashier_tour_worklist_v1',warmup:20,graded:samples.length,concurrency:1,transport:'Actual HTTP through isolated gateway; complete JSON body; excludes login',samplesMs:samples,p50Ms:ordered[49],p95Ms:ordered[94],p99Ms:ordered[98],maxMs:ordered.at(-1),qualification:false,limitations:'Small fixed TEST tour,owner actor,no Realtime,no concurrent writers; not production capacity or screen render latency'},null,2));
});

test("real Auth and Cashier backend render the completed seated buy-in", async ({ page }) => {
  await loginOwner(page);
  const cashierReads: string[] = [];
  page.on("response", async (response) => {
    if (response.url().includes("/rpc/cashier_tour_worklist_v1")) {
      cashierReads.push(`${response.status()} ${(await response.text()).slice(0, 700)}`);
    }
  });

  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
  });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/ops/cashier/tour?club=a2000000-0000-4000-8000-000000000001");

  try {
    await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    console.error(JSON.stringify({
      browser_url: page.url(),
      body: (await page.locator("body").innerText()).slice(0, 2_000),
      page_errors: pageErrors,
      request_failures: requestFailures,
    }, null, 2));
    throw error;
  }
  await page.getByRole("button", { name: /^Cashier Edge TEST Tour ·/ }).first().click();
  await page.getByRole("button", { name: /Đã tự hoàn tất/ }).click();
  try {
    await expect(page.getByRole("button", { name: /Người chơi Edge TEST/ })).toBeVisible();
  } catch (error) {
    console.error(JSON.stringify({ body: (await page.locator("body").innerText()).slice(0, 2_000), cashierReads }));
    throw error;
  }
  await expect(page.getByText(/Phiếu đã cấp: bàn 1, ghế \d+/u)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("real Cashier UI refunds a waiting Tour B registration while serving Tour A", async ({ page }) => {
  const token = await loginOwner(page);
  const lookupReads: string[] = [];
  page.on("response", async (response) => {
    if (response.url().includes("/rpc/cashier_lookup_tour_v1")) {
      lookupReads.push(`${response.status()} ${(await response.text()).slice(0, 700)}`);
    }
  });
  const registrationId = process.env.LOCAL_REFUND_REGISTRATION_ID!;
  const referenceCode = process.env.LOCAL_REFUND_REFERENCE_CODE!;
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/ops/cashier/tour?club=a2000000-0000-4000-8000-000000000001");
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Cashier Edge TEST Tour ·/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Cashier Edge TEST Tour" })).toBeVisible();
  await page.getByPlaceholder("Quét QR, thẻ hội viên, mã CK; hoặc tìm tên, số điện thoại").fill(referenceCode);
  try {
    await page.getByRole("button", { name: "Xem đăng ký tour này" }).waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    console.error(JSON.stringify({ body: (await page.locator("body").innerText()).slice(0, 2_000), lookupReads }));
    throw error;
  }
  await page.getByRole("button", { name: "Xem đăng ký tour này" }).click();
  await expect(page.getByRole("dialog", { name: /Chi tiết buy-in/ })
    .getByText("Tour của lượt này: Cashier Edge TEST Tour B")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Cashier Edge TEST Tour" })).toBeVisible();

  const detail = page.getByRole("dialog", { name: /Chi tiết buy-in/ });
  await detail.getByLabel("Lý do").fill("TEST refund before seating");
  const requestResponse = page.waitForResponse((response) => response.url().endsWith("/rpc/cashier_request_refund_v1"));
  await detail.getByRole("button", { name: "Yêu cầu hoàn tiền" }).click();
  const requested = await requestResponse;
  expect(requested.request().postDataJSON().p_registration_id).toBe(registrationId);
  expect((await requested.json()).ok).toBe(true);
  await detail.getByLabel("Tiền mặt").fill("6600000");
  await detail.getByLabel("Chuyển khoản").fill("0");
  await detail.getByLabel("Bằng chứng chi hoàn").fill("TEST paid in isolated cashier E2E");
  page.once("dialog", (dialog) => dialog.accept());
  const payoutResponse = page.waitForResponse((response) => response.url().endsWith("/rpc/cashier_complete_refund_v1"));
  await detail.getByRole("button", { name: "Ghi nhận đã chi hoàn" }).click();
  const payout = await payoutResponse;
  expect((await payout.json()).ok).toBe(true);

  const retry = await page.evaluate(async ({ api, anon, accessToken, refundId }) => {
    const response = await fetch(`${api}/rest/v1/rpc/cashier_complete_refund_v1`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_refund_id: refundId, p_cash_amount: 6600000,
        p_bank_amount: 0, p_bank_reference: "", p_evidence: "TEST retry in isolated cashier E2E" }),
    });
    return { status: response.status, body: await response.json() };
  }, { api: process.env.LOCAL_SUPABASE_URL!, anon: process.env.LOCAL_SUPABASE_ANON_KEY!,
    accessToken: token, refundId: (await requested.json()).refund_id as string });
  expect(retry.status).toBe(200);
  expect(retry.body.already_paid).toBe(true);
});
