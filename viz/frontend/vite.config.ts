import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { authPlugin } from "./vite.auth";

// The UI talks to PostgREST through this dev server at /api. Reads go through as-is (PostgREST
// treats them as web_anon). Writes need a logged-in session: vite.auth.ts checks the session cookie
// and adds a short-lived web_writer JWT, signed with LAB_JWT_SECRET from the repo's .env.
// The secret and the tokens never reach the browser.

const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "LAB_");
  const apiPort = env.LAB_API_PORT || "3301";
  const secret = env.LAB_JWT_SECRET;

  return {
    plugins: [react(), tailwindcss(), authPlugin({ apiUrl: `http://127.0.0.1:${apiPort}`, secret })],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
    preview: { host: "127.0.0.1" },
  };
});
