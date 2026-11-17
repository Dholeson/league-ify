import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two build shapes from one config:
//   - local dev / default: app at "/", API at "/api" (Vite proxies to Express).
//   - hosted on dhole.dev (BUILD_TARGET=site): the SPA is vendored under
//     /projects/league-ify/ and the API is a Pages Function at /api/league-ify.
// The hosted build is produced by `npm run build:site`.
const hosted = process.env.BUILD_TARGET === "site";

export default defineConfig({
  base: hosted ? "/projects/league-ify/" : "/",
  // Injected as a literal at build time; read in src/api.ts. Avoids relying on
  // env-var plumbing into import.meta.env.
  define: {
    __API_BASE__: JSON.stringify(hosted ? "/api/league-ify" : "/api"),
  },
  build: {
    // Keep the hosted bundle in its own folder so it never collides with the
    // Worker bundle (dist/worker) during `npm run build:all`.
    outDir: hosted ? "dist/site" : "dist",
  },
  plugins: [react()],
  server: {
    port: 5173,
    // Bind all interfaces and accept the Cloudflare tunnel host so `npm run
    // demo` can expose the app to a tester over a public URL. Harmless locally.
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
