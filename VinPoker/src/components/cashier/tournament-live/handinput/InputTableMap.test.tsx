// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputTableMap } from "./InputTableMap";

afterEach(cleanup);

describe("InputTableMap", () => {
  it("uses the canonical number rather than a digit from the event name", () => {
    const tables=[{id:"d2-7",physicalTableId:"physical-7",tournamentTableId:"tt-7",
      name:"Linked Main Event D2 TEST 7",tableNumber:7,playerCount:4,hasLiveHand:false}];
    render(<InputTableMap tables={tables} activeTableId={null} onSelect={vi.fn()}/>);
    expect(screen.getByRole("button",{name:"7 Linked Main Event D2 TEST 7 4 người chơi"})).toBeVisible();
  });
  it.each([undefined,null,0,101,3.5,Number.NaN])("does not invent a number for missing or malformed metadata: %s", (tableNumber) => {
    const tables=[{id:"legacy",physicalTableId:"physical",tournamentTableId:null,
      name:"Flight 2026 D2",tableNumber,playerCount:0,hasLiveHand:false}];
    render(<InputTableMap tables={tables} activeTableId={null} onSelect={vi.fn()}/>);
    expect(screen.getByRole("button",{name:"— Flight 2026 D2 0 người chơi"})).toBeVisible();
  });
  it("shows repair-required instead of claiming an empty tournament", () => {
    render(<InputTableMap tables={[]} activeTableId={null} onSelect={vi.fn()}
      loadState="ready" loadError="1 bàn cần sửa dữ liệu phiên." />);
    expect(screen.getByRole("alert")).toHaveTextContent("cần sửa dữ liệu");
    expect(screen.queryByText("Chưa có bàn nào trong giải này.")).toBeNull();
  });
  it("distinguishes roster visibility from manual card authority", () => {
    render(<InputTableMap tables={[{ id: "t", physicalTableId: "p", tournamentTableId: "tt",
      name: "Bàn 1", playerCount: 2, hasLiveHand: false, canManualCards: false }]}
      activeTableId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("Không có quyền lật bài thủ công");
  });
  it("marks the exact physical table with unresolved Floor alerts", () => {
    render(<InputTableMap
      tables={[
        { id: "table-5", physicalTableId: "physical-5", tournamentTableId: "tt-5", name: "Bàn 5", playerCount: 6, hasLiveHand: true },
        { id: "table-6", physicalTableId: "physical-6", tournamentTableId: "tt-6", name: "Bàn 6", playerCount: 0, hasLiveHand: false },
      ]}
      activeTableId={null}
      onSelect={vi.fn()}
      alertsByTable={{ "physical-5": 2 }}
    />);

    expect(screen.getByRole("button", { name: /Bàn 5.*2 cảnh báo cần Floor xử lý/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Bàn 6/i })).not.toHaveTextContent("cảnh báo");
  });
});
