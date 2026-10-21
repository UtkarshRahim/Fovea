import { check } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

/**
 * Check if an update is available.
 * Returns null if no update is available or if checking fails silently.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (!update) {
      console.log("No update available");
      return null;
    }

    if (!update.available) {
      console.log("Already on latest version");
      return null;
    }

    console.log(`Update available: ${update.version} (current: ${update.currentVersion})`);
    
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      date: update.date,
      body: update.body,
    };
  } catch (error) {
    console.warn("Failed to check for updates:", error);
    return null;
  }
}

/**
 * Download and install an update.
 * The app will need to be manually restarted to apply the update.
 * Returns true if successful, false otherwise.
 */
export async function downloadAndInstall(onProgress?: (percent: number) => void): Promise<boolean> {
  try {
    const update = await check();
    if (!update?.available) {
      return false;
    }

    console.log("Downloading update...");
    
    let contentLength = 0;
    let downloaded = 0;
    
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          console.log(`Downloading ${event.data.contentLength} bytes`);
          contentLength = event.data.contentLength || 0;
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          console.log(`Downloaded ${downloaded} / ${contentLength} bytes`);
          if (onProgress && contentLength > 0) {
            onProgress(Math.round((downloaded / contentLength) * 100));
          }
          break;
        case "Finished":
          console.log("Download finished");
          break;
      }
    });

    console.log("Update installed successfully. Please restart the app to apply.");
    return true;
  } catch (error) {
    console.error("Failed to download and install update:", error);
    return false;
  }
}
