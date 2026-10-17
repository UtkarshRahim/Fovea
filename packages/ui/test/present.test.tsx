import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformProvider } from "../src/platform";
import { PresentInner } from "../src/screens/Present";
import { fakePlatform, sampleManifest } from "./fakePlatform";

function setup(mode: "present" | "preview" = "present") {
  const manifest = sampleManifest(3);
  const { platform, store } = fakePlatform([manifest]);
  render(
    <PlatformProvider value={platform}>
      <PresentInner initial={manifest} index={0} mode={mode} />
    </PlatformProvider>,
  );
  return { manifest, platform, store };
}

const counter = () => screen.getByText(/\d+ \/ \d+/).textContent;

describe("presentation", () => {
  it("navigates with arrow keys, Home and End, staying in bounds", async () => {
    setup();
    const user = userEvent.setup();
    expect(counter()).toBe("1 / 3");
    await user.keyboard("{ArrowLeft}");
    expect(counter()).toBe("1 / 3");
    await user.keyboard("{ArrowRight}");
    expect(counter()).toBe("2 / 3");
    await user.keyboard("{End}");
    expect(counter()).toBe("3 / 3");
    await user.keyboard("{ArrowRight}");
    expect(counter()).toBe("3 / 3");
    await user.keyboard("{Home}");
    expect(counter()).toBe("1 / 3");
  });

  it("navigates with on-screen buttons", async () => {
    setup();
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: /Previous image/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Next image/ }));
    expect(counter()).toBe("2 / 3");
  });

  it("navigates with swipe gestures", () => {
    setup();
    const region = screen.getByTestId("photo-stage");
    fireEvent.pointerDown(region, { clientX: 600, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(region, { clientX: 300, clientY: 310, pointerId: 1 });
    expect(counter()).toBe("2 / 3");
    fireEvent.pointerDown(region, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(region, { clientX: 600, clientY: 290, pointerId: 1 });
    expect(counter()).toBe("1 / 3");
    fireEvent.pointerDown(region, { clientX: 300, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(region, { clientX: 340, clientY: 400, pointerId: 1 });
    expect(counter()).toBe("1 / 3");
  });

  it("toggles the overlay with O", async () => {
    setup();
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: /Hide overlay/ })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("o");
    expect(screen.getByRole("button", { name: /Show overlay/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("starts with the overlay hidden in preview mode", () => {
    setup("preview");
    expect(screen.getByRole("button", { name: /Show overlay/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("opens the field picker with I and persists selections", async () => {
    const { manifest, store } = setup();
    const user = userEvent.setup();
    await user.keyboard("i");
    const picker = screen.getByRole("dialog", { name: "Show on photo" });
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Focal length" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Lens" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Lens" }));
    await user.click(screen.getByRole("radio", { name: "Top" }));
    await waitFor(() => expect(store.get(manifest.assignmentId)!.presentation.overlay.fields).toContain("lens"), { timeout: 2000 });
    expect(store.get(manifest.assignmentId)!.presentation.overlay.placement).toBe("top");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Show on photo" })).not.toBeInTheDocument();
  });

  it("switches camera data between horizontal and vertical with V and in the panel", async () => {
    const { manifest, store } = setup();
    const user = userEvent.setup();
    const saved = () => store.get(manifest.assignmentId)!.presentation.overlay.direction;
    await user.keyboard("v");
    await waitFor(() => expect(saved()).toBe("vertical"), { timeout: 2000 });
    await user.keyboard("v");
    await waitFor(() => expect(saved()).toBe("horizontal"), { timeout: 2000 });
    await user.keyboard("i");
    await user.click(screen.getByRole("radio", { name: "Vertical" }));
    await waitFor(() => expect(saved()).toBe("vertical"), { timeout: 2000 });
  });

  it("does not fire shortcuts while a text field has focus", async () => {
    setup();
    const user = userEvent.setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await user.keyboard("{ArrowRight}io");
    expect(counter()).toBe("1 / 3");
    expect(screen.queryByRole("dialog", { name: "Show on photo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hide overlay/ })).toBeInTheDocument();
    input.remove();
  });

  it("shows only the photo in fullscreen while shortcuts keep working", async () => {
    localStorage.removeItem("fovea.presentHintSeen");
    const { platform } = setup();
    let fs = false;
    platform.setFullscreen = vi.fn(async (on: boolean) => {
      fs = on;
    });
    platform.isFullscreen = vi.fn(async () => fs);
    const region = () => screen.getByRole("region", { name: /Presentation/ });
    expect(screen.getByText(/swipe to move/)).toBeInTheDocument();
    expect(region()).toHaveClass("controls-on");

    await act(async () => {
      fireEvent.keyDown(window, { key: "f" });
    });
    await waitFor(() => expect(region()).toHaveClass("is-fullscreen"));
    expect(region()).toHaveClass("controls-off");
    expect(screen.queryByText(/swipe to move/)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "o" });
    });
    expect(counter()).toBe("2 / 3");
    expect(screen.getByRole("button", { name: /Show overlay/ })).toHaveAttribute("aria-pressed", "false");
    expect(region()).toHaveClass("controls-off");

    await act(async () => {
      fireEvent.keyDown(window, { key: "f" });
    });
    await waitFor(() => expect(region()).not.toHaveClass("is-fullscreen"));
    expect(region()).toHaveClass("controls-on");
  });

  it("requests fullscreen with F", async () => {
    const { platform } = setup();
    await act(async () => {
      fireEvent.keyDown(window, { key: "f" });
    });
    await waitFor(() => expect(platform.setFullscreen).toHaveBeenCalledWith(true));
  });
});
