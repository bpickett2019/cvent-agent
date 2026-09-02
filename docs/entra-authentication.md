# Microsoft Entra ID setup for the Emerald console

The console uses Auth.js OIDC with a single-tenant Microsoft Entra issuer. Do not put secrets in source control, the UI, or logs.

## 1. Register the application

An Entra administrator must create a **Web** application registration (this repository does not create one). Use these redirect URIs exactly:

- Production: `https://<emerald-console-hostname>/api/entra/auth/callback/microsoft-entra-id`
- Local development: `http://localhost:3000/api/entra/auth/callback/microsoft-entra-id`

Replace `<emerald-console-hostname>` only after the deployment hostname is known. Do not use wildcard redirect URIs. Create a client secret and deliver its **value** through the approved secret store.

## 2. Define application roles

In **App registrations → App roles**, create roles allowed for `Users/Groups` with these exact values (display names may match the values):

| Value | Purpose |
| --- | --- |
| `Viewer` | Read monitor and review data |
| `Operator` | Upload, preview, apply, queue, control runs/workspaces, and promote Golden login |
| `Approver` | Operator capabilities plus approval actions |
| `Administrator` | All console actions and future auth/config administration |

Equivalent manifest fragment (generate a different stable GUID for each `id`; never reuse the example placeholders):

```json
{
  "appRoles": [
    { "allowedMemberTypes": ["User"], "description": "Read Emerald monitor and review data", "displayName": "Viewer", "id": "<viewer-role-guid>", "isEnabled": true, "value": "Viewer" },
    { "allowedMemberTypes": ["User"], "description": "Operate Emerald event runs and workspaces", "displayName": "Operator", "id": "<operator-role-guid>", "isEnabled": true, "value": "Operator" },
    { "allowedMemberTypes": ["User"], "description": "Operate and approve Emerald actions", "displayName": "Approver", "id": "<approver-role-guid>", "isEnabled": true, "value": "Approver" },
    { "allowedMemberTypes": ["User"], "description": "Administer all Emerald console actions", "displayName": "Administrator", "id": "<administrator-role-guid>", "isEnabled": true, "value": "Administrator" }
  ]
}
```

Assign users or groups under **Enterprise applications → Users and groups**. A user with no recognized app role is denied sign-in. Directory roles such as Global Administrator do not grant console access.

## 3. Runtime environment

Set all values through the deployment environment/secret manager:

```dotenv
EMERALDX_ENTRA_TENANT_ID=<directory-tenant-guid>
EMERALDX_ENTRA_CLIENT_ID=<application-client-guid>
EMERALDX_ENTRA_CLIENT_SECRET=<client-secret-value>
EMERALDX_AUTH_BASE_URL=https://<emerald-console-hostname>
AUTH_SECRET=<high-entropy-random-authjs-secret>
```

`EMERALDX_AUTH_BASE_URL` must be HTTPS in production and must not include a path. Generate `AUTH_SECRET` with a cryptographically secure secret generator (for example, `openssl rand -base64 32`).

For authenticated local OIDC development, use `EMERALDX_AUTH_BASE_URL=http://localhost:3000`. The legacy local-only bypass remains available only when all conditions are true: the process is not production, `EMERALDX_ALLOW_UNAUTHENTICATED_DEV=true`, and `EMERALDX_AUTH_BASE_URL` is unset or uses exactly `localhost`, `127.0.0.1`, or `::1`. Production always ignores the bypass and fails closed.

## Security behavior

Auth.js performs OIDC discovery and validates token signature, issuer, audience and nonce; the provider additionally requires PKCE and state. Sessions use encrypted/signed JWT cookies with `HttpOnly`, `SameSite=Lax`, `Secure` in production, and an eight-hour maximum age. The console copies only recognized role strings into the session; tokens are never rendered or logged. Existing same-origin checks, exact Cvent target authorization, and permanent safety prohibitions remain in force after role authorization.
