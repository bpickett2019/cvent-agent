# CVENT-agent Pre-Deployment Checklist

Legend:

- `[x]` implemented and locally verified
- `[~]` partially implemented or code-only verification
- `[ ]` required before client production
- `BLOCKED` requires external access/operator action

## A. Source and release hygiene

- [ ] All current changes reviewed and committed.
- [ ] Reviewed branch pushed to private GitHub repository.
- [ ] Pull request reviewed and approved.
- [ ] Immutable release tag/container digest created.
- [ ] Dependency and container scans pass.
- [ ] Rollback artifact and procedure verified.
- [ ] Previously exposed Cvent client secret rotated.
- [ ] No `.env`, `session.json`, credentials, tokens, or private workbooks tracked by Git.

Current status: the authoritative worktree contains substantial uncommitted changes and nothing has been pushed.

## B. Intake and workbook compiler

- [x] Legacy RR workbook upload.
- [x] New-format RR workbook upload.
- [x] Deterministic preview before EventSpec application.
- [x] Operator-controlled Apply recognized values gate.
- [x] New-format workbook download.
- [x] Conversion Report generation.
- [x] Template formatting/formulas/validations retained in tested output.
- [~] Event, registration-type, and question extraction.
- [ ] Contract inventory test for 107 authoritative Field Map rows across 9 tabs.
- [ ] Correct repeating-table start row from 7 to 8.
- [ ] Correct existing/new event-name mapping (C5 versus C6).
- [ ] Structured venue/city/state extraction.
- [ ] Start/end expo and conference date parsing.
- [ ] Footer links coverage: 10 fields.
- [ ] Registration paths coverage: 4 fields.
- [ ] Complete registration-type coverage: 12 fields.
- [ ] Admission items coverage: 9 fields.
- [ ] Discounts coverage: 13 fields.
- [ ] Pricing coverage: 7 fields.
- [ ] Question visibility/trigger/determines-type corrections.
- [ ] Voucher fields explicitly reconciled as unsupported/review when no source exists.
- [ ] Every Field Map row has supported/review/excluded/blocked outcome.

Current measured nominal coverage: approximately 17 of 107 contract fields. Assignment-cell totals must not be presented as contract coverage.

## C. EventSpec, authorization, and safety

- [x] EventSpec is the execution contract.
- [x] Tenant/account/event target fields added.
- [x] Strict versioned authorization registry.
- [x] Registry revision, tenant/account, region, API base URL, credential reference, enabled state, event permissions.
- [x] Duplicate tenant/account and duplicate event rejection.
- [x] Queue authorization before enqueue.
- [x] Worker reauthorization before browser/API setup.
- [x] Permanent code-level deny classes for Delete/Remove, Publish, communications, and attendees.
- [~] Existing-event attach plan; creation/copy prohibited in guarded queue path.
- [ ] Immutable authorization grant stored in every queued job.
- [ ] Grant includes registry revision and authenticated operator.
- [ ] Reauthorization on retry/resume and revocation test.
- [ ] Direct CLI/run/resume entry points enforce registry.
- [ ] Workspace mutation lock keyed by tenant/account/event.
- [ ] Credential provider selected from tenant credential reference.
- [ ] Live account/event UUID/name/Draft verification before first write.
- [ ] Audit every authorization denial without secrets.

## D. Pi Agent Core and deterministic procedures

- [x] Pi Agent Core used directly.
- [x] Deterministic task DAG.
- [x] Model cannot choose the task graph.
- [x] Browser actions pass through guardrails below Pi.
- [x] Same-selector and total-iteration caps.
- [x] Shared cost ceiling.
- [~] Nineteen browser procedure YAMLs exist.
- [ ] Procedures promoted from prose/selector guidance to tested `readCurrent`, `applyDesired`, and `verify` implementations.
- [ ] Already-correct tests.
- [ ] Duplicate/conflict tests.
- [ ] Wrong-event tests.
- [ ] Auth-wall tests.
- [ ] Cvent-validation tests.
- [ ] Selector-drift/reload-persistence tests.
- [ ] No-unnecessary-Save tests.
- [ ] Procedure provenance includes route, Cvent build/version, evidence, and review date.

## E. Cvent API

- [~] Typed client boundary exists.
- [~] OAuth client-credentials flow implemented.
- [~] Event, admission-item, path, type, question, fee, and voucher reads represented.
- [~] Event update represented.
- [x] Pagination and Retry-After behavior represented in code.
- [ ] Live OpenAPI contract pulled and archived for the authorized account/region.
- [ ] Exact token endpoint and scopes verified.
- [ ] Every request/response schema validated with Zod.
- [ ] Region/account base URL selected by authorization grant.
- [ ] Read-only contract verification against authorized clone.
- [ ] Any write endpoint individually approved and tested on authorized clone.
- [ ] Arbitrary `Record<string, unknown>` write bodies eliminated.

## F. Authentication and golden context

- [x] Attended Steel maintenance session.
- [x] Microsoft/Cvent login viewer.
- [x] Capture of cookies and origin-scoped localStorage only.
- [x] Mode `0600` file storage locally.
- [x] Reject capture on Cvent/Microsoft login pages.
- [x] Clone context into isolated sessions.
- [ ] BLOCKED: operator completes Microsoft/Cvent login and MFA.
- [ ] Golden context captured after authenticated redirect.
- [ ] Login reuse verified across at least two new isolated sessions.
- [ ] Server-side expiry and attended refresh behavior tested.
- [ ] Golden context moved to private Blob Storage for Azure.
- [ ] Session versioning/rotation/revocation implemented.

## G. Steel workspaces and Run Monitor

- [x] One Docker container/Chromium runtime per agent workspace.
- [x] Maximum 12 active workspaces per RR document/job, three active documents, and 36 workspaces globally.
- [x] Golden browser contexts are private and document-scoped; login refresh never crosses document boundaries.
- [x] Workspace exists only while an agent/job owns it in production UI path.
- [x] Three-hour session timeout.
- [x] Same-host egress and isolated API/CDP/viewer ports.
- [x] Correct host-port values injected into Steel DOMAIN/CDP_DOMAIN.
- [x] Fixed viewer WebSocket `Session connecting...` root cause.
- [x] Screenshot thumbnails rather than nested preview iframes.
- [x] Grid-to-focused viewer behavior modeled after Ego Lite.
- [x] Back to workspaces restores grid.
- [x] View, Take over, Return, Stop controls.
- [x] Workspace lifecycle activity stream.
- [~] Worker reports plan start, browser connected, finish, and failure.
- [ ] Per-task/checkpoint progress streamed to activity UI.
- [ ] Final evidence captured before teardown.
- [ ] Docker workspace runtime replaced by AKS/dedicated service for production scale.

## H. Controls and recovery

- [x] Durable local pause/cancel control state.
- [x] Gate before tasks and browser actions.
- [x] Take over changes ownership and pauses mutation jobs.
- [x] Stop requests cancellation and removes browser/container.
- [~] Local unit/smoke tests for Pause, Resume, Cancel, Take over, Return, Stop.
- [ ] Atomic takeover transaction.
- [ ] Worker pause acknowledgement before user control.
- [ ] Return leaves automation paused; separate explicit Resume.
- [ ] Stop waits for terminal cancellation acknowledgement before teardown.
- [ ] Cancel semantics verified in queued/paused/running/user-control states.
- [ ] Control events stored append-only with operator/reason/timestamps.
- [ ] Real resume from triage wired with `resumeRunId`.
- [ ] Triage Retry timer fixture removed.
- [ ] Full UI/API/worker control test on authorized clone.

## I. Review, triage, evidence, and audit

- [x] Existing fixture records visibly labeled Demo data.
- [ ] Demo fixtures removed from production mode.
- [ ] Demo mode explicit and disabled by default.
- [ ] Review reads real persisted runs/reports.
- [ ] Triage reads real failed/halted jobs.
- [ ] Approve/Send Back decisions persisted append-only.
- [ ] Run list/detail APIs.
- [ ] Deterministic export builder.
- [ ] Export manifest with hashes/provenance.
- [ ] Spec, plan, checkpoints, report, traces, control events, decisions exported.
- [ ] Screenshots stored separately with SHA-256 hashes.
- [ ] Retention classes, retain-until, legal hold, purge tombstone.
- [ ] Active/paused/takeover/unresolved/legal-hold runs cannot be purged.

## J. Production persistence

- [x] File stores locally exercise queue/run/control/workspace concepts.
- [ ] Job queue interface extracted.
- [ ] PostgreSQL migrations and client.
- [ ] PostgreSQL jobs/idempotency/leases.
- [ ] PostgreSQL runs/checkpoints/traces/audit.
- [ ] PostgreSQL controls and workspace ownership.
- [ ] Transactional outbox.
- [ ] Azure Service Bus job signal adapter.
- [ ] Duplicate delivery, lock renewal, dead-letter, replay tests.
- [ ] Importer for local `.queue`, `.runs`, and `.workspaces`.
- [ ] Local worker autostart disabled outside development.

## K. Azure security and identity

- [ ] Azure resource group/VNet/subnet/NSG provisioned through reviewed IaC.
- [ ] UI/API/worker managed identities.
- [ ] SecretProvider interface.
- [ ] Azure Key Vault provider.
- [ ] BrowserSessionStore interface.
- [ ] Azure Blob browser-session/evidence store.
- [ ] Entra token verification on every privileged route.
- [ ] Issuer, audience, tenant, signature, expiry verification.
- [ ] App roles configured: Reader, Operator, Approver, AuthMaintainer, Auditor, Admin.
- [ ] Operator identity derived only from verified claims.
- [ ] PostgreSQL event grants combined with Entra roles.
- [ ] Golden login restricted to AuthMaintainer.
- [ ] No public Steel/CDP/viewer ingress.
- [ ] Private endpoints/firewall/RBAC verified.

## L. Observability and operations

- [~] Langfuse model/tool trace adapter implemented.
- [ ] Application Insights/OpenTelemetry Azure exporter.
- [ ] Correlation IDs across request/job/run/workspace/session.
- [ ] Structured redacted logs.
- [ ] Queue depth, lease expiry, worker failure, browser health metrics.
- [ ] Service Bus dead-letter alerts.
- [ ] PostgreSQL backup/PITR policy.
- [ ] Blob retention/immutability policy.
- [ ] Load-test and approve VM CPU/RAM/disk limits for up to 36 concurrent Steel browsers (12 per document, three documents).
- [ ] Health/readiness/liveness endpoints.
- [ ] On-call and incident runbooks.

## M. Required live acceptance sequence

- [ ] Golden Microsoft/Cvent login captured.
- [ ] Two-session login reuse.
- [ ] Authorized event read-only preflight.
- [ ] Exact UUID/name/account/Draft status confirmed.
- [ ] Bounded supported clone benchmark.
- [ ] Pause/Take over/Return/Resume/Stop/Cancel verified on real worker.
- [ ] Complete reconciliation with no prohibited actions.
- [ ] Idempotent rerun with zero duplicates and zero unnecessary Saves.
- [ ] Full runtime and cost benchmark recorded.
- [ ] Security review.
- [ ] Staging deployment.
- [ ] Production canary with explicit approval.

## Go/no-go

Client production deployment is **NO-GO** until every uncompleted item in sections A, C, E, F, H, J, K, and M that applies to production has an owner, evidence, and approval. A private Azure VM pilot may proceed earlier only under SSH tunnel, single-host file persistence, explicit event authorization, and no claim of high availability.
