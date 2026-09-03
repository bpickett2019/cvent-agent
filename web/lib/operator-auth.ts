export interface OperatorCredentials {
  username: string;
  password: string;
}

export interface OperatorAuthOptions {
  production: boolean;
  credentials: OperatorCredentials | null;
  allowUnauthenticatedDevelopment?: boolean;
}

export type OperatorAuthorization =
  | { authorized: true }
  | { authorized: false; reason: "credentials-not-configured" | "credentials-required" };

/** Authenticate a private-pilot request. Production always fails closed. */
export function authorizeOperatorRequest(request: Request, options: OperatorAuthOptions): OperatorAuthorization {
  if (!options.credentials) {
    if (!options.production && options.allowUnauthenticatedDevelopment === true) return { authorized: true };
    return { authorized: false, reason: "credentials-not-configured" };
  }

  const supplied = parseBasicCredentials(request.headers.get("authorization"));
  if (
    supplied &&
    constantTimeEqual(supplied.username, options.credentials.username) &&
    constantTimeEqual(supplied.password, options.credentials.password)
  ) return { authorized: true };
  return { authorized: false, reason: "credentials-required" };
}

export function operatorAuthOptions(environment: NodeJS.ProcessEnv = process.env): OperatorAuthOptions {
  const username = environment.EMERALDX_OPERATOR_AUTH_USERNAME?.trim();
  const password = environment.EMERALDX_OPERATOR_AUTH_PASSWORD;
  return {
    production: environment.NODE_ENV === "production",
    credentials: username && password ? { username, password } : null,
    allowUnauthenticatedDevelopment: environment.EMERALDX_ALLOW_UNAUTHENTICATED_DEV === "true",
  };
}

function parseBasicCredentials(header: string | null): OperatorCredentials | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const size = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
