import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@fovea/ui";
import { DesktopPlatform } from "./platform";
import { UpdateNotification } from "./UpdateNotification";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UpdateNotification />
    <App platform={new DesktopPlatform()} />
  </StrictMode>,
);
