import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { PhysicalTableDeclaration } from "./PhysicalTableDeclaration";

const requestId = "11111111-1111-4111-8111-111111111111";
const result = { ok: true, data: { ok: true, game_table_id: "asset-a", club_id: "club-a",
  table_number: 21, status: "inactive", operational_status: "available", actor_id: "actor-a" } } as const;
const props = { actorId: "actor-a", clubId: "club-a", clubName: "TEST Quads" };
const key = `vinpoker:physical-asset-pending:${JSON.stringify([props.actorId, props.clubId])}`;
function open() { fireEvent.click(screen.getByRole("button", { name: "physicalTableDeclaration.action" })); }
function choose() { fireEvent.change(screen.getByLabelText("physicalTableDeclaration.number"), { target: { value: "21" } }); }
describe("physical asset declaration intent", () => {
  beforeEach(() => { sessionStorage.clear(); vi.stubGlobal("crypto", { randomUUID: () => requestId }); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("has complete declaration messages and number placeholders in all six locales", () => {
    const load = (language: string) => JSON.parse(readFileSync(`src/i18n/locales/${language}.json`, "utf8")).physicalTableDeclaration;
    const base = load("en");
    for (const language of ["vi", "en", "zh-CN", "ja", "ko", "th"]) {
      const messages = load(language);
      expect(Object.keys(messages).sort()).toEqual(Object.keys(base).sort());
      expect(Object.keys(messages.errors).sort()).toEqual(Object.keys(base.errors).sort());
      for (const key of ["pending", "success"]) expect(messages[key]).toContain("{{number}}");
      for (const value of Object.values(messages.errors)) expect(value).toEqual(expect.any(String));
    }
  });
  it("persists explicit intent before calling the single declaration seam", async () => {
    const onDeclared = vi.fn();
    const declareAsset = vi.fn(async (args: { actorId: string; clubId: string; tableNumber: number; requestId: string }) => {
      expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({
        actorId: props.actorId, clubId: props.clubId, tableNumber: 21, requestId });
      expect(args).toEqual({ actorId: "actor-a", clubId: "club-a", tableNumber: 21, requestId });
      return result;
    });
    render(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={onDeclared} />);
    open(); choose(); fireEvent.click(screen.getByRole("button", { name: "physicalTableDeclaration.submit" }));
    await waitFor(() => expect(onDeclared).toHaveBeenCalledOnce());
    expect(declareAsset).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("double clicks cannot send two requests while the first response is pending", async () => {
    let resolve!: (value: typeof result) => void;
    const declareAsset = vi.fn(() => new Promise<typeof result>(done => { resolve = done; }));
    render(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={vi.fn()} />);
    open(); choose(); const button = screen.getByRole("button", { name: "physicalTableDeclaration.submit" });
    fireEvent.click(button); fireEvent.click(button);
    expect(declareAsset).toHaveBeenCalledOnce();
    await act(async () => { resolve(result); });
  });
  it("unknown response keeps the original key and number for explicit retry", async () => {
    const declareAsset = vi.fn().mockResolvedValueOnce({ ok: false, error: "PHYSICAL_ASSET_OUTCOME_UNKNOWN" }).mockResolvedValueOnce(result);
    render(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={vi.fn()} />);
    open(); choose(); fireEvent.click(screen.getByRole("button", { name: "physicalTableDeclaration.submit" }));
    await screen.findByRole("button", { name: "physicalTableDeclaration.retry" });
    expect(screen.getByLabelText("physicalTableDeclaration.number")).toBeDisabled();
    expect(sessionStorage.getItem(key)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "physicalTableDeclaration.retry" }));
    await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
    expect(declareAsset.mock.calls[1][0]).toEqual(declareAsset.mock.calls[0][0]);
  });
  it("storage failure prevents dispatch instead of losing the retry identity", async () => {
    const declareAsset = vi.fn();
    render(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={vi.fn()} />);
    open(); choose(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    fireEvent.click(screen.getByRole("button", { name: "physicalTableDeclaration.submit" }));
    expect(declareAsset).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("physicalTableDeclaration.journalError");
  });
  it("a stale response after changing actor and club cannot clear the old intent or refresh new scope", async () => {
    let resolve!: (value: typeof result) => void;
    const onDeclared = vi.fn();
    const declareAsset = vi.fn(() => new Promise<typeof result>(done => { resolve = done; }));
    const view = render(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={onDeclared} />);
    open(); choose(); fireEvent.click(screen.getByRole("button", { name: "physicalTableDeclaration.submit" }));
    view.rerender(<PhysicalTableDeclaration {...props} actorId="actor-b" clubId="club-b" declareAsset={declareAsset} onDeclared={onDeclared} />);
    await act(async () => { resolve(result); });
    expect(onDeclared).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("reads a saved same-scope request and never silently clears a malformed journal", () => {
    sessionStorage.setItem(key, JSON.stringify({ actorId: "actor-a", clubId: "club-a", tableNumber: 21, requestId }));
    const declareAsset = vi.fn();
    const view = render(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={vi.fn()} />);
    open(); expect(screen.getByLabelText("physicalTableDeclaration.number")).toHaveValue(21);
    expect(screen.getByRole("button", { name: "physicalTableDeclaration.retry" })).toBeEnabled();
    view.unmount(); sessionStorage.setItem(key, "malformed");
    render(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={vi.fn()} />);
    open(); expect(screen.getByRole("alert")).toHaveTextContent("physicalTableDeclaration.journalError");
    expect(declareAsset).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toBe("malformed");
  });
  it("an old A response cannot clear the restored A journal after A to B to A", async () => {
    let resolve!: (value: typeof result) => void;
    const onDeclared = vi.fn();
    const declareAsset = vi.fn(() => new Promise<typeof result>(done => { resolve = done; }));
    const view = render(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={onDeclared} />);
    open(); choose(); fireEvent.click(screen.getByRole("button", { name: "physicalTableDeclaration.submit" }));
    const journal = sessionStorage.getItem(key);
    view.rerender(<PhysicalTableDeclaration {...props} actorId="actor-b" declareAsset={declareAsset} onDeclared={onDeclared} />);
    view.rerender(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={onDeclared} />);
    open();
    await act(async () => { resolve(result); });
    expect(onDeclared).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBe(journal);
    expect(screen.getByRole("button", { name: "physicalTableDeclaration.retry" })).toBeEnabled();
    expect(screen.getByLabelText("physicalTableDeclaration.number")).toBeDisabled();
  });
  it("a committed response with failed journal cleanup cannot enable another intent", async () => {
    const declareAsset = vi.fn().mockResolvedValue(result); const onDeclared = vi.fn();
    render(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={onDeclared} />);
    open(); choose();
    vi.spyOn(Storage.prototype,"removeItem").mockImplementation(() => { throw new Error("denied"); });
    fireEvent.click(screen.getByRole("button", { name: "physicalTableDeclaration.submit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("physicalTableDeclaration.journalError"));
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(onDeclared).not.toHaveBeenCalled();
    expect(screen.getByLabelText("physicalTableDeclaration.number")).toBeDisabled();
    expect(screen.getByRole("button", { name: "physicalTableDeclaration.retry" })).toBeDisabled();
    expect(declareAsset).toHaveBeenCalledOnce();
  });
  it.each(["actor_not_allowed", "PHYSICAL_ASSET_RPC_UNAVAILABLE", "IDEMPOTENCY_CONFLICT", "ACTOR_CHANGED"])("keeps prior retry identity after %s", async (error) => {
    const intent = { actorId: "actor-a", clubId: "club-a", tableNumber: 21, requestId };
    sessionStorage.setItem(key, JSON.stringify(intent));
    const declareAsset = vi.fn().mockResolvedValue({ ok: false, error });
    render(<PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={vi.fn()} />);
    open(); fireEvent.click(screen.getByRole("button", { name: "physicalTableDeclaration.retry" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
    expect(screen.getByLabelText("physicalTableDeclaration.number")).toBeDisabled();
  });
  it("publishes known success after StrictMode effect setup/cleanup replay", async () => {
    const onDeclared = vi.fn(); const declareAsset = vi.fn().mockResolvedValue(result);
    render(<StrictMode><PhysicalTableDeclaration {...props} declareAsset={declareAsset} onDeclared={onDeclared} /></StrictMode>);
    open(); choose(); fireEvent.click(screen.getByRole("button", { name: "physicalTableDeclaration.submit" }));
    await waitFor(() => expect(onDeclared).toHaveBeenCalledOnce());
    expect(sessionStorage.getItem(key)).toBeNull();
  });
});
