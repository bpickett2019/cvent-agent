# Agent 4 — Discounts and Event Vouchers UI mapping

## Scope and evidence

- Authorized event only: **(C+D) Medtrade Testing Clone 2**
- Event UUID: `e712e34c-6117-4d13-bf4c-8ed54cf2b495`
- Steel workspace: `23bbc568-7e3e-4585-baad-9f2989b52a40`
- Discovery used Playwright over CDP at `ws://127.0.0.1:60290/` on 2026-09-01.
- The live event title and UUID were verified on both list pages.
- Read-only: no create/edit/save/import/export/associate/delete/remove/publish/communication/attendee action was invoked.

## Shared guard

Before every navigation or future approved mutation:

1. Require the exact UUID in `evtstub` (case-insensitive parameter name may be rendered as `evtStub`).
2. Require visible event text `(C+D) Medtrade Testing Clone 2` or the title-bar bootstrap data containing both the exact event ID and event name.
3. Stop on sign-in, MFA, consent, payment, unexpected modal, another event, or a route without the authorized `evtstub`.
4. Never invoke `Delete`, `Remove`, `Delete All Event Discounts`, `Add Account Discounts`, `Import`, `Publish`, attendee, or communications controls.

## Discounts

### Routes

- List: `https://app.cvent.com/Subscribers/Events2/AgendaAndFees/DiscountsGrid?evtstub={eventId}`
- Add form (known route; not opened during this read-only pass): `/subscribers/events2/AgendaAndFees/DiscountDetails/Index/Add?evtstub={eventId}&level=1`
- Existing event-discount detail link pattern: `/subscribers/events2/AgendaAndFees/DiscountDetails?evtStub={eventId}&prodstub={discountId}&level=1`
- Pricing parent: `https://planner-registration-ui.app.cvent.com/pricing/fees?evtstub={eventId}`

### Stable list selectors and semantics

- Create: `button#Add` / role button, exact name `Create Discount` (**write-capable; avoid in read-only mode**).
- Associate account/global discounts: `button#Associate` / `Add Account Discounts` (**account boundary; prohibited**).
- Bulk destructive action: `button#BulkDelete` / `Delete All Event Discounts` (**permanently prohibited**).
- Row detail: `a[href*="/AgendaAndFees/DiscountDetails"][href*="prodstub="]` scoped to a row; prefer exact row name plus validated href.
- Tabs/text: `Fees`, `Discounts`, `Service Fees`, `EU E-invoice`.
- Type filter values visible in UI: `All`, `Discount Code`, `Volume Discount`.
- Grid columns: `Name`, `Code`, `Level`, `Amount/Percentage`, `Effective From`, `Effective To`, `Used`, `Active`.
- The live list showed event-level rows and detail URLs carrying both `evtStub` and a discount `prodstub`.

### Detail fields

Known detail model from the same authorized event's prior read-only mapping; field labels should be preferred over brittle generated IDs and selectors rediscovered if the DOM drifts.

Common:

- Name (required)
- Active: Yes/No
- Stackable / allow multiple discounts: Yes/No (`AllowMultipleDiscount` model)
- Effective From / Effective To
- Internal Note (300 characters)
- Type: Discount Code or Volume Discount

Discount Code branch:

- Discount Code (required)
- Method: subtract amount, subtract percentage, or charge fixed price
- Amount/Percentage (required; interpretation depends on Method)
- Audience: Invitees, Guests, or Invitees and Guests
- Capacity and read-only Used count
- Whether guests count toward capacity
- Automatically apply: Yes/No
- Apply to selected items or final total
- Eligible item groups: Admission Items, Session Bundles, Sessions, Optional Items
- Advanced Filters: maximum five rows; Field + Operator + Value with And/Or. Available fields include contact/custom fields and registration attributes such as Registration Type, Reference ID, Admission Item, Registration Path, and Invitation List.

Volume Discount branch:

- Threshold (required)
- Method: subtract amount or percentage
- Amount/Percentage (required)
- Apply to registrants at/before threshold, after threshold, repeatedly at an interval after threshold, or all registrants
- Include primary registrant: Yes/No
- Interval ordinal (1st–10th) for repeated-threshold mode

### Dependencies and constraints

- Scope is not automatically event-local: the list can contain event discounts and discounts applied to all account events. `Level` must equal `Event` before any future approved edit.
- `Add Account Discounts` crosses the account/global boundary and must remain unsupported.
- Item-targeted discounts depend on eligible admission/session/bundle/optional items; item fees may be required before an item becomes eligible.
- Method controls amount semantics. Do not parse `$59.00` as “subtract $59” without reading Method; it may represent a fixed price.
- Date range must be validated as a pair; blank dates are permitted by existing rows, but should not be invented.
- Capacity, audience, guest-counting, automatic application, stackability, and applicable items must be compared independently.
- Advanced filters depend on exact field/operator/value compatibility and are capped at five rows.

### Duplicate and conflict rules

- Normalize only whitespace for comparison; preserve requested name and code exactly for writes.
- Search/read the full dataset, not only the current page. Pagination previously reported hundreds of records and the live DOM showed many repeated names.
- Exact idempotent match requires matching code, name, type, method, amount/percentage, dates, active, stackability, audience/threshold configuration, capacity, auto-apply, targets, and filters.
- Existing exact match: skip and report its `prodstub`.
- Same code with any differing configuration: conflict; stop. Never overwrite.
- Same name with a different code: conflict requiring human review.
- Duplicate names are possible in the live event (for example many `Exhibitor promo code` rows); name alone is not identity.
- Any `Level != Event` or ambiguous level: stop as global/account scoped.

### Read-back contract

After a future separately authorized Save:

1. Wait for navigation/confirmation; do not treat a click as success.
2. Return to the event-scoped list route and search all pages for the exact code.
3. Require one unambiguous event-level row; record Name, Code, Level, Amount/Percentage, Effective From/To, Used, Active, and detail `prodstub`.
4. Open only that validated detail URL and compare every supported setting and dependency assignment.
5. If list and detail disagree, report failure/partial state and do not retry creation.

## Event Vouchers

### Routes

- List: `https://app.cvent.com/Subscribers/Events2/RegistrationOption/EventVouchersGrid/Index/?evtstub={eventId}`
- Add form (known route; not opened in this pass): `/subscribers/events2/RegistrationOption/AddVouchers?evtstub={eventId}`
- Post-save list may canonicalize with or without `/Index`; validate event UUID rather than relying on that suffix.

### Stable selectors and live state

- Import: `button#Import` / `Import Vouchers` (**write-capable; prohibited**).
- Create: `button#AddVouchers` / `Create Vouchers` (**write-capable; avoid in read-only mode**).
- Edit: `button#Edit` / `Edit` (**write-capable; avoid in read-only mode**).
- Grid data: `textarea#Vouchers-1` contains JSON rows.
- Grid metadata: `textarea#Vouchers-config` contains column metadata and option routes.
- Validation payload: `textarea#Vouchers-valid-1`.
- Grid columns: `Voucher Code`, `Alert Email Address`, `Capacity`, `Used`.
- Live row read back:
  - ID `75df53a9-72e6-4d92-881a-1687dccf7896`
  - Code `MOCKVCHR001`
  - Email `mock@example.com`
  - Description `Mock voucher for end-to-end automation testing`
  - Capacity `100`
  - Used `0`
- The metadata exposes a row option URL `/EventVouchersGrid/Delete?...&voucherstub={Id}`. It is permanently prohibited even when `Deletable=true`.

### Add-form fields and selectors

Known from prior read-only discovery on this exact event:

- Repeating rows start at 1 and initially expose rows 1–5.
- Code: `#Vouchers_Code_{n}` — required, maximum 30 characters.
- Alert email: `#Vouchers_EmailAlertAddress_{n}` — optional, maximum 80 characters.
- Description: `#Vouchers_Description_{n}`.
- Capacity: `#Vouchers_Capacity_{n}`.
- Add another row: `#Vouchers-SimpleButton-Add_Another_Voucher`.
- Save: `button#Save` (**write-capable**).
- Cancel: `button#Cancel`.

### Dependencies and constraints

- Voucher scope is event-local via `evtstub`.
- Voucher code is the primary identity and is required/max 30.
- Alert email is optional/max 80 and, when supplied, must be syntactically valid.
- Capacity must be a valid nonnegative/positive integer as required by current UI validation; never reduce it below Used.
- Used is read-only operational state, not an intake field.
- Description is not visible as a table column; read it from `#Vouchers-1` JSON or an authorized detail/edit surface.
- Existing vouchers expose delete only in the row options metadata; no safe standalone view route was observed.

### Duplicate and conflict rules

- Compare voucher code exactly (preserve case and punctuation); do not silently “repair” a requested code.
- Exact match requires code, alert email, description, and capacity; Used is observed but not part of desired configuration.
- Exact match: skip and record ID.
- Same code with any differing email/description/capacity: conflict; stop. Never overwrite or delete/recreate.
- Same email or description with a different code is not sufficient to identify a duplicate.
- Read `#Vouchers-1` after every list load; empty UI text alone is not enough.

### Read-back contract

After a future separately authorized Save:

1. Wait for the event-scoped voucher list route (with or without `/Index`).
2. Parse `textarea#Vouchers-1` and require exactly one object whose `Code` exactly matches.
3. Verify `EmailAlertAddress`, `Description`, `Capacity`, and expected initial `Used` (normally 0 for a new voucher).
4. Record Cvent `Id`; also verify the rendered row columns.
5. If the route changes but the exact row already exists, treat it as success and never retry creation blindly.

## AI-assisted recovery (bounded and read-only safe)

Use deterministic Playwright locators first. AI/semantic recovery is permitted only to rediscover controls; it must not submit or mutate.

1. Re-verify exact event UUID/name and current route.
2. Capture a semantic snapshot of headings, buttons, labels, table headers, visible rows, and hrefs.
3. Ask the recovery layer only for candidates matching the known intent (for example, “locate the Event Vouchers grid data”), excluding any candidate whose text/href contains `Delete`, `Remove`, `Import`, `Associate`, `Account`, `Publish`, attendee, email, or communications terms.
4. Promote a recovered candidate only if its event-scoped href/DOM ancestry and accessible name match expectations; otherwise stop for human review.
5. For row identity, prefer exact code plus `Level=Event` (discounts) or exact voucher code in `#Vouchers-1`; never choose by row position or name alone.
6. On stale DOM, timeout, session loss, sign-in, unexpected modal, empty/partial grid, or pagination ambiguity: refresh/reopen the known list route once, reread state, and stop if still ambiguous. Do not navigate to another event or retry a create/save.
7. Preserve the Steel workspace/session reference, URL, timestamp, last verified event guard, and extracted read-only evidence in the failure report.
