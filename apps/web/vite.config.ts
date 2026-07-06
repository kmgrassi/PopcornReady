import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const workspaceSourceAliases = [
  {
    find: /^@popcorn\/shared\/(.+)$/,
    replacement: fileURLToPath(new URL("../../packages/shared/src/$1.ts", import.meta.url)),
  },
];

const localApiTarget = process.env.PLAYWRIGHT_API_PORT
  ? `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT}`
  : "http://localhost:4000";
const deviceHttps =
  process.env.POPCORN_DEVICE_HTTPS_CERT &&
  process.env.POPCORN_DEVICE_HTTPS_KEY &&
  existsSync(process.env.POPCORN_DEVICE_HTTPS_CERT) &&
  existsSync(process.env.POPCORN_DEVICE_HTTPS_KEY)
    ? {
        cert: readFileSync(process.env.POPCORN_DEVICE_HTTPS_CERT),
        key: readFileSync(process.env.POPCORN_DEVICE_HTTPS_KEY),
      }
    : undefined;

// The web app is a static SPA deployed to Netlify. It talks to the Express API
// (Railway) over HTTP via VITE_API_URL. In dev we proxy /api to the local API
// server so cookies/headers behave like production without CORS friction.
export default defineConfig({
  // Load env from the repo root (where the shared .env* live), not just
  // apps/web — so public VITE_* vars (e.g. VITE_SUPABASE_*) reach the web
  // build the same way the API reads its env from the root. Only VITE_-
  // prefixed vars are exposed to the client; root-level secrets are not.
  envDir: "../..",
  plugins: [react()],
  resolve: {
    alias: workspaceSourceAliases,
  },
  server: {
    port: 3000,
    https: deviceHttps,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || localApiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3000,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
