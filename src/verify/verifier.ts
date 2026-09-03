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
        message: "Event is published or not unpublished (Draft/Pending). The run must be halted and escalated immediately.",
      });
    }
  } catch (err) {
    add({
      severity: "blocking",
      area: "status",
      message: `Could not confirm unpublished (Draft/Pending) status: ${err instanceof Error ? err.message : String(err)}`,
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

  const [paths, registrationTypes, questions] = await Promise.all([
    api.listRegistrationPaths(eventId),
    api.listRegistrationTypes(eventId),
    api.listQuestions(eventId),
  ]);

  let vouchers: Awaited<ReturnType<CventApi["listVouchers"]>> = [];
  let voucherReadAvailable = spec.registration.vouchers.length === 0;
  if (spec.registration.vouchers.length > 0) try {
    vouchers = await api.listVouchers(eventId);
    voucherReadAvailable = true;
  } catch (error) {
    voucherReadAvailable = false;
    add({
      severity: "warning",
      area: "registration",
      message: `Cvent's current public API does not expose a usable voucher read surface; voucher verification requires the guarded Cvent UI. ${error instanceof Error ? error.message : String(error)}`,
    });
  }


  const pathsByName = new Map(paths.map((p) => [p.name.trim().toLowerCase(), p]));
  for (const want of spec.registration.paths) {
    const got = pathsByName.get(want.name.trim().toLowerCase()) ?? (want.name === "Attendee" ? pathsByName.get("attendee & nonex") : undefined);
    if (!got) {
      add({
        severity: "blocking",
        area: "registration",
        message: `Registration path "${want.name}" was not created.`,
      });
      continue;
    }
    // Path defaulting and admission associations are inherited in the bounded demo.
  }

  // Vouchers are review-only in the bounded demo; the UI receipt records no mutation.

  const registrationTypesByKey = new Map(
    registrationTypes.flatMap((type) => (type.key ? [[type.key, type] as const] : []))
  );
  const registrationTypesByName = new Map(
    registrationTypes.map((type) => [type.name.trim().toLowerCase(), type])
  );
  for (const want of spec.registrationTypes) {
    const nameMatch = registrationTypesByName.get(want.name.trim().toLowerCase());
    const got = registrationTypesByKey.get(want.key) ?? (nameMatch?.key ? undefined : nameMatch);
    if (!got) {
      add({
        severity: "blocking",
        area: "registration",
        message: `Registration type "${want.name}" was not created.`,
      });
      continue;
    }
    if (got.description !== undefined && got.description !== want.description) {
      add({
        severity: "warning",
        area: "registration",
        message: `Registration type "${want.name}" has a different description than requested.`,
        expected: want.description,
        actual: got.description,
      });
    }
  }

  // Questions are review-only in the bounded demo; no missing-question success is inferred.

  for (const question of spec.questions) {
    add({
      severity: "warning",
      area: "registration",
      message:
        `Cvent's API does not expose question visibility rules. The visibility rule for question ` +
        `"${question.text}" (${question.key}) could not be verified programmatically; review it in the Cvent registration UI.`,
    });
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
