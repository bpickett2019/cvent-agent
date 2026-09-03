# CVENT Agent demo readiness — 2026-09-03

## Environment

- Azure resource group: `rg-chartdarts-stg` (explicitly reauthorized for CVENT Agent staging)
- VM: `cvent-pi-dev-vm`
- Region: `westus3`
- VM size: `Standard_D32s_v5` (32 vCPU, 128 GiB class; live guest reported 125 GiB)
- OS: Ubuntu Linux, Trusted Launch
- Docker: 29.1.3
- Steel image: `ghcr.io/steel-dev/steel-browser@sha256:21cf2a5785aa9478d0f7933c04bce96ca79f3d7a93d9824ea184800d29d3cd02`
- Staging SSH: public-key access for `piadmin`; NSG allows TCP/22 only from Bailey's current `/32`. UI/Steel/CDP ports remain unexposed.

## Capacity evidence

The capacity harness started one self-hosted Steel container and one blank Chromium session per slot, bound every API port to `127.0.0.1`, sampled Docker stats, and trap-removed every container.

### 12-container gate — PASS

- 12/12 container stats recorded
- 12 blank sessions created
- Total sampled memory: 6,765.8 MiB
- Maximum sampled container memory: 614.4 MiB
- Total sampled PIDs: 1,785
- Leftover capacity-test containers after cleanup: 0

### 36-container gate — PASS

- 36/36 container stats recorded
- 36 blank sessions created
- Total sampled memory: 19,228.7 MiB
- Maximum sampled container memory: 618.7 MiB
- Total sampled PIDs: 5,520
- Leftover capacity-test containers after cleanup: 0
- VM memory after cleanup: approximately 2.5 GiB used / 125 GiB total
- Root disk after image pull/tests: 9.6 GiB used / 123 GiB total

These results certify blank Steel/Chromium workspace startup capacity only. They do not certify 36 concurrent authenticated Cvent pages, Pi inference, mutation throughput, or Cvent rate limits.

## GitHub

- PR: `https://github.com/bpickett2019/cvent-agent/pull/2`
- Reviewed branch head before harness compatibility fix: `d51858f615fdb510046aa48d60a9dc645abb800b`
- `deterministic-core`: SUCCESS
- `operator-dashboard`: SUCCESS
- PR remains open and unmerged.

## Blocking items

### Entra application — BLOCKED on directory administrator

Existing app: `app-chartdarts-dashboard`, client ID `11f91043-4128-4b76-a405-46e71e034fab`.

Live state:

- CVENT Agent Auth.js callback URIs are absent.
- `Viewer`, `Operator`, `Approver`, and `Administrator` app roles are absent.
- `appRoleAssignmentRequired` is false despite the earlier email saying assignment is required.
- `groupMembershipClaims` is unset.
- Bailey is not an owner and received `Insufficient privileges` when attempting an add-only redirect URI update.

Required administrator action:

1. Add `http://localhost:4320/api/entra/auth/callback/microsoft-entra-id` for the tunneled pilot.
2. Add staging/production callback URIs at the same path after DNS is established.
3. Create the four exact application roles.
4. Enable assignment required.
5. Assign the approved operator group to `Operator`.
6. Remove or separately justify unnecessary `Mail.Send` for the CVENT Agent use case.

### Cvent acceptance — BLOCKED on attended login

The bounded authorized-clone acceptance attempted only:

- Event: `(C+D) Medtrade Testing Clone 2`
- UUID: `e712e34c-6117-4d13-bf4c-8ed54cf2b495`

Result: `BLOCKED: authentication wall`. No mutation occurred.

The operator must open `Default Cvent login` in the top-right of the Emerald UI, complete login/MFA manually, return to the exact authorized clone, and select `Save refreshed login` before the bounded idempotent acceptance can run.

## Permanent safety boundaries

- No other event is authorized.
- Never Delete/Remove.
- Never Publish/Go Live.
- Never send Cvent communications.
- Never access attendee data.
- Every mutation requires read-before/write and independent read-back.
- Same-event writes remain serialized.
