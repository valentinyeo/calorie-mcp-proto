import type { CapacitorConfig } from "@capacitor/cli";

// Device-proof build only: the Android emulator in CI talks to the Worker running on the
// CI host at http://10.0.2.2:8788, so cleartext HTTP has to be allowed for that build.
// The shipped APK uses capacitor.config.ts and https only.
const config: CapacitorConfig = {
  appId: "dev.calorie.tracker",
  appName: "Calorie Tracker",
  webDir: "dist-app",
  server: {
    androidScheme: "https",
    cleartext: true,
  },
};

export default config;
