import { useEffect, useState } from "react";
import { checkForUpdate, downloadAndInstall, type UpdateInfo } from "./updater";
import { Button } from "../../../packages/ui/src/components/primitives";

export function UpdateNotification() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check for updates on mount (after a short delay to not block startup)
    const timer = setTimeout(() => {
      void checkForUpdate().then(setUpdate);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleInstall = async () => {
    setIsInstalling(true);
    const success = await downloadAndInstall((percent: number) => {
      setProgressPercent(percent);
    });
    if (success) {
      setIsComplete(true);
    } else {
      setIsInstalling(false);
      setProgressPercent(0);
    }
  };

  if (!update || dismissed) return null;

  return (
    <div className="update-notification" role="status" aria-live="polite">
      <div className="update-content">
        <div className="update-text">
          <strong>{isComplete ? "Update ready" : "Update available"}</strong>
          <span className="muted">
            {isComplete
              ? "Please restart Fovea to apply the update"
              : `Version ${update.version} is ready to install${update.date ? ` (released ${new Date(update.date).toLocaleDateString()})` : ""}`}
          </span>
        </div>
        <div className="update-actions">
          {isComplete ? (
            <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
              Dismiss
            </Button>
          ) : !isInstalling ? (
            <>
              <Button size="sm" variant="primary" onClick={handleInstall}>
                Update now
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                Later
              </Button>
            </>
          ) : (
            <div className="update-progress">
              <span className="muted small">Downloading... {progressPercent}%</span>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
