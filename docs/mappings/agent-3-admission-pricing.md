# Agent 3 — Admission Items and Pricing / Fees UI Map

## Authorization and run boundary

- **Only authorized event:** `(C+D) Medtrade Testing Clone 2`
- **Event UUID:** `e712e34c-6117-4d13-bf4c-8ed54cf2b495`
- **Steel workspace:** `4d1ec6cd-f79e-45b4-a1ff-8a5ba33d1b05`
- **Backend:** Steel Browser API `http://127.0.0.1:60273`, Playwright CDP `ws://127.0.0.1:60273/`
- This map is read-only. Never submit a form, invoke Save/Finish, Delete/Remove, Set Order, Import, Publish/Go Live, attendee, or communication controls. Never navigate to another event. Reject any route whose `evtstub`/`evtStub` is not the authorized UUID.

## Admission items

### Routes

| Surface | Event-local route |
|---|---|
| List | `/Subscribers/Events2/AgendaAndFees/AdmissionItemGrid/Index/?evtstub={eventId}` |
| Create (mapping only; do not submit) | `/subscribers/events2/AgendaAndFees/AdmissionItemDetails/Index/Add?evtstub={eventId}` |
| Detail | `/subscribers/events2/AgendaAndFees/AdmissionItemDetails?evtStub={eventId}&prodstub={admissionItemId}` |

Canonical host observed for legacy routes: `https://app.cvent.com`. Event overview is `https://events.app.cvent.com/events/home?evtstub={eventId}`.

### List procedure and selectors

1. Attach to the existing Steel browser; do not launch or replace the workspace browser.
2. Require the current URL to contain the exact event UUID and require the visible event name when the shell exposes it. Stop on mismatch.
3. Navigate directly to the guarded list route using a GET.
4. Wait for a visible table/grid and collect anchors matching:
   - `table a[href*="AdmissionItemDetails"][href*="prodstub="]`
5. Normalize each anchor's trimmed text as the displayed admission-item name; parse `prodstub` from its URL as immutable secondary identity.
6. Treat duplicate exact names, missing `prodstub`, or links carrying another `evtstub` as a blocking ambiguity.

Known list discovery found nine admission-item rows. Do not hard-code nine as a future invariant; enumerate the live guarded list and reconcile counts programmatically.

Stable semantic entry controls:

- Create: `button[name="Add"]`, accessible name **Create Admission Item**
- Item details: exact-name link under the selector above
- Do not use Set Order or row action menus in read-only mapping.

### Detail/create fields and dependencies

The admission-item surface owns the item identity and availability configuration. Procedure inputs should model:

- Name (required identity; exact trimmed comparison)
- Code/key (required stable business identity; exact comparison)
- Description
- Registration-type availability/assignment
- Availability/start and end dates, when enabled
- Capacity and any capacity-enabled toggle
- Item active/display/availability state where exposed
- Simple/default fee linkage (the fee itself is edited on the separate fee surface)

Dependencies:

1. Event identity and event-local route guard.
2. Exact item name/code uniqueness.
3. Registration types must already exist before assignment.
4. Date fields are conditional on their associated availability option.
5. Capacity value is conditional on capacity being enabled.
6. Fee rows depend on the admission item and event currency; do not infer currency.

Mapped form actions (for future approved procedures only):

- Finish/save selector: `button[name="Save"]` (visible label **Finish**)
- Cancel: `button[name="Cancel"]`
- Never use `button[name="SaveAndAdd"]` for bounded one-item execution.

### Admission-item read-back

After any separately authorized future write, verification must be independent:

1. GET the guarded list route.
2. Require exactly one exact-name link.
3. Parse and retain its `prodstub`.
4. GET the guarded details route and compare every requested field (name, code, description, assignments, dates, capacity, states).
5. Report only `PASS`, `FAIL`, `BLOCKED`, or `NOT TESTED`; a click or disabled Save is not success.

## Pricing / fees

### Routes and navigation surfaces

| Surface | Route |
|---|---|
| Pricing / Fees | `https://planner-registration-ui.app.cvent.com/pricing/fees?evtstub={eventId}` |
| Service Fees sibling | `https://app.cvent.com/Subscribers/Events2/AgendaAndFees/ServiceFeesGrid/Index/?evtstub={eventId}` |

Pricing top-level tabs:

- **Fees**
- **Discounts**
- **Service Fees**
- **EU E-invoice**

Fees item tabs:

- **Admission Items**
- **Sessions**
- **Session Bundles**
- **Quantity Items**

Use role/text locators for those tabs and re-check URL/event guard after navigation. The fees list also exposes search and a **Registration Type** filter.

### Fees list and selectors

Prefer semantic selectors because the pricing UI is a modern app:

- `getByRole('tab', { name: 'Fees' })`
- `getByRole('tab', { name: 'Admission Items' })`
- `getByText(<exact admission item name>, { exact: true })` scoped to the grid/group
- `getByText('Edit fee', { exact: true })` scoped to the target item group
- `getByRole('button', { name: /Cancel/i })` for closing an untouched editor

Do not use an unscoped first **Edit fee** in production. First resolve the exact item group by name and `prodstub`/group context, then locate its editor control.

Observed grid columns:

- Fee Name
- Base Price (USD)
- Early Bird Pricing
- Refund Policy
- Status
- Display

Rows are grouped by admission item and registration-type assignment. The default fee applies to all registration types unless a more specific fee row is assigned.

Actions visible on this surface include **Manage Fees**, **Create Fee**, item-level **Edit fee**, and per-fee action menus. In read-only mode, only opening a precisely scoped editor for inspection is permitted; close it with Cancel without changing values. Never invoke action-menu destructive controls.

### Fee editor fields

Modal title: **Edit admission item fee**.

Each fee row exposes:

- Default (radio)
- Fee Name (required text)
- Registration Type assignment picker (`Not assigned` when empty)
- Base Price (USD) (required currency input)
- Active checkbox
- Display checkbox
- Delete control (prohibited; may state `Cannot remove fee when registration is active`)
- **Create Fee** for another row (do not invoke during read-only discovery)
- **Save** and **Cancel**, plus a top-right close/cancel icon

Observed mapping example only: fee name `Fee`, base price `$1990`, Default=true, Active=true, Display=true. This is not a template or expected value.

### Tier/deadline and refund model

- Cvent represents early-bird pricing as repeated **If Registered By** deadline rows followed by an unlabeled/base price, not as named tiers with explicit start ranges.
- Verified example elsewhere in this authorized event: `Mock Admission Fee` on item code `MOCK057` has deadlines 09/15/2026 → $100, 09/30/2026 → $125, 10/25/2026 → $150, then base price $175.
- Member/non-member or other segmented prices require separate registration-type-specific fee rows.
- Early-bird and refund policy are summarized on the list. Their nested editors were not safely exposed in this read-only pass; treat them as separate, unresolved dependencies and never guess selectors or payload shape.

### Fee dependencies and constraints

1. Admission/session/bundle/quantity item must exist before its fee row.
2. Registration type must exist before a fee can be assigned to it.
3. Exactly one default row should cover otherwise-unassigned registration types.
4. Currency is event-configured and rendered as USD here; never infer or change it.
5. Deadline rows must be chronologically ordered and non-overlapping; the final base price follows the last deadline.
6. Fee creation is blocked when the published registration process lacks a Payment widget. The UI may instruct opening Site Designer to publish; **do not publish**.
7. Deletion/removal can be blocked while registration is active and is prohibited regardless.
8. Service Fees are a separate sibling surface; do not conflate them with admission-item fee rows.

### Pricing read-back

For each targeted admission item:

1. Re-open the guarded Pricing / Fees route.
2. Select **Fees** → **Admission Items**.
3. Resolve the exact item group; fail closed on duplicates.
4. Read grid summaries for fee name, base price/currency, early-bird summary, refund policy, status, and display.
5. Open the exact target item's **Edit fee** modal only if more detail is needed; read every row's default flag, name, registration-type assignment, base price, active, and display.
6. Close with Cancel and verify the list is visible again.
7. Reconcile the live editor rows against the requested pricing object. Never infer success from modal opening/closing.

## Safe Playwright skeleton

```ts
const EVENT = 'e712e34c-6117-4d13-bf4c-8ed54cf2b495';
const EVENT_NAME = '(C+D) Medtrade Testing Clone 2';
const browser = await chromium.connectOverCDP('ws://127.0.0.1:60273/');
const page = browser.contexts().flatMap(c => c.pages())
  .find(p => p.url().includes(EVENT));
if (!page) throw new Error('BLOCKED: authorized event page absent');
if (!page.url().includes(EVENT)) throw new Error('BLOCKED: event UUID mismatch');

await page.goto(`https://app.cvent.com/Subscribers/Events2/AgendaAndFees/AdmissionItemGrid/Index/?evtstub=${EVENT}`);
await page.waitForLoadState('domcontentloaded');
if (!page.url().includes(EVENT)) throw new Error('BLOCKED: event guard lost');
const rows = await page.locator('table a[href*="AdmissionItemDetails"][href*="prodstub="]').all();
// Read only. No fill(), check(), Save/Finish, Delete/Remove, or Publish.
```

Do not call `browser.close()` when attached to a shared/persistent Steel session unless the orchestrator explicitly owns and intends to terminate it; disconnect/exit the client instead.

## AI recovery and UI drift

1. **Event mismatch:** stop immediately; do not search across events.
2. **Auth/session expiry:** retain workspace ID and last verified URL, report `BLOCKED`, and resume only after authentication is restored.
3. **Changed selector:** use a semantic snapshot/DOM inspection to rediscover role, label, accessible name, and event-guarded href. Promote the new stable locator only after read-only verification.
4. **Duplicate/missing item identity:** stop rather than choosing a likely match.
5. **Unexpected modal or validation state:** do not type or save. Capture visible text, use Cancel/close if untouched, otherwise abandon by guarded GET navigation.
6. **Timeout/network error:** retry only a read-only GET or snapshot once after checking page health. Do not repeat an action click blindly.
7. **Page crash:** do not loop reconnect attempts. Confirm the Steel API health, preserve the last known workspace/session evidence, and request/recover a fresh browser target before resuming from the last verified surface.
8. **Create Fee blocked by Payment widget:** report the dependency. Never follow the instruction to publish or change Site Designer.
9. **Early-bird/refund editor unresolved:** mark `NOT TESTED`; do not extrapolate from list summaries.

## Discovery receipt

- Status: **PARTIAL / BLOCKED**
- The existing Steel CDP endpoint accepted a connection and the current authorized Admission Items page was reached. The first direct detail GET caused the page to crash; subsequent CDP attachment timed out even though `GET http://127.0.0.1:60273/` still returned the Steel Browser API health message.
- No fields were changed and no Save/Finish, Delete/Remove, Publish, communication, or attendee action was invoked.
- `deletePerformed: false`
- The routes/selectors/field model above reconcile the authorized event's retained read-only Admission Items and Pricing/Fees mappings; live detail-by-detail enumeration and nested early-bird/refund controls remain `NOT TESTED` in this Steel pass.
