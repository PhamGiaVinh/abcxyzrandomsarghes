// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const { rpc, client, saveFailure, lostResponseCommitted, submittedState, brandingLayout, brandingAssets } = vi.hoisted(() => {
  const saveFailure = { value: false };
  const lostResponseCommitted = { value: false };
  const submittedState = { value: null as Record<string, unknown> | null };
  const brandingLayout = { value: {} as unknown };
  const brandingAssets = { value: { logo_url: null as string | null, background_url: null as string | null } };
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "save_tv_tournament_layout_v1" && saveFailure.value) {
      if (lostResponseCommitted.value) submittedState.value = args ?? null;
      throw new Error("offline");
    }
    if (name === "get_tv_tournament_branding_v1") return {
      data: submittedState.value ? {
        logo_url: submittedState.value.p_logo_url || null,
        background_url: submittedState.value.p_bg_url || null,
        brand_name: submittedState.value.p_brand_name || null,
        layout: submittedState.value.p_layout,
        revision: 8,
      } : { ...brandingAssets.value, brand_name: "VinPoker", layout: brandingLayout.value, revision: 7 },
      error: null,
    };
    return { data: { revision: 8 }, error: null };
  });
  return {
    rpc,
    client: { rpc },
    saveFailure,
    lostResponseCommitted,
    submittedState,
    brandingLayout,
    brandingAssets,
  };
});

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => client }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "test-owner" } }) }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { tvLayoutEditorV1: true } }));
vi.mock("@/components/ProofUploader", () => ({ ProofUploader: () => <div>Image upload</div> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TvBrandingEditor } from "./TvBrandingEditor";
import { toast } from "sonner";

afterEach(() => { cleanup(); rpc.mockClear(); saveFailure.value = false; lostResponseCommitted.value = false; submittedState.value = null; brandingLayout.value = {}; brandingAssets.value = { logo_url: null, background_url: null }; });

describe("TvBrandingEditor publish boundary", () => {
  it("keeps the editor discoverable while server RPCs remain the authority boundary", async () => {
    render(<TvBrandingEditor tournamentId="flight-1" />);

    const trigger = await screen.findByRole("button", { name: /Edit TV layout/i });
    expect(trigger).toBeVisible();
    expect(trigger).toHaveClass("min-h-11");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("previews the draft through the broadcast clock renderer", async () => {
    render(<TvBrandingEditor tournamentId="flight-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit TV layout/i }));

    const clock = await screen.findByLabelText("VinPoker tournament clock");
    expect(clock).toHaveClass("vpc-root", "vpc-editor-preview");
    expect(screen.getByText("MAIN EVENT · DAY 1")).toBeVisible();
    expect(screen.getByText("Current Level")).toBeVisible();
    expect(screen.queryByText("BLINDS · LEVEL · PAYOUTS")).toBeNull();
  });

  it("keeps edits and reset in a local draft until Publish, then sends the loaded revision", async () => {
    render(<TvBrandingEditor tournamentId="flight-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit TV layout/i }));
    expect(await screen.findByText(/Draft 16:9 preview · not on TV/i)).toBeVisible();

    fireEvent.change(screen.getByLabelText("Brand name"), { target: { value: "New brand" } });
    expect(rpc).not.toHaveBeenCalledWith("save_tv_tournament_layout_v1", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: /Reset draft to defaults/i }));
    expect(screen.getByLabelText("Brand name")).toHaveValue("");
    expect(rpc).not.toHaveBeenCalledWith("save_tv_tournament_layout_v1", expect.anything());

    fireEvent.change(screen.getByLabelText("Brand name"), { target: { value: "Final brand" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Publish TV layout/i })));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_tv_tournament_layout_v1", expect.objectContaining({
      p_tournament_id: "flight-1", p_expected_revision: 7, p_brand_name: "Final brand",
    })));
  });

  it("keeps the draft open and reports a rejected publish request", async () => {
    saveFailure.value = true;
    render(<TvBrandingEditor tournamentId="flight-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit TV layout/i }));
    expect(await screen.findByText(/Draft 16:9 preview/i)).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Publish TV layout/i })));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("response was lost")));
    expect(screen.getByRole("button", { name: /Publish TV layout/i })).toBeEnabled();
  });

  it("reconciles a committed publish whose response was lost", async () => {
    saveFailure.value = true;
    lostResponseCommitted.value = true;
    render(<TvBrandingEditor tournamentId="flight-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit TV layout/i }));
    await screen.findByText(/Draft 16:9 preview/i);
    fireEvent.change(screen.getByLabelText("Brand name"), { target: { value: "Committed brand" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Publish TV layout/i })));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("published")));
    expect(rpc).toHaveBeenCalledWith("get_tv_tournament_branding_v1", { p_tournament_id: "flight-1" });
  });

  it("renders the legacy single custom_text as a visible text block", async () => {
    brandingLayout.value = {
      brand_x: 18, brand_y: 45, brand_scale: 100, logo_scale: 80,
      background_x: 50, background_y: 50, font: "serif", custom_text: "Legacy TV label",
    };
    render(<TvBrandingEditor tournamentId="flight-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit TV layout/i }));
    const legacyText = await screen.findByText("Legacy TV label");
    expect(legacyText).toBeVisible();
    expect(document.querySelector<HTMLElement>("[data-tv-branding-canvas]")?.style.containerType).toBe("inline-size");
    expect((legacyText as HTMLDivElement).style.overflow).toBe("hidden");
    expect((legacyText as HTMLDivElement).style.whiteSpace).toBe("nowrap");
    expect((legacyText as HTMLDivElement).style.textOverflow).toBe("ellipsis");
  });

  it("resubmits club fallback images unchanged on the first publish", async () => {
    brandingAssets.value = {
      logo_url: "https://orlesggcjamwuknxwcpk.supabase.co/storage/v1/object/public/backing-proofs/clubs/legacy-logo.png",
      background_url: "https://orlesggcjamwuknxwcpk.supabase.co/storage/v1/object/public/backing-proofs/clubs/legacy-background.jpg",
    };
    render(<TvBrandingEditor tournamentId="flight-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit TV layout/i }));
    const publish = screen.getByRole("button", { name: /Publish TV layout/i });
    await waitFor(() => expect(publish).toBeEnabled());
    await act(async () => fireEvent.click(publish));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_tv_tournament_layout_v1", expect.objectContaining({
      p_tournament_id: "flight-1",
      p_logo_url: brandingAssets.value.logo_url,
      p_bg_url: brandingAssets.value.background_url,
    })));
  });
});
