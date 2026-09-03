import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { authorizeOperatorRequest } from "./web/lib/operator-auth";
import { assertSameOrigin, publicWorkspace } from "./web/lib/request-security";
import type { SteelWorkspace } from "./src/workspace/manager";

const workspace: SteelWorkspace = {
  id: "workspace-1",
  name: "Mutation worker",
  ownerJobId: "job-secret",
  authScopeId: "document-secret",
  eventId: "event-1",
  access: "mutation",
  controller: "agent",
  status: "ready",
  createdAt: "2026-09-02T12:00:00.000Z",
  updatedAt: "2026-09-02T12:01:00.000Z",
  containerId: "container-secret",
  providerSessionId: "provider-secret",
  apiUrl: "http://127.0.0.1:3333",
  viewerUrl: "http://127.0.0.1:3333/v1/sessions/debug",
  error: null,
  activity: [],
};
const dto = publicWorkspace(workspace);
assert.equal(dto.viewerUrl, workspace.viewerUrl);
assert.equal("apiUrl" in dto, false);
assert.equal("providerSessionId" in dto, false);
assert.equal("containerId" in dto, false);
assert.equal("ownerJobId" in dto, false);
assert.equal("authScopeId" in dto, false);

assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { origin: "http://localhost:3000" } })));
assert.doesNotThrow(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/auth", { method: "POST", headers: { origin: "http://127.0.0.1:3000" } })));
assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost:4320/api/rr-preview", { method: "POST", headers: { origin: "http://127.0.0.1:4320" } })), "Next.js local canonicalization may map 127.0.0.1 to localhost without changing protocol or port");
assert.throws(() => assertSameOrigin(new Request("http://localhost:4320/api/rr-preview", { method: "POST", headers: { origin: "http://127.0.0.1:4321" } })), /same-origin/i, "loopback aliases with different ports must remain cross-origin");
assert.throws(() => assertSameOrigin(new Request("https://localhost:4320/api/rr-preview", { method: "POST", headers: { origin: "http://127.0.0.1:4320" } })), /same-origin/i, "loopback aliases with different protocols must remain cross-origin");
assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { origin: "https://evil.example" } })), /same-origin/i);
assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/auth", { method: "POST" })), /same-origin/i);

async function routeFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? routeFiles(join(root, entry.name)) : [join(root, entry.name)]));
  return nested.flat().filter((path) => path.endsWith("route.ts"));
}
const postRoutes = [] as string[];
for (const path of await routeFiles("web/app/api")) {
  const source = await readFile(path, "utf8");
  if (/export\s+async\s+function\s+POST\s*\(request/.test(source)) {
    postRoutes.push(path);
    assert.match(source, /assertSameOrigin\(request\)/, `${path} must reject cross-origin POSTs`);
  }
}
assert.ok(postRoutes.length >= 7, "security scan must discover every current POST route");
const workspaceRoute = await readFile("web/app/api/workspaces/route.ts", "utf8");
assert.match(workspaceRoute, /publicWorkspace/);
assert.match(workspaceRoute, /Return leaves mutation run paused/);
assert.doesNotMatch(workspaceRoute, /runControls\(\)\.resume/);

const basic = `Basic ${Buffer.from("pilot:correct horse").toString("base64")}`;
const credentials = { username: "pilot", password: "correct horse" };
assert.equal(authorizeOperatorRequest(new Request("https://pilot.example/", { headers: { authorization: basic } }), { production: true, credentials }).authorized, true);
assert.equal(authorizeOperatorRequest(new Request("https://pilot.example/"), { production: true, credentials }).authorized, false);
assert.equal(authorizeOperatorRequest(new Request("https://pilot.example/", { headers: { authorization: `Basic ${Buffer.from("pilot:wrong").toString("base64")}` } }), { production: true, credentials }).authorized, false);
assert.equal(authorizeOperatorRequest(new Request("https://pilot.example/"), { production: true, credentials: null }).authorized, false, "production must fail closed when credentials are absent");
assert.equal(authorizeOperatorRequest(new Request("http://localhost:3000/"), { production: false, credentials: null, allowUnauthenticatedDevelopment: true }).authorized, true);
assert.equal(authorizeOperatorRequest(new Request("http://localhost:3000/"), { production: false, credentials: null, allowUnauthenticatedDevelopment: false }).authorized, false, "development bypass must be explicit");
const proxySource = await readFile("web/proxy.ts", "utf8");
const entraAuthSource = await readFile("web/auth.ts", "utf8");
const goldenAuthRouteSource = await readFile("web/app/api/auth/route.ts", "utf8");
const jobsRouteSource = await readFile("web/app/api/jobs/route.ts", "utf8");
assert.match(proxySource, /export function proxy/);
assert.match(proxySource, /import \{ auth \}/);
assert.match(entraAuthSource, /authorized\(\{ auth, request \}\)/);
assert.match(entraAuthSource, /authorizeRole\(auth, "Viewer"\)/);
assert.doesNotMatch(goldenAuthRouteSource, /store\.refreshAuthentication/, "the default Golden seed must never overwrite every document-scoped login");
assert.match(jobsRouteSource, /parseAuthScope/, "every queued RR document must retain an immutable private login scope across its runs");
assert.match(jobsRouteSource, /randomUUID\(\)/, "server must provide a private scope fallback");

const monitor = await readFile("web/components/run-monitor.tsx", "utf8");
const cards = await readFile("web/components/agent-workspaces.tsx", "utf8");
assert.doesNotMatch(monitor, /Open in new window/);
assert.doesNotMatch(monitor, /Open full screen/);
assert.match(monitor, /pointerEvents:\s*selectedViewer\.interactive\s*\?\s*"auto"\s*:\s*"none"/);
assert.match(monitor, /tabIndex=\{selectedViewer\.interactive\s*\?\s*0\s*:\s*-1\}/);
assert.match(monitor, /inert=\{!selectedViewer\.interactive\}/);
assert.match(monitor, /workspace-viewer-shield/);
assert.match(monitor, /Return control/);
assert.match(cards, /interactive:\s*false/);
assert.match(cards, /interactive:\s*true/);
console.log("viewer and API security blockers smoke passed");
