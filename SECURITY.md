# Security

Cvent workflows may process attendee personally identifiable information. Security, privacy, retention, and contractual requirements must be approved with the client before production use.

## Baseline controls

- Prefer Cvent APIs over browser automation.
- Use least-privilege service accounts and Managed Identity.
- Keep secrets in Azure Key Vault; never commit or log them.
- Enforce authorization and approval rules outside the language model.
- Redact PII and credentials from Langfuse, Application Insights, screenshots, and artifacts.
- Encrypt data in transit and at rest.
- Define retention and deletion schedules for traces, sessions, screenshots, and attendee data.
- Isolate client environments and production resources.
- Audit every side effect with actor, versions, request, approval, result, and evidence.
- Treat web and Cvent content as untrusted input and defend against prompt injection.
- Provide immediate revocation, task cancellation, and incident-response procedures.

## Disclosure

Do not place vulnerabilities or client data in public issues. Report security concerns privately to the repository owner until a client-specific process is established.
