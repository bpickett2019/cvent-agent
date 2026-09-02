import assert from "node:assert/strict";
import { authorizeRole, extractEmeraldRoles } from "./lib/entra-authz";
import { allowUnauthenticatedDevelopment, entraEnvironment } from "./lib/entra-config";

assert.deepEqual(
  authorizeRole(undefined, "Viewer"),
  { authorized: false, status: 401, reason: "authentication-required" },
  "missing session must fail closed as unauthenticated",
);

assert.equal(
  authorizeRole({ user: { roles: ["Administrator"] } }, "Operator").authorized,
  true,
  "Administrator must inherit Operator abilities",
);

assert.throws(
  () => entraEnvironment({ NODE_ENV: "production" }),
  /EMERALDX_ENTRA_TENANT_ID/,
  "production Entra configuration must fail closed when environment is incomplete",
);

assert.deepEqual(
  extractEmeraldRoles({ roles: ["Operator", "Global Administrator", "Operator", 42] }),
  ["Operator"],
  "only declared app roles may enter the session",
);

assert.deepEqual(
  authorizeRole({ user: { roles: ["Viewer"] } }, "Operator"),
  { authorized: false, status: 403, reason: "insufficient-role" },
  "authenticated viewers must receive forbidden for privileged actions",
);

assert.equal(
  allowUnauthenticatedDevelopment({ NODE_ENV: "development", EMERALDX_ALLOW_UNAUTHENTICATED_DEV: "true" }),
  true,
  "explicit local development bypass is available when no external canonical URL is configured",
);

assert.equal(
  allowUnauthenticatedDevelopment({
    NODE_ENV: "development",
    EMERALDX_ALLOW_UNAUTHENTICATED_DEV: "true",
    EMERALDX_AUTH_BASE_URL: "https://preview.example",
  }),
  false,
  "development bypass must not enable an externally addressable host",
);

console.log("auth session smoke test passed");
