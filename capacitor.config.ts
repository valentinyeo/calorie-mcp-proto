import type { CapacitorConfig } from "@capacitor/cli";

// Wraps the built web app in an Android WebView. The WebView is served from
// https://localhost, which the food log server allows for sign-in and the app API.
const config: CapacitorConfig = {
  appId: "dev.calorie.tracker",
  appName: "Calorie Tracker",
  webDir: "dist-app",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
