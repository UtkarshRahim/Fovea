import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { useAutosave } from "../src/hooks/useAutosave";
import { fakePlatform, sampleManifest } from "./fakePlatform";

describe("autosave", () => {
  it("debounces saves and reports status", async () => {
    vi.useFakeTimers();
    const m = sampleManifest(1);
    const save = vi.fn(async () => {});
    const { result } = renderHook(() => useAutosave(m, save, 500));
    expect(result.current.status.state).toBe("saved");
    act(() => result.current.update((x) => ({ ...x, title: "A" })));
    act(() => result.current.update((x) => ({ ...x, title: "AB" })));
    expect(result.current.status.state).toBe("pending");
    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: "AB" }));
    expect(result.current.status.state).toBe("saved");
    vi.useRealTimers();
  });

  it("reports save errors", async () => {
    vi.useFakeTimers();
    const m = sampleManifest(1);
    const { result } = renderHook(() => useAutosave(m, async () => Promise.reject(new Error("disk full")), 500));
    act(() => result.current.update((x) => ({ ...x, title: "A" })));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.status).toEqual({ state: "error", message: "disk full" });
    vi.useRealTimers();
  });
});

describe("editor", () => {
  beforeEach(() => localStorage.setItem("framenote.reviewMode", "1"));

  it("edits a caption, autosaves, and keeps camera data read-only", async () => {
    const manifest = sampleManifest(2);
    const { platform, store } = fakePlatform([manifest]);
    location.hash = `#/a/${manifest.assignmentId}`;
    render(<App platform={platform} />);
    const user = userEvent.setup();
    const caption = await screen.findByRole("textbox", { name: "Caption" });
    await user.type(caption, "Waiting in the sal forest");
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Saved locally")).toBeInTheDocument(), { timeout: 2000 });
    const saved = store.get(manifest.assignmentId)!;
    expect(saved.images.find((i) => i.order === 0)!.user.caption).toBe("Waiting in the sal forest");
    expect(screen.getByText("600 mm")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /aperture/i })).not.toBeInTheDocument();
  });

  it("ignores I and arrow keys while typing in a caption", async () => {
    const manifest = sampleManifest(2);
    const { platform } = fakePlatform([manifest]);
    location.hash = `#/a/${manifest.assignmentId}`;
    render(<App platform={platform} />);
    const user = userEvent.setup();
    const caption = await screen.findByRole("textbox", { name: "Caption" });
    await user.click(caption);
    await user.keyboard("i{ArrowDown}");
    expect(screen.queryByRole("dialog", { name: "Show on photo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Image 1:/ })).toHaveAttribute("aria-current", "true");
    await user.click(document.body);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: /Image 2:/ })).toHaveAttribute("aria-current", "true");
  });

  it("switches camera data to vertical with V, but not while typing", async () => {
    const manifest = sampleManifest(2);
    const { platform, store } = fakePlatform([manifest]);
    location.hash = `#/a/${manifest.assignmentId}`;
    render(<App platform={platform} />);
    const user = userEvent.setup();
    const caption = await screen.findByRole("textbox", { name: "Caption" });
    await user.click(caption);
    await user.keyboard("v");
    await user.click(document.body);
    await user.keyboard("v");
    await waitFor(() => expect(store.get(manifest.assignmentId)!.presentation.overlay.direction).toBe("vertical"), { timeout: 2000 });
    expect(store.get(manifest.assignmentId)!.images.find((i) => i.order === 0)!.user.caption).toBe("v");
  });

  it("reorders images with the keyboard-accessible move buttons", async () => {
    const manifest = sampleManifest(3);
    const { platform, store } = fakePlatform([manifest]);
    location.hash = `#/a/${manifest.assignmentId}`;
    render(<App platform={platform} />);
    const user = userEvent.setup();
    const firstId = manifest.images[0]!.id;
    await user.click(await screen.findByRole("button", { name: "Move image 1 down" }));
    await waitFor(() => expect(store.get(manifest.assignmentId)!.images.find((i) => i.id === firstId)!.order).toBe(1), { timeout: 2000 });
  });

  it("shows an empty state in the library", async () => {
    const { platform } = fakePlatform([]);
    location.hash = "#/";
    render(<App platform={platform} />);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("opens in view mode with only the photo, and R toggles review panels", async () => {
    localStorage.setItem("framenote.reviewMode", "0");
    const manifest = sampleManifest(3);
    const { platform } = fakePlatform([manifest]);
    location.hash = `#/a/${manifest.assignmentId}`;
    render(<App platform={platform} />);
    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: /Review/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("textbox", { name: "Caption" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Images in this project" })).toBeInTheDocument();
    await user.keyboard("r");
    expect(await screen.findByRole("textbox", { name: "Caption" })).toBeInTheDocument();
    expect(localStorage.getItem("framenote.reviewMode")).toBe("1");
  });

  it("swipes between photos on the main stage", async () => {
    localStorage.setItem("framenote.reviewMode", "0");
    const manifest = sampleManifest(3);
    const { platform } = fakePlatform([manifest]);
    location.hash = `#/a/${manifest.assignmentId}`;
    render(<App platform={platform} />);
    const stage = await screen.findByTestId("photo-stage");
    fireEvent.pointerDown(stage, { clientX: 600, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 300, clientY: 310, pointerId: 1 });
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("switches project from the title menu", async () => {
    const a = sampleManifest(1);
    const b = { ...sampleManifest(2), title: "Kabini Dusk" };
    const { platform } = fakePlatform([a, b]);
    location.hash = `#/a/${a.assignmentId}`;
    render(<App platform={platform} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Switch project/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Kabini Dusk/ }));
    await waitFor(() => expect(location.hash).toBe(`#/a/${b.assignmentId}`));
    expect(await screen.findByRole("button", { name: /Project: Kabini Dusk/ })).toBeInTheDocument();
  });

  it("lists keyboard shortcuts with ? or the button, and blocks other keys while open", async () => {
    localStorage.setItem("framenote.reviewMode", "0");
    const manifest = sampleManifest(3);
    const { platform } = fakePlatform([manifest]);
    location.hash = `#/a/${manifest.assignmentId}`;
    render(<App platform={platform} />);
    const user = userEvent.setup();
    await screen.findByTestId("photo-stage");
    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveTextContent("Review mode on / off");
    expect(dialog).toHaveTextContent("Fullscreen on / off");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts (?)" }));
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});
