import { useCallback, useEffect, useRef, useState } from "react";
import type { Manifest } from "@framenote/core";

export type SaveStatus = { state: "saved" } | { state: "pending" } | { state: "saving" } | { state: "error"; message: string };

export const AUTOSAVE_DELAY_MS = 500;

/** Holds the editable manifest; every update is persisted after a debounce. */
export function useAutosave(initial: Manifest, save: (m: Manifest) => Promise<void>, delay = AUTOSAVE_DELAY_MS) {
  const [manifest, setManifest] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>({ state: "saved" });
  const latest = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const dirty = useRef(false);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    dirty.current = false;
    setStatus({ state: "saving" });
    try {
      await saveRef.current(latest.current);
      setStatus(dirty.current ? { state: "pending" } : { state: "saved" });
    } catch (e) {
      dirty.current = true;
      setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const update = useCallback(
    (fn: (m: Manifest) => Manifest) => {
      const next = fn(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      dirty.current = true;
      setManifest(next);
      setStatus({ state: "pending" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  return { manifest, update, status, flush };
}
