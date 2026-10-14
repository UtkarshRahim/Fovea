import { PlatformProvider, type Platform } from "./platform";
import { useRoute } from "./lib/router";
import { Library } from "./screens/Library";
import { Editor } from "./screens/Editor";
import { Present } from "./screens/Present";
import { ToastProvider } from "./components/Toasts";

function Routes() {
  const route = useRoute();
  switch (route.name) {
    case "library":
      return <Library />;
    case "editor":
      return <Editor id={route.id} imageId={route.image} />;
    case "present":
      return <Present id={route.id} index={route.index} mode={route.mode} />;
  }
}

export function App({ platform }: { platform: Platform }) {
  return (
    <PlatformProvider value={platform}>
      <ToastProvider>
        <Routes />
      </ToastProvider>
    </PlatformProvider>
  );
}
