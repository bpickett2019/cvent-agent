# Agent 2 — Registration Paths and Registration Types UI Map

## Scope and safety boundary

- Authorized event only: **(C+D) Medtrade Testing Clone 2**
- Event UUID: `e712e34c-6117-4d13-bf4c-8ed54cf2b495`
- Discovery method: read-only Playwright attachment to the existing Steel CDP session.
- No form was submitted; no `Edit`, `Apply`, `Save`, `Publish`, `Delete`, `Remove`, attendee, or communications action was invoked.
- Every procedure must guard both:
  1. URL contains `evtstub=e712e34c-6117-4d13-bf4c-8ed54cf2b495`; and
  2. visible body/header contains `(C+D) Medtrade Testing Clone 2`.
- Stop on either mismatch, authentication prompt, modal confirmation, or an unexpected event.

## Registration types

### Routes and page markers

- List route:
  `/Subscribers/Events2/Details/RegistrationTypes/Index/?evtstub={eventId}`
- Expected title/heading: `Registration Types`.
- Stable list JSON: `textarea#InputModel\.RegistrationTypeList-1[name="json::InputModel.RegistrationTypeList"]`.
- Grid configuration/read-back metadata: `textarea#InputModel\.RegistrationTypeList-config`.
- Grid filter: `input#InputModel\.RegistrationTypeList-filter`.
- View route template:
  `/subscribers/events2/Details/RegistrationTypeDetail/Index/View?evtstub={eventId}&registrationtypestub={registrationTypeId}`
- Manage Availability route (from grid configuration; write-capable):
  `/subscribers/events2/Details/RegistrationTypeDetail/Index/Edit?evtstub={eventId}&registrationtypestub={registrationTypeId}`
- List-level write control to avoid: `button#Edit[name="Edit"]` (submit).
- Detail write/destructive controls to avoid: `button#Edit`, `button#Delete` (visible label `Remove`). `button#Close` is navigation-only but direct URL navigation is safer.

### Current registration types

The list has 14 rows including the built-in `No Registration Type`. Columns are `Name`, `Code`, `Virtual`, `Capacity`, and `Registered`. All rows currently show `Virtual = No` and `Registered = 0`.

| Name | ID | Code | Capacity |
|---|---|---:|---:|
| No Registration Type | `00000000-0000-0000-0000-000000000000` | *(blank)* | Unlimited |
| Attendee | `cbe7e888-e36a-440f-b392-a9cf3480f562` | `ATT` | Unlimited |
| Attendee- New | `dd73cdac-e36d-4d7d-b5f1-52fb5de1c6d8` | `Attendee- New` | 100 |
| Exhibitor \| Complimentary | `5855121c-3b12-45b8-8ce0-6fe04db9620b` | `EXCOMP` | Unlimited |
| Exhibitor \| Paid | `d27e76b6-116c-4657-972f-8cb89b74f25e` | `EXPAID` | Unlimited |
| Exhibitor Appointed Contractor (EAC) | `f7808f53-49ca-45f2-98d1-ec48b700b5de` | `EAC` | Unlimited |
| Guest | `19aec99d-096c-4e89-9fba-2f1949e79e8f` | `GST-X` | Unlimited |
| No Reg Type Selected | `0cebb071-dc80-4a2e-a0f2-c62195466204` | `ZZ` | Unlimited |
| Non-Ex | `e0a73cb0-b63d-4106-9b66-90be3d464192` | `NONEX-X` | Unlimited |
| Press/Media | `4949c469-9062-4abc-a87f-ce92040319dd` | `PR-X` | Unlimited |
| Show Management Guest | `556af3ec-0c4a-47ca-880d-5b7f0fc4b92d` | `SHOWGUE` | Unlimited |
| Speaker/Presenter | `52a32571-c272-471f-b08f-958fb18fc846` | `SPKR` | Unlimited |
| Staff | `6f056d6d-c167-4adc-ac6c-ddce70041ec9` | `STAFF` | Unlimited |
| Vendor/Supplier | `a5c28b7e-d049-43d9-afba-b0253f83061e` | `VENDR` | Unlimited |

Preserve whitespace exactly when matching UI names; the rendered `Show Management Guest` contained non-breaking spaces during discovery, so normalize whitespace only for comparison and retain the exact UUID as identity.

### Detail read-back surfaces

A read-only view of `Attendee- New` confirmed these sections:

- `Basic Settings`
- `Admission Items`
- `Sessions`
- `Session Bundles`
- `Optional Items`
- `Fees`
- `Badges, Certificates, & Tickets`

Useful embedded JSON read-back selectors on the detail view:

- Admission items: `textarea#admissionItems-1[name="json::admissionItems"]`
- Sessions: `textarea#sessions-1[name="json::sessions"]`
- Session bundles: `textarea#tracks-1[name="json::tracks"]`
- Optional items: `textarea#optionalItems-1[name="json::optionalItems"]`
- Fees: `textarea#FeeGroup-1[name="json::FeeGroup"]`
- Badges/certificates/tickets: `textarea#BadgeGroups-1[name="json::BadgeGroups"]`
- Each grid has parallel `-config`, `-valid-1`, `-searchmodel`, and `-validations` elements.

Observed `Attendee- New` association: admission item `Mock Name for automation testing only`, code `MOCK057`, ID `905cb7d3-cfdf-47b1-b711-4660aaf9e1f2`; the embedded row reports it is locked because it is only associated with this registration type.

### Fields and constraints for a future guarded procedure

These are procedure mappings, not authorization to edit:

- Exact identity must be resolved by UUID plus exact name/code; duplicate or conflicting identity stops the run.
- Registration Open Date maps to `input[name="AutoOpenDate-Datetxtbox"]` with backing model `#AutoOpenDate` on Manage Availability.
- Open status and open date are coupled. Cvent rejects `Open = Yes` with a future automatic-open date; set/validate them as one logical change.
- Capacity read-back is `EventContactTypeCapacity` / `EventContactTypeCapacityText` in the list JSON; `null` means `Unlimited`.
- Open/closed read-back is exposed in list JSON as `IsOpenForRegistration`, `IsClosedForRegistration`, `AutoOpenDate`, and `AutoCloseDate`.
- `No Registration Type` has `IsEditable=false`; never attempt to edit it.
- Description, Web Page Description, registration-path assignment, and guest eligibility have no verified event-local edit controls. Treat them as blocked, not blank/default.
- The detail form displays registration path as `(Not Specified)` but does not expose a verified edit control.
- `Create Contact Type` is account-global and prohibited. Do not submit it.
- `Add from Contact Types` remains blocked until its event-local safety is independently proven.

### Registration-type read-back procedure

1. Navigate directly to the list route and apply the event guard.
2. Require title/heading `Registration Types`.
3. Parse `textarea#InputModel\.RegistrationTypeList-1` as JSON; do not scrape names alone.
4. Resolve a target by UUID, then verify exact name and code.
5. Navigate to the view route only (final path segment `View`).
6. Verify detail heading equals the resolved name and re-run the event guard.
7. Read `Basic Settings` and embedded section JSON; do not invoke `Edit`, options menus, or `Remove`.
8. Return to the list by direct URL and confirm the same row remains present.

## Registration paths / Registration Process

### Routes and page markers

- Legacy Registration Process route:
  `/Subscribers/Events2/RegistrationOption/RegistrationProcessPages/Index/?evtstub={eventId}`
- Expected title/heading: `Registration Process`.
- Secondary headings: `Design & Build Your Registration Process`, `Registration Process Pages`.
- Path picker trigger: `a.cvf-grid-filter-display`.
- Path choices: `a.cvf-grid-filter-item[data-value]`.
- Selected persistent ID: `input#SelectedRegPathId[name="SelectedRegPathId"]`.
- Page model/read-back: `textarea#groupableGridModel[name="settings"]`.
- Site Designer launch (write-capable environment; avoid in read-only runs): `button#LaunchWebsiteEditor[name="LaunchWebsiteEditor"]`, label `Open Site Designer`.

### Current paths and stable IDs

| Path | Persistent ID |
|---|---|
| Attendee & NONEX | `f5c18fd7-deab-43c1-9748-a9dcc2b52299` |
| Landing Path | `b5b1682b-4b51-41e0-8874-6ad0c2243b34` |
| Exhibitor | `6fa1ed49-1918-48b9-8c1e-2654c0c40d23` |
| Internal | `e57126f9-6bdc-4abd-96ff-a3f539f0a579` |

Each picker option's `data-value` is the persistent path UUID. After selecting, verify the same UUID in `#SelectedRegPathId` and in all path-local customization links as `selectedRegPathId`. Never confuse these UUIDs with Site Designer's page-local numeric option values (`0`–`3`).

### Page navigation and selectors

Path-local page links use:

`/subscribers/events2/EventWebsite/EditWebsite/Index/View?evtstub={eventId}&startSection=Registration&startPage={pageKey}&selectedRegPathId={pathId}`

On the legacy list, customization links have stable IDs matching their visible page names. Use CSS escaping or `locator('a').filter({has: ...})`; examples:

- `a#Personal\ Information`
- `a#Admission\ Item`
- `a#Registration\ Summary`
- `a#Payment`
- `a#Confirmation`
- `a#Cancellation\ Form`
- `a#Decline\ Form`
- `a#Guest\ Information`
- Some paths additionally expose `a#Show\ Questions` and/or `a#Sessions`.

The exact `startPage` key is path-local and must be read from the link or `#groupableGridModel`; do not transplant a page UUID from another path. Observed page composition varies:

- `Attendee & NONEX`: Personal Information, Show Questions, Admission Item, Sessions, Registration Summary, Payment, Confirmation, Cancellation Form, Decline Form, Guest Information.
- `Landing Path`: Personal Information, Admission Item, Registration Summary, Payment, Confirmation, Cancellation Form, Decline Form, Guest Information.
- `Internal`: Personal Information, Admission Item, Sessions, Registration Summary, Payment, Confirmation, Cancellation Form, Decline Form, Guest Information.
- `Exhibitor`: path identity was verified; page-link extraction did not stabilize during the bounded read-only pass, so parse `#groupableGridModel` after selecting it rather than assuming another path's composition.

### Site Designer path settings mapping

For a future separately authorized guarded procedure:

- Site header/navigation toggle: `[data-cvent-id="nucleus-site-editor-site-header"]` and its closest `[role="button"]`.
- Registration path selector: `select#RegistrationPath[name="RegistrationPath"][data-cvent-id="input"]`.
- Scope the settings icon strictly: `[data-cvent-id="switch-registration-path"] [data-cvent-id="edit-icon"]`.
- The resulting inline child panel is titled `Path Settings`.
- Identity fields/read-back: `#name`, `#code`, `#internalNote`.
- Pristine close: `button[data-cvent-id="cancel-button"]`.
- Child-panel commit: `button[data-cvent-id="apply-button"]`; separate persistence: `button[data-cvent-id="site-designer-save-button"]`. Both are prohibited in read-only mode.

Mapped settings:

- Privacy radio group name: `accessRules.invitationListAccess.type`.
  - value `1`, `#accessRules\.invitationListAccess\.type__0`: `Open to the public`
  - value `2`, `#accessRules\.invitationListAccess\.type__1`: `Only those on invitation lists`
  - value `3`, `#accessRules\.invitationListAccess\.type__2`: `Only those on certain invitation lists`
- Value `3` has an invitation-list dependency; require exact reviewed invitation-list resolution before any future mutation.
- Active status: `input#isActive_0[name="isActive"]`, label `Active`.
- All four paths were previously read as public and active.
- Landing Path status is disabled because it is the default path. Do not change the default merely to deactivate it.
- Post-registration redirect URL is unresolved: no verified control exists on the legacy list, Path Settings, Site Designer Settings, More Actions, Confirmation settings, or Post Registration folder. Never alias it to page title, Confirmation content, or another URL field.

### Registration-path read-back procedure

1. Navigate directly to the Registration Process route and apply the event guard.
2. Require title/heading `Registration Process` and `#SelectedRegPathId`.
3. Open `a.cvf-grid-filter-display` and resolve the exact path by option text plus `data-value` UUID.
4. Selecting a picker item is navigation/read-only state. After selection, wait for `#SelectedRegPathId` to equal the expected UUID.
5. Parse `#groupableGridModel`; verify every returned page link contains both the authorized `evtstub` and selected `selectedRegPathId`.
6. Record page names and exact `startPage` values. Do not click `Open Site Designer` during read-only runs.
7. Repeat for each path, reapplying the event guard after every selection.

## AI recovery hints

- **Stale/empty path display:** the picker label briefly rendered empty for some AJAX selections even though `#SelectedRegPathId` had updated. Trust only after UUID equality plus refreshed `#groupableGridModel`/path-local links; otherwise reload the list and retry the selection once.
- **Empty path links after selection:** wait for the AJAX/model refresh and parse `#groupableGridModel`. If still empty, reload and select by exact `data-value`; do not borrow links from another path.
- **Dynamic IDs:** the global search input uses generated `react-aria...` IDs. Never use it as a page marker.
- **Whitespace:** normalize non-breaking spaces for name comparison, but preserve source display text and use UUID as primary identity.
- **Selector drift:** prefer JSON textareas and route parameters over visual row positions. Re-discover config from `*-config` when columns or links change.
- **Mode guard:** `input[name="hiddenMode"]` should read `View` on legacy list/detail views. Treat any other value as a stop condition in read-only mode.
- **Unexpected modal or submit control:** stop; do not attempt to close confirmations with ambiguous buttons. Directly navigate back to the guarded list route.
- **Session/auth failure:** retain Steel workspace/session identifiers and stop for user re-authentication; never handle SSO/MFA credentials.
- **Read-back failure:** a click or navigation is not success. Require exact URL, event name, title/heading, UUID, and JSON/read-back values before reporting.
