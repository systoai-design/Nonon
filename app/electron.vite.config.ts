import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

// The page ships with a CSP that allows no network at all. Only the dev server needs a socket back to itself for hot reload.
const devSocket: Plugin = {
  name: "nonon-dev-csp",
  apply: "serve",
  transformIndexHtml: (html) => html.replace("connect-src 'self';", "connect-src 'self' ws://localhost:* http://localhost:*;"),
};

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, "src/main/index.ts") } } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react(), tailwindcss(), devSocket],
    build: { rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } } },
  },
});
