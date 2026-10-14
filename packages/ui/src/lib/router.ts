import { useEffect, useState } from "react";

export type Route =
  | { name: "library" }
  | { name: "editor"; id: string; image?: string }
  | { name: "present"; id: string; index: number; mode: "present" | "preview" };

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "a" && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    if (parts[2] === "present") {
      const index = Math.max(0, Number.parseInt(params.get("i") ?? "0", 10) || 0);
      return { name: "present", id, index, mode: params.get("mode") === "preview" ? "preview" : "present" };
    }
    const image = params.get("image") ?? undefined;
    return { name: "editor", id, ...(image ? { image } : {}) };
  }
  return { name: "library" };
}

export function routeHref(r: Route): string {
  switch (r.name) {
    case "library":
      return "#/";
    case "editor":
      return `#/a/${encodeURIComponent(r.id)}${r.image ? `?image=${encodeURIComponent(r.image)}` : ""}`;
    case "present":
      return `#/a/${encodeURIComponent(r.id)}/present?i=${r.index}&mode=${r.mode}`;
  }
}

export function navigate(r: Route, replace = false) {
  const href = routeHref(r);
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return route;
}
