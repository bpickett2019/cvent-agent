"use client";

import { useMemo, useRef, useState } from "react";
import { EventSpec as EventSpecSchema, type EventSpec, type Question } from "../../src/spec/eventSpec";
import type { ZodIssue } from "zod";
import { ImageRefField } from "./image-ref-field";
import { RRDocumentImport } from "./rr-document-import";

import { authorizedExecutionError } from "../../src/safety/authorizedTarget";

type RegistrationType = EventSpec["registrationTypes"][number];
type AdmissionItem = EventSpec["registration"]["admissionItems"][number];
type OptionalItem = EventSpec["registration"]["optionalItems"][number];
type Voucher = EventSpec["registration"]["vouchers"][number];
type RegistrationPath = EventSpec["registration"]["paths"][number];

interface IntakeFormProps {
  seed: EventSpec;
  onQueued?: (jobId: string) => void;
}

const answerTypes: Array<{ value: Question["answerType"]; label: string }> = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "singleSelect", label: "Single select" },
  { value: "multiSelect", label: "Multiple select" },
  { value: "boolean", label: "Yes / No" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date and time" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "fileUpload", label: "File upload" },
];
const APPROVED_TEMPLATE_ID = "e712e34c-6117-4d13-bf4c-8ed54cf2b495";
const APPROVED_TEMPLATE_NAME = "(C+D) Medtrade Testing Clone 2";
const E2E_EVENT_ID = "f58e1bf4-7559-437a-bab2-9210e3cf1895";
const E2E_EVENT_NAME = "MOCK ONLY - Medtrade CVENT Agent E2E 2027";

export function IntakeForm({ seed, onQueued }: IntakeFormProps) {
  const [spec, setSpec] = useState<EventSpec>(() => structuredClone(seed));
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [queuedJobId, setQueuedJobId] = useState("");
  const [targetMode, setTargetMode] = useState<"existingEvent" | "copyTemplate">(seed.target?.mode ?? "existingEvent");
  const [rrApplied, setRrApplied] = useState(false);
  const submissionKey = useRef(crypto.randomUUID());
  const authScopeId = useRef(crypto.randomUUID());
  const validation = useMemo(() => EventSpecSchema.safeParse(spec), [spec]);
  const issues = validation.success ? [] : validation.error.issues;
  const authorizationError = validation.success ? authorizedExecutionError(validation.data) : null;
  const readyToQueue = validation.success && !authorizationError && rrApplied;

  const update = (recipe: (draft: EventSpec) => void) => {
    setSubmitted(false);
    setSubmissionError("");
    setQueuedJobId("");
    submissionKey.current = crypto.randomUUID();
    setSpec((current) => {
      const draft = structuredClone(current);
      recipe(draft);
      return draft;
    });
  };

  const submit = async () => {
    if (!validation.success || authorizationError || !rrApplied || submitting) return;
    setSubmitting(true);
    setSubmissionError("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": submissionKey.current },
        body: JSON.stringify({
          spec: validation.data,
          authScopeId: authScopeId.current,
          operator: { id: "demo-operator", email: "demo-operator@example.invalid" },
        }),
      });
      const body = (await response.json()) as { job?: { id: string }; error?: string };
      if (!response.ok || !body.job) throw new Error(body.error || "The run could not be queued.");
      setQueuedJobId(body.job.id);
      setSubmitted(true);
      window.setTimeout(() => onQueued?.(body.job!.id), 700);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "The run could not be queued.");
    } finally {
      setSubmitting(false);
    }
  };

  const applyNormalizedSpec = (normalizedSpec: EventSpec) => {
    const next = structuredClone(normalizedSpec);
    if (targetMode === "copyTemplate") {
      next.target = { mode: "copyTemplate", tenantId: "emerald-pilot", accountId: "emerald-cvent", templateEventId: APPROVED_TEMPLATE_ID, templateEventName: APPROVED_TEMPLATE_NAME, newEventName: next.details.name, ...(next.details.code ? { newEventCode: next.details.code } : {}) };
      next.details.templateEventId = APPROVED_TEMPLATE_ID;
    }
    setSpec(next); setRrApplied(true); setSubmitted(false); setSubmissionError(""); setQueuedJobId(""); submissionKey.current = crypto.randomUUID();
    window.setTimeout(() => document.getElementById("intake-review")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  return (
    <div className="page-stack" id="intake-top">
      <PageIntro
        eyebrow="New event build"
        title="Event intake"
        description="Define this year’s registration delta. Branding and page structure stay inherited unless explicitly changed."
        aside={
          <div className={`validation-pill ${readyToQueue ? "valid" : "invalid"}`}>
            <span className="status-dot" />
            {readyToQueue ? "Ready to plan" : !rrApplied ? "Upload and apply an RR workbook" : authorizationError ? "Execution scope blocked" : `${issues.length} item${issues.length === 1 ? "" : "s"} need attention`}
          </div>
        }
      />

      {submitted && (
        <div className="notice success-notice" role="status">
          <strong>Run queued.</strong> Job {queuedJobId} is durable and ready for a worker. Completed work will be checkpointed for safe resume.
        </div>
      )}

      {submissionError && (
        <div className="notice error-summary" role="alert">
          <strong>The run was not queued.</strong><span>{submissionError}</span>
        </div>
      )}

      {!validation.success && (
        <div className="notice error-summary" role="alert">
          <strong>Complete the highlighted fields before submitting.</strong>
          <span>{plainIssue(issues[0])}</span>
        </div>
      )}

      {authorizationError && (
        <div className="notice error-summary" role="alert">
          <strong>Execution scope is blocked.</strong><span>{authorizationError}</span>
        </div>
      )}

      <RRDocumentImport onApply={applyNormalizedSpec} />

      <section className="form-section" id="intake-review"><div className="section-head"><span className="section-number">00</span><div><h2>Authorized Cvent target</h2><p>Choose an explicitly authorized destination. New copies remain unpublished.</p></div></div><div className="section-body"><div className="segmented-control"><button type="button" onClick={() => { setTargetMode("existingEvent"); update((draft) => { draft.target = { mode: "existingEvent", tenantId: "emerald-pilot", accountId: "emerald-cvent", eventId: APPROVED_TEMPLATE_ID, eventName: APPROVED_TEMPLATE_NAME }; draft.details.name = APPROVED_TEMPLATE_NAME; delete draft.details.templateEventId; }); }}>Use existing training event</button><button type="button" onClick={() => { setTargetMode("existingEvent"); update((draft) => { draft.target = { mode: "existingEvent", tenantId: "emerald-pilot", accountId: "emerald-cvent", eventId: E2E_EVENT_ID, eventName: E2E_EVENT_NAME }; draft.details.name = E2E_EVENT_NAME; delete draft.details.code; delete draft.details.templateEventId; }); }}>Use created mock E2E event</button><button type="button" className={targetMode === "copyTemplate" ? "active" : ""} onClick={() => { setTargetMode("copyTemplate"); update((draft) => { draft.target = { mode: "copyTemplate", tenantId: "emerald-pilot", accountId: "emerald-cvent", templateEventId: APPROVED_TEMPLATE_ID, templateEventName: APPROVED_TEMPLATE_NAME, newEventName: draft.details.name, ...(draft.details.code ? { newEventCode: draft.details.code } : {}) }; draft.details.templateEventId = APPROVED_TEMPLATE_ID; }); }}>Copy approved template</button></div><div className="form-grid two"><Field label="Approved template name"><input value={APPROVED_TEMPLATE_NAME} readOnly /></Field><Field label="Approved template UUID"><input value={APPROVED_TEMPLATE_ID} readOnly /></Field></div></div></section>

      <Section number="01" title="Event details" description="These reviewed details apply only to the authorized existing clone; no event is created or copied.">
        <div className="form-grid three">
          <Field label="Event name" error={fieldError(issues, "details.name")} className="span-2">
            <input value={spec.details.name} onChange={(event) => update((draft) => { draft.details.name = event.target.value; if (draft.target?.mode === "copyTemplate") draft.target.newEventName = event.target.value; })} />
          </Field>
          <Field label="Event code">
            <input value={spec.details.code ?? ""} onChange={(event) => update((draft) => void (draft.details.code = event.target.value || undefined))} />
          </Field>
          <Field label="Starts" error={fieldError(issues, "details.start")}>
            <input type="datetime-local" value={toLocalInput(spec.details.start)} onChange={(event) => update((draft) => void (draft.details.start = fromLocalInput(event.target.value)))} />
          </Field>
          <Field label="Ends" error={fieldError(issues, "details.end")}>
            <input type="datetime-local" value={toLocalInput(spec.details.end)} onChange={(event) => update((draft) => void (draft.details.end = fromLocalInput(event.target.value)))} />
          </Field>
          <Field label="Timezone">
            <select value={spec.details.timezone} onChange={(event) => update((draft) => void (draft.details.timezone = event.target.value))}>
              <option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option>
            </select>
          </Field>
          <Field label="Format">
            <select value={spec.details.format} onChange={(event) => update((draft) => void (draft.details.format = event.target.value as EventSpec["details"]["format"]))}>
              <option value="inPerson">In person</option><option value="virtual">Virtual</option><option value="hybrid">Hybrid</option>
            </select>
          </Field>
          <Field label="Template event ID" hint="The previous year’s approved event" error={fieldError(issues, "details.templateEventId")} className="span-2">
            <input value={spec.details.templateEventId ?? ""} onChange={(event) => update((draft) => void (draft.details.templateEventId = event.target.value || undefined))} />
          </Field>
        </div>
        <div className="subsection-label">Venue</div>
        <div className="form-grid three">
          <Field label="Venue name" className="span-2"><input value={spec.details.venue?.name ?? ""} onChange={(event) => update((draft) => { draft.details.venue = ensureVenue(draft); draft.details.venue.name = event.target.value; })} /></Field>
          <Field label="Country"><input value={spec.details.venue?.country ?? "US"} onChange={(event) => update((draft) => { draft.details.venue = ensureVenue(draft); draft.details.venue.country = event.target.value; })} /></Field>
          <Field label="Address"><input value={spec.details.venue?.address1 ?? ""} onChange={(event) => update((draft) => { draft.details.venue = ensureVenue(draft); draft.details.venue.address1 = event.target.value; })} /></Field>
          <Field label="City"><input value={spec.details.venue?.city ?? ""} onChange={(event) => update((draft) => { draft.details.venue = ensureVenue(draft); draft.details.venue.city = event.target.value; })} /></Field>
          <div className="split-fields"><Field label="State"><input value={spec.details.venue?.state ?? ""} onChange={(event) => update((draft) => { draft.details.venue = ensureVenue(draft); draft.details.venue.state = event.target.value; })} /></Field><Field label="Postal code"><input value={spec.details.venue?.postalCode ?? ""} onChange={(event) => update((draft) => { draft.details.venue = ensureVenue(draft); draft.details.venue.postalCode = event.target.value; })} /></Field></div>
        </div>
      </Section>

      <Section number="02" title="Site images" description="Upload approved image files or reference their exact SharePoint location. Files are resolved by trusted server code, never by the model.">
        <div className="asset-grid">
          <ImageRefField label="Header logo" value={spec.header?.logo} onChange={(value) => update((draft) => setHeaderImage(draft, "logo", value))} />
          <ImageRefField label="Header banner" value={spec.header?.bannerImage} onChange={(value) => update((draft) => setHeaderImage(draft, "bannerImage", value))} />
        </div>
      </Section>

      <Section number="03" title="Registration types" description="Who someone is—not what they buy. Order these as they should appear to operators." action={<button className="secondary-button" onClick={() => update((draft) => draft.registrationTypes.push(newRegistrationType(draft.registrationTypes.length)))}>+ Add type</button>}>
        <div className="item-list">
          {spec.registrationTypes.map((type, index) => (
            <ItemCard key={`${type.key}-${index}`} index={index} title={type.name || "Untitled registration type"} onUp={() => update((draft) => move(draft.registrationTypes, index, -1))} onDown={() => update((draft) => move(draft.registrationTypes, index, 1))} onRemove={() => update((draft) => void draft.registrationTypes.splice(index, 1))} first={index === 0} last={index === spec.registrationTypes.length - 1}>
              <div className="form-grid three">
                <Field label="Key" error={fieldError(issues, `registrationTypes.${index}.key`)}><input value={type.key} onChange={(event) => update((draft) => void (draft.registrationTypes[index].key = slug(event.target.value)))} /></Field>
                <Field label="Display name" error={fieldError(issues, `registrationTypes.${index}.name`)}><input value={type.name} onChange={(event) => update((draft) => void (draft.registrationTypes[index].name = event.target.value))} /></Field>
                <Field label="Description"><input value={type.description} onChange={(event) => update((draft) => void (draft.registrationTypes[index].description = event.target.value))} /></Field>
              </div>
            </ItemCard>
          ))}
        </div>
      </Section>

      <Section number="04" title="Registration questions" description="Define placement, answer design, and exactly who should see each question." action={<button className="primary-small" onClick={() => update((draft) => draft.questions.push(newQuestion(draft.questions)))}>+ Add question</button>}>
        <div className="question-list">
          {spec.questions.map((question, index) => {
            const priorQuestions = spec.questions.filter((candidate) => candidate.order < question.order && candidate.key !== question.key);
            return (
              <ItemCard key={`${question.key}-${index}`} index={index} title={question.text || "Untitled question"} badge={`Order ${question.order}`} onUp={() => update((draft) => move(draft.questions, index, -1))} onDown={() => update((draft) => move(draft.questions, index, 1))} onRemove={() => update((draft) => void draft.questions.splice(index, 1))} first={index === 0} last={index === spec.questions.length - 1} prominent>
                <div className="form-grid three">
                  <Field label="Question text" error={fieldError(issues, `questions.${index}.text`)} className="span-2"><input value={question.text} onChange={(event) => update((draft) => void (draft.questions[index].text = event.target.value))} /></Field>
                  <Field label="Stable key" error={fieldError(issues, `questions.${index}.key`)}><input value={question.key} onChange={(event) => update((draft) => void (draft.questions[index].key = slug(event.target.value)))} /></Field>
                  <Field label="Page" error={fieldError(issues, `questions.${index}.page`)}><input list="question-pages" value={question.page} onChange={(event) => update((draft) => void (draft.questions[index].page = event.target.value))} /><datalist id="question-pages"><option value="personal-information" /><option value="show-questions" /></datalist></Field>
                  <Field label="Order" error={fieldError(issues, `questions.${index}.order`)}><input type="number" min="0" value={question.order} onChange={(event) => update((draft) => void (draft.questions[index].order = Number(event.target.value)))} /></Field>
                  <Field label="Answer type"><select value={question.answerType} onChange={(event) => update((draft) => { draft.questions[index].answerType = event.target.value as Question["answerType"]; if (!isChoice(event.target.value)) draft.questions[index].answerValues = []; })}>{answerTypes.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}</select></Field>
                  {isChoice(question.answerType) && <Field label="Answer values" hint="Separate values with commas" error={fieldError(issues, `questions.${index}.answerValues`)} className="span-2"><input value={question.answerValues.join(", ")} onChange={(event) => update((draft) => void (draft.questions[index].answerValues = csv(event.target.value)))} /></Field>}
                  <label className="check-field"><input type="checkbox" checked={question.required} onChange={(event) => update((draft) => void (draft.questions[index].required = event.target.checked))} /><span><strong>Required</strong><small>Registrant must answer to continue</small></span></label>
                </div>

                <div className="visibility-builder">
                  <div className="visibility-heading"><span className="eye-icon">◉</span><div><strong>Visibility</strong><small>Who should see this question?</small></div></div>
                  <div className="segmented-control">
                    <button className={question.visibility.type === "always" ? "active" : ""} onClick={() => update((draft) => void (draft.questions[index].visibility = { type: "always" }))}>Everyone</button>
                    <button className={question.visibility.type === "registrationTypes" ? "active" : ""} onClick={() => update((draft) => void (draft.questions[index].visibility = { type: "registrationTypes", registrationTypeKeys: [] }))}>Registration types</button>
                    <button className={question.visibility.type === "questionAnswer" ? "active" : ""} onClick={() => update((draft) => void (draft.questions[index].visibility = { type: "questionAnswer", questionKey: priorQuestions[0]?.key ?? "", matchingValues: [] }))}>Prior answer</button>
                  </div>
                  {question.visibility.type === "registrationTypes" && (
                    <div className="choice-panel">
                      <span className="choice-label">Show only for</span>
                      <div className="chip-checks">{spec.registrationTypes.map((type) => <label key={type.key} className={question.visibility.type === "registrationTypes" && question.visibility.registrationTypeKeys.includes(type.key) ? "selected" : ""}><input type="checkbox" checked={question.visibility.type === "registrationTypes" && question.visibility.registrationTypeKeys.includes(type.key)} onChange={(event) => update((draft) => { const visibility = draft.questions[index].visibility; if (visibility.type !== "registrationTypes") return; visibility.registrationTypeKeys = event.target.checked ? [...visibility.registrationTypeKeys, type.key] : visibility.registrationTypeKeys.filter((key) => key !== type.key); })} />{type.name}</label>)}</div>
                      <InlineError text={fieldError(issues, `questions.${index}.visibility.registrationTypeKeys`)} />
                    </div>
                  )}
                  {question.visibility.type === "questionAnswer" && (
                    <div className="choice-panel condition-row">
                      <Field label="Show when question"><select value={question.visibility.questionKey} onChange={(event) => update((draft) => { const visibility = draft.questions[index].visibility; if (visibility.type === "questionAnswer") visibility.questionKey = event.target.value; })}><option value="">Select an earlier question</option>{priorQuestions.map((prior) => <option value={prior.key} key={prior.key}>{prior.order}. {prior.text}</option>)}</select></Field>
                      <Field label="Answer matches" hint="Separate multiple values with commas"><input value={question.visibility.matchingValues.join(", ")} onChange={(event) => update((draft) => { const visibility = draft.questions[index].visibility; if (visibility.type === "questionAnswer") visibility.matchingValues = csv(event.target.value); })} /></Field>
                      <InlineError text={fieldError(issues, `questions.${index}.visibility.questionKey`) || fieldError(issues, `questions.${index}.visibility.matchingValues`)} />
                    </div>
                  )}
                </div>
              </ItemCard>
            );
          })}
        </div>
      </Section>

      <CommerceSections spec={spec} issues={issues} update={update} />

      <div className="submit-bar">
        <div><strong>{readyToQueue ? "EventSpec is complete and authorized" : "EventSpec needs attention"}</strong><span>{readyToQueue ? `${spec.questions.length} questions and ${spec.registrationTypes.length} registration types are ready to plan.` : !rrApplied ? "Upload and apply a reviewed RR workbook before queueing." : authorizationError ?? plainIssue(issues[0])}</span></div>
        <button className="submit-button" disabled={!readyToQueue || submitting} onClick={() => void submit()}>{submitting ? "Queuing run…" : "Queue for execution"} <span>→</span></button>
      </div>
    </div>
  );
}

function CommerceSections({ spec, issues, update }: { spec: EventSpec; issues: ZodIssue[]; update: (recipe: (draft: EventSpec) => void) => void }) {
  return (
    <Section number="05" title="Registration commerce" description="Admission products, optional purchases, discounts, and registration paths inherited or changed for this event.">
      <CompactCollection title="Admission items" count={spec.registration.admissionItems.length} onAdd={() => update((draft) => draft.registration.admissionItems.push(newAdmissionItem(draft.registration.admissionItems.length)))}>
        {spec.registration.admissionItems.map((item, index) => <CommerceRow key={`${item.key}-${index}`} title={item.name} onRemove={() => update((draft) => void draft.registration.admissionItems.splice(index, 1))}><div className="form-grid four"><Field label="Key"><input value={item.key} onChange={(e) => update((d) => void (d.registration.admissionItems[index].key = slug(e.target.value)))} /></Field><Field label="Name" error={fieldError(issues, `registration.admissionItems.${index}.name`)}><input value={item.name} onChange={(e) => update((d) => void (d.registration.admissionItems[index].name = e.target.value))} /></Field><Field label="Price"><input type="number" min="0" value={item.price} onChange={(e) => update((d) => void (d.registration.admissionItems[index].price = Number(e.target.value)))} /></Field><Field label="Currency"><input maxLength={3} value={item.currency} onChange={(e) => update((d) => void (d.registration.admissionItems[index].currency = e.target.value.toUpperCase()))} /></Field></div></CommerceRow>)}
      </CompactCollection>
      <CompactCollection title="Optional items" count={spec.registration.optionalItems.length} onAdd={() => update((draft) => draft.registration.optionalItems.push(newOptionalItem(draft.registration.optionalItems.length)))}>
        {spec.registration.optionalItems.map((item, index) => <CommerceRow key={`${item.key}-${index}`} title={item.name} onRemove={() => update((draft) => void draft.registration.optionalItems.splice(index, 1))}><div className="form-grid three"><Field label="Key"><input value={item.key} onChange={(e) => update((d) => void (d.registration.optionalItems[index].key = slug(e.target.value)))} /></Field><Field label="Name"><input value={item.name} onChange={(e) => update((d) => void (d.registration.optionalItems[index].name = e.target.value))} /></Field><Field label="Price"><input type="number" min="0" value={item.price} onChange={(e) => update((d) => void (d.registration.optionalItems[index].price = Number(e.target.value)))} /></Field></div></CommerceRow>)}
      </CompactCollection>
      <CompactCollection title="Vouchers" count={spec.registration.vouchers.length} onAdd={() => update((draft) => draft.registration.vouchers.push(newVoucher(draft.registration.vouchers.length)))}>
        {spec.registration.vouchers.map((voucher, index) => <CommerceRow key={`${voucher.key}-${index}`} title={voucher.code} onRemove={() => update((draft) => void draft.registration.vouchers.splice(index, 1))}><div className="form-grid four"><Field label="Key"><input value={voucher.key} onChange={(e) => update((d) => void (d.registration.vouchers[index].key = slug(e.target.value)))} /></Field><Field label="Code"><input value={voucher.code} onChange={(e) => update((d) => void (d.registration.vouchers[index].code = e.target.value.toUpperCase()))} /></Field><Field label="Discount type"><select value={voucher.discountType} onChange={(e) => update((d) => void (d.registration.vouchers[index].discountType = e.target.value as Voucher["discountType"]))}><option value="percent">Percent</option><option value="fixed">Fixed amount</option></select></Field><Field label="Amount"><input type="number" min="0" value={voucher.amount} onChange={(e) => update((d) => void (d.registration.vouchers[index].amount = Number(e.target.value)))} /></Field></div></CommerceRow>)}
      </CompactCollection>
      <CompactCollection title="Registration paths" count={spec.registration.paths.length} onAdd={() => update((draft) => draft.registration.paths.push(newPath(draft.registration.paths.length, draft.registration.admissionItems)))}>
        {spec.registration.paths.map((path, index) => <CommerceRow key={`${path.key}-${index}`} title={path.name} onRemove={() => update((draft) => void draft.registration.paths.splice(index, 1))}><div className="form-grid three"><Field label="Key"><input value={path.key} onChange={(e) => update((d) => void (d.registration.paths[index].key = slug(e.target.value)))} /></Field><Field label="Name"><input value={path.name} onChange={(e) => update((d) => void (d.registration.paths[index].name = e.target.value))} /></Field><div className="inline-checks"><label><input type="checkbox" checked={path.isDefault} onChange={(e) => update((d) => { d.registration.paths.forEach((candidate) => void (candidate.isDefault = false)); d.registration.paths[index].isDefault = e.target.checked; })} /> Default path</label><label><input type="checkbox" checked={path.requiresApproval} onChange={(e) => update((d) => void (d.registration.paths[index].requiresApproval = e.target.checked))} /> Requires approval</label></div></div><div className="chip-checks commerce-chips">{spec.registration.admissionItems.map((item) => <label key={item.key} className={path.admissionItemKeys.includes(item.key) ? "selected" : ""}><input type="checkbox" checked={path.admissionItemKeys.includes(item.key)} onChange={(e) => update((d) => { const keys = d.registration.paths[index].admissionItemKeys; d.registration.paths[index].admissionItemKeys = e.target.checked ? [...keys, item.key] : keys.filter((key) => key !== item.key); })} />{item.name}</label>)}</div><InlineError text={fieldError(issues, `registration.paths.${index}`)} /></CommerceRow>)}
      </CompactCollection>
    </Section>
  );
}

function PageIntro({ eyebrow, title, description, aside }: { eyebrow: string; title: string; description: string; aside?: React.ReactNode }) { return <header className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{aside}</header>; }
function Section({ number, title, description, action, children }: { number: string; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) { return <section className="form-section"><div className="section-head"><span className="section-number">{number}</span><div><h2>{title}</h2><p>{description}</p></div>{action && <div className="section-action">{action}</div>}</div><div className="section-body">{children}</div></section>; }
function Field({ label, hint, error, className = "", children }: { label: string; hint?: string; error?: string; className?: string; children: React.ReactNode }) { return <label className={`field ${error ? "has-error" : ""} ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}<InlineError text={error} /></label>; }
function InlineError({ text }: { text?: string }) { return text ? <small className="inline-error">{text}</small> : null; }
function ItemCard({ index, title, badge, children, onUp, onDown, onRemove, first, last, prominent = false }: { index: number; title: string; badge?: string; children: React.ReactNode; onUp: () => void; onDown: () => void; onRemove: () => void; first: boolean; last: boolean; prominent?: boolean }) { return <article className={`item-card ${prominent ? "question-card" : ""}`}><div className="item-card-head"><div className="drag-mark">⋮⋮</div><span className="item-index">{String(index + 1).padStart(2, "0")}</span><strong>{title}</strong>{badge && <span className="soft-badge">{badge}</span>}<div className="item-actions"><button disabled={first} onClick={onUp} aria-label="Move up">↑</button><button disabled={last} onClick={onDown} aria-label="Move down">↓</button><button className="remove-action" onClick={onRemove}>Remove</button></div></div><div className="item-card-body">{children}</div></article>; }
function CompactCollection({ title, count, onAdd, children }: { title: string; count: number; onAdd: () => void; children: React.ReactNode }) { return <div className="compact-collection"><div className="compact-head"><h3>{title} <span>{count}</span></h3><button onClick={onAdd}>+ Add</button></div>{count ? <div className="compact-list">{children}</div> : <div className="empty-row">No {title.toLowerCase()} included in this delta.</div>}</div>; }
function CommerceRow({ title, onRemove, children }: { title: string; onRemove: () => void; children: React.ReactNode }) { return <div className="commerce-row"><div className="commerce-row-head"><strong>{title || "Untitled item"}</strong><button onClick={onRemove}>Remove</button></div>{children}</div>; }

function fieldError(issues: ZodIssue[], path: string): string | undefined { const issue = issues.find((candidate) => candidate.path.join(".") === path || candidate.path.join(".").startsWith(`${path}.`)); return issue ? plainIssue(issue) : undefined; }
function plainIssue(issue?: ZodIssue): string { if (!issue) return "Review the highlighted fields."; const message = issue.message.replace(/^String must contain at least 1 character\(s\)$/i, "This field is required.").replace("Invalid datetime", "Enter a valid date and time."); return message.charAt(0).toUpperCase() + message.slice(1); }
function csv(value: string): string[] { return value.split(",").map((item) => item.trim()).filter(Boolean); }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function isChoice(value: string): value is "singleSelect" | "multiSelect" { return value === "singleSelect" || value === "multiSelect"; }
function move<T>(items: T[], index: number, direction: -1 | 1): void { const destination = index + direction; if (destination < 0 || destination >= items.length) return; [items[index], items[destination]] = [items[destination], items[index]]; }
function toLocalInput(iso: string): string { return iso.slice(0, 16); }
function fromLocalInput(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toISOString(); }
function ensureVenue(spec: EventSpec): NonNullable<EventSpec["details"]["venue"]> { return spec.details.venue ?? { name: "", address1: "", city: "", state: "", postalCode: "", country: "US" }; }
function setHeaderImage(spec: EventSpec, key: "logo" | "bannerImage", value: NonNullable<EventSpec["header"]>["logo"] | undefined): void {
  if (value) {
    spec.header ??= { title: "", subtitle: "", showEventDates: true, showLocation: true };
    spec.header[key] = value;
    return;
  }
  if (!spec.header) return;
  delete spec.header[key];
  if (!spec.header.logo && !spec.header.bannerImage && !spec.header.title && !spec.header.subtitle && spec.header.showEventDates && spec.header.showLocation) {
    delete spec.header;
  }
}
function newRegistrationType(index: number): RegistrationType { return { key: `type-${index + 1}`, name: "New registration type", description: "" }; }
function newQuestion(questions: Question[]): Question { const order = Math.max(0, ...questions.map((question) => question.order)) + 1; return { key: `question-${order}`, text: "", page: "show-questions", order, answerType: "text", answerValues: [], required: false, visibility: { type: "always" } }; }
function newAdmissionItem(index: number): AdmissionItem { return { key: `admission-${index + 1}`, name: "New admission item", description: "", price: 0, currency: "USD" }; }
function newOptionalItem(index: number): OptionalItem { return { key: `optional-${index + 1}`, name: "New optional item", price: 0, availableTo: [] }; }
function newVoucher(index: number): Voucher { return { key: `voucher-${index + 1}`, code: `CODE${index + 1}`, discountType: "percent", amount: 10, appliesTo: [] }; }
function newPath(index: number, items: AdmissionItem[]): RegistrationPath { return { key: `path-${index + 1}`, name: "New registration path", admissionItemKeys: items[0] ? [items[0].key] : [], isDefault: index === 0, requiresApproval: false }; }
