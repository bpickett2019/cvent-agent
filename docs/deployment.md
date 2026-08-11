# Azure Deployment and Release Process

## Initial services

- Azure Container Apps for the UI, API, and workers
- Azure Service Bus for queued tasks and events
- Azure Database for PostgreSQL for conversations, state, and audit data
- Azure Blob Storage for screenshots and artifacts
- Azure Key Vault for credentials
- Managed Identity and Microsoft Entra ID for authentication
- Azure Application Insights for infrastructure telemetry
- Langfuse for model, prompt, and tool traces and evaluations
- Steel.dev for remote browser sessions
- Anthropic enterprise API for model inference

Container Apps is preferred over AKS for the initial release to reduce operational overhead.

## Environments

Maintain isolated development, staging, and production environments. Each environment receives distinct identities, secrets, network rules, databases, storage, Cvent credentials, Steel configuration, and Langfuse projects.

## CI/CD

```text
Lint and unit test
-> Run workflow simulations
-> Run prompt and policy evaluations
-> Scan dependencies, source, and container
-> Build and sign an immutable container
-> Deploy to staging
-> Run Cvent sandbox smoke tests
-> Obtain approval
-> Deploy a production canary
-> Promote or automatically roll back
```

GitHub Actions or Azure DevOps may implement this pipeline. Terraform should define Azure resources and environment configuration.

## Release rules

- Pin model, prompt, policy, workflow, tool, and container versions.
- Never deploy from uncommitted or unreviewed source.
- Store no production secrets in GitHub, container images, prompts, or logs.
- Require protected branches and reviews for production policy changes.
- Preserve rollback artifacts and database migration procedures.
- Evaluate candidate self-improvements exactly like human-authored changes.

## MVP delivery sequence

1. Entra ID authentication and role model.
2. Chat/task UI and durable task API.
3. One read-only Cvent API workflow.
4. One approved, side-effecting Cvent API workflow.
5. One Steel.dev browser workflow.
6. Live status, screenshots, and approval checkpoints.
7. Langfuse traces and baseline evaluations.
8. Terraform and staged deployment pipeline.
9. Security review and production canary.
