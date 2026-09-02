import type { EventSpec } from "../../../src/spec/eventSpec";
import type { FullRRCompilation } from "./full-rr";

/** Pure boundary adapter: projects normalized compiler sections into EventSpec. */
export function compileFullRRToEventSpec(seed: EventSpec, compiled: FullRRCompilation): EventSpec {
  const spec = structuredClone(seed);
  const { event, footer, paths, commerce, discounts, questions, legacyEvent, legacyRegistration, legacyFooter, legacyQuestions } = compiled.sections;
  const key = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const clean = <T extends object>(value: T): T => { for (const field of Object.keys(value) as Array<keyof T>) if (value[field] === undefined || value[field] === "") delete value[field]; return value; };
  const eventName = event.value.newEventName ?? legacyEvent.value.newEventName;
  if (eventName) spec.details.name = eventName;
  const venue = event.value.venue ?? legacyEvent.value.venue;
  if (venue) spec.details.venue = { ...venue, address1: "", postalCode: "", country: "US" };
  else if (legacyEvent.review.some((finding) => finding.field === "venue")) delete spec.details.venue;
  const dates = event.value.conferenceDates ?? event.value.expoDates ?? legacyEvent.value.conference ?? legacyEvent.value.expo;
  if (dates) { spec.details.start = isoDateTime(dates.start); spec.details.end = isoDateTime(dates.end); }
  const legacyLinks = legacyFooter.links.map((x) => clean({ key: `${x.key}-${x.applicability.kind}-${x.applicability.paths.join("-") || "all"}`, label: x.canonicalLabel ?? x.label, destination: isUrl(x.destination) ? x.destination : undefined, literalDestination: x.destination, enabled: x.include, appliesToPaths: x.applicability.paths.length ? x.applicability.paths : [x.applicability.kind] }));
  spec.footer = { ...(spec.footer ?? { text: "", socialLinks: {}, links: [] }), links: legacyLinks.length ? legacyLinks : footer.filter((x) => x.outcome !== "unsupported").map((x) => clean({ key: x.key, label: x.sourceLabel, destination: x.destination, enabled: x.include, appliesToPaths: [] })) };
  const admissionSource = commerce.admissionItems.length ? commerce.admissionItems : legacyRegistration.admissionItems.map((x) => ({ code: x.code, name: x.name, description: x.description, regTypeCodes: x.registrationTypeCodes, openForRegistration: true, autoOpensOn: "", autoClosesOn: "", capacity: null, chargeFee: true, confidence: x.outcome === "exact" ? "exact" as const : "review" as const, fields: {} as never }));
  const admission = new Map(admissionSource.map((x) => [x.code.toUpperCase(), key(x.code)]));
  const reg = new Map(commerce.registrationTypes.map((x) => [x.code.toUpperCase(), key(x.code)]));
  if (commerce.registrationTypes.length || legacyRegistration.admissionItems.length) {
    spec.registration.optionalItems = [];
    spec.registration.advancedRules = [];
  }
  spec.registrationTypes = commerce.registrationTypes.map((x) => clean({ key: key(x.code), code: x.code, name: x.name, description: x.description, passDescription: x.passDescription, appearsOn: x.appearsOn, admissionItemKeys: x.admissionItemCodes.map((c) => admission.get(c.toUpperCase()) ?? key(c)), pathKey: x.pathAssignment ? key(x.pathAssignment) : undefined, openForRegistration: x.openForRegistration, autoOpensOn: x.autoOpensOn || undefined, autoClosesOn: x.autoClosesOn || undefined, capacity: x.capacity ?? undefined, canAddGuest: x.canAddGuest }));
  spec.registration.admissionItems = admissionSource.map((x) => clean({ key: key(x.code), name: x.name, description: x.description, capacity: x.capacity ?? undefined, price: 0, currency: "USD", registrationTypeKeys: x.regTypeCodes.map((c) => reg.get(c.toUpperCase()) ?? key(c)), openForRegistration: x.openForRegistration, autoOpensOn: x.autoOpensOn || undefined, autoClosesOn: x.autoClosesOn || undefined, chargeFee: x.chargeFee, pricing: commerce.admissionItems.length ? commerce.pricing.tiers.map((t) => clean({ name: t.name, starts: t.starts || undefined, ends: t.ends || undefined, memberPrice: t.memberPrice, nonMemberPrice: t.nonMemberPrice })) : undefined, legacyPricing: legacyRegistration.pricing.filter((p) => p.admissionItemCode.toUpperCase() === x.code.toUpperCase()).map((p) => ({ registrationTypeCode: p.registrationTypeCode, tierName: p.tierName, amount: p.amount })) }));
  const pathNames = [...new Set(paths.map((x) => x.pathName))];
  spec.registration.paths = pathNames.length ? pathNames.map((name, index) => { const fields = paths.filter((x) => x.pathName === name); const get = (field: string) => fields.find((x) => x.sourceField === field)?.value ?? undefined; const privacy = get("privacy")?.toLowerCase(); const status = get("status")?.toLowerCase(); return clean({ key: key(name), name, admissionItemKeys: [...admission.values()], isDefault: index === 0, requiresApproval: false, privacy: privacy === "public" || privacy === "private" ? privacy : undefined, status: status === "active" || status === "inactive" ? status : undefined, redirectUrl: get("redirectUrl") }); }) : legacyRegistration.registrationPaths.map((path, index) => ({ key: key(path.name), name: path.name, admissionItemKeys: [...admission.values()], isDefault: index === 0, requiresApproval: false }));
  spec.registration.discounts = discounts.discounts.map((x) => clean({ key: key(x.code), name: x.name, code: x.code, discountType: x.method === "amount" ? "fixed" as const : "percent" as const, amount: x.amount, effectiveFrom: x.effectiveFrom, effectiveTo: x.effectiveTo, capacity: x.capacity, stackable: x.stackable, usableBy: x.usableBy, countGuestsTowardCapacity: x.countGuestsTowardCapacity, active: x.active, admissionItemKeys: x.admissionItemCodes.map((c) => admission.get(c) ?? key(c)), optionalItemKeys: x.optionalItemCodes.map(key) }));
  spec.registration.vouchers = discounts.vouchers.map((x) => clean({ key: key(x.code), code: x.code, discountType: "fixed" as const, amount: 0, maxUses: x.capacity && x.capacity > 0 ? x.capacity : undefined, appliesTo: [], alertEmail: x.alertEmail, description: x.description ?? "", capacity: x.capacity }));
  const semanticByName = new Map(questions.map((x) => [x.internalName, x]));
  const questionNames = legacyQuestions.length ? legacyQuestions.map((x) => x.internalName) : questions.map((x) => x.internalName);
  const legacyQuestionByName = new Map(legacyQuestions.map((x) => [x.internalName, x]));
  const questionKeyCounts = new Map<string, number>();
  spec.questions = questionNames.map((internalName, index) => {
    const x = semanticByName.get(internalName);
    const legacy = legacyQuestionByName.get(internalName);
    const answers = x?.answers ?? legacy?.answers.map((answer) => ({ code: answer.code, text: answer.text })) ?? [];
    const rawRegistrationCodes = legacy?.visibility.registrationTypeCodes.length ? legacy.visibility.registrationTypeCodes : x?.visibility.registrationTypeCodes ?? [];
    const registrationCodes = rawRegistrationCodes.filter((code) => reg.has(code.toUpperCase()));
    const trigger = legacy?.triggers[0] ?? x?.trigger;
    const seen = questionKeyCounts.get(internalName) ?? 0;
    questionKeyCounts.set(internalName, seen + 1);
    const questionKey = seen ? `${internalName}-${seen + 1}` : internalName;
    return clean({ key: questionKey, text: internalName, page: "personal-information" as const, order: index, answerType: answers.length ? "singleSelect" as const : "text" as const, answerValues: answers.map((a) => a.text), answerOptions: answers, required: legacy?.required.value ?? false, visibility: registrationCodes.length ? { type: "registrationTypes" as const, registrationTypeKeys: registrationCodes.map((c) => reg.get(c.toUpperCase())!) } : { type: "always" as const }, determinesRegistrationTypeKey: x?.determinesRegistrationType && reg.has(x.determinesRegistrationType.toUpperCase()) ? reg.get(x.determinesRegistrationType.toUpperCase()) : undefined, trigger: trigger ? { questionKey: "questionInternalName" in trigger ? trigger.questionInternalName : trigger.referencedQuestion, answerCode: "answer" in trigger ? trigger.answer?.code ?? null : trigger.referencedAnswer?.code ?? null, answerText: "answer" in trigger ? trigger.answer?.text ?? null : trigger.referencedAnswer?.text ?? null, raw: trigger.raw } : undefined });
  });
  return spec;
}
function isoDateTime(value: string): string { return /T/.test(value) ? `${value}Z` : `${value}T00:00:00Z`; }
function isUrl(value?: string): value is string { if (!value) return false; try { new URL(value); return true; } catch { return false; } }
