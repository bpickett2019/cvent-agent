# Agent 1 — Event Details and footer links UI mapping

## Scope and evidence

- Authorized event only: **(C+D) Medtrade Testing Clone 2**
- Event UUID: `e712e34c-6117-4d13-bf4c-8ed54cf2b495`
- Steel workspace: `05b3108b-165e-4d61-bf35-65cf27738214`
- Discovery used Playwright over CDP at `ws://127.0.0.1:60237/` on 2026-09-01.
- Live verification succeeded on Event Information View and Edit: the URL carried the exact UUID and the exact event name was visible.
- Read-only only: no field was changed and no form, Save, Cancel, Publish, Delete/Remove, communication, or attendee action was invoked.
- The Steel renderer crashed after the Event Details extraction while navigating to Registration Process. Footer findings below therefore distinguish the retained, event-specific read-only Site Designer map from fields whose component inspector remains unproven. Never infer inspector controls or destinations from rendered link text.

## Shared event guard

Run this before **every** page navigation and again after it settles:

1. Require URL query `evtstub`/`evtStub` to equal `e712e34c-6117-4d13-bf4c-8ed54cf2b495` (case-insensitive parameter name, exact UUID value).
2. Require visible exact text `(C+D) Medtrade Testing Clone 2`. On Event Information this is present in the event header and page body.
3. Require the expected page marker listed below. A route parameter alone is not a surface assertion.
4. Stop on sign-in/MFA, consent/payment UI, another event, missing identity, an unexpected modal, or any attendee/communication surface.
5. Permanently reject controls or URLs containing `Delete`, `Remove`, `Publish`, `Go Live`, or HTTP `DELETE`.

## Event Details / Event Information

### Routes and page markers

- View: `https://app.cvent.com/subscribers/events2/Details/EventDetails/Index/View?evtStub={eventId}`
  - Browser title: `Event Information`
  - Stable visible markers: heading `Event Information`, section headings `Basic Information`, `When`, `Event Format`, `Location`, `Where`, `Event Planner`, `Key Stakeholder`
  - Edit entry on View: role link/button exact name `Edit` (prefer the direct Edit route).
- Edit: `https://app.cvent.com/subscribers/events2/Details/EventDetails/Index/Edit?evtStub={eventId}`
  - Browser title and primary marker: `Event Information`
  - Save: `button#Save` / `button[name="Save"]` (**write-capable; not used**)
  - Cancel: `button#Cancel` / `button[name="Cancel"]` (do not submit in read-only discovery)

### Deterministic fields and constraints

Prefer the IDs below; use labels only as a drift fallback. Read `value`, checked state, and selected option text, not only visible page text.

| UI field | Stable selector/model | Live value | Constraint / dependency |
|---|---|---|---|
| Title | `#EventInputModel_Title` | `(C+D) Medtrade Testing Clone 2` | max 300; target rename is prohibited |
| Category | `#EventInputModel_CategoryId` | `TradeShow` / Trade Show | select |
| Locale country | `select#EventInputModel_CultureCountryId` | `232` / USA | paired duplicate hidden input exists; target the `select` |
| Multi-language | `input[name="EventInputModel.IsMultiLanguageEvent"]` | View says No | radio values `1`/`0`; language dependencies exist |
| Description | hidden `#EventInputModel_Description`; rich editor is the visible authoring surface | `Join us for Medtrade March 2-4, 2026 at the Phoenix Convention Center.` | do not mutate the hidden mirror directly; rich/plain hidden mirrors coexist |
| Internal Note | `#EventInputModel_Note` | `Mock automation test - ego browser` | textarea, max 300 |
| Time zone | `#EventInputModel_Timezone` | `10` / `(GMT-07:00) Mountain [US & Canada]` | select; adjusts for DST |
| Start | `#EventDatesInputModel_StartDate` | `2026-10-26T00:00:00` | datetime; matching `-previous` hidden input exists |
| End | `#EventDatesInputModel_EndDate` | `2026-11-24T23:59:00` | datetime; must not precede start |
| Archive | `#EventDatesInputModel_ArchiveDate` | `2027-02-22T23:59:00` | datetime; verify against end |
| Event format | `input[name="EventInputModel.EventAttendingFormat"]` | `2` / Hybrid | radios: `0`, `1`, `2`; read checked state, not DOM order |
| Location method | `input[name="EventInputModel.LocationCreationMethod"]` | `CustomLocation` | options include CustomLocation, ExistingHotelLocation, CsnLocation; changing branch changes dependent controls |
| Venue | `#EventInputModel_Location` | `Phoenix Convention Center` | max 300; custom-location branch |
| Phone | `#EventInputModel_Phone` | `(602) 262-6225` | max 30 |
| Address 1 | `#EventInputModel_Address_Address1` | `100 North 3rd Street` | max 40 |
| Address 2 / 3 | `#EventInputModel_Address_Address2`, `#EventInputModel_Address_Address3` | blank | max 40 each; preserve blank unless mapped |
| City | `#EventInputModel_Address_City` | `Phoenix` | max 40 |
| State/province | `#EventInputModel_Address_StateCode` | `AZ` / Arizona | dependent on country |
| Postal code | `#EventInputModel_Address_PostalCode` | `85004` | max 25 |
| Country/region | `#EventInputModel_Address_CountryCode` | `US` / USA | changing it can replace state options |

Additional live read-only state: event code `NLNMYJD28PH`; registration status hidden value `Pending`; previous event type `BetaStandard`; capacity hidden value `100`; close date hidden value `11/24/2026 11:58:00 PM`. Treat hidden operational fields as read-only and out of scope.

### Planner and stakeholder

The View surface is the safest read-back for these sections. Live View showed planner First `Medtrade Show`, Last `Team`, Email `MedtradeShowTeam@medtrade.com`; company/title were blank. Key Stakeholder name/company/title/email/phone/fax/address were blank. These controls were not promoted to write selectors in this pass; rediscover by exact section plus label before any separately authorized write, and never overwrite a nonblank unmapped value.

### Event Details read-back contract

After a future separately authorized mutation:

1. Verify the guard on Edit immediately before filling.
2. Read all supported fields and fill only explicitly mapped changed values. Never rename the event.
3. Save once with `button#Save`; wait for the canonical View route rather than treating the click as success.
4. Re-run the guard on View and compare visible section values.
5. Reopen Edit once and compare selector values/checked states/selected option text. Report `PASS` only when View and Edit agree; otherwise `FAIL` and do not retry Save blindly.

## Footer links / Site Designer

### Entry routes and surface assertions

- Registration Process entry:
  `https://app.cvent.com/Subscribers/Events2/RegistrationOption/RegistrationProcessPages/Index/?evtstub={eventId}`
  - Expected marker: `Registration Process`
  - Site Designer launch: `button[name="LaunchWebsiteEditor"]` / accessible name `Open Site Designer` (**navigation only**).
- Path-specific Customize pattern:
  `/subscribers/events2/EventWebsite/EditWebsite/Index/View?evtstub={eventId}&startSection=Registration&startPage={pageType}:{pageId}&selectedRegPathId={pathId}`
- Site Designer top page selector/container: `[data-cvent-id="nucleus-site-editor-site-header"]`.
- Main tabs: exact names `Build`, `Sections`, `Theme`, `Settings`.
- Header/Footer choices previously observed for this exact event: `Default Header and Footer` and `Header and Footer 2 Confirmation`.

**Critical wrong-surface rule:** `startSection=HeaderFooter` can still resolve to `Summary (WEBSITE PAGE)`. Never trust that parameter or the top selector alone. Before inspecting or later mutating any footer component, require visible selected-surface text **`Default Header and Footer`**; assert it again before any top-level Save. If the selected page says `Summary`, `Registration Summary`, or any registration page, stop.

### Rendered footer inventory (read-only observation)

The exact event's Default Header and Footer rendered these labels:

- Show Hours
- Show Policy
- Emerald Privacy Policy
- Hotel Info
- Browse Sessions
- Review Pricing
- FAQ
- Follow us on
- CONTACT US
- Do Not Sell or Share My Personal Information
- Manage Cookie Preferences

This inventory proves rendered content only. It does **not** prove exact href, visibility condition, component type, or inspector field. The current compiler intake also names `Registration Status`, `Contact Us button`, and `Exhibitor Resource Center`; those must not be assumed to exist merely because the contract supports them.

### Footer contract status

| Intake label | Intended Cvent field | Discovery status / rule |
|---|---|---|
| Show Hours | Show Hours link | rendered label observed; inspector and href unproven |
| Show Policy | Show Policy link | rendered label observed; inspector and href unproven |
| Emerald Privacy Policy | Emerald Privacy Policy link | rendered label observed; inspector and href unproven |
| Browse Sessions | Browse Sessions link | rendered label observed; inspector and href unproven |
| Review Pricing | Review Pricing link | rendered label observed; inspector and href unproven |
| Registration Status | Registration Status link | not observed as rendered footer text; known component model maps to `Already Registered`; review required |
| FAQ | FAQ link | rendered label observed; inspector and href unproven |
| Contact Us button | Contact Us button | rendered as `CONTACT US`; Contact Planner model previously read planner name/email, but exact link/button inspector remains unproven |
| Exhibitor Resource Center | Exhibitor Resource Center link | known component model maps to `Custom Link`; not observed in rendered inventory; review required |
| Hotel Info | Hotel Info link | rendered label observed; compiler classifies as review; inspector/href unproven |

### Stable discovery selectors and safe scoping

Site Designer DOM is dynamic; generated IDs and snapshot refs are not stable. Use this locator order:

1. `[data-cvent-id="nucleus-site-editor-site-header"]` then exact visible page name `Default Header and Footer`.
2. Scope the canvas query to the rendered exact link/button text; require one visible candidate. For `CONTACT US`, compare case-insensitively but preserve actual text.
3. If selecting a component is separately authorized, first snapshot all candidate buttons/links and reject any `Delete`, `Remove`, `Publish`, or `Go Live` ancestor/action. Selection may open a write-capable inspector; selection was not exercised in this read-only pass.
4. Discover inspector controls by accessible label/name and record them before use. Do not promote transient `@N`, generated class names, coordinates, or nth-child selectors.
5. Treat `Save` in the Site Designer header and Theme-level Save as write-capable. `Publish` is permanently prohibited.

### Footer dependencies and constraints

- Surface dependency: footer components belong to a specific Header and Footer surface; never edit a registration page with a similar canvas.
- Path dependency: registration paths observed on this event include Attendee & NONEX, Landing Path, Exhibitor, and Internal; confirmation may use `Header and Footer 2 Confirmation` instead of Default.
- Component-model dependency: Registration Status corresponds to `Already Registered`; Exhibitor Resource Center corresponds to `Custom Link`; Contact Us corresponds to `Contact Planner`. Do not substitute Website Navigation or raw Text without an explicit approved mapping.
- Link identity is a tuple of surface + rendered label/component model + exact destination + visibility. Label alone is insufficient.
- `Include? = No` is potentially destructive because it may imply removal/hiding. Since Delete/Remove is prohibited, report it as unsupported/review unless a proven non-destructive visibility control is explicitly authorized.
- Validate destinations as literal requested URLs. Do not repair, infer, follow redirects, or copy a destination from a different component/event.
- Footer privacy/cookie links may be platform/account-managed. If inspector scope is global, inherited, locked, or ambiguous, stop.
- Preserve all unrequested components, social links, layout containers, assets, styling, and order.

### Footer read-back contract

After a future separately authorized write:

1. Guard event UUID/name, then select and visibly assert `Default Header and Footer` (or the explicitly mapped confirmation surface).
2. Save once per surface only after all intended fields are deterministic; never Publish.
3. Wait for a concrete saved/clean state, then reload the same event-scoped Site Designer route.
4. Re-assert event and surface, inventory rendered labels, and open only the exact target component inspector.
5. Compare component model, label, literal destination, visibility, and surface. Also verify every untouched footer label remains present.
6. If the route resolves to Summary, inspector is absent/ambiguous, or rendered and inspector values disagree, report `FAIL`/`BLOCKED`; do not place a duplicate or retry Save.

## AI-assisted recovery (bounded, read-only safe)

1. Reopen the known direct route once and re-run the exact event guard.
2. Capture headings, accessible names, values, selected options, hrefs, and `data-cvent-id` attributes. Exclude any candidate containing destructive/publish/attendee/communication terms.
3. Event Details: recover by exact section heading + label and verify the candidate model name begins `EventInputModel.` or `EventDatesInputModel.` before promoting it.
4. Footer: recover the page selector first, require visible `Default Header and Footer`, then search within the canvas for exact rendered label. Never let AI choose a page/component by visual position.
5. If multiple exact labels exist, use component ancestry and inspector heading; if still ambiguous, stop for human review.
6. On stale DOM, page crash, timeout, sign-in, modal, missing event identity, or wrong surface: record URL, workspace ID, last successful guard, and extracted evidence; reconnect/reopen once only. Never navigate to another event, submit a form, place a component, or retry a Save.

## Discovery status

- Event Information View/Edit mapping: **PASS** (live, read-only).
- Registration Process/footer live traversal in this Steel session: **BLOCKED** after the page renderer crashed and subsequent CDP reconnect timed out.
- Footer rendered inventory and route/surface model: retained event-specific read-only evidence; inspector selectors/destinations: **NOT TESTED** and must remain review-gated.
- `deletePerformed: false`; `publishPerformed: false`; `formSubmitted: false`.
