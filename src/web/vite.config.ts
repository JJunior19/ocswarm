import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Standalone web build (F3): `bun run build:web` compiles src/web into
// <repo>/dist/web, which the plugin server then serves statically (see
// `staticRoot` in src/server/app.ts).
//
// Type checking note: `bun run typecheck` uses the ROOT tsconfig only, which
// excludes src/web and stays solid-js-only. This directory carries its own
// tsconfig.json (jsx: react-jsx, DOM libs) for editor support; the shipped
// code is checked by esbuild during this build — an accepted tradeoff to keep
// the two JSX worlds from colliding in one config.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [react()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});
