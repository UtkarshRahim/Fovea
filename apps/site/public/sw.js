// The web app used to live at the site root with its service worker here. It now lives under app/, so this
// replacement removes the old worker and its cache, then reloads open pages so they get the website.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const scope = self.registration.scope;
      for (const name of await caches.keys()) {
        if (name.endsWith(scope)) await caches.delete(name);
      }
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
    })(),
  );
});
