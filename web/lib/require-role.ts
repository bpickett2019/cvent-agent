import { NextResponse } from "next/server";
import { auth } from "../auth";
import { allowUnauthenticatedDevelopment } from "./entra-config";
import { authorizeRole, type EmeraldRole } from "./entra-authz";

export async function requireRole(role: EmeraldRole): Promise<NextResponse | null> {
  if (allowUnauthenticatedDevelopment()) return null;
  const session = await auth();
  const authorization = authorizeRole(session, role);
  if (authorization.authorized) return null;
  return NextResponse.json(
    { error: authorization.reason },
    { status: authorization.status, headers: { "Cache-Control": "no-store" } },
  );
}
