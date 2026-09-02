import assert from "node:assert/strict";
import { authorizeRole, extractEmeraldRoles, rolesForEntraProfile } from "./lib/entra-authz";
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

const productionLoopback = entraEnvironment({
  NODE_ENV: "production",
  EMERALDX_ENTRA_TENANT_ID: "661c8d9b-e19e-4330-b412-75dce2d26154",
  EMERALDX_ENTRA_CLIENT_ID: "11f91043-4128-4b76-a405-46e71e034fab",
  EMERALDX_ENTRA_CLIENT_SECRET: "opaque-test-value",
  EMERALDX_AUTH_BASE_URL: "http://localhost:4320",
  EMERALDX_ENTRA_REDIRECT_PROXY_URL: "http://localhost:3000/auth/callback",
  AUTH_SECRET: "opaque-test-auth-secret",
});
assert.equal(productionLoopback.baseUrl, "http://localhost:4320", "production may use OAuth's loopback HTTP exception through an SSH tunnel");
assert.equal(productionLoopback.redirectProxyUrl, "http://localhost:3000/auth/callback");
assert.throws(() => entraEnvironment({
  NODE_ENV: "production",
  EMERALDX_ENTRA_TENANT_ID: productionLoopback.tenantId,
  EMERALDX_ENTRA_CLIENT_ID: productionLoopback.clientId,
  EMERALDX_ENTRA_CLIENT_SECRET: productionLoopback.clientSecret,
  EMERALDX_AUTH_BASE_URL: "http://staging.example",
  AUTH_SECRET: productionLoopback.authSecret,
}), /HTTPS/i, "non-loopback production origins must require HTTPS");

assert.deepEqual(
  extractEmeraldRoles({ roles: ["Operator", "Global Administrator", "Operator", 42] }),
  ["Operator"],
  "only declared app roles may enter the session",
);

assert.deepEqual(
  rolesForEntraProfile({ preferred_username: "Bailey.Picket@emeraldX.com" }, ["bailey.picket@emeraldx.com"]),
  ["Operator"],
  "a tenant-authenticated pilot operator on the explicit email allowlist receives only Operator",
);
assert.deepEqual(
  rolesForEntraProfile({ preferred_username: "other@emeraldx.com" }, ["bailey.picket@emeraldx.com"]),
  [],
  "an unlisted tenant user receives no fallback role",
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
