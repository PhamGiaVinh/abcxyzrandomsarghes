import { describe, expect, it } from "vitest";
import { inviteStatusLabel, isOperatorInviteRole, operatorInviteRoleLabel, operatorInviteRoles } from "./clubOperatorInviteModel";

describe("club operator invitation model", () => {
  it("recognizes only the supported club operator roles", () => {
    expect(operatorInviteRoles).toEqual(["floor", "cashier", "dealer_control"]);
    expect(isOperatorInviteRole("floor")).toBe(true);
    expect(isOperatorInviteRole("cashier")).toBe(true);
    expect(isOperatorInviteRole("dealer_control")).toBe(true);
    expect(operatorInviteRoleLabel.dealer_control).toBe("Dealer Control");
    expect(isOperatorInviteRole("owner")).toBe(false);
    expect(isOperatorInviteRole("club_admin")).toBe(false);
  });

  it("labels revoked membership clearly", () => {
    expect(inviteStatusLabel("active")).toBe("Đang có quyền");
    expect(inviteStatusLabel("revoked")).toBe("Đã thu hồi");
  });
});
