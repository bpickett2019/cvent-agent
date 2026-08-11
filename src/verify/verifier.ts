/**
 * Verifier.
 *
 * Re-reads what actually landed in Cvent and diffs it against the EventSpec.
 * Runs on the API, not the browser: fast, deterministic, zero tokens, and — the
 * part that matters for SOX — a different channel from the one that performed
 * the writes. The agent that did the work does not grade the work.
 *
 * Output feeds the review page. An operator approves or sends back from this
 * diff, so it has to be readable by a non-engineer.
 */

import type { EventSpec } from "../spec/eventSpec";
import type { CventApi } from "../cvent/api";

export type Severity = "blocking" | "warning";

export interface Finding {
  severity: Severity;
  area: "event" | "registration" | "status";
  /** Plain English. This is read by ops, not developers. */
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface VerificationReport {
  eventId: string;
  specHash: string;
  passed: boolean;
  findings: Finding[];
  /** Website verification is screenshot-only — no API surface exists for it. */
  siteVerifiedBy: "screenshot-review";
  checkedAt: string;
}

const money = (n?: number) => (n === undefined ? "not set" : `$${n.toFixed(2)}`);

export async function verify(
  api: CventApi,
  eventId: string,
  spec: EventSpec,
  specHash: string
): Promise<VerificationReport> {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  /* ------------------------------------------------------- status (absolute) */

  try {
    if (!(await api.isDraft(eventId))) {
      add({
        severity: "blocking",
        area: "status",
        message: "Event is NOT in Draft status. The run must be halted and escalated immediately.",
      });
    }
  } catch (err) {
    add({
      severity: "blocking",
      area: "status",
      message: `Could not confirm Draft status: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  /* -------------------------------------------------------------- event core */

  const event = await api.getEvent(eventId);
  if (event.title && event.title !== spec.details.name) {
    add({
      severity: "blocking",
      area: "event",
      message: `Event name does not match the intake form.`,
      expected: spec.details.name,
      actual: event.title,
    });
  }

  /* ------------------------------------------------------------ registration */

  const [items, paths, vouchers] = await Promise.all([
    api.listAdmissionItems(eventId),
    api.listRegistrationPaths(eventId),
    api.listVouchers(eventId),
  ]);

  const byName = new Map(items.map((i) => [i.name.trim().toLowerCase(), i]));

  for (const want of spec.registration.admissionItems) {
    const got = byName.get(want.name.trim().toLowerCase());
    if (!got) {
      add({
        severity: "blocking",
        area: "registration",
        message: `Admission item "${want.name}" was not created.`,
      });
      continue;
    }
    if (got.price !== undefined && Math.abs(got.price - want.price) > 0.001) {
      add({
        severity: "blocking",
        area: "registration",
        message: `Admission item "${want.name}" has the wrong price.`,
        expected: money(want.price),
        actual: money(got.price),
      });
    }
    if (want.capacity !== undefined && got.capacity !== want.capacity) {
      add({
        severity: "warning",
        area: "registration",
        message: `Admission item "${want.name}" has a different capacity than requested.`,
        expected: want.capacity,
        actual: got.capacity ?? "unlimited",
      });
    }
  }

  // Items in Cvent that the spec never asked for. Usually template residue —
  // a warning rather than a block, but an operator should see it.
  const wanted = new Set(spec.registration.admissionItems.map((a) => a.name.trim().toLowerCase()));
  for (const got of items) {
    if (!wanted.has(got.name.trim().toLowerCase())) {
      add({
        severity: "warning",
        area: "registration",
        message: `Cvent has an admission item "${got.name}" that the intake form did not request. Likely left over from the template.`,
      });
    }
  }

  const pathsByName = new Map(paths.map((p) => [p.name.trim().toLowerCase(), p]));
  for (const want of spec.registration.paths) {
    const got = pathsByName.get(want.name.trim().toLowerCase());
    if (!got) {
      add({
        severity: "blocking",
        area: "registration",
        message: `Registration path "${want.name}" was not created.`,
      });
      continue;
    }
    if (want.isDefault && got.isDefault === false) {
      add({
        severity: "blocking",
        area: "registration",
        message: `Registration path "${want.name}" should be the default path but is not.`,
      });
    }
    const linked = got.admissionItems?.length ?? 0;
    if (linked !== want.admissionItemKeys.length) {
      add({
        severity: "blocking",
        area: "registration",
        message: `Registration path "${want.name}" is linked to the wrong number of admission items.`,
        expected: want.admissionItemKeys.length,
        actual: linked,
      });
    }
  }

  const codes = new Set(vouchers.map((v) => v.code.trim().toUpperCase()));
  for (const want of spec.registration.vouchers) {
    if (!codes.has(want.code.trim().toUpperCase())) {
      add({
        severity: "blocking",
        area: "registration",
        message: `Voucher code "${want.code}" was not created.`,
      });
    }
  }

  return {
    eventId,
    specHash,
    passed: !findings.some((f) => f.severity === "blocking"),
    findings,
    siteVerifiedBy: "screenshot-review",
    checkedAt: new Date().toISOString(),
  };
}

/** Review-page summary. Blocking first — that is what gates approval. */
export function summarize(report: VerificationReport): string {
  if (report.findings.length === 0) return "All configured items match the intake form.";
  const blocking = report.findings.filter((f) => f.severity === "blocking");
  const warnings = report.findings.filter((f) => f.severity === "warning");
  const lines = [
    blocking.length
      ? `${blocking.length} issue${blocking.length === 1 ? "" : "s"} must be resolved before approval:`
      : "No blocking issues.",
    ...blocking.map((f) => `  • ${f.message}`),
  ];
  if (warnings.length) {
    lines.push(`${warnings.length} item${warnings.length === 1 ? "" : "s"} to review:`);
    lines.push(...warnings.map((f) => `  • ${f.message}`));
  }
  return lines.join("\n");
}
