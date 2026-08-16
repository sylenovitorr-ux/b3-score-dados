import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "br.com.b3score.dados",
  appName: "B3 Score",
  webDir: "dist",
  bundledWebRuntime: false,
  android: { allowMixedContent: false },
};

export default config;
