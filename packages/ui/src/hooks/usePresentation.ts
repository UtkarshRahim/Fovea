import { useCallback, useEffect, useState } from "react";
import { defaultPresentation, PresentationSchema, type Presentation } from "@fovea/core";

const KEY = "fovea.presentation";
const EVENT = "fovea:presentation";

function read(): Presentation | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? PresentationSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function write(p: Presentation) {
  localStorage.setItem(KEY, JSON.stringify(p));
  window.dispatchEvent(new Event(EVENT));
}

/**
 * What's shown on photos (fields, placement, fit). One setting for every project, remembered on this device.
 * Before anything is saved, `seed` (the open project's old per-project settings) becomes the starting point.
 */
export function usePresentation(seed?: Presentation): [Presentation, (change: (p: Presentation) => Presentation) => void] {
  const [presentation, setPresentation] = useState(() => read() ?? seed ?? defaultPresentation());
  useEffect(() => {
    if (!read() && seed) write(seed);
    const sync = () => setPresentation(read() ?? defaultPresentation());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
    // The seed only matters the first time; later projects must not overwrite the saved setting.
  }, []);
  const update = useCallback((change: (p: Presentation) => Presentation) => {
    write(change(read() ?? defaultPresentation()));
  }, []);
  return [presentation, update];
}
