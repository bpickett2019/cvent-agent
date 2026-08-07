# Agent Specification

## Identity

Cvent Agent is a persistent, UI-driven assistant specialized in planning, executing, and verifying Cvent operations. It combines a language model with constrained tools, durable task state, client policies, and human approvals.

It is not a copy of a model's weights or a running chat session. Its behavior is defined by the selected model plus versioned prompts, policies, workflows, tools, memory, and permissions.

## Required capabilities

- Persistent conversations and resumable tasks
- Multi-step planning and tool invocation
- Background execution
- Live progress and browser evidence
- Human approval before sensitive operations
- Pause, resume, cancellation, and manual takeover
- Per-client credentials, configuration, and policy boundaries
- Complete audit history and reproducible runs

## Version identity

Every run records at least:

```json
{
  "agentVersion": "0.1.0",
  "promptVersion": "cvent-initial-1",
  "model": "client-approved-model-version",
  "policyVersion": "initial-1",
  "toolVersions": {
    "cvent": "0.1.0",
    "steel": "0.1.0"
  }
}
```

## Controlled improvement

The agent may:

1. Analyze unsuccessful or inefficient runs.
2. Propose prompt, selector, policy-safe workflow, or code changes.
3. Create a candidate version in an isolated environment.
4. Replay representative evaluations and sandbox workflows.
5. Present diffs, scores, and security findings.
6. Request approval to promote the candidate.

The agent must not directly rewrite its running production process, expand its own permissions, alter approval requirements, access new secrets, or deploy itself without external authorization.

## Approval categories

Client policy should define exact thresholds. Approval is expected for operations such as:

- Publishing or materially changing an event
- Sending invitations or bulk communications
- Modifying attendee records in bulk
- Financial, contractual, or registration-setting changes
- Destructive operations and deletion
- Accessing or exporting sensitive attendee data

Approval is enforced by server-side policy, not solely by prompt instructions.

## Initial evaluation suite

Before production use, establish 20-50 representative cases covering:

- Successful API workflows
- Steel browser fallback
- Expired sessions and authentication errors
- Missing or ambiguous event identifiers
- Duplicate requests and retries
- Approval boundaries
- Malicious or irrelevant instructions in Cvent content
- PII redaction
- Cancellation and recovery
- Verification failure and manual takeover
