/**
 * Guardrail middleware.
 *
 * Every browser action passes through `check` before it executes. This sits
 * BELOW Pi in the stack: the agent emits an intent, this decides whether it
 * runs. That layering is the whole point — a deny-list enforced in a system
 * prompt is a suggestion, one enforced here is a control.
 *
 * Implements the deterministic controls committed in the scope doc:
 *   - element / page deny-list
 *   - event-ID validation
 *   - publish prohibition (permanent, not operator-editable)
 *   - attendee-data isolation
 *   - per-run cost ceiling
 *
 * Every denial throws and is logged with the attempted action. Nothing fails
 * silently; a blocked action halts the run into the triage queue.
 */

export type ActionType = "click" | "fill" | "select" | "navigate" | "upload" | "read";

export interface Action {
  type: ActionType;
  /** CSS or role-based selector, for DOM-targeting actions. */
  selector?: string;
  /** Absolute URL, for navigate. */
  url?: string;
  /** Never logged verbatim if the field is marked sensitive. */
  value?: string;
  taskId: string;
}

export interface DenyList {
  /** Operator-editable from the dashboard. Emerald supplies the initial set. */
  selectors: string[];
  urlPatterns: string[];
}

export interface GuardrailConfig {
  /** The one event this run may touch. Sourced from the API create/copy response. */
  eventId: string;
  denyList: DenyList;
  costCeilingUsd: number;
  costAlertUsd: number;
}

export class GuardrailViolation extends Error {
  constructor(
    readonly rule: string,
    readonly action: Action,
    message: string
  ) {
    super(message);
    this.name = "GuardrailViolation";
  }
}

/**
 * Permanent deny-list. Not configurable, not editable from the dashboard, not
 * overridable by the operator or the agent. Publish prohibition and
 * attendee-data isolation live here because they were sold as absolute.
 */
const PERMANENT = {
  selectorFragments: [
    "publish",
    "go-live",
    "golive",
    "launch-event",
    "delete-event",
    "[data-cvent-action='publish']",
  ],
  urlFragments: [
    "/publish",
    "/attendees",
    "/registrants",
    "/invitees",
    "/contacts",
    "/address-book",
    "/reports/attendee",
  ],
} as const;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export class Guardrails {
  private spentUsd = 0;
  private alerted = false;

  constructor(
    private readonly cfg: GuardrailConfig,
    private readonly log: (e: Record<string, unknown>) => void
  ) {}

  /** Throws GuardrailViolation if the action must not execute. */
  check(action: Action): void {
    this.checkPermanent(action);
    this.checkEventId(action);
    this.checkDenyList(action);
    this.checkBudget(action);
  }

  private deny(rule: string, action: Action, message: string): never {
    // Logged before throwing — a blocked attempt is itself an audit event, and
    // acceptance criterion #5 requires the attempt be visible in the trail.
    this.log({
      event: "guardrail.denied",
      rule,
      taskId: action.taskId,
      actionType: action.type,
      selector: action.selector,
      url: action.url,
      at: new Date().toISOString(),
    });
    throw new GuardrailViolation(rule, action, message);
  }

  private checkPermanent(action: Action) {
    if (action.selector) {
      const s = norm(action.selector);
      const hit = PERMANENT.selectorFragments.find((f) => s.includes(norm(f)));
      if (hit) this.deny("permanent.selector", action, `selector matches prohibited control "${hit}"`);
    }
    if (action.url) {
      const u = action.url.toLowerCase();
      const hit = PERMANENT.urlFragments.find((f) => u.includes(f));
      if (hit) this.deny("permanent.url", action, `navigation to prohibited area "${hit}"`);
    }
  }

  /**
   * Event-ID validation. Any URL carrying an event identifier must carry THIS
   * run's event id. A mismatch means the agent has drifted to another event and
   * the run halts immediately.
   */
  private checkEventId(action: Action) {
    if (!action.url) return;
    const ids = extractEventIds(action.url);
    if (ids.length === 0) return;
    if (!ids.every((id) => id === this.cfg.eventId)) {
      this.deny(
        "eventId.mismatch",
        action,
        `url targets event(s) [${ids.join(", ")}], run is bound to ${this.cfg.eventId}`
      );
    }
  }

  private checkDenyList(action: Action) {
    if (action.selector) {
      const s = norm(action.selector);
      const hit = this.cfg.denyList.selectors.find((d) => s.includes(norm(d)));
      if (hit) this.deny("denyList.selector", action, `selector on deny-list: "${hit}"`);
    }
    if (action.url) {
      const hit = this.cfg.denyList.urlPatterns.find((p) => matchesPattern(action.url!, p));
      if (hit) this.deny("denyList.url", action, `url on deny-list: "${hit}"`);
    }
  }

  private checkBudget(action: Action) {
    if (this.spentUsd >= this.cfg.costCeilingUsd) {
      this.deny(
        "cost.ceiling",
        action,
        `run halted at cost ceiling ($${this.spentUsd.toFixed(2)} / $${this.cfg.costCeilingUsd})`
      );
    }
  }

  /** Called after each model call or billable step. */
  accrue(usd: number): void {
    this.spentUsd += usd;
    if (!this.alerted && this.spentUsd >= this.cfg.costAlertUsd) {
      this.alerted = true;
      this.log({ event: "cost.alert", spentUsd: this.spentUsd, ceiling: this.cfg.costCeilingUsd });
    }
  }

  get spent(): number {
    return this.spentUsd;
  }
}

/** Pulls event ids out of Cvent url shapes and query params. */
export function extractEventIds(url: string): string[] {
  const found = new Set<string>();
  const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  for (const m of url.matchAll(/\/events?\/([^/?#]+)/gi)) {
    if (guid.test(m[1])) found.add(m[1].toLowerCase());
    guid.lastIndex = 0;
  }
  try {
    const qs = new URL(url).searchParams;
    for (const key of ["eventId", "eventid", "id", "e"]) {
      const v = qs.get(key);
      if (v && guid.test(v)) found.add(v.toLowerCase());
      guid.lastIndex = 0;
    }
  } catch {
    /* relative url — path match above is sufficient */
  }
  return [...found];
}

/** Deny-list url patterns support a single `*` wildcard per segment. */
export function matchesPattern(url: string, pattern: string): boolean {
  const rx = new RegExp(
    "^" + pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"),
    "i"
  );
  return rx.test(url);
}
