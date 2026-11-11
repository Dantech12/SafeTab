import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Serves the supervisor portal (static files in /public). No build step, no third-party
 * scripts: everything is same-origin, so the default helmet CSP (script-src 'self') applies.
 */
const FILES: Record<string, string> = {
  "/": "index.html",
  "/app.js": "app.js",
  "/app.css": "app.css",
};
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export async function portalRoutes(app: FastifyInstance) {
  const dir = path.resolve("public");
  for (const [route, file] of Object.entries(FILES)) {
    app.get(route, async (_req, reply) => {
      const body = await readFile(path.join(dir, file));
      return reply
        .type(TYPES[path.extname(file)] ?? "application/octet-stream")
        .header("cache-control", "no-store")
        .send(body);
    });
  }
}
