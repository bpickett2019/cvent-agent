import { EventSpec, type EventSpec as EventSpecType } from "../spec/eventSpec";

export const ACCEPTANCE_EVENT_ID = "e712e34c-6117-4d13-bf4c-8ed54cf2b495";
export const ACCEPTANCE_EVENT_NAME = "(C+D) Medtrade Testing Clone 2";

/**
 * Offline-only acceptance input, deliberately limited to the authorized existing
 * clone. It carries no event lifecycle, messaging, or participant operations.
 */
export const acceptanceEventSpec: EventSpecType = EventSpec.parse({
  specVersion: "1.0",
  target: {
    tenantId: "emerald-pilot",
    accountId: "emerald-cvent",
    eventId: ACCEPTANCE_EVENT_ID,
    eventName: ACCEPTANCE_EVENT_NAME,
    mode: "existingEvent",
  },
  details: {
    name: ACCEPTANCE_EVENT_NAME,
    timezone: "America/Chicago",
    start: "2027-01-12T09:00:00-06:00",
    end: "2027-01-12T17:00:00-06:00",
    format: "inPerson",
  },
  registrationTypes: [],
  questions: [],
  registration: {
    admissionItems: [],
    optionalItems: [],
    vouchers: [],
    paths: [],
    advancedRules: [],
    waitlistEnabled: false,
  },
});

export type ReconciliationStatus = "created" | "updated" | "already-correct" | "conflict";
export type FixtureValue = string | number | boolean | null;

export interface FixtureObject {
  id?: string;
  kind: string;
  key: string;
  /** Acceptance objects must use conspicuous, unique mock names. */
  name: string;
  values: Record<string, FixtureValue>;
}

/**
 * Synthetic identities for offline acceptance and authorized-clone rehearsal.
 * They are intentionally conspicuous and event-scoped to avoid matching normal objects.
 */
export const ACCEPTANCE_FIXTURE_OBJECTS: readonly FixtureObject[] = Object.freeze([
  { kind: "question", key: "acceptance-created", name: "[ACCEPTANCE MOCK e712e34c] Created", values: { required: false } },
  { kind: "question", key: "acceptance-updated", name: "[ACCEPTANCE MOCK e712e34c] Updated", values: { required: true } },
  { kind: "question", key: "acceptance-correct", name: "[ACCEPTANCE MOCK e712e34c] Correct", values: { required: false } },
  { kind: "question", key: "acceptance-conflict", name: "[ACCEPTANCE MOCK e712e34c] Conflict", values: { required: false } },
]);

export interface ReconciliationReceipt {
  kind: string;
  key: string;
  name: string;
  status: ReconciliationStatus;
  retainedId: string | null;
  creates: 0 | 1;
  saves: 0 | 1;
  reason: string | null;
}

export interface ReconciliationSummary {
  total: number;
  created: number;
  updated: number;
  "already-correct": number;
  conflict: number;
  creates: number;
  saves: number;
}

/** Pure reconciliation: it never calls Cvent or performs I/O. */
export function reconcileFixtureObjects(
  desired: readonly FixtureObject[],
  current: readonly FixtureObject[]
): ReconciliationReceipt[] {
  return desired.map((wanted) => {
    const matches = current.filter(
      (candidate) => candidate.kind === wanted.kind && candidate.key === wanted.key && candidate.name === wanted.name
    );
    if (matches.length > 1) return receipt(wanted, "conflict", null, 0, 0, "multiple existing objects match the fixture identity");
    if (matches.length === 0) return receipt(wanted, "created", null, 1, 0, null);

    const existing = matches[0];
    if (equalValues(existing.values, wanted.values)) {
      return receipt(wanted, "already-correct", existing.id ?? null, 0, 0, null);
    }
    return receipt(wanted, "updated", existing.id ?? null, 0, 1, null);
  });
}

export function summarizeReconciliation(rows: readonly ReconciliationReceipt[]): ReconciliationSummary {
  const summary: ReconciliationSummary = {
    total: rows.length,
    created: 0,
    updated: 0,
    "already-correct": 0,
    conflict: 0,
    creates: 0,
    saves: 0,
  };
  for (const row of rows) {
    summary[row.status] += 1;
    summary.creates += row.creates;
    summary.saves += row.saves;
  }
  return summary;
}

export function assertIdempotentSecondRun(rows: readonly ReconciliationReceipt[]): void {
  const summary = summarizeReconciliation(rows);
  if (summary.creates !== 0 || summary.saves !== 0) {
    throw new Error(`idempotent second run requires zero creates and zero saves; observed ${summary.creates} creates and ${summary.saves} saves`);
  }
}

function receipt(
  object: FixtureObject,
  status: ReconciliationStatus,
  retainedId: string | null,
  creates: 0 | 1,
  saves: 0 | 1,
  reason: string | null
): ReconciliationReceipt {
  return { kind: object.kind, key: object.key, name: object.name, status, retainedId, creates, saves, reason };
}

function equalValues(left: Record<string, FixtureValue>, right: Record<string, FixtureValue>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}
