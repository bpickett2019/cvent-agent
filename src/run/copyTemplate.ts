export interface CopyTemplateTarget {
  readonly mode: "copyTemplate";
  readonly tenantId: string;
  readonly accountId: string;
  readonly templateEventId: string;
  readonly templateEventName: string;
  readonly newEventName: string;
  readonly newEventCode?: string;
}

export interface TemplateCopyGrant {
  readonly grantId: string;
  readonly tenantId: string;
  readonly accountId: string;
  readonly templateEventId: string;
  readonly templateEventName: string;
  readonly permission: "copy";
}

export type PostCopyPermission = "read" | "configure";

export interface PostCopyGrant {
  readonly grantId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly accountId: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly permissions: readonly PostCopyPermission[];
}

export type CopyTemplateCheckpoint =
  | { readonly phase: "authorization"; readonly templateGrant: TemplateCopyGrant }
  | { readonly phase: "copy"; readonly eventId: string }
  | { readonly phase: "verification"; readonly eventId: string }
  | { readonly phase: "grant"; readonly eventId: string; readonly postCopyGrant: PostCopyGrant };

export interface CopyTemplateCheckpointStore {
  load(runId: string): Promise<readonly CopyTemplateCheckpoint[]>;
  save(runId: string, checkpoint: CopyTemplateCheckpoint): Promise<void>;
}

export interface CopyTemplateServices {
  authorizeTemplate(request: {
    readonly tenantId: string;
    readonly accountId: string;
    readonly templateEventId: string;
    readonly templateEventName: string;
    readonly permission: "copy";
  }): Promise<TemplateCopyGrant>;
  copyTemplate(grant: TemplateCopyGrant, details: Readonly<Record<string, unknown>>): Promise<{ readonly id: string }>;
  /** This must use a read path independent from the copy operation. */
  readEvent(eventId: string): Promise<{
    readonly id: string;
    readonly name?: string;
    readonly title?: string;
    readonly status?: string;
  }>;
  /** Omit when the account does not expose a registration-count read surface. */
  readRegistrationCount?(eventId: string): Promise<number | undefined>;
  mintPostCopyGrant(request: {
    readonly runId: string;
    readonly tenantId: string;
    readonly accountId: string;
    readonly eventId: string;
    readonly eventName: string;
    readonly permissions: readonly ["read", "configure"];
  }): Promise<PostCopyGrant>;
}

export interface RunCopyTemplateInput {
  readonly runId: string;
  readonly target: CopyTemplateTarget;
  readonly details: Readonly<Record<string, unknown>>;
  readonly services: CopyTemplateServices;
  readonly checkpointStore: CopyTemplateCheckpointStore;
}

export const COPY_CONTRACT_NOT_VERIFIED_ERROR = "copy contract not verified";

/** A verified implementation owns authorize -> copy -> verify -> grant. */
export interface VerifiedTemplateCopyCapability {
  readonly verified: true;
  runLifecycle(input: {
    readonly runId: string;
    readonly target: CopyTemplateTarget;
    readonly details: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly eventId: string }>;
}

export function assertTemplateCopyExecutionAvailable(
  spec: { readonly target?: { readonly mode?: string } },
  capability?: Pick<VerifiedTemplateCopyCapability, "verified">,
): void {
  if (spec.target?.mode === "copyTemplate" && capability?.verified !== true) {
    throw new Error(COPY_CONTRACT_NOT_VERIFIED_ERROR);
  }
}

export async function runCopyTemplateLifecycle(input: RunCopyTemplateInput): Promise<{
  readonly eventId: string;
  readonly postCopyGrant: Readonly<PostCopyGrant>;
}> {
  assertProposedDetails(input.target, input.details);
  const checkpoints = [...await input.checkpointStore.load(input.runId)];

  let templateGrant = uniquePhase(checkpoints, "authorization")?.templateGrant;
  if (!templateGrant) {
    templateGrant = await input.services.authorizeTemplate({
      tenantId: input.target.tenantId,
      accountId: input.target.accountId,
      templateEventId: input.target.templateEventId,
      templateEventName: input.target.templateEventName,
      permission: "copy",
    });
    assertTemplateGrant(templateGrant, input.target);
    await input.checkpointStore.save(input.runId, { phase: "authorization", templateGrant });
  } else {
    assertTemplateGrant(templateGrant, input.target);
  }

  let eventId = uniquePhase(checkpoints, "copy")?.eventId;
  if (!eventId) {
    const copied = await input.services.copyTemplate(templateGrant, input.details);
    assertUuid(copied.id, "copy returned event id");
    eventId = copied.id;
    await input.checkpointStore.save(input.runId, { phase: "copy", eventId });
  } else {
    assertUuid(eventId, "copy checkpoint event id");
  }

  const verification = uniquePhase(checkpoints, "verification");
  if (verification && verification.eventId !== eventId) throw new Error("copy verification checkpoint is bound to a different event UUID");
  if (!verification) {
    const observed = await input.services.readEvent(eventId);
    if (observed.id !== eventId) throw new Error("independent read returned a different event UUID");
    const observedName = observed.name ?? observed.title;
    if (observedName !== input.target.newEventName) throw new Error("copied event did not match the proposed name");
    if ((observed.status ?? "").toLowerCase() === "live") throw new Error("copied event is live; post-copy grant refused");
    const registrations = await input.services.readRegistrationCount?.(eventId);
    if (registrations !== undefined && registrations !== 0) {
      throw new Error(`copied event has ${registrations} registrations; post-copy grant refused`);
    }
    await input.checkpointStore.save(input.runId, { phase: "verification", eventId });
  }

  let postCopyGrant = uniquePhase(checkpoints, "grant")?.postCopyGrant;
  if (!postCopyGrant) {
    postCopyGrant = await input.services.mintPostCopyGrant({
      runId: input.runId,
      tenantId: input.target.tenantId,
      accountId: input.target.accountId,
      eventId,
      eventName: input.target.newEventName,
      permissions: ["read", "configure"],
    });
    assertPostCopyGrant(postCopyGrant, input, eventId);
    await input.checkpointStore.save(input.runId, { phase: "grant", eventId, postCopyGrant });
  } else {
    assertPostCopyGrant(postCopyGrant, input, eventId);
  }

  return { eventId, postCopyGrant: freezeGrant(postCopyGrant) };
}

function uniquePhase<P extends CopyTemplateCheckpoint["phase"]>(
  checkpoints: readonly CopyTemplateCheckpoint[],
  phase: P,
): Extract<CopyTemplateCheckpoint, { phase: P }> | undefined {
  const matches = checkpoints.filter((checkpoint): checkpoint is Extract<CopyTemplateCheckpoint, { phase: P }> => checkpoint.phase === phase);
  if (matches.some((checkpoint) => JSON.stringify(checkpoint) !== JSON.stringify(matches[0]))) {
    throw new Error(`conflicting ${phase} checkpoints`);
  }
  return matches.at(-1);
}

function assertProposedDetails(target: CopyTemplateTarget, details: Readonly<Record<string, unknown>>) {
  if (details.name !== target.newEventName) throw new Error("copy details name must match the proposed name");
  if (details.templateEventId !== target.templateEventId) throw new Error("copy details template UUID must match the authorized template");
  if (target.newEventCode !== undefined && details.code !== target.newEventCode) throw new Error("copy details code must match the proposed code");
}

function assertTemplateGrant(grant: TemplateCopyGrant, target: CopyTemplateTarget) {
  if (grant.permission !== "copy" || grant.tenantId !== target.tenantId || grant.accountId !== target.accountId ||
      grant.templateEventId !== target.templateEventId || grant.templateEventName !== target.templateEventName) {
    throw new Error("template grant is not exactly bound to the requested template");
  }
}

function assertPostCopyGrant(grant: PostCopyGrant, input: RunCopyTemplateInput, eventId: string) {
  const permissions = [...grant.permissions];
  if (grant.runId !== input.runId || grant.tenantId !== input.target.tenantId || grant.accountId !== input.target.accountId ||
      grant.eventId !== eventId || grant.eventName !== input.target.newEventName ||
      permissions.length !== 2 || permissions[0] !== "read" || permissions[1] !== "configure") {
    throw new Error("post-copy grant is not immutably bound to this run and event UUID");
  }
}

function freezeGrant(grant: PostCopyGrant): Readonly<PostCopyGrant> {
  return Object.freeze({ ...grant, permissions: Object.freeze([...grant.permissions]) });
}

function assertUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} is not a UUID`);
  }
}
