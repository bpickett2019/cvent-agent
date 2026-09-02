export interface EntraEnvironment {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  authSecret: string;
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
  return {
    tenantId: values.EMERALDX_ENTRA_TENANT_ID!,
    clientId: values.EMERALDX_ENTRA_CLIENT_ID!,
    clientSecret: values.EMERALDX_ENTRA_CLIENT_SECRET!,
    baseUrl: baseUrl.origin,
    authSecret: values.AUTH_SECRET!,
  };
}

export function allowUnauthenticatedDevelopment(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (environment.NODE_ENV === "production" || environment.EMERALDX_ALLOW_UNAUTHENTICATED_DEV !== "true") return false;
  try {
    const hostname = new URL(environment.EMERALDX_AUTH_BASE_URL?.trim() || "http://localhost").hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}
