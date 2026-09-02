# Entra administrator update — existing Charts + Darts app reused for CVENT Agent

The CVENT Agent staging pilot has been explicitly authorized to reuse the existing single-tenant app registration:

- Display name: `app-chartdarts-dashboard`
- Application/client ID: `11f91043-4128-4b76-a405-46e71e034fab`
- Tenant: `661c8d9b-e19e-4330-b412-75dce2d26154`

Bailey does not own this application and `az ad app update` returns `Insufficient privileges`, so a directory/application administrator must make the changes below.

## 1. Preserve existing redirect URIs and add these Web redirects

For the SSH-tunneled pilot:

`http://localhost:4320/api/entra/auth/callback/microsoft-entra-id`

For staging after DNS is created:

`https://staging.app-chartsdarts-dashboard.com/api/entra/auth/callback/microsoft-entra-id`

For production only when separately approved:

`https://app-chartsdarts-dashboard.com/api/entra/auth/callback/microsoft-entra-id`

Do not remove the three existing `/auth/callback` URIs and do not add wildcards.

## 2. Add exact application roles

Use these stable role IDs and exact values. Allow Users/Groups.

```json
[
  {
    "allowedMemberTypes": ["User"],
    "description": "Read Emerald CVENT Agent monitor and review data",
    "displayName": "Viewer",
    "id": "16bded82-c072-4ca3-b7b5-5d21e90d7346",
    "isEnabled": true,
    "value": "Viewer"
  },
  {
    "allowedMemberTypes": ["User"],
    "description": "Operate Emerald CVENT Agent event runs and workspaces",
    "displayName": "Operator",
    "id": "51803c1c-ee89-41c0-afb4-0a83e1ae98e8",
    "isEnabled": true,
    "value": "Operator"
  },
  {
    "allowedMemberTypes": ["User"],
    "description": "Operate and approve Emerald CVENT Agent actions",
    "displayName": "Approver",
    "id": "425308c3-c309-4f31-9800-5bea743ca2ad",
    "isEnabled": true,
    "value": "Approver"
  },
  {
    "allowedMemberTypes": ["User"],
    "description": "Administer the Emerald CVENT Agent console",
    "displayName": "Administrator",
    "id": "c16f6f2d-ed48-4779-bcc6-124e4fdae1e9",
    "isEnabled": true,
    "value": "Administrator"
  }
]
```

## 3. Enable assignment required

On Enterprise Applications → `app-chartdarts-dashboard` → Properties, set `Assignment required?` to **Yes**.

The live service principal currently reports `appRoleAssignmentRequired: false`, so the earlier email confirmation has not taken effect on this service principal.

## 4. Assign operator group to the Operator role

Assign `sg-chartdarts-operators` to the `Operator` app role. Bailey is already a confirmed member of this group.

A default/no-role assignment is insufficient: the application deliberately rejects sessions without one of the four exact role values.

## 5. Secret delivery

The previously issued secret must be delivered only through the approved private channel and stored as `EMERALDX_ENTRA_CLIENT_SECRET` in the staging VM's protected environment/secret store. Never place it in chat, source control, deployment command arguments, tickets, screenshots, or shared logs.

## Verification requested

Please confirm after changes:

- All existing redirect URIs remain.
- The localhost:4320 Auth.js callback exists exactly.
- All four app role values exist exactly.
- `appRoleAssignmentRequired` is true.
- `sg-chartdarts-operators` is assigned to `Operator`.
- Bailey can receive an ID token with `roles: ["Operator"]`.
