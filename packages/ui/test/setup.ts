import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

class RO {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    Object.defineProperty(el, "clientWidth", { value: 1600, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 1000, configurable: true });
    this.cb([], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;

HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
if (!globalThis.PointerEvent) {
  // jsdom lacks PointerEvent; MouseEvent carries clientX/clientY which is all the gestures need.
  globalThis.PointerEvent = MouseEvent as unknown as typeof PointerEvent;
}
