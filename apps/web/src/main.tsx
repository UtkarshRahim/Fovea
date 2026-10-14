import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "@framenote/ui";
import { WebPlatform } from "./platform";

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App platform={new WebPlatform()} />
  </StrictMode>,
);
