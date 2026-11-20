import { expect, test } from "@playwright/test";

const api = "http://127.0.0.1:54321";
const actor = "10000000-0000-4000-8000-000000000001";
const clubs = [
  { id: "10000000-0000-4000-8000-000000000011", name: "TEST Alpha", suffix: "Alpha", net: 111_000 },
  { id: "10000000-0000-4000-8000-000000000012", name: "TEST Bravo", suffix: "Bravo", net: 222_000 },
] as const;

for (const width of [1440, 390]) {
  test(`accountant switches all three populated views at ${width}px`, async ({ page }) => {
    test.skip(process.env.VITE_SUPABASE_URL !== api, "Requires isolated loopback fixtures");
    await page.setViewportSize({ width, height: 844 });
    const expiry = 4_102_444_800;
    const access_token = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${Buffer.from(JSON.stringify({ sub: actor, exp: expiry })).toString("base64url")}.`;
    const user = { id: actor, aud: "authenticated", role: "authenticated", email: "operator@example.test",
      email_confirmed_at: "2026-10-01T00:00:00Z", app_metadata: {}, user_metadata: {} };
    await page.addInitScript((session) => localStorage.setItem("sb-127-auth-token", JSON.stringify(session)), {
      access_token, refresh_token: "fixture-refresh", expires_at: expiry, token_type: "bearer", user,
    });
    await page.route(`${api}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const json = (body: unknown) => route.fulfill({ json: body });
      if (url.pathname.endsWith("/auth/v1/user")) return json(user);
      if (url.pathname.endsWith("/clubs")) {
        return json(url.searchParams.has("id") ? [clubs[1]] : [clubs[0]]);
      }
      if (url.pathname.endsWith("/club_accountants")) return json([{ club_id: clubs[1].id }]);
      if (url.pathname.endsWith("/rpc/get_my_ops_capability_scope")) return json(clubs.map((club, index) => ({
        club_id: club.id, can_owner: index === 0, can_accountant: index === 1, can_floor: false,
        can_cashier: false, can_tracker: false, can_dealer_control: false, can_chip_master: false,
        can_marketer: false, can_fnb_cashier: false, can_fnb_server: false, can_fnb_kitchen: false,
      })));
      if (url.pathname.endsWith("/rpc/get_my_ops_global_capability")) return json([{ is_super_admin: false }]);
      const body = request.method() === "POST" ? request.postDataJSON() : {};
      const club = clubs.find((entry) => entry.id === (body?.p_club_id ?? url.searchParams.get("club_id")?.replace(/^eq\./, "")));
      if (url.pathname.endsWith("/rpc/get_accountant_capabilities")) return json({ is_accountant: club === clubs[1], staff: true, expenses: true, payroll: true });
      if (url.pathname.endsWith("/rpc/get_staff_salary_report") && club) {
        return json({ club_id: club.id, period_year: body.p_year, period_month: body.p_month, header: { status: "approved" },
          rows: [{ id: `run-${club.suffix}`, staff_id: `staff-${club.suffix}`, full_name: `Lương ${club.suffix}`,
            department: "service", employment_type: "full_time", status: "locked", gross_vnd: club.net,
            net_vnd: club.net, manual_bhxh_vnd: 0, manual_tax_vnd: 0 }], total_gross_vnd: club.net, total_net_vnd: club.net,
        });
      }
      if (url.pathname.endsWith("/staff") && club) return json([{ id: `staff-${club.suffix}`, full_name: `Nhân viên ${club.suffix}`,
        department: "service", employment_type: "full_time", status: "active", monthly_salary_vnd: club.net,
      }]);
      if (url.pathname.endsWith("/rpc/get_club_expenses") && club) return json({ club_id: club.id, from: body.p_from, to: body.p_to,
        rows: [{ id: `expense-${club.suffix}`, club_id: club.id, category: "misc", description: `Chứng từ ${club.suffix}`,
          amount_vnd: club.net, incurred_at: body.p_from, payment_status: "paid", payment_source: "cash" }],
        total_vnd: club.net, paid_vnd: club.net, unpaid_vnd: 0, by_category: { misc: club.net },
      });
      return json([]);
    });

    await page.goto("/accountant");
    for (const [selected, other] of [[clubs[0], clubs[1]], [clubs[1], clubs[0]], [clubs[0], clubs[1]]] as const) {
      const clubPicker = page.getByRole("main").getByRole("combobox").filter({ hasText: /TEST (Alpha|Bravo)/ });
      if (!(await clubPicker.textContent())?.includes(selected.name)) {
        await clubPicker.click();
        await page.getByRole("option", { name: selected.name, exact: true }).click();
      }
      for (const [tab, label] of [["Bảng lương", "Lương"], ["Nhân viên & lương", "Nhân viên"], ["Sổ chi phí", "Chứng từ"]]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        const panel = page.getByRole("tabpanel", { name: tab });
        await expect(panel.getByText(`${label} ${selected.suffix}`, { exact: true })).toBeVisible();
        await expect(panel.getByText(`${label} ${other.suffix}`, { exact: true })).toHaveCount(0);
      }
    }
  });
}
