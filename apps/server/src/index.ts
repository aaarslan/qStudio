import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { APP_DIR } from "./config";
import { closeDb, loadDb } from "./store";
import { resume } from "./runner";
import { TOKEN, setupMiddleware } from "./routes/middleware";
import { registerSystemRoutes } from "./routes/system";
import { registerLibraryRoutes } from "./routes/library";
import { registerFilmCrudRoutes } from "./routes/filmCrud";
import { registerFilmRenderRoutes } from "./routes/filmRender";

export const app = new Hono();
const PORT = Number(process.env.PORT ?? process.env.QSTUDIO_PORT ?? 8799);

setupMiddleware(app);
registerSystemRoutes(app);
registerLibraryRoutes(app);
registerFilmCrudRoutes(app);
registerFilmRenderRoutes(app);

/* ------------------------------ frontend ----------------------------- */

const dist = path.resolve(import.meta.dirname, "../../web/dist");

export function initializeServer() {
  loadDb();
  resume();
}

export function startServer() {
  if (fs.existsSync(dist)) {
    app.use("/*", serveStatic({ root: dist }));
    app.get("*", (c) => c.html(fs.readFileSync(path.join(dist, "index.html"), "utf8")));
  }

  initializeServer();

  const distDir = process.env.QSTUDIO_DIST;
  if (distDir && fs.existsSync(distDir)) {
    app.use("/*", serveStatic({ root: distDir }));
  }

  const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
    console.log(`\n  Q STUDIO server  →  http://127.0.0.1:${info.port}\n`);
    console.log(`QSTUDIO_READY ${JSON.stringify({ port: info.port })}`);
    try {
      fs.mkdirSync(APP_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(APP_DIR, "engine.json"),
        JSON.stringify({ port: info.port, pid: process.pid, startedAt: new Date().toISOString() }),
        { mode: 0o600 }
      );
    } catch {
    }
  });

  let shuttingDown = false;
  function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[engine] ${signal} received, shutting down`);
    closeDb();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  if (TOKEN) {
    const parentPid = process.ppid;
    setInterval(() => {
      if (process.ppid !== parentPid) shutdown("parent exited");
    }, 2000).unref();
  }

  return server;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === path.resolve(import.meta.filename)) {
  startServer();
}
