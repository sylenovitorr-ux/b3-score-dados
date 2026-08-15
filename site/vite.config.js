import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const bundleBenchmarks = () => ({
  name: "bundle-official-benchmarks",
  closeBundle() {
    const source = resolve("../data/benchmarks.json");
    const target = resolve("dist/data/benchmarks.json");
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  },
});

export default defineConfig({
  plugins: [react(), bundleBenchmarks()],
  base: "/b3-score-dados/",
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
