// Root-level entrypoint shim for local-directory plugin loading.
// OpenCode v2.0.24 resolves local plugin directories via Bun.resolveSync of
// root files (tui), not via the package exports map. The real implementation
// lives in src/tui.tsx; the exports map still exposes "./tui" for registry
// consumption.
export { default } from "./src/tui"
