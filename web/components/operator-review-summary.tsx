import type { OperatorReview } from "../lib/operator-review";

const STATUSES = ["exact", "review", "missing", "unsupported", "overflow"] as const;

export function OperatorReviewSummary({ review }: { review: OperatorReview }) {
  const totals = Object.values(review.sections).reduce(
    (sum, section) => {
      for (const status of STATUSES) sum[status] += section.counts[status];
      return sum;
    },
    { exact: 0, review: 0, missing: 0, unsupported: 0, overflow: 0 },
  );
  const flaggedIssues = review.issues.length;

  return (
    <section className={`operator-review ${review.canProceed ? "can-proceed" : "is-blocked"}`} aria-label="Operator review summary">
      <header>
        <div>
          <span className="eyebrow">Operator review</span>
          <strong>{review.canProceed ? "Ready for operator review" : "Resolve required issues before applying"}</strong>
          <small>{review.unresolvedRequired ? `${review.unresolvedRequired} required issue(s) block apply.` : "No required fields are blocking the next step."}</small>
        </div>
        <span className="operator-review-status">{review.canProceed ? "Can apply" : "Blocked"}</span>
      </header>
      <div className="operator-review-totals" aria-label="Conversion status totals">
        {STATUSES.map((status) => (
          <div key={status} className={totals[status] ? `has-${status}` : ""}>
            <strong>{totals[status]}</strong><span>{humanize(status)}</span>
          </div>
        ))}
      </div>
      <details className="operator-review-details">
        <summary>Review detailed mappings and issues <span>{flaggedIssues} flagged issue(s)</span></summary>
        <div className="operator-review-sections">
          {Object.entries(review.sections).map(([name, section]) => (
            <article className="operator-review-section" key={name}>
              <header><b>{humanize(name)}</b>{section.rowCap !== undefined && <small>{section.rowCount} / {section.rowCap} rows</small>}</header>
              <dl>{STATUSES.map((status) => <div key={status} className={section.counts[status] ? `has-${status}` : ""}><dt>{status}</dt><dd>{section.counts[status]}</dd></div>)}</dl>
            </article>
          ))}
        </div>
        {review.issues.length > 0 && <ul className="operator-review-issues">{review.issues.map((issue) => <li key={`${issue.path}:${issue.status}`}><b>{issue.required ? "Required" : "Optional"}</b><span>{issue.label}</span><small>{issue.message}</small></li>)}</ul>}
      </details>
    </section>
  );
}

function humanize(value: string): string { return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()); }
