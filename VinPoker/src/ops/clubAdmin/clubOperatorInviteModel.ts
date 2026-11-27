export const operatorInviteRoles = ["floor", "cashier", "dealer_control"] as const;
export type OperatorInviteRole = (typeof operatorInviteRoles)[number];
export const operatorInviteRoleLabel: Record<OperatorInviteRole, string> = {
  floor: "Floor",
  cashier: "Cashier",
  dealer_control: "Dealer Control",
};
export function isOperatorInviteRole(
  value: string,
): value is OperatorInviteRole {
  return (operatorInviteRoles as readonly string[]).includes(value);
}
export function inviteStatusLabel(status: string): string {
  if (status === "pending") return "Đang chờ nhận lời mời";
  if (status === "revoked") return "Đã thu hồi";
  return "Đang có quyền";
}
