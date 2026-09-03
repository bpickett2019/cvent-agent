const DEFAULT_CALLBACK_TARGET = "http://localhost:4320/api/entra/auth/callback/microsoft-entra-id";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function redirectEntraCallback(request: Request, targetValue = DEFAULT_CALLBACK_TARGET): Response {
  const source = new URL(request.url);
  if (request.method !== "GET" || source.pathname !== "/auth/callback") {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const target = new URL(targetValue);
  if (target.protocol !== "http:" || !LOOPBACK_HOSTS.has(target.hostname.toLowerCase()) || target.pathname !== "/api/entra/auth/callback/microsoft-entra-id") {
    throw new Error("Entra callback target must be the exact local Auth.js loopback callback");
  }
  target.search = source.search;
  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
