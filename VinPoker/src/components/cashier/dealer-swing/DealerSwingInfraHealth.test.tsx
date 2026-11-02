import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DealerSwingInfraHealth from "./DealerSwingInfraHealth";

const clubs = [{ id: "a", name: "Quads TEST" }, { id: "b", name: "Centerpoint TEST" }];
const row = { club_id: "a", lock: { held: false }, pre_announce: { pending: 0, processing: 0, failed_recent: 0 }, overdue_now: 0, last_swing_activity_at: null };
describe("Swing health completeness", () => {
 it("shows missing clubs without hiding confirmed rows", () => {
  render(<DealerSwingInfraHealth health={[row]} clubs={clubs} unavailable={false} nowMs={0} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Centerpoint TEST");
  expect(screen.getByText("Nhàn rỗi")).toBeInTheDocument();
 });
 it("does not hide an empty successful response", () => {
  render(<DealerSwingInfraHealth health={[]} clubs={clubs} unavailable={false} nowMs={0} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Không xác minh được");
 });
 it("distinguishes initial loading from missing data", () => {
  render(<DealerSwingInfraHealth health={null} clubs={clubs} unavailable={false} nowMs={0} />);
  expect(screen.getByRole("status")).toHaveTextContent("Đang xác minh");
 });
});
