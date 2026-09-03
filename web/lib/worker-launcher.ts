import { spawn } from "node:child_process";
import { resolve } from "node:path";

export function startLocalWorker(): { started: boolean; pid?: number } {
  if (process.env.EMERALDX_AUTOSTART_WORKER === "false") return { started: false };
  const projectRoot = resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
  const child = spawn(process.execPath, ["--import", "tsx", resolve(projectRoot, "bin", "worker.ts"), "--once"], {
    cwd: projectRoot,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { started: true, ...(child.pid ? { pid: child.pid } : {}) };
}
