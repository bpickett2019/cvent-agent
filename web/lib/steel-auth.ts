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
  const response = await fetch(`${baseUrl()}/v1/sessions`, { method: "POST", headers: headers(), body: JSON.stringify({ persistProfile: false, timeout: 3_600_000, headless: true, debugConfig: { interactive: true, systemCursor: true } }) });
  if (!response.ok) throw new Error(`Steel maintenance session failed: ${response.status} ${await response.text()}`);
  const session = await response.json() as { id: string; websocketUrl: string; sessionViewerUrl?: string; debugUrl?: string };
  const rawViewer = session.debugUrl ?? session.sessionViewerUrl;
  const viewerUrl = rawViewer ? rebaseUrl(rawViewer) : undefined;
  if (!viewerUrl) throw new Error("Steel did not provide a live viewer URL");
  maintenance = { sessionId: session.id, viewerUrl, startedAt: new Date().toISOString() };
  await navigateCdp(rebaseWebSocket(session.websocketUrl), process.env.CVENT_APP_URL ?? "https://app.cvent.com/");
  return maintenance;
}

function rebaseUrl(raw: string): string { const source = new URL(raw); const target = new URL(baseUrl()); source.protocol = target.protocol; source.host = target.host; return source.toString(); }
function rebaseWebSocket(raw: string): string { const source = new URL(raw); const target = new URL(baseUrl()); source.protocol = target.protocol === "https:" ? "wss:" : "ws:"; source.host = target.host; return source.toString(); }
async function navigateCdp(websocketUrl: string, url: string): Promise<void> {
  const socket = new WebSocket(websocketUrl); let id = 0;
  await new Promise<void>((resolveOpen, reject) => { socket.addEventListener("open", () => resolveOpen(), { once: true }); socket.addEventListener("error", () => reject(new Error("Steel CDP connection failed")), { once: true }); });
  const command = <T>(method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<T>((resolveCommand, reject) => {
    const commandId = ++id;
    const listener = (event: MessageEvent) => { try { const message = JSON.parse(String(event.data)) as { id?: number; result?: T; error?: { message?: string } }; if (message.id !== commandId) return; socket.removeEventListener("message", listener); if (message.error) reject(new Error(message.error.message ?? `${method} failed`)); else resolveCommand(message.result as T); } catch { /* wait for a valid CDP record */ } };
    socket.addEventListener("message", listener); socket.send(JSON.stringify({ id: commandId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  try {
    const targets = await command<{ targetInfos: Array<{ targetId: string; type: string }> }>("Target.getTargets");
    const target = targets.targetInfos.find((value) => value.type === "page") ?? await command<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const targetId = "targetId" in target ? target.targetId : undefined; if (!targetId) throw new Error("Steel browser has no page target");
    const attached = await command<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    await command("Page.navigate", { url }, attached.sessionId);
  } finally { socket.close(); }
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
