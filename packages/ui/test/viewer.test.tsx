import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildImageEntry, newImageId } from "@framenote/core";
import { App } from "../src/App";
import { openInViewer } from "../src/lib/viewerSession";
import type { FolderPhoto, FolderViewer, PhotoFolder } from "../src/platform";
import { fakePlatform } from "./fakePlatform";

const folder: PhotoFolder = {
  id: "/Users/me/Birds",
  name: "Birds",
  path: "/Users/me/Birds",
  photos: ["Z9_1.NEF", "Z9_2.jpg", "Z9_3.HEIC"].map((name) => ({ name, size: 1, modifiedMs: 0 })),
  start: 1,
  reopenable: true,
};

function fakeViewer(): FolderViewer {
  return {
    pickPhotos: vi.fn(async () => null),
    openRecent: vi.fn(async () => null),
    recents: vi.fn(async () => []),
    remember: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    loadPhoto: vi.fn(async (_f, p) => ({ blob: new Blob([p.name]), source: p.name.endsWith(".NEF") ? ("embedded-preview" as const) : ("original" as const) })),
    loadMetadata: vi.fn(async (_f, p) => (p.name === "Z9_2.jpg" ? { focusAreas: [{ x: 0.4, y: 0.3, width: 0.05, height: 0.08 }] } : {})),
    addToProject: vi.fn(async (_a: string, _f: PhotoFolder, photos: FolderPhoto[]) => ({
      entries: [],
      failures: photos.map((p) => ({ file: p.name, message: "test" })),
      cancelled: false,
    })),
  };
}

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL, decode: HTMLImageElement.prototype.decode };
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
  HTMLImageElement.prototype.decode = async function () {
    Object.defineProperty(this, "naturalWidth", { value: 1500 });
    Object.defineProperty(this, "naturalHeight", { value: 1000 });
  };
});
afterAll(() => {
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
  HTMLImageElement.prototype.decode = original.decode;
});

function setup() {
  const { platform, store } = fakePlatform();
  const viewer = fakeViewer();
  platform.viewer = viewer;
  location.hash = "";
  render(<App platform={platform} />);
  act(() => openInViewer(folder));
  return { platform, store, viewer };
}

const subtitle = () => document.querySelector(".viewer-sub")?.textContent ?? "";

describe("folder viewer", () => {
  it("opens at the chosen photo, steps through the folder and preloads neighbours", async () => {
    const { viewer } = setup();
    const user = userEvent.setup();
    await waitFor(() => expect(subtitle()).toContain("Z9_2.jpg · 2 of 3"));
    expect(screen.getByRole("heading", { name: "Birds" })).toBeInTheDocument();
    await waitFor(() => expect(viewer.loadPhoto).toHaveBeenCalledTimes(3));

    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(subtitle()).toContain("Z9_1.NEF · 1 of 3 · NEF · camera's embedded preview"));
    await user.keyboard("{ArrowLeft}");
    expect(subtitle()).toContain("1 of 3");
    await user.keyboard("{End}");
    await waitFor(() => expect(subtitle()).toContain("Z9_3.HEIC · 3 of 3"));
    expect(viewer.loadPhoto).toHaveBeenCalledTimes(3);
  });

  it("remembers the folder and the last photo viewed", async () => {
    const { viewer } = setup();
    await waitFor(() => expect(viewer.remember).toHaveBeenCalledWith(folder, "Z9_2.jpg"), { timeout: 2000 });
  });

  it("toggles the focus point with A, off by default, and remembers the choice", async () => {
    setup();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Show focus point (A)" })).toHaveAttribute("aria-pressed", "false"));
    expect(document.querySelector(".focus-box")).toBeNull();

    await user.keyboard("a");
    await waitFor(() => expect(document.querySelector(".focus-box")).not.toBeNull());
    expect(localStorage.getItem("framenote.showFocus")).toBe("1");

    await user.keyboard("{End}");
    await waitFor(() => expect(screen.getByRole("button", { name: /None recorded for this photo/ })).toBeInTheDocument());
    expect(document.querySelector(".focus-box")).toBeNull();

    await user.keyboard("a");
    expect(screen.getByRole("button", { name: "Show focus point (A)" })).toHaveAttribute("aria-pressed", "false");
  });

  it("adds the current photo to an existing project, loading it before importing", async () => {
    const { platform, store, viewer } = setup();
    const target = await platform.createAssignment("Sal Forest");
    vi.mocked(viewer.addToProject).mockImplementationOnce(async () => ({
      entries: [buildImageEntry({ id: newImageId(), originalFilename: "Z9_2.jpg", assetSource: "original-jpeg", assetSha256: "a".repeat(64), thumbnailSha256: "b".repeat(64), assetWidth: 1500, assetHeight: 1000, metadata: {} }, 0)],
      failures: [],
      cancelled: false,
    }));
    const user = userEvent.setup();
    await waitFor(() => expect(subtitle()).toContain("2 of 3"));
    await user.click(screen.getByRole("button", { name: /Add to project/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Sal Forest/ }));
    await waitFor(() => expect(store.get(target.assignmentId)!.images).toHaveLength(1));
    expect(vi.mocked(viewer.addToProject).mock.calls[0]![2].map((p) => p.name)).toEqual(["Z9_2.jpg"]);
    expect(vi.mocked(platform.loadAssignment).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(viewer.addToProject).mock.invocationCallOrder[0]!);
  });

  it("creates a project from every photo in the folder", async () => {
    const { viewer, store } = setup();
    const user = userEvent.setup();
    await waitFor(() => expect(subtitle()).toContain("2 of 3"));
    await user.click(screen.getByRole("button", { name: /Add to project/ }));
    await user.click(await screen.findByRole("menuitem", { name: /New project from all 3 photos/ }));
    const name = await screen.findByRole("textbox");
    expect(name).toHaveValue("Birds");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(viewer.addToProject).toHaveBeenCalled());
    const [id, from, photos] = vi.mocked(viewer.addToProject).mock.calls[0]!;
    expect(from).toBe(folder);
    expect(photos.map((p) => p.name)).toEqual(["Z9_1.NEF", "Z9_2.jpg", "Z9_3.HEIC"]);
    expect(store.get(id)?.title).toBe("Birds");
  });
});
