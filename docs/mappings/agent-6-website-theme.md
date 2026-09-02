# Agent 6 — Site Designer website/theme/header-footer/widget mapping

## Scope and evidence

- **Authorized event only:** `(C+D) Medtrade Testing Clone 2`
- **Event UUID:** `e712e34c-6117-4d13-bf4c-8ed54cf2b495`
- **Steel workspace:** `16e3966d-a179-486b-b343-125ddd66b5f2`
- **Runtime inspected:** Playwright over CDP at `ws://127.0.0.1:60326/`
- **Observed title:** `Site Designer`
- **Observed direct route:** `https://app.cvent.com/subscribers/events2/EventWebsite/EditWebsite/Index/View?evtstub=e712e34c-6117-4d13-bf4c-8ed54cf2b495`
- Read-only inspection only. No drag/drop, input, Save, theme Save, Publish, Create Path, Delete/Remove, attendee access, communication, or other-event access.
- Top-level Save remained disabled before and after all inspected navigation/selection states.

## Entry route and hard guard

Use the event-scoped Site Designer route:

```text
/subscribers/events2/EventWebsite/EditWebsite/Index/View?evtstub=e712e34c-6117-4d13-bf4c-8ed54cf2b495
```

Before every interaction assert all of:

```ts
expect(page.url()).toContain('evtstub=e712e34c-6117-4d13-bf4c-8ed54cf2b495');
expect(await page.title()).toBe('Site Designer');
await expect(page.locator('[data-cvent-id="nucleus-site-editor-site-header"]')).toBeVisible();
await expect(page.locator('[data-cvent-id="site-designer-save-button"]')).toBeDisabled();
```

Fail closed on a UUID mismatch, an absent site header, an unexpected modal, or an enabled Save at task start. Never infer the selected surface solely from URL/startSection parameters; assert the visible header name and type.

## Top-level Site Designer selectors

| Purpose | Stable selector / assertion |
|---|---|
| Surface/page selector | `[data-cvent-id="nucleus-site-editor-site-header"]` |
| Visible surface name | `[data-cvent-id="site-header-dropdown-text"]` |
| Publish (prohibited) | `[data-cvent-id="site-designer-publish-button"]` |
| Top-level Save (prohibited) | `[data-cvent-id="site-designer-save-button"]` |
| Device Preview | `[data-cvent-id="multi-device-preview"]` |
| More Actions (avoid) | `#more-action-button` |
| Close | `[data-cvent-id="site-designer-close-button"]` |
| Canvas | `[data-cvent-id="canvas-base"]` |
| Editable page content | `[data-cvent-id="page-renderer-editable-page-content"]` |
| Locked header overlay | `[data-cvent-id="page-renderer-locked-template-header"]` |
| Locked footer overlay | `[data-cvent-id="page-renderer-locked-template-footer"]` |
| Build tab | `[data-cvent-id="editor-panel-tab-EditorTabTypes.BUILD"]` |
| Sections tab | `[data-cvent-id="editor-panel-tab-EditorTabTypes.SECTION"]` |
| Theme tab | `[data-cvent-id="editor-panel-tab-EditorTabTypes.STYLE"]` |
| Settings tab | `[data-cvent-id="editor-panel-tab-EditorTabTypes.ARRANGE"]` |
| Breadcrumb | `[data-cvent-id^="nucleus-site-editor-footer-breadcrumb-"]` |

The primary header is `[data-cvent-id="nucleus-site-editor-primary-header"]`. Summary asserted as `Summary / WEBSITE PAGE`; Default Header and Footer asserted as `Default Header and Footer / HEADER AND FOOTER`.

## Surface/page menu

Open the page selector read-only with:

```ts
await page.locator('[data-cvent-id="nucleus-site-editor-site-header"]').click();
```

Observed registration paths: `Attendee & NONEX`, `Landing Path`, `Exhibitor`, `Internal`. Path switch options are `[data-cvent-id="option-0"]` through `option-3`; do not select a path unless it is part of the authorized read target.

Observed menu items and IDs:

- Personal Information: `regProcessStep1:f4fc583a-90f1-401d-a9f8-57305c4bfdd1`
- Admission Item: `regPage:bad01a4b-9017-4186-b565-fe8c3638fae3`
- Registration Summary: `regPage:ca30c98e-c040-45a2-842e-5ef63628b016`
- Payment: `regPage:0c02233b-9566-48bf-9e51-cad3876b428c`
- Confirmation: `confirmation:61be1918-5030-49c6-8ec5-b5b3f24c712b`
- Cancellation Form: `registrationCancellationPage:f3f1b3b3-c5b2-48ca-8fb4-4a0ceec04bfa`
- Decline Form: `registrationDeclinePage:b4b37d5e-2ebd-4b51-9169-fbfcd514f756`
- Guest Information: `guestRegistrationPage:0585b196-1408-4846-9885-e89e17ddcea2`
- Post-Registration Payment: `postRegistrationPayment:872feed7-1835-49c2-855c-1c470356fd76`
- Default Header and Footer: `template:0a4c67cb-cd3f-4f55-8b73-2915bc0b9558`
- Header and Footer 2 Confirmation: `template:6aed56db-b7c1-4514-99d7-5f26f5df6b26`
- Archived Event: `eventArchivePage`

`[data-cvent-id="add-registration-path"]` is Create Path and is prohibited. Reorder handles use `[data-cvent-id="reorder-handle"]`; never drag them.

## Website Summary and body widget map

Observed Summary canvas content included `REGISTER NOW`, event description, countdown, `EXHIBITOR RESOURCE CENTER`, `Already registered?`, registration deadline, and `CONTACT US`. Existing widget selectors/IDs:

- Header Website Navigation: `widget-WebsiteNavigator-widget:16c7d970-2b47-43bd-af30-091be9b4a1e2`
- Event description: `widget-EventDescription-widget:4bb55e0a-059f-40e3-885f-56862216ba4c`
- Countdown heading text: `widget-NucleusText-widget:cd33d43d-1df6-449e-8e53-4d7143f061a2`
- Countdown timer: `widget-EventCountdownTimer-widget:4d0f8043-9c23-4aad-b46d-352b156204b0`
- Custom link (`EXHIBITOR RESOURCE CENTER`): `widget-NucleusLinkButton-widget:c5dd0323-6403-46a8-bf59-523686d2d3e2`
- Registration deadline: `widget-RegistrationDeadline-widget:ac9e61c9-41fa-4b12-bd28-20be267f290b`
- Summary Contact Planner: `widget-ContactPlanner-widget:c69c0ff5-76ef-4362-8336-aff9bdc590c4`
- Footer text/links: `widget-NucleusText-widget:02394f8f-6793-4480-8d7e-e2318cc49904`
- Footer Follow Bar: `widget-FollowBar-widget:47ee9777-dba2-488a-9abe-410c10c63b2f`
- Footer Contact Planner: `widget-ContactPlanner-widget:4170a428-e6cb-4b1c-ba0d-a8a07fbb33a3`
- Cvent legal footer: `widget-EventFooter-CventFooterWidget`

Container assertions observed around the custom link/already-registered row:

```text
[data-cvent-id="section-sectionRow:1e234134-1c4c-418b-acf2-a9b2ff7af6b7"]
[data-cvent-id="containerParent"]
[data-cvent-id="containerChild"]
```

Build catalog selectors are deterministic:

- Event information: `widget-category-eventInformation-{EventHeader|EventDateTime|EventLocation|EventDescription|RegistrationDeadline}`
- Product information: `widget-category-productInformation-{AdmissionItems|AgendaV2|Speakers|Fees|AgendaAtAGlance|Exhibitors|Sponsors}`
- Additional content: `widget-category-fancyContent-{EventCountdownTimer|LocationMap|AttendeeList}`
- Text/visuals: `widget-category-customContent-{NucleusText|NucleusImage|NucleusImageCarousel|SocialMedia|ShareBar|FollowBar|Video|Code}`
- Buttons/links: `widget-category-buttonsAndLinks-{WebsiteNavigator|ContactPlanner|EventRegisterNow|AddToCalendar|NucleusLinkButton|AnchorLink|AlreadyRegistered}`
- Structure: `widget-category-structualElements-{NucleusEmptyCell|Section|NucleusDivider|Container}`

These catalog tiles are write-capable placement controls. Inventory text/availability only; do not click or drag in read-only mode. `Attendee List` is present but excluded by task scope and must not be opened.

## Theme panel

Open read-only using `[data-cvent-id="editor-panel-tab-EditorTabTypes.STYLE"]`. Observed theme: **`0 medtrade theme`**. Separate theme-level write controls exist and are prohibited:

- Change Theme: `[data-cvent-id="nucleus-site-editor-field-ChangeThemeButton"]`
- Save as: `[data-cvent-id="nucleus-site-editor-save-as-new-theme-button"]`
- Theme Save: `[data-cvent-id="nucleus-site-editor-save-theme-button"]`
- Reset Theme Styles: `[data-cvent-id="nucleus-site-editor-field-resetStyles"]`

Observed read-only menu items:

- Fonts: `nucleus-site-editor-menu-item-fontPalette`
- Colors: `nucleus-site-editor-menu-item-palette`
- Dimensions: `nucleus-site-editor-menu-item-dimensions`
- Site Background: `nucleus-site-editor-menu-item-backgroundNoKey`
- Header Background: `nucleus-site-editor-menu-item-titleBackground`
- Pop-Up Windows: `nucleus-site-editor-menu-item-dialog`
- Spinner: `nucleus-site-editor-menu-item-spinner`
- Header 1–4: `nucleus-site-editor-menu-item-elements.header1` … `.header4`
- Main/Alternative Text: `...elements.text1`, `...elements.text2`
- Paragraph/Alternative Paragraph: `...elements.body1`, `...elements.body2`
- Links: `...elements.link`
- Primary/Secondary button: `...elements.primaryButton`, `...elements.secondaryButton`
- Fields/Labels: `...elements.input`, `...elements.label`
- CSS Classes: `nucleus-site-editor-menu-item-customCSS`

Theme read-back assertion: breadcrumb index 1 equals `Theme`, visible panel contains `0 medtrade theme`, and top-level Save remains disabled. Do not use theme Save to “confirm” inspection.

## Header/footer surface and inspector states

Navigate by opening the page selector and clicking:

```ts
await page.locator('[data-cvent-id="template:0a4c67cb-cd3f-4f55-8b73-2915bc0b9558"]').click();
await expect(page.locator('[data-cvent-id="nucleus-site-editor-site-header"]'))
  .toContainText('Default Header and Footer');
await expect(page.locator('[data-cvent-id="nucleus-site-editor-site-header"]'))
  .toContainText('HEADER AND FOOTER');
```

Canvas markers on this surface:

- Header navigation section: `section-sectionRow:d6210425-f3a9-431a-b178-61f7b5d9ffc1`
- Responsive/CSS text section: `section-sectionRow:a3f36782-69ea-4e00-984b-3e97a6966092`
- Footer content section: `section-sectionRow:ae7485dd-de28-4945-aafd-440b4ee8de36`
- Cvent legal section: `section-CventFooterSection`

Rendered footer links/read-back:

- Show Hours → `https://example.com/mock`
- Show Policy → `https://example.com/mock-policy`
- Emerald Privacy Policy → `https://example.com/mock-privacy`
- Hotel Info → `https://example.com/mock-hotel`
- Browse Sessions → `https://example.com/mock-sessions`
- Review Pricing → `https://example.com/mock-pricing`
- FAQ → `https://example.com/mock-faq`
- Follow Bar exposes X and LinkedIn buttons.
- Cvent footer contains `Do Not Sell or Share My Personal Information` and `Manage Cookie Preferences`.

Selecting the existing footer Contact Planner was read-only and opened this inspector state:

- Breadcrumb: `Default Header and Footer > Build > Contact Planner`
- Inspector header: `[data-cvent-id="editor-panel-header-navItem"]` = `Contact Planner`
- Styling item: `[data-cvent-id="nucleus-site-editor-menu-item-style"]` = `Customize`
- `#buttonText` = `Contact Us`
- `#shared.firstName` = `Medtrade Show`
- `#shared.lastName` = `Team`
- `#shared.company` = `Mock Event Operations`
- `#shared.phoneNumber` = `+1 555 010 2608`
- Contact email read-back: `[data-cvent-id="appData.email-value"]` = `MedtradeShowTeam@medtrade.com`
- Display Email checkbox: `#appData.displayEmail_0`

Field wrappers use `[data-cvent-id="nucleus-site-editor-field-{fieldName}"]`. Selection itself did not enable top-level Save. Never type into these controls during read-only mapping.

## Read-back recipe

After every read-only navigation or component selection:

1. Re-assert the authorized `evtstub` and `Site Designer` title.
2. Read `[data-cvent-id="nucleus-site-editor-site-header"]`; require exact surface name and type.
3. Read breadcrumbs to confirm panel/inspector state.
4. Read canvas/container/widget text and current inputs via `inputValue()` only.
5. Assert `[data-cvent-id="site-designer-save-button"]` is still disabled.
6. Assert no dialog/modal is visible and no `Continue editing?` prompt appeared.
7. Do not click Save, theme Save, Publish, Reset Theme Styles, More Actions, Create Path, edit/settings icons, or reorder handles.

## Constraints and failure handling

- Never access any event other than UUID `e712e34c-6117-4d13-bf4c-8ed54cf2b495`.
- Never Delete/Remove, Publish, communicate, open attendees, submit forms, change input values, drag widgets/sections, or save.
- Treat an enabled Save at start as pre-existing draft state: stop and report; do not save, undo, restore, or remove.
- Clicking a Build catalog tile can create/activate a draft. For read-only inventory, extract its text/selector without activation.
- A `startSection=HeaderFooter` parameter is not sufficient proof of location. Require the visible `HEADER AND FOOTER` label before inspecting a header/footer component.
- Locked overlays on normal website pages indicate inherited header/footer content; use the dedicated header/footer surface for component inspection.

## Visual recovery hints

- If the right editor panel appears blank, verify the active breadcrumb and reselect the **tab**, not a catalog tile.
- If the page menu covers the canvas, press `Escape`; do not click outside near canvas widgets because that may select one.
- If a component selector appears twice (nested renderer nodes), use `.last()` only after confirming both share the same widget ID and visible text; never use coordinates.
- If header/footer is rendered as a locked overlay on Summary, open the surface selector and choose `template:0a4c67cb-cd3f-4f55-8b73-2915bc0b9558`, then assert `Default Header and Footer / HEADER AND FOOTER`.
- If the editor shows the Theme panel after switching surfaces, that is expected retained tab state; the surface assertion is independent of the active editor tab.
- If a modal, unsaved-draft prompt, enabled Save, auth wall, stale page, or event mismatch appears, stop without attempting cleanup or recovery writes.
