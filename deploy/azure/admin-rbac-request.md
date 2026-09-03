# Azure access request — CVENT-agent private pilot

Please perform these actions as an Azure administrator for subscription `e7a6e33b-d0a8-4ab6-9aa0-114ac3ad9a88` in tenant `661c8d9b-e19e-4330-b412-75dce2d26154`.

1. Create resource group `rg-cvent-agent-pilot` in `eastus2`.
2. Grant `Contributor` on only that resource group to user `bpicket@EMERALDEXPO.NET`, verified Entra object ID `4a6e7af6-72bb-4f11-8fb3-fb7842fcb2e6` (or to approved application `11f91043-4128-4b76-a405-46e71e034fab` if workload identity is being used).
3. Do not grant subscription-wide Owner/User Access Administrator unless separately required and approved.
4. Confirm the Microsoft.Compute, Microsoft.Network, and Microsoft.Storage resource providers are registered for the subscription.

Example administrator commands:

```bash
SUB='e7a6e33b-d0a8-4ab6-9aa0-114ac3ad9a88'
RG='rg-cvent-agent-pilot'
az account set --subscription "$SUB"
az group create --name "$RG" --location eastus2
SCOPE="/subscriptions/$SUB/resourceGroups/$RG"
az role assignment create --assignee 'bpicket@EMERALDEXPO.NET' --role Contributor --scope "$SCOPE"
az role assignment list --scope "$SCOPE" --assignee-object-id '4a6e7af6-72bb-4f11-8fb3-fb7842fcb2e6' --query '[].{role:roleDefinitionName,scope:scope}' -o table
```

The verification command must show `Contributor` at the exact resource-group scope. A successful Azure CLI login alone does not confirm the role assignment.

No Cvent credentials or application secrets are required for this RBAC action.
