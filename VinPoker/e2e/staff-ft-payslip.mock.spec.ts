import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const actor = "16840000-0000-4000-8000-000000000001";
const club = "16840000-0000-4000-8000-000000000011";
const staff = "16840000-0000-4000-8000-000000000021";
const run = "16840000-0000-4000-8000-000000000031";
const api = "http://127.0.0.1:54321";

test("FT employee sees the same monthly slip after the club records payment", async ({ page }) => {
  test.skip(process.env.VITE_SUPABASE_URL !== api || process.env.VITE_STAFF_FT_PAYSLIPS_V1 !== "true", "Requires isolated loopback fixtures");
  await page.setViewportSize({ width: 390, height: 844 });
  const expiry = 4_102_444_800;
  const token = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${Buffer.from(JSON.stringify({ sub: actor, exp: expiry })).toString("base64url")}.`;
  const user = { id: actor, aud: "authenticated", role: "authenticated", email: "staff@example.test",
    email_confirmed_at: "2026-10-01T00:00:00Z", app_metadata: {}, user_metadata: {} };
  await page.addInitScript((session) => localStorage.setItem("sb-127-auth-token", JSON.stringify(session)), {
    access_token: token, refresh_token: "fixture-refresh", expires_at: expiry, token_type: "bearer", user,
  });

  let recorded = false;
  const native = process.env.L05_NATIVE_BROWSER === "1";
  const query = (actorId: string, sql: string, runId = run) => JSON.parse(execFileSync("psql", [
    "-XAtq", "-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", "vinpoker_ops_l05",
    "-v", "ON_ERROR_STOP=1", "-v", `actor=${actorId}`, "-v", `run=${runId}`,
  ], { input: `SET request.jwt.claim.sub = :'actor';\nSET ROLE authenticated;\n${sql}\n`, encoding: "utf8", timeout: 10_000 }).trim());
  let approvedRun: string | undefined;
  const reads: unknown[] = [];
  await page.route(`${api}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === "/auth/v1/user") return json(user);
    if (path === "/rest/v1/staff") return json([{ id: staff, club_id: club, user_id: actor,
      full_name: "L05 TEST FT", department: "service", employment_type: "full_time", status: "active",
      monthly_salary_vnd: 5_200_000, clubs: { name: "L05 TEST CLUB" },
    }]);
    if (path.endsWith("/rpc/get_my_staff_salary")) return json({ staff_id: staff, club_id: club,
      employment_type: "full_time", hourly_rate_vnd: 0, accrued_minutes: 0, balance_vnd: 0, last_reset_at: null,
      current_shift_open: false, current_shift_start: null, monthly_salary_vnd: 5_200_000, recent_payments: [],
    });
    if (path.endsWith("/rpc/get_my_staff_ft_payslips_v1")) {
      reads.push(request.postDataJSON());
      if (native) {
        const packet = query(actor, `SELECT public.get_my_staff_ft_payslips_v1('${staff}', '${club}');`);
        const october = packet.payslips.find((slip: { period_month: number }) => slip.period_month === 10);
        if (!recorded) approvedRun = october.id;
        expect(october.id).toBe(approvedRun);
        return json(packet);
      }
      return json({ staff_id: staff, club_id: club, payslips: [{
        id: run, period_year: 2026, period_month: 10, net_vnd: 4_900_000,
        status: recorded ? "recorded_paid" : "approved",
        paid_at: recorded ? "2026-11-01T01:00:00Z" : null,
        payment_method: recorded ? "bank_transfer" : null,
      }] });
    }
    return json([]);
  });

  await page.goto("/staff/salary");
  const slips = page.getByRole("region", { name: "Phiếu lương tháng" });
  const slip = slips.getByRole("heading", { name: /10\/2026.*4[.,]900[.,]000/ });
  const octoberCard = slip.locator("..");
  await expect(slip).toHaveCount(1);
  await expect(octoberCard.getByText("Đã duyệt", { exact: true })).toBeVisible();
  if (native) {
    expect(approvedRun).toBeTruthy();
    const receipt = query("16840000-0000-4000-8000-000000000003",
      "SELECT public.mark_staff_salary_paid(:'run', 'bank_transfer', 'TEST-L05-BROWSER');", approvedRun);
    expect(receipt).toMatchObject({ status: "paid", run_id: approvedRun });
  }
  recorded = true;
  await page.reload();
  await expect(slip).toHaveCount(1);
  await expect(octoberCard.getByText(/CLB đã ghi chi.*chuyển khoản/)).toBeVisible();
  await expect(octoberCard.getByText("Đã duyệt", { exact: true })).toHaveCount(0);
  expect(reads).toEqual(Array(2).fill({ p_staff_id: staff, p_club_id: club }));
});
