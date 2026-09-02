import { NextResponse } from "next/server";
import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { allowUnauthenticatedDevelopment, entraEnvironment, type EntraEnvironment } from "./lib/entra-config";
import { authorizeRole, extractEmeraldRoles } from "./lib/entra-authz";

const developmentBypassSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`;

function runtimeEnvironment(): EntraEnvironment {
  if (!allowUnauthenticatedDevelopment()) return entraEnvironment();
  try { return entraEnvironment(); } catch {
    return {
      tenantId: "development-bypass",
      clientId: "development-bypass",
      clientSecret: "development-bypass",
      baseUrl: "http://localhost:3000",
      authSecret: developmentBypassSecret,
    };
  }
}

function authConfig(): NextAuthConfig {
  const environment = runtimeEnvironment();
  process.env.AUTH_URL = environment.baseUrl;
  const secure = process.env.NODE_ENV === "production";
  return {
    basePath: "/api/entra/auth",
    secret: environment.authSecret,
    trustHost: true,
    session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
    providers: [MicrosoftEntraID({
      clientId: environment.clientId,
      clientSecret: environment.clientSecret,
      issuer: `https://login.microsoftonline.com/${encodeURIComponent(environment.tenantId)}/v2.0`,
      checks: ["pkce", "state", "nonce"],
      authorization: { params: { scope: "openid profile email" } },
    })],
    cookies: {
      sessionToken: {
        name: secure ? "__Secure-emeraldx.session-token" : "emeraldx.session-token",
        options: { httpOnly: true, sameSite: "lax", path: "/", secure },
      },
    },
    callbacks: {
      authorized({ auth, request }) {
        const pathname = request.nextUrl.pathname;
        if (pathname.startsWith("/login") || pathname.startsWith("/api/entra/auth") || allowUnauthenticatedDevelopment()) return true;
        const authorization = authorizeRole(auth, "Viewer");
        if (authorization.authorized) return true;
        if (pathname.startsWith("/api/")) return NextResponse.json({ error: authorization.reason }, { status: authorization.status, headers: { "Cache-Control": "no-store" } });
        const login = new URL("/login", request.nextUrl);
        login.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`);
        return NextResponse.redirect(login);
      },
      redirect({ url }) {
        const candidate = new URL(url, environment.baseUrl);
        return candidate.origin === environment.baseUrl ? candidate.toString() : environment.baseUrl;
      },
      signIn({ profile }) {
        return extractEmeraldRoles(profile).length > 0;
      },
      jwt({ token, profile }) {
        if (profile) token.roles = extractEmeraldRoles(profile);
        return token;
      },
      session({ session, token }) {
        session.user.roles = extractEmeraldRoles({ roles: token.roles });
        return session;
      },
    },
    pages: { signIn: "/login", error: "/login" },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => authConfig());
