import { createHmac } from "node:crypto";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The UI talks to PostgREST through this dev server at /api.
// Reads go through as-is (PostgREST treats them as web_anon). Writes (POST to /rpc/...) get a
// short-lived JWT for web_writer added here, signed with LAB_JWT_SECRET from the repo's .env.
// The secret and the token never reach the browser bundle.

const repoRoot = path.resolve(__dirname, "../..");

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

function writerToken(secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ role: "web_writer", exp: Math.floor(Date.now() / 1000) + 300 }));
  const signature = createHmac("sha256", secret).update(`${header}.${claims}`).digest("base64url");
  return `${header}.${claims}.${signature}`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "LAB_");
  const apiPort = env.LAB_API_PORT || "3301";
  const secret = env.LAB_JWT_SECRET;

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (req) => {
              if (req.method !== "GET" && req.method !== "HEAD" && secret) {
                req.setHeader("Authorization", `Bearer ${writerToken(secret)}`);
              }
            });
          },
        },
      },
    },
    preview: { host: "127.0.0.1" },
  };
});
