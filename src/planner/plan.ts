/**
 * Planner — EventSpec -> ordered task DAG.
 *
 * Deterministic by design. The same spec always produces the same plan, which is
 * what makes a run reproducible in front of an auditor. No model call happens
 * here; Pi's judgment is used inside individual browser tasks, never to decide
 * which tasks exist.
 *
 * The emitted plan is persisted before any browser action and is what the
 * verifier diffs against later.
 */

import { createHash } from "node:crypto";
import type { EventSpec } from "../spec/eventSpec";
import type { CopyTemplateTarget } from "../run/copyTemplate";

export type Channel = "api" | "browser";

export interface Task {
  /** Stable across runs of the same spec — the checkpoint key for retries. */
  id: string;
  kind: string;
  channel: Channel;
  /** Task ids that must complete first. */
  dependsOn: string[];
  /** Procedure file to load for browser tasks. */
  procedure?: string;
  payload: Record<string, unknown>;
  /** Human-readable, surfaced in the triage queue on failure. */
  label: string;
}

export interface Plan {
  specHash: string;
  tasks: Task[];
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

export function copyTemplateTasks(
  target: CopyTemplateTarget,
  details: Record<string, unknown>,
): Task[] {
  const exactTemplate = {
    tenantId: target.tenantId,
    accountId: target.accountId,
    templateEventId: target.templateEventId,
    templateEventName: target.templateEventName,
  };
  return [
    {
      id: "event.template.authorize", kind: "event.template.authorize", channel: "api", dependsOn: [],
      payload: { ...exactTemplate, permission: "copy" }, label: `Authorize template ${target.templateEventName}`,
    },
    {
      id: "event.shell", kind: "event.copy", channel: "api", dependsOn: ["event.template.authorize"],
      payload: { details, ...exactTemplate }, label: `Clone template ${target.templateEventId}`,
    },
    {
      id: "event.copy.verify", kind: "event.copy.verify", channel: "api", dependsOn: ["event.shell"],
      payload: { proposedName: target.newEventName }, label: "Independently verify copied event",
    },
    {
      id: "event.postCopyGrant", kind: "event.postCopyGrant", channel: "api", dependsOn: ["event.copy.verify"],
      payload: { tenantId: target.tenantId, accountId: target.accountId, eventName: target.newEventName },
      label: "Mint run-bound post-copy grant",
    },
  ];
}

export function plan(spec: EventSpec): Plan {
  const tasks: Task[] = [];
  const copyTarget = copyTargetOf(spec);
  const guard = copyTarget
    ? { eventIdFrom: "event.postCopyGrant", eventName: copyTarget.newEventName }
    : spec.target
    ? { eventId: spec.target.eventId, eventName: spec.target.eventName }
    : { eventName: spec.details.name };
  const push = (t: Omit<Task, "dependsOn"> & { dependsOn?: string[] }) => {
    tasks.push({ dependsOn: [], ...t });
    return t.id;
  };

  /* --- event shell: API. Returns the authoritative event id for guardrails. --- */
  let shell: string;
  let eventReady: string;
  if (copyTarget) {
    for (const task of copyTemplateTasks(copyTarget, spec.details as Record<string, unknown>)) tasks.push(task);
    shell = "event.shell";
    eventReady = "event.postCopyGrant";
  } else shell = eventReady = push({
    id: "event.shell",
    kind: spec.target?.mode === "existingEvent" ? "event.attach" : spec.details.templateEventId ? "event.copy" : "event.create",
    channel: "api",
    payload: spec.target?.mode === "existingEvent" ? { eventId: spec.target.eventId, eventName: spec.target.eventName } : { details: spec.details },
    label: spec.target?.mode === "existingEvent"
      ? `Use existing event ${spec.target.eventName}`
      : spec.details.templateEventId
      ? `Clone template ${spec.details.templateEventId}`
      : `Create event "${spec.details.name}"`,
  });

  const details = push({
    id: "event.details",
    kind: "event.details.reconcile",
    channel: "browser",
    dependsOn: [eventReady],
    procedure: "events/reconcile-event-details",
    payload: { guard, details: spec.details },
    label: "Reconcile event details",
  });

  /* --------------------------- website: browser only ------------------------ */

  // Site-designer fields are normally inherited from the copied event. Emit
  // work only for fields the spec explicitly asks this run to change.
  const siteTasks: string[] = [];
  let theme: string | undefined;
  if (spec.theme) {
    theme = push({
      id: "site.theme",
      kind: "site.theme",
      channel: "browser",
      dependsOn: [details],
      procedure: "site/apply-theme",
      payload: { theme: spec.theme },
      label: spec.theme.templateName ? `Apply theme "${spec.theme.templateName}"` : "Apply theme colors",
    });
    siteTasks.push(theme);
  }

  const siteBase = theme ?? details;
  if (spec.header) {
    siteTasks.push(
      push({
        id: "site.header",
        kind: "site.header",
        channel: "browser",
        dependsOn: [siteBase],
        procedure: "site/configure-header",
        payload: { header: spec.header },
        label: "Configure header",
      })
    );
  }

  if (spec.footer) {
    siteTasks.push(
      push({
        id: "site.footer",
        kind: "site.footer",
        channel: "browser",
        dependsOn: [siteBase],
        procedure: "site/configure-footer",
        payload: { footer: spec.footer },
        label: "Configure footer",
      })
    );
  }

  // Page and widget tasks are conditional on pages being explicitly supplied.
  // Pages do not depend on each other, so one failure does not block siblings.
  for (const page of spec.pages ?? []) {
    const create = push({
      id: `site.page.${page.key}`,
      kind: "site.page.create",
      channel: "browser",
      dependsOn: [siteBase],
      procedure: "site/create-page",
      payload: { page: { key: page.key, title: page.title, slug: page.slug, showInNav: page.showInNav } },
      label: `Create page "${page.title}"`,
    });
    siteTasks.push(create);

    page.widgets.forEach((widget, i) => {
      siteTasks.push(
        push({
          id: `site.page.${page.key}.widget.${i}`,
          kind: `site.widget.${widget.type}`,
          channel: "browser",
          dependsOn: [create],
          procedure: `site/widget-${widget.type}`,
          payload: { pageKey: page.key, index: i, widget },
          label: `Add ${widget.type} widget to "${page.title}"`,
        })
      );
    });
  }

  /* ------------------- registration: browser writes, API reads --------------- */

  const reg = spec.registration;

  const registrationTypeTasks = new Map(
    spec.registrationTypes.map((registrationType) => [
      registrationType.key,
      push({
        id: `reg.type.${registrationType.key}`,
        kind: "reg.registrationType.reconcile",
        channel: "browser",
        dependsOn: [details],
        procedure: "registration/reconcile-registration-type",
        payload: { guard, registrationType },
        label: `Registration type "${registrationType.name}"`,
      }),
    ])
  );

  // A question and all of its visibility dimensions are one Site Designer
  // reconcile transaction: read once, write the complete payload, save once,
  // then reload/read back. Splitting visibility into another task would create a
  // second save and expose a partially configured question between tasks.
  const questions = [...spec.questions].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  for (const question of questions) {
    const conditionalDependencies =
      question.visibility.type === "questionAnswer"
        ? [`reg.question.${question.visibility.questionKey}`]
        : question.visibility.type === "registrationTypes"
          ? question.visibility.registrationTypeKeys.map((key) => registrationTypeTasks.get(key)!)
          : [];
    const { visibility, ...definition } = question;
    push({
      id: `reg.question.${question.key}`,
      kind: "reg.question.reconcile",
      channel: "browser",
      dependsOn: [details, ...conditionalDependencies],
      procedure: "registration/reconcile-question",
      payload: { guard, question: definition, visibility },
      label: `Reconcile registration question "${question.text}"`,
    });
  }

  const admissionTasks = reg.admissionItems.map((item) =>
    push({
      id: `reg.admission.${item.key}`,
      kind: "reg.admission.reconcile",
      channel: "browser",
      dependsOn: [details],
      procedure: "registration/reconcile-admission-item",
      payload: { guard, item },
      label: `Admission item "${item.name}"`,
    })
  );

  const pathTasks = reg.paths.map((p) =>
    push({
      id: `reg.path.${p.key}`,
      kind: "reg.path.reconcile",
      channel: "browser",
      // A path binds admission items, so those must exist first.
      dependsOn: p.admissionItemKeys.map((k) => `reg.admission.${k}`),
      procedure: "registration/reconcile-path",
      payload: { guard, path: p },
      label: `Registration path "${p.name}"`,
    })
  );

  // Pricing is a separate Cvent surface from admission-item identity.
  const pricingTasks = new Map(
    reg.admissionItems.map((item) => [
      item.key,
      push({
        id: `reg.pricing.${item.key}`,
        kind: "reg.pricing.reconcile",
        channel: "browser",
        dependsOn: [`reg.admission.${item.key}`],
        procedure: "registration/reconcile-pricing",
        payload: {
          guard,
          itemKey: item.key,
          itemName: item.name,
          pricing: {
            basePrice: item.price,
            currency: item.currency,
            chargeFee: item.chargeFee,
            tiers: item.pricing,
          },
        },
        label: `Pricing for admission item "${item.name}"`,
      }),
    ])
  );

  // Consume anticipated compiler output conservatively without widening
  // EventSpec: only an array of object records with an explicit key/code emits.
  const anticipatedDiscounts = (reg as unknown as { discounts?: unknown }).discounts;
  if (Array.isArray(anticipatedDiscounts)) {
    for (const candidate of anticipatedDiscounts) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const discount = candidate as Record<string, unknown>;
      const identity =
        typeof discount.key === "string" ? discount.key : typeof discount.code === "string" ? discount.code : undefined;
      if (!identity) continue;
      const rawTargets = Array.isArray(discount.admissionItemKeys)
        ? discount.admissionItemKeys
        : Array.isArray(discount.admissionItemCodes)
          ? discount.admissionItemCodes
          : [];
      const targets = rawTargets.filter((value): value is string => typeof value === "string");
      push({
        id: `reg.discount.${identity}`,
        kind: "reg.discount.reconcile",
        channel: "browser",
        dependsOn: targets.length
          ? targets.map((key) => pricingTasks.get(key) ?? `reg.pricing.${key}`)
          : [...pricingTasks.values()],
        procedure: "registration/reconcile-discount",
        payload: { guard, discount },
        label: `Discount "${String(discount.code ?? identity)}"`,
      });
    }
  }

  reg.optionalItems.forEach((o) =>
    push({
      id: `reg.optional.${o.key}`,
      kind: "reg.optional.create",
      channel: "browser",
      dependsOn: o.availableTo.length ? o.availableTo.map((k) => `reg.admission.${k}`) : admissionTasks,
      procedure: "registration/create-optional-item",
      payload: { item: o },
      label: `Optional item "${o.name}"`,
    })
  );

  reg.vouchers.forEach((v) =>
    push({
      id: `reg.voucher.${v.key}`,
      kind: "reg.voucher.reconcile",
      channel: "browser",
      dependsOn: v.appliesTo.length ? v.appliesTo.map((k) => `reg.admission.${k}`) : admissionTasks,
      procedure: "registration/reconcile-voucher",
      payload: { guard, voucher: v },
      label: `Voucher "${v.code}"`,
    })
  );

  reg.advancedRules.forEach((r) =>
    push({
      id: `reg.rule.${r.key}`,
      kind: "reg.rule.create",
      channel: "browser",
      dependsOn: pathTasks.length ? pathTasks : admissionTasks,
      procedure: "registration/create-advanced-rule",
      payload: { rule: r },
      label: `Advanced rule: ${r.description}`,
    })
  );

  /* ------------------------------ verification ------------------------------ */
  // API reads only. Cheap, deterministic, and independent of the browser layer
  // that did the writing — which is what makes the Draft-status check credible.

  const everything = tasks.map((t) => t.id);

  push({
    id: "verify.registration",
    kind: "verify.registration",
    channel: "api",
    dependsOn: everything,
    payload: {},
    label: "Verify registration configuration against spec",
  });

  push({
    id: "verify.draft",
    kind: "verify.draftStatus",
    channel: "api",
    dependsOn: everything,
    payload: {},
    label: "Confirm event is still in Draft",
  });

  if (siteTasks.length > 0) {
    push({
      id: "verify.site",
      kind: "verify.siteScreenshots",
      channel: "browser",
      dependsOn: [...siteTasks],
      procedure: "site/capture-screenshots",
      payload: { pageKeys: (spec.pages ?? []).map((p) => p.key) },
      label: "Capture site screenshots for review",
    });
  }

  assertAcyclic(tasks);
  return { specHash: hash(spec), tasks };
}

/** Topological order. Throws on a cycle or dangling dependency. */
export function executionOrder(p: Plan): Task[] {
  const byId = new Map(p.tasks.map((t) => [t.id, t]));
  const state = new Map<string, 0 | 1 | 2>();
  const out: Task[] = [];

  const visit = (id: string, trail: string[]) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) throw new Error(`cycle: ${[...trail, id].join(" -> ")}`);
    const task = byId.get(id);
    if (!task) throw new Error(`unknown dependency "${id}" (from ${trail.at(-1) ?? "root"})`);
    state.set(id, 1);
    task.dependsOn.forEach((d) => visit(d, [...trail, id]));
    state.set(id, 2);
    out.push(task);
  };

  p.tasks.forEach((t) => visit(t.id, []));
  return out;
}

function assertAcyclic(tasks: Task[]) {
  executionOrder({ specHash: "", tasks });
}

function copyTargetOf(spec: EventSpec): CopyTemplateTarget | undefined {
  const target = (spec as unknown as { target?: Partial<CopyTemplateTarget> }).target;
  return target?.mode === "copyTemplate" ? target as CopyTemplateTarget : undefined;
}
