import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app talks to the local Express server over /api.
// Vite proxies those calls in dev so everything runs on one origin.
export default defineConfig({
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
