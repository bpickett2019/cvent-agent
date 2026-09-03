import assert from "node:assert/strict";
import { authorizeEventSpec, AuthorizationRegistry, PERMANENTLY_DENIED_ACTIONS } from "./src/safety/authorizationRegistry";
import { initialSpec } from "./web/lib/fixtures";
import { EventSpec } from "./src/spec/eventSpec";

const raw = {
  version: 1 as const,
  revision: "pilot-2026-09-01",
  tenants: [{
    tenantId: "emerald-pilot",
    accountId: "emerald-cvent",
    region: "na" as const,
    apiBaseUrl: "https://api-platform.cvent.com/ea",
    credentialRef: "cvent-emerald-pilot",
    enabled: true,
    events: [{ eventId: "e712e34c-6117-4d13-bf4c-8ed54cf2b495", eventName: "(C+D) Medtrade Testing Clone 2", permissions: ["read" as const, "configure" as const], enabled: true }],
  }],
};
const registry = AuthorizationRegistry.parse(raw);

const copyRaw = structuredClone(raw) as any;
copyRaw.tenants[0].templates = [{
  templateEventId: "6d5f9383-432b-4b87-a59b-c37163d72c19",
  templateEventName: "Authorized 2026 Template",
  permissions: ["read", "copy"],
  enabled: true,
}];
const copyRegistry = AuthorizationRegistry.parse(copyRaw);
const copySpec = structuredClone(initialSpec) as any;
copySpec.target = {
  mode: "copyTemplate",
  tenantId: "emerald-pilot",
  accountId: "emerald-cvent",
  templateEventId: "6d5f9383-432b-4b87-a59b-c37163d72c19",
  templateEventName: "Authorized 2026 Template",
  newEventName: "Safe New Event 2027",
  newEventCode: "SAFE27",
};
copySpec.details.name = "Safe New Event 2027";
copySpec.details.templateEventId = "6d5f9383-432b-4b87-a59b-c37163d72c19";
const parsedCopySpec = EventSpec.parse(copySpec);
assert.equal(parsedCopySpec.target?.mode, "copyTemplate");
for (const forbiddenField of ["eventId", "eventName"]) {
  assert.throws(() => EventSpec.parse({ ...copySpec, target: { ...copySpec.target, [forbiddenField]: "forbidden" } }));
}
assert.throws(() => EventSpec.parse({ ...copySpec, target: { ...copySpec.target, newEventName: "" } }));
assert.equal(authorizeEventSpec(parsedCopySpec, copyRegistry).templateEventId, copySpec.target.templateEventId);

for (const mutate of [
  (spec: any) => { spec.target.templateEventId = "00000000-0000-0000-0000-000000000000"; },
  (spec: any) => { spec.target.templateEventName = "Lookalike template"; },
]) {
  const invalid = structuredClone(copySpec); mutate(invalid);
  assert.throws(() => authorizeEventSpec(invalid, copyRegistry), /template is not authorized/i);
}
const disabledTemplate = structuredClone(copyRegistry); disabledTemplate.tenants[0].templates![0].enabled = false;
assert.throws(() => authorizeEventSpec(copySpec, disabledTemplate), /template is not authorized/i);
const noCopy = structuredClone(copyRegistry); noCopy.tenants[0].templates![0].permissions = ["read"];
assert.throws(() => authorizeEventSpec(copySpec, noCopy), /does not permit copy/i);
const mismatchedNewName = structuredClone(copySpec); mismatchedNewName.details.name = "Other event";
assert.throws(() => authorizeEventSpec(mismatchedNewName, copyRegistry), /new event name/i);
const mismatchedLegacyTemplate = structuredClone(copySpec); mismatchedLegacyTemplate.details.templateEventId = "00000000-0000-0000-0000-000000000000";
assert.throws(() => authorizeEventSpec(mismatchedLegacyTemplate, copyRegistry), /template event ID/i);
assert.throws(() => AuthorizationRegistry.parse({ ...copyRaw, tenants: [{ ...copyRaw.tenants[0], templates: [{ ...copyRaw.tenants[0].templates[0], permissions: ["delete"] }] }] }), /Invalid enum value/i);

const authorized = structuredClone(initialSpec);
authorized.target = { tenantId: "emerald-pilot", accountId: "emerald-cvent", eventId: "e712e34c-6117-4d13-bf4c-8ed54cf2b495", eventName: "(C+D) Medtrade Testing Clone 2", mode: "existingEvent" };
authorized.details.name = "(C+D) Medtrade Testing Clone 2";
delete authorized.details.templateEventId;
assert.equal(authorizeEventSpec(authorized, registry).eventId, authorized.target.eventId);
const wrongTenant = structuredClone(authorized); wrongTenant.target!.tenantId = "other";
assert.throws(() => authorizeEventSpec(wrongTenant, registry), /tenant\/account\/event is not authorized/i);
const readOnly = structuredClone(registry); readOnly.tenants[0].events[0].permissions = ["read"];
assert.throws(() => authorizeEventSpec(authorized, readOnly, "configure"), /does not permit configure/i);
const disabled = structuredClone(registry); disabled.tenants[0].events[0].enabled = false;
assert.throws(() => authorizeEventSpec(authorized, disabled), /not authorized/i);
assert.throws(() => AuthorizationRegistry.parse({ ...raw, unknown: true }));
const duplicate = structuredClone(raw); duplicate.tenants[0].events.push(structuredClone(duplicate.tenants[0].events[0]));
assert.throws(() => AuthorizationRegistry.parse(duplicate), /duplicate event/i);
assert.deepEqual(PERMANENTLY_DENIED_ACTIONS, ["delete", "remove", "publish", "communications", "attendees"]);
console.log("authorization registry smoke passed");
