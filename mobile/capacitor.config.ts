import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.simpledimple.app",
  appName: "Simple Dimple",
  webDir: "../frontend/dist",
  android: {
    allowMixedContent: false
  }
};

export default config;
