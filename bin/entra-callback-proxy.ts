#!/usr/bin/env node
import { createServer } from "node:http";
import { redirectEntraCallback } from "../web/lib/entra-callback-proxy";

const host = "127.0.0.1";
const port = Number(process.env.EMERALDX_ENTRA_CALLBACK_PROXY_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("callback proxy port must be between 1024 and 65535");
const server = createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(`http://localhost:${port}${incoming.url ?? "/"}`, { method: incoming.method });
    const response = redirectEntraCallback(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  } catch {
    outgoing.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" });
    outgoing.end("Invalid callback request");
  }
});
server.listen(port, host, () => console.log(`Entra callback proxy listening on ${host}:${port}`));
