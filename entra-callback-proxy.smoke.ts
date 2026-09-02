import assert from "node:assert/strict";
import { redirectEntraCallback } from "./web/lib/entra-callback-proxy";

const response = redirectEntraCallback(new Request("http://localhost:3000/auth/callback?code=opaque-code&state=opaque-state"));
assert.equal(response.status, 302);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.equal(response.headers.get("location"), "http://localhost:4320/api/entra/auth/callback/microsoft-entra-id?code=opaque-code&state=opaque-state");
assert.equal(redirectEntraCallback(new Request("http://localhost:3000/not-auth")).status, 404);
assert.throws(() => redirectEntraCallback(new Request("http://localhost:3000/auth/callback"), "https://evil.example/callback"), /loopback/i);
console.log("Entra callback proxy smoke passed");
