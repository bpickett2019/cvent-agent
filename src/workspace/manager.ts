import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createServer } from "node:net";
import { promisify } from "node:util";

export type WorkspaceAccess = "mutation" | "readOnly";
export type WorkspaceStatus = "starting" | "ready" | "failed" | "released";
export interface WorkspaceActivity { type: string; message: string; at: string }

export interface SteelWorkspace {
  id: string;
  name: string;
  ownerJobId: string;
  authScopeId: string;
  eventId: string;
  access: WorkspaceAccess;
  controller: "agent" | "user";
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  containerId: string | null;
  providerSessionId: string | null;
  apiUrl: string | null;
  viewerUrl: string | null;
  error: string | null;
  activity: WorkspaceActivity[];
  initialUrl?: string;
  assignment?: string;
}

export interface CreateSteelWorkspace {
  name: string;
  jobId: string;
  authScopeId?: string;
  eventId: string;
  access: WorkspaceAccess;
  initialUrl?: string;
  assignment?: string;
}

export interface StartedSteelWorkspace {
  containerId: string;
  providerSessionId?: string;
  apiUrl: string;
  viewerUrl: string;
}

export interface SteelWorkspaceRuntime {
  start(workspace: SteelWorkspace): Promise<StartedSteelWorkspace>;
  stop(workspace: SteelWorkspace): Promise<void>;
  refreshAuthentication?(workspace: SteelWorkspace): Promise<{ providerSessionId: string }>;
}

interface WorkspaceDocument { workspaces: SteelWorkspace[] }

export interface WorkspaceCapacityLimits { perJob: number; global: number; activeJobs: number }
export const DEFAULT_WORKSPACE_CAPACITY: WorkspaceCapacityLimits = { perJob: 12, global: 36, activeJobs: 3 };

export class FileSteelWorkspaceManager {
  private readonly statePath: string;
  private readonly lockPath: string;

  constructor(
    private readonly root: string,
    private readonly runtime: SteelWorkspaceRuntime,
    private readonly now: () => Date = () => new Date(),
    private readonly capacity: WorkspaceCapacityLimits = DEFAULT_WORKSPACE_CAPACITY,
  ) {
    this.statePath = join(root, "workspaces.json");
    this.lockPath = join(root, ".lock");
  }

  async create(input: CreateSteelWorkspace): Promise<SteelWorkspace> {
    if (!input.name.trim() || !input.jobId.trim() || !input.eventId.trim()) throw new Error("workspace name, jobId, and eventId are required");
    if (input.initialUrl) { const parsed = new URL(input.initialUrl); if (parsed.hostname.endsWith("cvent.com") && !input.initialUrl.toLowerCase().includes(input.eventId.toLowerCase())) throw new Error("workspace initial Cvent URL must contain its exact event ID"); }
    const workspace = await this.withLock(async (document) => {
      const active = document.workspaces.filter((candidate) => ["starting", "ready"].includes(candidate.status));
      const activeForJob = active.filter((candidate) => candidate.ownerJobId === input.jobId);
      if (activeForJob.length >= this.capacity.perJob) throw new Error(`per-job workspace limit of ${this.capacity.perJob} reached`);
      const activeJobs = new Set(active.map((candidate) => candidate.ownerJobId));
      if (!activeJobs.has(input.jobId) && activeJobs.size >= this.capacity.activeJobs) throw new Error(`active document limit of ${this.capacity.activeJobs} reached`);
      if (active.length >= this.capacity.global) throw new Error(`global workspace limit of ${this.capacity.global} reached`);
      if (input.access === "mutation") {
        const owner = document.workspaces.find((candidate) => candidate.eventId === input.eventId && candidate.access === "mutation" && ["starting", "ready"].includes(candidate.status));
        if (owner) throw new Error(`mutation workspace already owns event ${input.eventId}: ${owner.id}`);
      }
      const timestamp = this.now().toISOString();
      const created: SteelWorkspace = {
        id: randomUUID(), name: input.name.trim(), ownerJobId: input.jobId.trim(), authScopeId: input.authScopeId?.trim() || input.jobId.trim(), eventId: input.eventId.trim(), access: input.access, controller: "agent",
        status: "starting", createdAt: timestamp, updatedAt: timestamp, containerId: null, providerSessionId: null, apiUrl: null, viewerUrl: null, error: null,
        activity: [{ type: "workspace_started", message: input.assignment ? `Agent workspace is starting: ${input.assignment}` : "Agent workspace is starting", at: timestamp }],
        ...(input.initialUrl ? { initialUrl: input.initialUrl } : {}), ...(input.assignment ? { assignment: input.assignment.trim() } : {}),
      };
      document.workspaces.push(created);
      return created;
    });

    try {
      const started = await this.runtime.start(workspace);
      return await this.update(workspace.id, (current) => ({ ...current, ...started, status: "ready", updatedAt: this.now().toISOString() }));
    } catch (error) {
      await this.update(workspace.id, (current) => ({ ...current, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: this.now().toISOString() }));
      throw error;
    }
  }

  async release(id: string): Promise<SteelWorkspace> {
    const workspace = await this.get(id);
    if (!workspace) throw new Error(`unknown workspace ${id}`);
    if (workspace.status !== "released") await this.runtime.stop(workspace).catch(() => undefined);
    return this.update(id, (current) => ({ ...current, status: "released", updatedAt: this.now().toISOString() }));
  }

  async takeOver(id: string): Promise<SteelWorkspace> {
    return this.recordActivity(id, { type: "user_control", message: "Operator took control" }, "user");
  }

  async returnToAgent(id: string): Promise<SteelWorkspace> {
    return this.recordActivity(id, { type: "agent_control", message: "Control returned to agent; mutation remains paused until explicit Resume" }, "agent");
  }

  async refreshAuthentication(id: string): Promise<SteelWorkspace> {
    const workspace = await this.get(id);
    if (!workspace || workspace.status !== "ready") throw new Error(`workspace ${id} is not ready for authentication refresh`);
    if (!this.runtime.refreshAuthentication) throw new Error("workspace runtime does not support authentication refresh");
    const refreshed = await this.runtime.refreshAuthentication(workspace);
    const at = this.now().toISOString();
    return this.update(id, (current) => ({ ...current, providerSessionId: refreshed.providerSessionId, updatedAt: at, activity: [...current.activity, { type: "authentication_refreshed", message: "Fresh golden login cloned; assigned page reopened", at }].slice(-200) }));
  }

  async recordActivity(id: string, activity: Pick<WorkspaceActivity, "type" | "message">, controller?: "agent" | "user"): Promise<SteelWorkspace> {
    const at = this.now().toISOString();
    return this.update(id, (current) => ({ ...current, ...(controller ? { controller } : {}), updatedAt: at, activity: [...(current.activity ?? []), { ...activity, at }].slice(-200) }));
  }

  async reapExpired(maxAgeMs: number): Promise<SteelWorkspace[]> {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 1_000) throw new Error("workspace max age must be at least 1000ms");
    const cutoff = this.now().getTime() - maxAgeMs;
    const expired = (await this.list()).filter((workspace) => ["starting", "ready"].includes(workspace.status) && new Date(workspace.updatedAt).getTime() <= cutoff);
    const released: SteelWorkspace[] = [];
    for (const workspace of expired) released.push(await this.release(workspace.id));
    return released;
  }

  async get(id: string): Promise<SteelWorkspace | null> {
    return (await this.read()).workspaces.find((workspace) => workspace.id === id) ?? null;
  }

  async list(): Promise<SteelWorkspace[]> {
    return [...(await this.read()).workspaces].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async update(id: string, change: (workspace: SteelWorkspace) => SteelWorkspace): Promise<SteelWorkspace> {
    return this.withLock(async (document) => {
      const index = document.workspaces.findIndex((workspace) => workspace.id === id);
      if (index < 0) throw new Error(`unknown workspace ${id}`);
      document.workspaces[index] = change(document.workspaces[index]);
      return document.workspaces[index];
    });
  }

  private async read(): Promise<WorkspaceDocument> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return readFile(this.statePath, "utf8").then((source) => {
      const document = JSON.parse(source) as WorkspaceDocument;
      document.workspaces = document.workspaces.map((workspace) => ({ ...workspace, authScopeId: workspace.authScopeId || workspace.ownerJobId }));
      return document;
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return { workspaces: [] };
      throw error;
    });
  }

  private async withLock<T>(operation: (document: WorkspaceDocument) => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (let attempt = 0; ; attempt += 1) {
      try { await mkdir(this.lockPath); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 100) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      const document = await this.read();
      const result = await operation(document);
      const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.statePath);
      await chmod(this.statePath, 0o600);
      return result;
    } finally { await rm(this.lockPath, { recursive: true, force: true }); }
  }
}

const execFile = promisify(execFileCallback);

export interface DockerSteelWorkspaceRuntimeOptions {
  image?: string;
  containerPrefix?: string;
  timeoutMs?: number;
  sessionContextPath?: string | ((workspace: SteelWorkspace) => string);
}

export interface GoldenSessionContext { cookies: unknown[]; localStorage?: Record<string, Record<string, string>>; sessionStorage?: Record<string, Record<string, string>>; indexedDB?: Record<string, unknown[]>; userAgent?: string }
export function scopedSessionContextPath(basePath: string, authScopeId: string): string {
  if (!authScopeId.trim()) throw new Error("authentication scope is required");
  const scopeHash = createHash("sha256").update(authScopeId.trim()).digest("hex");
  return join(dirname(basePath), "sessions", `${scopeHash}.json`);
}
export async function seedScopedSessionContext(basePath: string, authScopeId: string): Promise<string> {
  const scopedPath = scopedSessionContextPath(basePath, authScopeId);
  if (await loadGoldenSessionContext(scopedPath)) return scopedPath;
  const legacy = await loadGoldenSessionContext(basePath);
  if (!legacy) throw new Error("no authenticated Golden context is available to seed this document");
  await mkdir(dirname(scopedPath), { recursive: true, mode: 0o700 });
  await writeFile(scopedPath, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });
  await chmod(scopedPath, 0o600);
  return scopedPath;
}
export async function loadGoldenSessionContext(path: string): Promise<GoldenSessionContext | undefined> {
  try {
    const metadata = await stat(path);
    if ((metadata.mode & 0o077) !== 0) throw new Error("golden browser context must have mode 0600");
    const value = JSON.parse(await readFile(path, "utf8")) as { cookies?: unknown[]; localStorage?: Record<string, Record<string, string>> | Record<string, string>; localStorageOrigin?: string; sessionStorage?: Record<string, Record<string, string>>; indexedDB?: Record<string, unknown[]>; userAgent?: string };
    const cookies = Array.isArray(value.cookies) ? value.cookies : [];
    const legacyLocalStorage = value.localStorageOrigin && value.localStorage ? { [value.localStorageOrigin]: value.localStorage as Record<string, string> } : undefined;
    const localStorage = legacyLocalStorage ?? value.localStorage as Record<string, Record<string, string>> | undefined;
    return { cookies, ...(localStorage ? { localStorage } : {}), ...(value.sessionStorage ? { sessionStorage: value.sessionStorage } : {}), ...(value.indexedDB ? { indexedDB: value.indexedDB } : {}), ...(value.userAgent ? { userAgent: value.userAgent } : {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function resolveWorkspaceImage(value = process.env.STEEL_WORKSPACE_IMAGE, production = process.env.NODE_ENV === "production"): string {
  const image = value?.trim();
  if (production && !image?.match(/^[^\s@]+@sha256:[0-9a-fA-F]{64}$/)) throw new Error("Production Steel workspace image must be an immutable @sha256 digest");
  return image || "ghcr.io/steel-dev/steel-browser";
}

export class DockerSteelWorkspaceRuntime implements SteelWorkspaceRuntime {
  constructor(private readonly options: DockerSteelWorkspaceRuntimeOptions = {}) {}

  private sessionContextPath(workspace: SteelWorkspace): string | undefined {
    return typeof this.options.sessionContextPath === "function"
      ? this.options.sessionContextPath(workspace)
      : this.options.sessionContextPath;
  }

  async start(workspace: SteelWorkspace): Promise<StartedSteelWorkspace> {
    const image = resolveWorkspaceImage(this.options.image);
    const prefix = this.options.containerPrefix ?? "cvent-steel-worker";
    const apiPort = await allocateLocalPort();
    const cdpPort = await allocateLocalPort();
    const { stdout } = await execFile("docker", buildDockerSteelRunArgs(workspace, apiPort, cdpPort, image, prefix));
    const containerId = stdout.trim();
    try {
      const apiUrl = `http://127.0.0.1:${apiPort}`;
      await waitForHealthy(`${apiUrl}/documentation/`, this.options.timeoutMs ?? 60_000);
      let providerSessionId: string | undefined;
      if (workspace.access === "readOnly") {
        const contextPath = this.sessionContextPath(workspace);
        const goldenContext = contextPath ? await loadGoldenSessionContext(contextPath) : undefined;
        const { userAgent, ...sessionContext } = goldenContext ?? { cookies: [] };
        const response = await fetch(`${apiUrl}/v1/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ persist: false, headless: true, sessionContext }),
        });
        if (!response.ok) throw new Error(`Steel workspace session failed: ${response.status} ${await response.text()}`);
        providerSessionId = ((await response.json()) as { id: string }).id;
        if (workspace.initialUrl) await navigateSteelCdp(apiUrl.replace(/^http/, "ws") + "/", workspace.initialUrl);
      }
      return { containerId, providerSessionId, apiUrl, viewerUrl: `${apiUrl}/v1/sessions/debug` };
    } catch (error) {
      await execFile("docker", ["rm", "-f", containerId]).catch(() => undefined);
      throw error;
    }
  }

  async refreshAuthentication(workspace: SteelWorkspace): Promise<{ providerSessionId: string }> {
    if (!workspace.apiUrl) throw new Error("workspace has no Steel API URL");
    const contextPath = this.sessionContextPath(workspace);
    if (!contextPath) throw new Error("golden session context path is not configured");
    let resumeUrl = workspace.initialUrl;
    if (!resumeUrl && workspace.providerSessionId) {
      const details = await fetch(`${workspace.apiUrl}/v1/sessions/${workspace.providerSessionId}/live-details`).then((response) => response.ok ? response.json() as Promise<{ pages?: Array<{ url?: string }> }> : undefined).catch(() => undefined);
      resumeUrl = details?.pages?.find((page) => page.url && page.url !== "about:blank")?.url;
    }
    if (workspace.providerSessionId) await fetch(`${workspace.apiUrl}/v1/sessions/${workspace.providerSessionId}/release`, { method: "POST", headers: { "content-type": "application/json" } }).catch(() => undefined);
    const goldenContext = await loadGoldenSessionContext(contextPath);
    const { userAgent, ...sessionContext } = goldenContext ?? { cookies: [] };
    const response = await fetch(`${workspace.apiUrl}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persist: false, headless: true, sessionContext }) });
    if (!response.ok) throw new Error(`Steel workspace authentication refresh failed: ${response.status} ${await response.text()}`);
    const providerSessionId = ((await response.json()) as { id: string }).id;
    if (resumeUrl) await navigateSteelCdp(workspace.apiUrl.replace(/^http/, "ws") + "/", resumeUrl);
    return { providerSessionId };
  }

  async stop(workspace: SteelWorkspace): Promise<void> {
    if (workspace.apiUrl && workspace.providerSessionId) {
      await fetch(`${workspace.apiUrl}/v1/sessions/${workspace.providerSessionId}/release`, { method: "POST", headers: { "content-type": "application/json" } }).catch(() => undefined);
    }
    if (workspace.containerId) await execFile("docker", ["rm", "-f", workspace.containerId]).then(() => undefined);
  }
}

export function buildDockerSteelRunArgs(workspace: Pick<SteelWorkspace, "id" | "ownerJobId">, apiPort: number, cdpPort: number, image: string, prefix: string): string[] {
  return [
    "run", "-d", "--name", `${prefix}-${workspace.id}`, "--restart", "unless-stopped",
    "--label", `cvent-agent.workspace=${workspace.id}`,
    "--label", `cvent-agent.job=${workspace.ownerJobId}`,
    "-p", `127.0.0.1:${apiPort}:3000`, "-p", `127.0.0.1:${cdpPort}:9223`,
    "-e", `DOMAIN=127.0.0.1:${apiPort}`, "-e", `CDP_DOMAIN=127.0.0.1:${cdpPort}`, "-e", "USE_SSL=false", "-e", "CHROME_HEADLESS=true",
    image,
  ];
}

async function navigateSteelCdp(websocketUrl: string, url: string): Promise<void> {
  const socket = new WebSocket(websocketUrl); let id = 0;
  await new Promise<void>((resolveOpen, reject) => { socket.addEventListener("open", () => resolveOpen(), { once: true }); socket.addEventListener("error", () => reject(new Error("Steel CDP navigation connection failed")), { once: true }); });
  const command = <T>(method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<T>((resolveCommand, reject) => { const commandId = ++id; const listener = (event: MessageEvent) => { try { const message = JSON.parse(String(event.data)) as { id?: number; result?: T; error?: { message?: string } }; if (message.id !== commandId) return; socket.removeEventListener("message", listener); if (message.error) reject(new Error(message.error.message ?? `${method} failed`)); else resolveCommand(message.result as T); } catch { /* wait for matching CDP result */ } }; socket.addEventListener("message", listener); socket.send(JSON.stringify({ id: commandId, method, params, ...(sessionId ? { sessionId } : {}) })); });
  try { const targets = await command<{ targetInfos: Array<{ targetId: string; type: string }> }>("Target.getTargets"); const target = targets.targetInfos.find((value) => value.type === "page") ?? await command<{ targetId: string }>("Target.createTarget", { url: "about:blank" }); const attached = await command<{ sessionId: string }>("Target.attachToTarget", { targetId: target.targetId, flatten: true }); await command("Page.navigate", { url }, attached.sessionId); } finally { socket.close(); }
}

async function allocateLocalPort(): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForHealthy(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; lastError = new Error(`health returned ${response.status}`); }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Steel workspace did not become healthy: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
