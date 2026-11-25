import { expect, it } from "vitest";
import { financeDestination } from "./financeNavigation";

it("carries club and report dates while preserving the destination task", () => {
  expect(financeDestination("/accountant?tab=salary", "?club=B&from=2026-11-01&to=2026-11-25&tab=report&payment_id=old"))
    .toBe("/accountant?tab=salary&club=B&from=2026-11-01&to=2026-11-25");
});

it("keeps an explicit invalid scope for the consumer to reject", () => {
  expect(financeDestination("/cashier", "?club=unavailable&from=bad"))
    .toBe("/cashier?club=unavailable&from=bad");
});
