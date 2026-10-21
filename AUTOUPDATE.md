# Auto-Update Feature

Fovea now includes automatic update notifications! When a new version is released, users will see a banner at the top of the app offering to download and install the update.

## How it works

1. **Automatic checking**: When the app starts, it checks GitHub Releases for updates after a 3-second delay
2. **User notification**: If an update is available, a banner appears at the top with version information
3. **One-click update**: Users can click "Update now" to download and install
4. **Progress tracking**: Shows download progress percentage
5. **Restart required**: After installation, users need to restart the app to apply the update

## Technical details

### Frontend

- `apps/desktop/src/updater.ts`: Update checking and installation logic
- `apps/desktop/src/UpdateNotification.tsx`: UI component for update banner
- Uses `@tauri-apps/plugin-updater` to check GitHub releases

### Backend

- `apps/desktop/src-tauri/src/lib.rs`: Initializes the updater plugin
- `apps/desktop/src-tauri/tauri.conf.json`: Updater configuration pointing to GitHub
- `apps/desktop/src-tauri/Cargo.toml`: Added `tauri-plugin-updater` dependency

### Update endpoint

The updater checks: `https://api.github.com/repos/UtkarshRahim/Fovea/releases/latest`

GitHub automatically generates the correct JSON format that Tauri expects, including:
- Version number
- Download URLs for each platform (.dmg, .exe)
- Release notes
- Publication date

## Security (optional enhancement)

Currently, updates are unsigned. For additional security, you can:

1. Generate a signing key pair:
   ```bash
   pnpm tauri signer generate
   ```

2. Add the public key to `tauri.conf.json` in the `plugins.updater.pubkey` field

3. Sign releases in the GitHub workflow using the private key (stored as a GitHub secret)

This ensures users only install updates that were officially released by you.

## Testing updates

To test the auto-updater:

1. Build and release a new version with a higher version number in `tauri.conf.json`
2. Push a git tag and let GitHub Actions create the release
3. Run the previous version locally
4. The update banner should appear after ~3 seconds

## User experience

- **"Update available"** banner: Shows new version number and release date
- **"Update now"** button: Downloads and installs the update
- **"Later"** button: Dismisses the notification
- **Download progress**: Real-time percentage display
- **"Update ready"** message: Indicates restart is needed to apply

Users can dismiss the notification and continue working. The check only happens at app startup, so it won't interrupt ongoing work.
