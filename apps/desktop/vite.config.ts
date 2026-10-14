import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 43219, strictPort: true, host: "localhost" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: ["es2022", "safari15"], sourcemap: !!process.env.TAURI_ENV_DEBUG },
});
