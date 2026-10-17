import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// iOS and Android fill transparent pixels in home-screen icons, so those two get an explicit background.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: { ...minimal2023Preset.maskable, padding: 0.2, resizeOptions: { background: "#121A16" } },
    apple: { ...minimal2023Preset.apple, padding: 0.2, resizeOptions: { background: "#121A16" } },
  },
  images: ["public/icon.svg"],
});
