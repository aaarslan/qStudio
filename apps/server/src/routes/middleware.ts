import crypto from "node:crypto";
import type { Hono } from "hono";

export const TOKEN = process.env.QSTUDIO_TOKEN ?? "";

export function isAllowedOrigin(origin: string, host: string): boolean {
  if (origin === "tauri://localhost" || /^https?:\/\/tauri\.localhost(:\d+)?$/.test(origin)) {
    return true;
  }
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) return false;
    return url.host === host;
  } catch {
    return false;
  }
}

export function tokenMatches(presented: string): boolean {
  const actual = Buffer.from(TOKEN);
  const received = Buffer.from(presented);
  return actual.length === received.length && crypto.timingSafeEqual(actual, received);
}

export function setupMiddleware(app: Hono) {
  app.use("*", async (c, next) => {
    const host = c.req.header("host") ?? "";
    if (!/^(localhost|127\.0\.0\.1|\[::1\]|tauri\.localhost)(:\d+)?$/.test(host)) {
      return c.text("Q Studio only accepts loopback connections.", 403);
    }
    const origin = c.req.header("origin");
    if (origin && !isAllowedOrigin(origin, host)) {
      return c.text("Forbidden origin.", 403);
    }
    if (origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    if (TOKEN && c.req.path.startsWith("/api/") && c.req.path !== "/api/health") {
      const header = c.req.header("authorization") ?? "";
      const headerToken = header.startsWith("Bearer ") ? header.slice(7) : "";
      const queryToken =
        c.req.method === "GET" &&
        (c.req.path === "/api/events" || c.req.path.startsWith("/api/media/"))
          ? c.req.query("token") ?? ""
          : "";
      if (!tokenMatches(headerToken || queryToken)) {
        return c.json({ error: "Missing or wrong engine token." }, 401);
      }
    }
    await next();
  });
}
