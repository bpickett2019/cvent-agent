# End-to-End UI Observation — 2026-09-02

## Run observed through Ego

- Local UI: `http://127.0.0.1:4320`
- Uploaded workbook: `BDNY_2026_BDE261_FINAL_RR_Doc_NEW_2.26.26_Converted_New_RR.xlsx`
- Authorized destination: `MOCK ONLY - Medtrade CVENT Agent E2E 2027`
- Destination UUID: `f58e1bf4-7559-437a-bab2-9210e3cf1895`
- Job: `d1bfe073-98ba-4bb5-8fc4-de69b9770528`
- Run: `87e0cb76-17c0-4fe8-8b9b-0414a10fb2bc`
- Result: `halted`

## Working

1. Workbook upload produced a preview.
2. `Apply reviewed values to form` populated the form and scrolled to the next section.
3. Actual question display text is now separate from stable internal keys.
4. Instructional voucher rows were removed; only `VIP2026` remained.
5. Selecting the exact authorized test destination enabled `Queue for execution`.
6. Queueing automatically navigated to Run Monitor.
7. A real isolated mutation Steel workspace appeared in Run Monitor.
8. No Delete, Remove, Publish, Go Live, communications, or attendee access occurred.

## Flaws found

### Critical — Run Review shows fixtures, not the real run
After the live job halted, the UI automatically navigated to Run Review, but displayed `BDNY 2027 · RUN-BDNY-270112` with a visible `Demo data` banner. It did not display job `d1bfe073-98ba-4bb5-8fc4-de69b9770528` or run `87e0cb76-17c0-4fe8-8b9b-0414a10fb2bc`.

Required fix: load Review and Triage from durable `.runs/<run-id>.json` and the queue record; carry the real job/run ID through navigation.

### Critical — Cvent writers are incomplete
The run did not create/reconcile the admission item, path, and 16 question values that verification reported missing or mismatched. Downstream tasks were blocked when Event Details halted.

Required fix: deterministic read/apply/read-back executors for admission items, registration types, paths, discounts, vouchers, and questions.

### Critical — Event-details exact guard failed in the worker clone
`event.details` halted with `Exact authorized event name was not visible before reconciliation.` The top-level Golden login badge still said `ready`, so the badge is not sufficient proof that the newly cloned workspace can see the authorized event.

Required fix: after cloning auth, probe the exact event route in that workspace; represent `AUTH_VERIFIED` only after the exact name and UUID are visible. Surface `WAITING_AUTH` otherwise.

### High — Converted RR still contains only part of the event contract
The uploaded workbook populated 51 of 107 contract fields. It provided 1 registration type and 29 questions. Missing source values cannot be inferred.

Required fix: show a permanent source-coverage table before Apply and require explicit review for fields absent from the workbook.

### High — Verification cannot prove admission items are event-scoped
The public API filter returned an account-wide admission-item collection. The run correctly excluded those rows, but it cannot verify event-local admission items through that API.

Required fix: use a proven event-scoped API contract or guarded Cvent UI read-back. Never restore account-wide matching.

### High — Site verification contains unresolved TODO selectors
`verify.site` halted because `src/procedures/site/capture-screenshots.yaml` still contains TODO selectors.

Required fix: implement proven event-scoped preview routes or omit the task when no executable site change exists.

### Medium — UI target selection overwrites imported event name
Selecting the authorized destination replaces imported `BDNY 2026` with the exact authorized destination name. This is required by the safety grant but obscures source-versus-destination identity.

Required fix: display separate immutable fields for `Source event name` and `Authorized destination name/UUID`.

### Medium — Run Monitor moved too quickly to review
The real mutation workspace disappeared before it could be opened after the job halted, and automatic navigation immediately exposed fixture review data.

Required fix: retain terminal workspace evidence and require an explicit `Review results` action, or navigate only after the real run receipt is loaded.

## Actual extracted data after fixes

- Imported source name: `BDNY 2026`
- Stable event code: absent in source; no sample code injected
- Registration types: 1
- Questions: 29 with actual display text
- Vouchers: 1 (`VIP2026`)
- Queue enabled after exact destination selection: yes

## Acceptance gate

Do not call the full workflow complete until one real uploaded workbook produces a terminal live receipt with:

- all executable tasks succeeded or explicitly not applicable;
- no required blocked tasks;
- exact destination stayed in scope;
- independent read-back for each mutation;
- destination remains Pending/unpublished;
- Review/Triage show the same real run ID;
- idempotent rerun performs zero unnecessary creates/saves.
