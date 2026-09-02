import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { EventSpec } from "../spec/eventSpec";

const Permission = z.enum(["read", "configure", "copy"]);
export const PERMANENTLY_DENIED_ACTIONS = ["delete", "remove", "publish", "communications", "attendees"] as const;

export const AuthorizationRegistry = z.object({
  version: z.literal(1),
  revision: z.string().min(1),
  tenants: z.array(z.object({
    tenantId: z.string().min(1),
    accountId: z.string().min(1),
    region: z.enum(["na", "eu"]),
    apiBaseUrl: z.string().url(),
    credentialRef: z.string().min(1),
    enabled: z.boolean(),
    events: z.array(z.object({
      eventId: z.string().uuid(),
      eventName: z.string().min(1),
      permissions: z.array(Permission).min(1),
      enabled: z.boolean(),
    }).strict()).min(1),
    templates: z.array(z.object({
      templateEventId: z.string().uuid(),
      templateEventName: z.string().min(1),
      permissions: z.array(Permission).min(1),
      enabled: z.boolean(),
    }).strict()).default([]),
  }).strict()).min(1),
}).strict().superRefine((registry, ctx) => {
  const tenants = new Set<string>();
  const events = new Set<string>();
  const templates = new Set<string>();
  registry.tenants.forEach((tenant, tenantIndex) => {
    const tenantKey = `${tenant.tenantId}\u0000${tenant.accountId}`;
    if (tenants.has(tenantKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tenants", tenantIndex], message: "duplicate tenant/account" });
    tenants.add(tenantKey);
    tenant.events.forEach((event, eventIndex) => {
      const eventKey = `${tenantKey}\u0000${event.eventId}`;
      if (events.has(eventKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tenants", tenantIndex, "events", eventIndex], message: "duplicate event" });
      events.add(eventKey);
    });
    tenant.templates.forEach((template, templateIndex) => {
      const templateKey = `${tenantKey}\u0000${template.templateEventId}`;
      if (templates.has(templateKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tenants", tenantIndex, "templates", templateIndex], message: "duplicate template" });
      templates.add(templateKey);
    });
  });
});
export type AuthorizationRegistry = z.infer<typeof AuthorizationRegistry>;
export type AuthorizedEvent = AuthorizationRegistry["tenants"][number]["events"][number] & { tenantId: string; accountId: string; registryRevision: string; apiBaseUrl: string; credentialRef: string; templateEventId?: never; templateEventName?: never };
export type AuthorizedTemplate = AuthorizationRegistry["tenants"][number]["templates"][number] & { tenantId: string; accountId: string; registryRevision: string; apiBaseUrl: string; credentialRef: string; eventId?: never; eventName?: never };

export function authorizeEventSpec(spec: EventSpec, registry: AuthorizationRegistry, permission: z.infer<typeof Permission> = "configure"): AuthorizedEvent | AuthorizedTemplate {
  const target = spec.target;
  if (!target) throw new Error("EventSpec has no explicit tenant/account target");
  const tenant = registry.tenants.find((candidate) => candidate.enabled && candidate.tenantId === target.tenantId && candidate.accountId === target.accountId);
  if (target.mode === "copyTemplate") {
    const template = tenant?.templates.find((candidate) => candidate.enabled && candidate.templateEventId === target.templateEventId && candidate.templateEventName === target.templateEventName);
    if (!tenant || !template) throw new Error("The tenant/account/template is not authorized");
    if (!template.permissions.includes("copy")) throw new Error("Authorized template does not permit copy");
    if (spec.details.name !== target.newEventName) throw new Error("EventSpec details name must exactly match the proposed new event name");
    if (spec.details.templateEventId !== target.templateEventId) throw new Error("EventSpec details template event ID must exactly match the authorized template event ID");
    return { tenantId: tenant.tenantId, accountId: tenant.accountId, registryRevision: registry.revision, apiBaseUrl: tenant.apiBaseUrl, credentialRef: tenant.credentialRef, ...template };
  }
  const event = tenant?.events.find((candidate) => candidate.enabled && candidate.eventId === target.eventId && candidate.eventName === target.eventName);
  if (!tenant || !event) throw new Error("The tenant/account/event is not authorized");
  if (!event.permissions.includes(permission)) throw new Error(`Authorized event does not permit ${permission}`);
  if (spec.details.name !== target.eventName) throw new Error("EventSpec event name must exactly match the authorized existing event");
  if (spec.details.templateEventId) throw new Error("This workflow cannot create or copy an event; remove the template event ID before queueing");
  return { tenantId: tenant.tenantId, accountId: tenant.accountId, registryRevision: registry.revision, apiBaseUrl: tenant.apiBaseUrl, credentialRef: tenant.credentialRef, ...event };
}

export async function loadAuthorizationRegistry(path = process.env.EMERALDX_AUTHORIZATION_PATH ?? resolve("config", "authorizations.json")): Promise<AuthorizationRegistry> {
  return AuthorizationRegistry.parse(JSON.parse(await readFile(path, "utf8")));
}
