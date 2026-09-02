# Agent 5 — Questions, visibility, and conditional logic (read-only UI map)

## Authorization and evidence

- **Only event inspected:** `(C+D) Medtrade Testing Clone 2`
- **Event UUID:** `e712e34c-6117-4d13-bf4c-8ed54cf2b495`
- **Steel workspace/session:** `1cb43e1c-9cdc-434d-a821-d26a4ae5d0ec`, CDP `ws://127.0.0.1:60308/`
- **Inspection mode:** Playwright over CDP, UI-only and read-only.
- No Save, Publish, Delete, Hide, Duplicate, Move, Add, Create Question Tag, attendee/communication access, or other-event navigation was invoked. Selecting an existing canvas widget opened its inspector but did not dirty the editor; the top Save control remained disabled.

## Routes and registration-process placement

Registration Process landing route:

```text
https://app.cvent.com/Subscribers/Events2/RegistrationOption/RegistrationProcessPages/Index/?evtstub=e712e34c-6117-4d13-bf4c-8ed54cf2b495
```

Observed landing-path page IDs and direct Site Designer pattern:

```text
/subscribers/events2/EventWebsite/EditWebsite/Index/View
  ?evtstub={eventId}
  &startSection=Registration
  &startPage={pageType}:{pageId}
  &selectedRegPathId={pathId}
```

Observed selected path (`Landing Path`) ID: `b5b1682b-4b51-41e0-8874-6ad0c2243b34`.

| Surface | `startPage` |
|---|---|
| Personal Information | `regProcessStep1:f4fc583a-90f1-401d-a9f8-57305c4bfdd1` |
| Admission Item | `regPage:bad01a4b-9017-4186-b565-fe8c3638fae3` |
| Registration Summary | `regPage:ca30c98e-c040-45a2-842e-5ef63628b016` |
| Payment | `regPage:0c02233b-9566-48bf-9e51-cad3876b428c` |
| Confirmation | `confirmation:61be1918-5030-49c6-8ec5-b5b3f24c712b` |
| Cancellation Form | `registrationCancellationPage:f3f1b3b3-c5b2-48ca-8fb4-4a0ceec04bfa` |
| Decline Form | `registrationDeclinePage:b4b37d5e-2ebd-4b51-9169-fbfcd514f756` |
| Guest Information | `guestRegistrationPage:0585b196-1408-4846-9885-e89e17ddcea2` |

Registration paths shown on the landing page: `Landing Path`, `Attendee & NONEX`, `Exhibitor`, and `Internal`. Path tabs are anchors ending in `#`; their selection is JavaScript-driven. Re-read all Customize URLs after selecting a path rather than reusing IDs from another path.

## Question placement and inventory

Question placement catalog is under **Build > Registration > Registration Information > Questions**:

- Choice Question
- Matrix Question
- Text Question
- Number Question
- Date & Time Question
- Consent Question
- File Upload
- Add Existing Question

Question-like custom contact fields are separately listed under **Registration Information > Custom Contact Fields**. Do not conflate a custom contact field widget with a registration question: their persistence, reporting, and account/event scope differ.

On the inspected Personal Information canvas, an existing Text Question fixture rendered first:

- Display text: `Mock question for end-to-end automation testing`
- Widget ID: `widget:4a8a1515-b479-40d8-8d22-a75949e09285`
- Data hook: `[data-cvent-id="widget-OpenEndedTextQuestion-widget:4a8a1515-b479-40d8-8d22-a75949e09285"]`
- Answer/input ID: `671175d2-030c-4931-9b56-4c69a9cba7df`
- Not required (`aria-required="false"` and inspector checkbox unchecked)
- Text field, General answer format, no minimum/maximum values
- Code: `MOCKE2E001`
- Internal Note: `Mock E2E Question`
- Include in emails: `Only when answered`
- Lock field: unchecked

Other rendered question examples included choice, consent/policy, radio, multiselect-like, and text widgets. Required questions visibly render both a leading `*` and `This question is required.`. Several repeated labels and placeholder `Choice A` / `Choice B` values exist; text-only locators are therefore unsafe without a widget/container scope.

## Stable selectors and inspector fields

Prefer these semantic/data selectors over generated CSS module classes:

```text
#widget\:{widgetUuid} > [role="button"]
[data-cvent-id^="widget-"][data-cvent-id$="widget:{widgetUuid}"]
[data-cvent-id="label"]
[data-cvent-id="input"]
button[data-cvent-id="nucleus-site-editor-menu-item-questionTag"]
button[data-cvent-id="nucleus-site-editor-menu-item-productAssociationVisibilityLogic"]
button[data-cvent-id="nucleus-site-editor-menu-item-registrantSpecificVisibilityLogic"]
```

Observed inspector field IDs/names:

| UI field | Selector/key |
|---|---|
| Label Placement | `#appData\.question\.questionTypeInfo\.answerPlacementType` |
| Required | `#appData\.question\.additionalInfo\.required_0` |
| Text Field / Comment Box | `input[name="appData.question.questionTypeInfo.openEndedType"]` |
| Answer Format | `#appData\.question\.questionTypeInfo\.answerFormatType` |
| Minimum / Maximum | `#appData\.question\.questionTypeInfo\.min`, `#appData\.question\.questionTypeInfo\.max` |
| Question Code | `#appData\.question\.code` |
| Include in emails | `input[name="appData.question.additionalInfo.includeInDataTag"]` |
| Reporting | `#appData\.question\.text` |
| Internal Note | `#appData\.question\.note` |
| Lock field | `#accessSetting\.lockField_0` |
| Administrator Note | `#accessSetting\.adminNote` |

The Question Text editor is rich text and should be read from its rendered editor subtree/text, not assumed to be a normal input.

## Visibility and conditional logic UI

The question inspector exposes **Visibility Settings** with two separate dependency dimensions:

1. **Show for an Agenda Item**
   - Hook: `nucleus-site-editor-menu-item-productAssociationVisibilityLogic`
   - Panel explanatory text: `Limit visibility by admission item or session`.
   - Also warns that, when the path allows guests, the widget is shown for each guest and should be checked in Preview Mode outside Site Designer.
   - Dependency domain is admission item/session association, not registrant attributes.

2. **Show for Specific Registrants**
   - Hook: `nucleus-site-editor-menu-item-registrantSpecificVisibilityLogic`
   - Empty-state panel displayed `Registrants must meet:`, an `evaluationType` select, and `Add criteria`.
   - `#evaluationType` values observed: `0` = `all criteria`; alternate option = `any criteria`.
   - Each criterion is a dependency on a registrant/contact/registration attribute plus operator/value. Criteria rows only appear when configured or after the write-capable **Add criteria** action; this read-only run did not invoke it.

The fixture showed disabled/empty checkmarks for Question Tags, Agenda Item visibility, and Specific Registrant visibility, and both visibility subpanels had no configured dependency rows. Therefore the fixture is presently unrestricted by those inspector controls. Do not generalize that state to other rendered questions without selecting and reading each question independently.

### Question tags

- Hook: `nucleus-site-editor-menu-item-questionTag`
- Field: `#appData\.question\.questionTag`
- Empty state offered `Select Question Tag` and **Create Question Tag**.
- Tags support cross-event response analysis. **Create Question Tag is an account-level/write-capable action and is outside this mapping; never invoke it in read-only or event-local automation.**

## Dependency model for automation

Represent a question read-back independently from its visual order:

```json
{
  "eventId": "e712e34c-6117-4d13-bf4c-8ed54cf2b495",
  "registrationPathId": "...",
  "pageType": "regProcessStep1",
  "pageId": "...",
  "widgetId": "widget:...",
  "questionKind": "OpenEndedTextQuestion",
  "displayText": "...",
  "required": false,
  "code": "...",
  "internalNote": "...",
  "agendaVisibility": {"enabled": false, "items": []},
  "registrantVisibility": {"enabled": false, "evaluation": "all", "criteria": []},
  "questionTag": null
}
```

Dependency order for a future guarded write compiler:

1. Exact event UUID/name and exact registration path.
2. Target page identity (`startPage` type + page ID).
3. Existing question/widget identity or question kind for placement.
4. Choice values before any response-based criterion that references them.
5. Admission item/session existence before agenda visibility.
6. Registration/contact field and allowed operator/value before registrant criteria.
7. Save once only after the complete question + visibility payload is validated.

## Read-back and verification

Read-only discovery/read-back procedure:

1. Assert URL contains exactly the authorized UUID and title is `Site Designer`.
2. Assert visible page selector text and registration page/path match the intended target.
3. Inventory canvas widgets by container `id^="widget:"`; record data hook, rendered question text, answer control type/name, choices, and required markers.
4. Select one existing widget by scoped widget ID. This is a view-state action only; immediately assert top Save remains disabled.
5. Read inspector fields using exact IDs/names above.
6. Open each visibility subpanel and read enabled checkmark/state plus all existing criteria/associations. Do not click Add criteria, Create Question Tag, Hide, Delete, Duplicate, Move, Save, or Publish.
7. Reload/navigate away without saving after inspection. Re-open the same widget and compare the rendered + inspector values if independent read-back is required.
8. Treat preview behavior as a separate read-only check; do not submit a registration or manipulate attendee data.

For post-save verification in a separately authorized write run, success requires all of: top Save completion/state transition, reload, exact rendered question match, inspector field match, and exact visibility association/criteria match. A click or disabled Save alone is not proof.

## Constraints and failure boundaries

- Permanent blocks: Delete/Remove, Publish/Go Live, communications, attendee data, other events, account-global creation, and HTTP DELETE.
- Never use broad text clicks for `Save`, `Publish`, `Delete`, `Choice A`, or repeated question labels.
- CSS-module class suffixes are build-generated and unstable; use `data-cvent-id`, input names/IDs, roles, and a widget scope.
- Page/path IDs are event-local. Never copy them to another event or infer another path's IDs.
- The canvas can render placeholder choices alongside real choices; preserve exact observed values and do not infer configuration from visual order alone.
- Selecting a widget exposes destructive controls (`aria-label="Delete"`, `Hide`, duplicate/move actions). Presence is not authorization.
- The editor embedded `appProps` contains sensitive/transient runtime data; never log or persist that payload. Only read the minimal event ID/limit facts needed for guards.
- Observed event limit: up to 500 registration-path questions; custom logic conditions limit shown as 100 per registration path. Limits are runtime metadata, not permission to approach them.

## AI recovery strategy

1. **Re-guard:** On any unexpected route/title, stop; restore the exact authorized direct URL and re-assert event UUID + visible page/path.
2. **Fresh DOM:** After route/path/page/widget changes, take a fresh DOM snapshot. Never reuse element handles or generated IDs from an earlier page state except recorded event-local widget IDs verified as present.
3. **Selector fallback order:** exact `data-cvent-id` → exact inspector `name`/`id` → scoped role/name inside `#widget\:{uuid}` → bounded DOM inspection. Do not fall back to coordinates or unscoped text.
4. **Duplicate labels:** Resolve the widget container from the rendered label/control, then operate only inside that container. If more than one candidate remains, report ambiguity and stop.
5. **Missing subpanel:** Re-select the widget, verify inspector heading/type, then locate the exact menu hook. If absent, classify the question type as unsupported rather than guessing.
6. **Dirty editor:** If Save becomes enabled after a supposed read, do not save. Reload/leave the page and verify the original value on return; report the accidental dirty state.
7. **Dialogs/errors/session expiry:** Do not confirm. Capture the current URL, title, visible error, and last verified widget/page; stop for human recovery on auth, consent, or destructive confirmation.
8. **UI drift:** Use a bounded DOM inventory of buttons/inputs/data hooks and update selectors only after independently confirming the same semantics. Never use AI-generated clicks against a control whose mutability is unclear.
