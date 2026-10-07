// Root-level entrypoint shim for local-directory plugin loading.
// OpenCode v2.0.24 resolves local plugin directories via Bun.resolveSync of
// root files (server/index), not via the package exports map. The real
// implementation lives in src/index.ts; the exports map still exposes "." and
// "./server" for registry consumption.
export { default } from "./src/index";
