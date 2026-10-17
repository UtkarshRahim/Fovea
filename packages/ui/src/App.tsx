import { useEffect } from "react";
import { PlatformProvider, usePlatform, type Platform } from "./platform";
import { navigate, useRoute } from "./lib/router";
import { openInViewer } from "./lib/viewerSession";
import { Library } from "./screens/Library";
import { Editor } from "./screens/Editor";
import { Present } from "./screens/Present";
import { Viewer } from "./screens/Viewer";
import { ToastProvider, useToast } from "./components/Toasts";

function Routes() {
  const route = useRoute();
  switch (route.name) {
    case "library":
      return <Library />;
    case "editor":
      return <Editor id={route.id} imageId={route.image} />;
    case "present":
      return <Present id={route.id} index={route.index} mode={route.mode} />;
    case "viewer":
      return <Viewer />;
  }
}

/** Photos and .framenote files the operating system asked us to open (double-click, Open With). */
function OpenRequests() {
  const platform = usePlatform();
  const toast = useToast();
  useEffect(
    () =>
      platform.viewer?.onOpenRequest?.((r) => {
        if (r.kind === "folder") openInViewer(r.folder);
        else if (r.kind === "project") {
          for (const w of r.imported.warnings) toast(w.message, "error");
          toast(`Imported “${r.imported.manifest.title}”.`);
          navigate({ name: "editor", id: r.imported.manifest.assignmentId });
        } else toast(r.message, "error");
      }),
    [platform, toast],
  );
  return null;
}

export function App({ platform }: { platform: Platform }) {
  return (
    <PlatformProvider value={platform}>
      <ToastProvider>
        <OpenRequests />
        <Routes />
      </ToastProvider>
    </PlatformProvider>
  );
}
