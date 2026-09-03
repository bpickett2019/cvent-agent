import type { EventSpec, Question } from "../../src/spec/eventSpec";

export interface RRNormalizedPreview {
  event: { name: string | null; location: string | null; timezoneSource: string | null; expoDatesSource: string | null; conferenceDatesSource: string | null; themeSource: string | null };
  registrationTypes: Array<{ key: string; name: string; code: string }>;
  questions: Array<{ key: string; text: string; page?: "personal-information" | "show-questions"; answerType: string; answerValues?: string[]; required?: boolean; visibilitySource?: string }>;
  recognizedSheets: string[];
  ignoredSheets: string[];
  warnings: string[];
}

const answerTypes = new Set<Question["answerType"]>(["text", "textarea", "singleSelect", "multiSelect", "boolean", "number", "date", "datetime", "email", "phone", "fileUpload"]);

export function mergeRRPreview(seed: EventSpec, preview: RRNormalizedPreview): EventSpec {
  const spec = structuredClone(seed);
  if (preview.event.name) spec.details.name = preview.event.name;
  if (preview.event.location) spec.details.venue = { name: preview.event.location, address1: spec.details.venue?.address1 ?? "", city: spec.details.venue?.city ?? "", state: spec.details.venue?.state ?? "", postalCode: spec.details.venue?.postalCode ?? "", country: spec.details.venue?.country ?? "US" };
  if (preview.registrationTypes.length) spec.registrationTypes = preview.registrationTypes.map((value) => ({ key: value.key, name: value.name, description: "" }));
  if (preview.questions.length) spec.questions = preview.questions.map((value, index) => {
    const answerType = answerTypes.has(value.answerType as Question["answerType"]) ? value.answerType as Question["answerType"] : "text";
    return { key: value.key, text: value.text, page: value.page ?? "personal-information", order: index, answerType, answerValues: value.answerValues ?? [], required: value.required ?? false, visibility: { type: "always" } };
  });
  return spec;
}
