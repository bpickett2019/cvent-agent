import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface MaintenanceState { sessionId: string; viewerUrl: string; startedAt: string }
let maintenance: MaintenanceState | null = null;
let maintenanceWebSocket: string | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

function baseUrl(): string { return (process.env.STEEL_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, ""); }
function headers(): Record<string, string> { return { "content-type": "application/json", ...(process.env.STEEL_API_KEY ? { "steel-api-key": process.env.STEEL_API_KEY } : {}) }; }
export function goldenSessionPath(): string { return resolve(/*turbopackIgnore: true*/ process.cwd(), "..", process.env.EMERALDX_SESSION_PATH ?? "session.json"); }

export async function goldenStatus(): Promise<{ status: "ready" | "missing"; maintenance: MaintenanceState | null }> {
  const ready = await readFile(goldenSessionPath(), "utf8").then(() => true).catch(() => false);
  return { status: ready ? "ready" : "missing", maintenance };
}

export async function startLoginMaintenance(): Promise<MaintenanceState> {
  if (maintenance && maintenanceWebSocket) {
    await navigateCdp(maintenanceWebSocket, process.env.CVENT_APP_URL ?? "https://app.cvent.com/");
    return maintenance;
  }
  const response = await fetch(`${baseUrl()}/v1/sessions`, { method: "POST", headers: headers(), body: JSON.stringify({ persist: true, userDataDir: process.env.CVENT_GOLDEN_USER_DATA_DIR ?? "/tmp/cvent-golden-profile", headless: true }) });
  if (!response.ok) throw new Error(`Steel maintenance session failed: ${response.status} ${await response.text()}`);
  const session = await response.json() as { id: string; websocketUrl: string; sessionViewerUrl?: string; debugUrl?: string };
  const rawViewer = session.debugUrl ?? session.sessionViewerUrl;
  const viewerUrl = rawViewer ? rebaseUrl(rawViewer) : undefined;
  if (!viewerUrl) throw new Error("Steel did not provide a live viewer URL");
  maintenance = { sessionId: session.id, viewerUrl, startedAt: new Date().toISOString() };
  maintenanceWebSocket = rebaseWebSocket(session.websocketUrl);
  await navigateCdp(maintenanceWebSocket, process.env.CVENT_APP_URL ?? "https://app.cvent.com/");
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
  if (!maintenanceWebSocket) throw new Error("Steel login maintenance session has no CDP connection");
  assertAuthenticatedCventUrl(await currentCdpUrl(maintenanceWebSocket));
  const response = await fetch(`${baseUrl()}/v1/sessions/${maintenance.sessionId}/context`, { headers: headers() });
  if (!response.ok) throw new Error(`Steel context capture failed: ${response.status} ${await response.text()}`);
  const context = await response.json() as { cookies?: unknown[]; localStorage?: Record<string, Record<string, string>>; sessionStorage?: Record<string, Record<string, string>>; indexedDB?: Record<string, unknown[]>; userAgent?: string };
  const liveDetails = await fetch(`${baseUrl()}/v1/sessions/${maintenance.sessionId}/live-details`, { headers: headers() }).then((result) => result.ok ? result.json() as Promise<{ browserState?: { userAgent?: string } }> : undefined).catch(() => undefined);
  const session = { cookies: context.cookies ?? [], ...(context.localStorage ? { localStorage: context.localStorage } : {}), ...(context.sessionStorage ? { sessionStorage: context.sessionStorage } : {}), ...(context.indexedDB ? { indexedDB: context.indexedDB } : {}), ...(liveDetails?.browserState?.userAgent ? { userAgent: liveDetails.browserState.userAgent } : {}) };
  const target = goldenSessionPath(); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 }); await chmod(target, 0o600);
  startAuthenticationHeartbeat();
}

function startAuthenticationHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = setInterval(() => { if (maintenanceWebSocket) void navigateCdp(maintenanceWebSocket, process.env.CVENT_KEEPALIVE_URL ?? "https://app.cvent.com/Subscribers/Events2/EventSelection").catch(() => undefined); }, 5 * 60_000);
  heartbeat.unref?.();
}

export async function resetLoginMaintenance(): Promise<void> {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  if (maintenance) await fetch(`${baseUrl()}/v1/sessions/${maintenance.sessionId}/release`, { method: "POST", headers: headers() }).catch(() => undefined);
  maintenance = null;
  maintenanceWebSocket = null;
}

export function assertAuthenticatedCventUrl(value: string): void {
  const url = new URL(value);
  if (url.hostname !== "app.cvent.com") throw new Error("The maintenance browser is not an authenticated Cvent page");
  if (/login/i.test(url.pathname) || /login/i.test(url.search)) throw new Error("The maintenance browser is still on the Cvent login page");
}

async function currentCdpUrl(websocketUrl: string): Promise<string> {
  const socket = new WebSocket(websocketUrl);
  await new Promise<void>((resolveOpen, reject) => { socket.addEventListener("open", () => resolveOpen(), { once: true }); socket.addEventListener("error", () => reject(new Error("Steel CDP connection failed")), { once: true }); });
  try {
    const result = await new Promise<{ targetInfos: Array<{ type: string; url: string }> }>((resolveResult, reject) => {
      const listener = (event: MessageEvent) => { const message = JSON.parse(String(event.data)) as { id?: number; result?: { targetInfos: Array<{ type: string; url: string }> }; error?: { message?: string } }; if (message.id !== 1) return; socket.removeEventListener("message", listener); if (message.error) reject(new Error(message.error.message ?? "Target.getTargets failed")); else resolveResult(message.result!); };
      socket.addEventListener("message", listener); socket.send(JSON.stringify({ id: 1, method: "Target.getTargets" }));
    });
    return result.targetInfos.find((target) => target.type === "page")?.url ?? "about:blank";
  } finally { socket.close(); }
}
