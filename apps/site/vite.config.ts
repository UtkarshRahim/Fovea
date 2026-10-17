import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  server: { port: 43219, strictPort: true },
});
