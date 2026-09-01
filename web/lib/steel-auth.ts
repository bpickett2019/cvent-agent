import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface MaintenanceState { sessionId: string; viewerUrl: string; startedAt: string }
let maintenance: MaintenanceState | null = null;

function baseUrl(): string { return (process.env.STEEL_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, ""); }
function headers(): Record<string, string> { return { "content-type": "application/json", ...(process.env.STEEL_API_KEY ? { "steel-api-key": process.env.STEEL_API_KEY } : {}) }; }
export function goldenSessionPath(): string { return resolve(/*turbopackIgnore: true*/ process.cwd(), "..", process.env.EMERALDX_SESSION_PATH ?? "session.json"); }

export async function goldenStatus(): Promise<{ status: "ready" | "missing"; maintenance: MaintenanceState | null }> {
  const ready = await readFile(goldenSessionPath(), "utf8").then(() => true).catch(() => false);
  return { status: ready ? "ready" : "missing", maintenance };
}

export async function startLoginMaintenance(): Promise<MaintenanceState> {
  if (maintenance) return maintenance;
  const response = await fetch(`${baseUrl()}/v1/sessions`, { method: "POST", headers: headers(), body: JSON.stringify({ persistProfile: false, timeout: 3_600_000, headless: false, debugConfig: { interactive: true, systemCursor: true } }) });
  if (!response.ok) throw new Error(`Steel maintenance session failed: ${response.status} ${await response.text()}`);
  const session = await response.json() as { id: string; sessionViewerUrl?: string; debugUrl?: string };
  const viewerUrl = session.sessionViewerUrl ?? session.debugUrl;
  if (!viewerUrl) throw new Error("Steel did not provide a live viewer URL");
  maintenance = { sessionId: session.id, viewerUrl, startedAt: new Date().toISOString() };
  return maintenance;
}

export async function captureGoldenLogin(): Promise<void> {
  if (!maintenance) throw new Error("No active Steel login maintenance session");
  const response = await fetch(`${baseUrl()}/v1/sessions/${maintenance.sessionId}/context`, { headers: headers() });
  if (!response.ok) throw new Error(`Steel context capture failed: ${response.status} ${await response.text()}`);
  const context = await response.json() as { cookies?: unknown[]; localStorage?: Record<string, Record<string, string>> };
  const localStorageOrigin = Object.keys(context.localStorage ?? {})[0];
  const session = { cookies: context.cookies ?? [], ...(localStorageOrigin ? { localStorage: context.localStorage?.[localStorageOrigin], localStorageOrigin } : {}) };
  const target = goldenSessionPath(); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 }); await chmod(target, 0o600);
  await fetch(`${baseUrl()}/v1/sessions/${maintenance.sessionId}/release`, { method: "POST", headers: headers() }).catch(() => undefined);
  maintenance = null;
}
