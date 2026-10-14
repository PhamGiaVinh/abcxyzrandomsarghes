import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AttentionItem from "./AttentionItem";
import type { AttentionItem as Item } from "@/hooks/useAttentionQueue";

describe("dealer attention action intent", () => {
  it("missing next dealer plans a replacement, never assigns the current seat", () => {
    const onAssign = vi.fn();
    const onPlanNext = vi.fn();
    const callbacks = { onAssign, onPlanNext };
    render(<AttentionItem item={{ id: "next", type: "missing_next_dealer", severity: "warning",
      tableId: "physical", title: "Thiếu dealer kế" } as Item} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Chọn dealer kế tiếp" }));
    expect(onPlanNext).toHaveBeenCalledExactlyOnceWith("physical");
    expect(onAssign).not.toHaveBeenCalled();
  });
});
