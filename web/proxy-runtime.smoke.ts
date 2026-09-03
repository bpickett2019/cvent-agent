import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

async function main() {
  process.env.EMERALDX_ALLOW_UNAUTHENTICATED_DEV = "true";
  assert.equal(typeof proxy, "function", "Next.js 16 requires a named proxy function export");
  const response = await proxy(
    new NextRequest("http://127.0.0.1:4320/"),
    { waitUntil() {}, passThroughOnException() {} } as never,
  ) as unknown as Response;
  assert.equal(response?.status, 200, "explicit local bypass must pass through the real Auth.js proxy wrapper");
  console.log("proxy runtime smoke test passed");
}

void main();
