import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
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
    expect(await screen.findByText("No assignments yet")).toBeInTheDocument();
  });
});
