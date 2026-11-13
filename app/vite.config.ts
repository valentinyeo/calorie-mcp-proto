import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

// The app's source lives in app/ and builds to dist-app/, which Capacitor copies into
// the Android WebView. The web bundle is also servable on its own for local use.
export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: "../dist-app",
    target: "es2022",
  },
  root: fileURLToPath(new URL(".", import.meta.url)),
});
