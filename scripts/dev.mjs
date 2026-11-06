import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const token = process.env.QSTUDIO_TOKEN || randomBytes(24).toString("hex");
const child = spawn("pnpm", [
    "exec",
    "concurrently",
    "-n",
    "server,web",
    "-c",
    "yellow,magenta",
    "pnpm --filter @qstudio/server dev",
    "pnpm --filter @qstudio/web dev",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, QSTUDIO_TOKEN: token },
  }
);

child.on("error", (err) => {
  console.error(`[dev] could not start the workspace: ${err.message}`);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  }
  process.exit(code ?? 1);
});
