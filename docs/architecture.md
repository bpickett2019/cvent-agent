# Architecture

## System overview

```text
Next.js web UI
  - Chat and task creation
  - Live progress and browser view
  - Approval requests
  - Run history and artifacts
           |
           | HTTPS + WebSocket/SSE
           v
Agent API (Azure Container Apps)
  - Agent reasoning and tool loop
  - Conversation/task state
  - Policy enforcement
  - Prompt and version selection
  - Approval controller
           |
           +-- Azure Service Bus --> Agent workers
           +-- Cvent API tools
           +-- Steel.dev browser tools
           +-- Langfuse traces/evaluations
           +-- PostgreSQL task and audit state
           +-- Blob Storage evidence/artifacts
```

The autonomous loop runs server-side. Tasks continue when the user disconnects, and the UI reconnects to durable task state and event streams.

## Component responsibilities

### Web UI

- Authenticate users through Microsoft Entra ID.
- Create tasks and display conversations.
- Stream task events and approval requests.
- Show screenshots, browser sessions, and generated artifacts.
- Allow pause, resume, cancel, and manual takeover.

### Agent API

- Authorize every user and operation.
- Translate requests into constrained plans.
- Select pinned prompt, model, policy, and tool versions.
- Dispatch durable work and expose task status.
- Enforce approval boundaries independently of the model.

### Workers

- Execute idempotent tool operations.
- Apply retries, timeouts, and rate limits.
- Persist progress before and after side effects.
- Emit redacted telemetry and verification evidence.

## Cvent execution order

1. Official Cvent API.
2. Supported Cvent import/export or integration.
3. Deterministic Steel.dev browser automation.
4. Model-assisted browser recovery when deterministic selectors fail.
5. Manual takeover for unresolved or high-risk operations.

## Workflow pattern

```text
Validate request
-> Fetch event and current state
-> Prepare proposed changes
-> Request approval when required
-> Apply through Cvent API or Steel.dev
-> Verify the resulting state
-> Save redacted evidence
-> Report completion
```

Every side-effecting operation needs an idempotency key, bounded retries, before/after evidence, and a clear environment and event boundary.

## Deployment boundaries

Development, staging, and production use separate Azure resource groups or subscriptions, identities, data stores, credentials, and Cvent environments. Production has no implicit access to development tooling.
