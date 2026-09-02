export interface EntraEnvironment {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  authSecret: string;
  redirectProxyUrl?: string;
}

const REQUIRED = [
  "EMERALDX_ENTRA_TENANT_ID",
  "EMERALDX_ENTRA_CLIENT_ID",
  "EMERALDX_ENTRA_CLIENT_SECRET",
  "EMERALDX_AUTH_BASE_URL",
  "AUTH_SECRET",
] as const;

export function entraEnvironment(environment: NodeJS.ProcessEnv = process.env): EntraEnvironment {
  const values = Object.fromEntries(REQUIRED.map((name) => [name, environment[name]?.trim()]));
  const missing = REQUIRED.filter((name) => !values[name]);
  if (missing.length > 0) throw new Error(`Missing required Entra environment: ${missing.join(", ")}`);

  const baseUrl = new URL(values.EMERALDX_AUTH_BASE_URL!);
  const loopback = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1" || baseUrl.hostname === "[::1]" || baseUrl.hostname === "::1";
  if (environment.NODE_ENV === "production" && baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && loopback)) {
    throw new Error("EMERALDX_AUTH_BASE_URL must use HTTPS in production except for an exact OAuth loopback origin");
  }
  const redirectProxy = environment.EMERALDX_ENTRA_REDIRECT_PROXY_URL?.trim();
  let redirectProxyUrl: string | undefined;
  if (redirectProxy) {
    const parsed = new URL(redirectProxy);
    const proxyLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "::1";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && proxyLoopback)) throw new Error("Entra redirect proxy must use HTTPS or an exact OAuth loopback origin");
    redirectProxyUrl = parsed.toString();
  }
  return {
    tenantId: values.EMERALDX_ENTRA_TENANT_ID!,
    clientId: values.EMERALDX_ENTRA_CLIENT_ID!,
    clientSecret: values.EMERALDX_ENTRA_CLIENT_SECRET!,
    baseUrl: baseUrl.origin,
    authSecret: values.AUTH_SECRET!,
    ...(redirectProxyUrl ? { redirectProxyUrl } : {}),
  };
}

export function allowUnauthenticatedDevelopment(environment: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const configured = environment.EMERALDX_AUTH_BASE_URL?.trim();
    const hostname = new URL(configured || "http://localhost").hostname.toLowerCase();
    const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
    if (environment.EMERALDX_ALLOW_PRIVATE_TUNNEL_PILOT === "true") return Boolean(configured) && loopback;
    return environment.NODE_ENV !== "production" && environment.EMERALDX_ALLOW_UNAUTHENTICATED_DEV === "true" && loopback;
  } catch {
    return false;
  }
}
