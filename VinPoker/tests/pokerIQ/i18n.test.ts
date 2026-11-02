// tests/pokerIQ/i18n.test.ts — pokerDrill namespace parity + mandatory disclaimer.
import { describe, it, expect } from "vitest";
import vi from "@/i18n/locales/vi.json";
import en from "@/i18n/locales/en.json";
import zhCN from "@/i18n/locales/zh-CN.json";
import ko from "@/i18n/locales/ko.json";
import ja from "@/i18n/locales/ja.json";
import th from "@/i18n/locales/th.json";

const locales: Record<string, any> = { vi, en, "zh-CN": zhCN, ko, ja, th };

const flat = (obj: any, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v) ? flat(v, key) : [key];
  });

describe("pokerDrill i18n", () => {
  it("does not promise unlocking the current top drill grade or assume everyone's weakest category", () => {
    for (const [lng, res] of Object.entries(locales)) {
      for (const key of ['nextHook', 'trainingGoal', 'cta']) {
        expect(res.pokerDrill.result[key], `${lng}.${key}`).not.toContain('A-');
      }
      expect(res.pokerDrill.result.cta, lng).toContain('{{drill}}');
    }
  });
  it("namespace exists in every locale", () => {
    for (const [lng, res] of Object.entries(locales)) {
      expect(res.pokerDrill, lng).toBeTruthy();
    }
  });

  it("mandatory disclaimer is present and non-empty everywhere", () => {
    for (const [lng, res] of Object.entries(locales)) {
      expect((res.pokerDrill?.result?.disclaimer ?? "").length, lng).toBeGreaterThan(0);
    }
  });

  it("vi disclaimer keeps the required honest wording", () => {
    expect(vi.pokerDrill.result.disclaimer).toContain("không phải cam kết kết quả");
  });

  it("key parity across all 6 locales", () => {
    const base = flat((vi as any).pokerDrill).sort();
    for (const [lng, res] of Object.entries(locales)) {
      expect(flat(res.pokerDrill).sort(), lng).toEqual(base);
    }
  });
});
