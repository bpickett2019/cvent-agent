export const EMERALDX_ROLES = ["Viewer", "Operator", "Approver", "Administrator"] as const;
export type EmeraldRole = (typeof EMERALDX_ROLES)[number];

export interface EmeraldPrincipal {
  user?: { roles?: string[] };
}

export function extractEmeraldRoles(claims: unknown): EmeraldRole[] {
  if (!claims || typeof claims !== "object") return [];
  const roles = (claims as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) return [];
  return [...new Set(roles.filter(
    (role): role is EmeraldRole => typeof role === "string" && EMERALDX_ROLES.includes(role as EmeraldRole),
  ))];
}

export function rolesForEntraProfile(claims: unknown, operatorEmails: readonly string[]): EmeraldRole[] {
  const assigned = extractEmeraldRoles(claims);
  if (assigned.length > 0) return assigned;
  if (!claims || typeof claims !== "object") return [];
  const profile = claims as { preferred_username?: unknown; email?: unknown; upn?: unknown };
  const candidate = [profile.preferred_username, profile.email, profile.upn].find((value): value is string => typeof value === "string")?.trim().toLowerCase();
  const allowed = new Set(operatorEmails.map((value) => value.trim().toLowerCase()).filter(Boolean));
  return candidate && allowed.has(candidate) ? ["Operator"] : [];
}

export type RoleAuthorization =
  | { authorized: true; role: EmeraldRole }
  | { authorized: false; status: 401 | 403; reason: "authentication-required" | "insufficient-role" };

export function authorizeRole(
  principal: EmeraldPrincipal | null | undefined,
  required: EmeraldRole,
): RoleAuthorization {
  if (!principal?.user) return { authorized: false, status: 401, reason: "authentication-required" };
  const requiredRank = EMERALDX_ROLES.indexOf(required);
  const role = principal.user.roles?.find(
    (candidate): candidate is EmeraldRole =>
      EMERALDX_ROLES.includes(candidate as EmeraldRole) &&
      EMERALDX_ROLES.indexOf(candidate as EmeraldRole) >= requiredRank,
  );
  return role
    ? { authorized: true, role }
    : { authorized: false, status: 403, reason: "insufficient-role" };
}
