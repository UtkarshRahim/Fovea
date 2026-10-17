import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@fovea/ui";
import { DesktopPlatform } from "./platform";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App platform={new DesktopPlatform()} />
  </StrictMode>,
);
