import { useEffect, useState } from "react";
import { usePlatform, type Platform } from "../platform";

interface Entry {
  promise: Promise<string>;
  refs: number;
  url?: string;
}

const caches = new WeakMap<Platform, Map<string, Entry>>();

function cacheFor(p: Platform) {
  let c = caches.get(p);
  if (!c) {
    c = new Map();
    caches.set(p, c);
  }
  return c;
}

/** Ref-counted asset URLs so object URLs are created once and revoked when nothing shows them. */
export function acquireAssetUrl(p: Platform, assignmentId: string, path: string): Promise<string> {
  const cache = cacheFor(p);
  const key = `${assignmentId}/${path}`;
  let e = cache.get(key);
  if (!e) {
    const entry: Entry = { refs: 0, promise: p.getAssetUrl(assignmentId, path) };
    entry.promise.then((u) => (entry.url = u)).catch(() => cache.delete(key));
    cache.set(key, entry);
    e = entry;
  }
  e.refs++;
  return e.promise;
}

export function releaseAssetRef(p: Platform, assignmentId: string, path: string) {
  const cache = cacheFor(p);
  const key = `${assignmentId}/${path}`;
  const e = cache.get(key);
  if (!e) return;
  e.refs--;
  if (e.refs <= 0) {
    cache.delete(key);
    e.promise.then((u) => p.releaseAssetUrl(u)).catch(() => {});
  }
}

export function useAssetUrl(assignmentId: string | undefined, path: string | undefined): string | undefined {
  const platform = usePlatform();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!assignmentId || !path) {
      setUrl(undefined);
      return;
    }
    let alive = true;
    acquireAssetUrl(platform, assignmentId, path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(undefined));
    return () => {
      alive = false;
      releaseAssetRef(platform, assignmentId, path);
    };
  }, [platform, assignmentId, path]);
  return url;
}
