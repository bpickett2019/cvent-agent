import type { OperatorReview } from "../lib/operator-review";

const STATUSES = ["exact", "review", "missing", "unsupported", "overflow"] as const;

export function OperatorReviewSummary({ review }: { review: OperatorReview }) {
  return (
    <section className="operator-review" aria-label="Operator review summary">
      <header><strong>Operator review</strong><span>{review.unresolvedRequired ? `${review.unresolvedRequired} required issue(s) block apply` : "Required fields are resolved"}</span></header>
      <div className="operator-review-sections">
        {Object.entries(review.sections).map(([name, section]) => (
          <div className="operator-review-section" key={name}>
            <b>{humanize(name)}</b>
            {section.rowCap !== undefined && <small>{section.rowCount} / {section.rowCap} template rows</small>}
            <dl>{STATUSES.map((status) => <div key={status} className={section.counts[status] ? `has-${status}` : ""}><dt>{status}</dt><dd>{section.counts[status]}</dd></div>)}</dl>
          </div>
        ))}
      </div>
      {review.issues.length > 0 && <ul>{review.issues.map((issue) => <li key={`${issue.path}:${issue.status}`}><b>{issue.required ? "Required" : "Optional"}</b> · {issue.label}: {issue.message}</li>)}</ul>}
    </section>
  );
}

function humanize(value: string): string { return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()); }
