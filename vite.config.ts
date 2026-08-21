import { defineConfig } from "vite";

// The site is served from https://<user>.github.io/Collisions-Simulator/, so
// every asset URL needs that prefix in a production build. Locally the dev
// server serves from the root, hence the conditional.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/Collisions-Simulator/" : "/",
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // The physics runs headless; only the panel-construction tests need a DOM,
    // and they say so with a `@vitest-environment` comment.
    environment: "node",
  },
}));
