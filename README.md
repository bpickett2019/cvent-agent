# Cvent Agent

A persistent, UI-driven agent for automating Cvent workflows through official Cvent APIs and Steel.dev browser sessions. The target deployment environment is Microsoft Azure, with Langfuse providing agent observability and evaluation.

> This repository currently contains the product and technical foundation. Runtime implementation will follow.

## Goals

- Provide a conversational UI for creating and monitoring Cvent tasks.
- Continue long-running tasks after the user closes the UI.
- Prefer official Cvent APIs; use browser automation only where needed.
- Stream progress, browser evidence, and approval requests to users.
- Maintain auditable, reproducible agent versions.
- Improve through evaluated and human-approved releases rather than unrestricted live self-modification.

## Proposed stack

- **UI:** Next.js with Microsoft Entra ID authentication
- **Agent API/worker:** TypeScript or Python on Azure Container Apps
- **Task orchestration:** Azure Service Bus and Durable Functions or Container Apps Jobs
- **Browser automation:** Steel.dev
- **Cvent integration:** Official REST APIs, with browser fallback
- **Observability and evaluation:** Langfuse and Azure Application Insights
- **State:** Azure Database for PostgreSQL
- **Artifacts:** Azure Blob Storage
- **Secrets:** Azure Key Vault and Managed Identity
- **Model:** Azure OpenAI or another client-approved provider
- **Infrastructure:** Terraform

## Documentation

- [Agent specification](docs/agent-specification.md)
- [Architecture](docs/architecture.md)
- [Deployment and release process](docs/deployment.md)
- [Security policy](SECURITY.md)

## Planned repository layout

```text
apps/
  web/             # User interface
  api/             # Agent and task API
  worker/          # Durable tool execution
agent/
  prompts/
  policies/
  tools/
  workflows/
  memory/
  evaluations/
integrations/
  cvent/
  steel/
  langfuse/
infra/
  terraform/
docs/
```

## Core principle

The production process is immutable and does not silently rewrite itself. It may analyze traces, propose changes, run evaluations, and produce a candidate release. Promotion requires policy checks and human approval, preserving auditability and rollback.

## Status

Initial architecture and deployment planning.
