/**
 * Event Spec — the single contract for an EmeraldX run.
 *
 * Nothing downstream reads the raw intake form. The form is validated into an
 * EventSpec; the planner, executor, and verifier all read only this.
 *
 * Field coverage here IS the Week 3 gate with Emerald. If a configuration
 * element is not expressible in this schema, the agent cannot produce it.
 *
 * `channel` annotations record whether a field is applied via the Cvent REST API
 * or the browser. Derived from the API coverage research; confirm against
 * Emerald's live account in Week 1 before treating as settled.
 */

import { z } from "zod";

/* ---------------------------------------------------------------- primitives */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #RRGGBB");
const Url = z.string().url();
const IsoDate = z.string().datetime({ offset: true });

/** Image referenced by upload id (drag-drop) or SharePoint path. */
export const ImageRef = z.discriminatedUnion("source", [
  z.object({ source: z.literal("upload"), assetId: z.string().min(1), alt: z.string().default("") }),
  z.object({ source: z.literal("sharepoint"), path: z.string().min(1), alt: z.string().default("") }),
]);

/* ------------------------------------------------------------- event details */
/* channel: API — POST/PATCH /ea/events (scope event/events:write)              */

export const EventDetails = z.object({
  name: z.string().min(1).max(200),
  code: z.string().optional(),
  description: z.string().default(""),
  timezone: z.string().min(1), // IANA, e.g. "America/Chicago"
  start: IsoDate,
  end: IsoDate,
  format: z.enum(["inPerson", "virtual", "hybrid"]),
  venue: z
    .object({
      name: z.string(),
      address1: z.string().default(""),
      city: z.string().default(""),
      state: z.string().default(""),
      postalCode: z.string().default(""),
      country: z.string().default("US"),
    })
    .optional(),
  /** Template event to clone from. API: copy event. */
  templateEventId: z.string().optional(),
});

/* --------------------------------------------------------------------- theme */
/* channel: BROWSER — no API surface for the site designer.                     */

export const Theme = z.object({
  templateName: z.string().min(1),
  palette: z.object({
    primary: Hex,
    secondary: Hex.optional(),
    accent: Hex.optional(),
    background: Hex.optional(),
    text: Hex.optional(),
  }),
  fontFamily: z.string().optional(),
});

/* ---------------------------------------------------------- header & footer */
/* channel: BROWSER                                                            */

export const Header = z.object({
  logo: ImageRef.optional(),
  bannerImage: ImageRef.optional(),
  title: z.string().default(""),
  subtitle: z.string().default(""),
  showEventDates: z.boolean().default(true),
  showLocation: z.boolean().default(true),
});

export const Footer = z.object({
  text: z.string().default(""),
  socialLinks: z
    .object({
      linkedin: Url.optional(),
      x: Url.optional(),
      instagram: Url.optional(),
      facebook: Url.optional(),
    })
    .default({}),
  contactEmail: z.string().email().optional(),
  links: z.array(z.object({ key: z.string().min(1), label: z.string().min(1), destination: Url.optional(), literalDestination: z.string().optional(), enabled: z.boolean(), appliesToPaths: z.array(z.string()).default([]) })).default([]),
});

/* -------------------------------------------------------------- body widgets */
/* channel: BROWSER — the six in-scope types per acceptance criterion #3.       */

export const Widget = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    heading: z.string().default(""),
    body: z.string(),
    alignment: z.enum(["left", "center", "right"]).default("left"),
  }),
  z.object({
    type: z.literal("image"),
    image: ImageRef,
    caption: z.string().default(""),
    fullWidth: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("video"),
    url: Url,
    caption: z.string().default(""),
  }),
  z.object({
    type: z.literal("button"),
    label: z.string().min(1),
    action: z.enum(["register", "externalUrl"]),
    url: Url.optional(),
  }),
  z.object({
    type: z.literal("agenda"),
    heading: z.string().default("Agenda"),
    showSpeakers: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("divider"),
    style: z.enum(["line", "space"]).default("line"),
  }),
]);

export const WebsitePage = z.object({
  /** Stable key used for idempotency and diffing. */
  key: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().optional(),
  showInNav: z.boolean().default(true),
  widgets: z.array(Widget).default([]),
});

/* -------------------------------------------------------------- registration */
/* channel: BROWSER for writes; API is READ-ONLY here and drives verification.  */

/** Registration types are attendee classifications, not admission products. */
export const RegistrationType = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  code: z.string().min(1).optional(),
  passDescription: z.string().optional(),
  appearsOn: z.string().optional(),
  admissionItemKeys: z.array(z.string().min(1)).optional(),
  pathKey: z.string().min(1).optional(),
  openForRegistration: z.boolean().optional(),
  autoOpensOn: z.string().optional(),
  autoClosesOn: z.string().optional(),
  capacity: z.number().int().nonnegative().optional(),
  canAddGuest: z.boolean().optional(),
});

export const QuestionVisibility = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }),
  z.object({
    type: z.literal("registrationTypes"),
    registrationTypeKeys: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("questionAnswer"),
    questionKey: z.string().min(1),
    matchingValues: z.array(z.string().min(1)).min(1),
  }),
]);

const ChoiceAnswerTypes = new Set(["singleSelect", "multiSelect"]);

export const QuestionPage = z.union([
  z.literal("personal-information"),
  z.literal("show-questions"),
  z.string().min(1), // Custom registration page key.
]);

export const Question = z
  .object({
    key: z.string().min(1),
    text: z.string().min(1),
    page: QuestionPage,
    order: z.number().int().nonnegative(),
    answerType: z.enum([
      "text",
      "textarea",
      "singleSelect",
      "multiSelect",
      "boolean",
      "number",
      "date",
      "datetime",
      "email",
      "phone",
      "fileUpload",
    ]),
    answerValues: z.array(z.string().min(1)).default([]),
    answerOptions: z.array(z.object({ code: z.string(), text: z.string().min(1) })).optional(),
    required: z.boolean().default(false),
    visibility: QuestionVisibility,
    determinesRegistrationTypeKey: z.string().min(1).optional(),
    trigger: z.object({ questionKey: z.string().min(1).nullable(), answerCode: z.string().nullable(), answerText: z.string().nullable(), raw: z.string().min(1) }).optional(),
  })
  .superRefine((question, ctx) => {
    if (ChoiceAnswerTypes.has(question.answerType) && question.answerValues.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answerValues"],
        message: `${question.answerType} questions require at least one answer value`,
      });
    }
  });

export const AdmissionItem = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  capacity: z.number().int().positive().optional(),
  price: z.number().nonnegative().default(0),
  currency: z.string().length(3).default("USD"),
  registrationTypeKeys: z.array(z.string().min(1)).optional(),
  openForRegistration: z.boolean().optional(),
  autoOpensOn: z.string().optional(),
  autoClosesOn: z.string().optional(),
  chargeFee: z.boolean().optional(),
  pricing: z.array(z.object({ name: z.string().min(1), starts: z.string().optional(), ends: z.string().optional(), memberPrice: z.number().nonnegative().nullable(), nonMemberPrice: z.number().nonnegative().nullable() })).optional(),
  legacyPricing: z.array(z.object({ registrationTypeCode: z.string().min(1), tierName: z.string().min(1), amount: z.number().nonnegative().nullable() })).optional(),
});

export const OptionalItem = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  price: z.number().nonnegative().default(0),
  capacity: z.number().int().positive().optional(),
  /** Admission item keys this option is offered to. Empty = all. */
  availableTo: z.array(z.string()).default([]),
});

export const Voucher = z.object({
  key: z.string().min(1),
  code: z.string().min(1),
  /** Percent (0-100) or fixed amount in the item currency. */
  discountType: z.enum(["percent", "fixed"]),
  amount: z.number().nonnegative(),
  maxUses: z.number().int().positive().optional(),
  appliesTo: z.array(z.string()).default([]),
  alertEmail: z.string().email().optional(),
  description: z.string().optional(),
  capacity: z.number().int().nonnegative().optional(),
});

export const Discount = z.object({
  key: z.string().min(1), name: z.string().min(1), code: z.string().min(1),
  discountType: z.enum(["percent", "fixed"]), amount: z.number().nonnegative(),
  method: z.enum(["percent", "amount"]).optional(),
  effectiveFrom: z.string().optional(), effectiveTo: z.string().optional(),
  capacity: z.number().int().nonnegative().optional(), stackable: z.boolean().optional(), usableBy: z.string().optional(),
  countGuestsTowardCapacity: z.boolean().optional(), active: z.boolean().optional(),
  admissionItemKeys: z.array(z.string()).default([]), optionalItemKeys: z.array(z.string()).default([]),
});

export const RegistrationPath = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  /** Admission item keys reachable on this path. */
  admissionItemKeys: z.array(z.string()).min(1),
  isDefault: z.boolean().default(false),
  requiresApproval: z.boolean().default(false),
  privacy: z.enum(["public", "private"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  redirectUrl: Url.optional(),
});

export const AdvancedRule = z.object({
  key: z.string().min(1),
  description: z.string().min(1),
  /** Left deliberately loose in v1 — Week 1 ops interviews define the vocabulary. */
  when: z.record(z.unknown()),
  then: z.record(z.unknown()),
});

export const Registration = z.object({
  admissionItems: z.array(AdmissionItem).default([]),
  optionalItems: z.array(OptionalItem).default([]),
  vouchers: z.array(Voucher).default([]),
  discounts: z.array(Discount).optional(),
  paths: z.array(RegistrationPath).default([]),
  advancedRules: z.array(AdvancedRule).default([]),
  capacity: z.number().int().positive().optional(),
  waitlistEnabled: z.boolean().default(false),
});

/* ------------------------------------------------------------------ the spec */

export const EventSpec = z
  .object({
    specVersion: z.literal("1.0"),
    /** Explicit existing-event boundary. Queue/worker safety validates the authorized clone. */
    target: z.discriminatedUnion("mode", [
      z.object({
        tenantId: z.string().min(1),
        accountId: z.string().min(1),
        eventId: z.string().uuid(),
        eventName: z.string().min(1),
        templateEventId: z.never().optional(),
        templateEventName: z.never().optional(),
        newEventName: z.never().optional(),
        newEventCode: z.never().optional(),
        mode: z.literal("existingEvent"),
      }).strict(),
      z.object({
        tenantId: z.string().min(1),
        accountId: z.string().min(1),
        templateEventId: z.string().uuid(),
        templateEventName: z.string().min(1),
        newEventName: z.string().min(1),
        newEventCode: z.string().min(1).optional(),
        eventId: z.never().optional(),
        eventName: z.never().optional(),
        mode: z.literal("copyTemplate"),
      }).strict(),
    ]).optional(),
    details: EventDetails,
    /** Usually inherited from templateEventId; include only when this run must change it. */
    theme: Theme.optional(),
    header: Header.optional(),
    footer: Footer.optional(),
    pages: z.array(WebsitePage).min(1).optional(),
    registrationTypes: z.array(RegistrationType).default([]),
    questions: z.array(Question).default([]),
    registration: Registration,
  })
  .superRefine((spec, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (new Date(spec.details.end) <= new Date(spec.details.start)) {
      issue(["details", "end"], "end must be after start");
    }

    const dupe = (label: string, keys: string[], path: (string | number)[]) => {
      const seen = new Set<string>();
      keys.forEach((k, i) => {
        if (seen.has(k)) issue([...path, i, "key"], `duplicate ${label} key "${k}"`);
        seen.add(k);
      });
    };

    dupe("page", (spec.pages ?? []).map((p) => p.key), ["pages"]);
    dupe("registration type", spec.registrationTypes.map((t) => t.key), ["registrationTypes"]);
    dupe("question", spec.questions.map((q) => q.key), ["questions"]);
    dupe("admission item", spec.registration.admissionItems.map((a) => a.key), [
      "registration",
      "admissionItems",
    ]);
    dupe("registration path", spec.registration.paths.map((p) => p.key), ["registration", "paths"]);

    // Referential integrity — cheaper to catch here than mid-run in Cvent.
    const registrationTypeKeys = new Set(spec.registrationTypes.map((t) => t.key));
    const questionsByKey = new Map(spec.questions.map((q) => [q.key, q]));
    spec.questions.forEach((question, i) => {
      if (question.visibility.type === "registrationTypes") {
        question.visibility.registrationTypeKeys.forEach((key) => {
          if (!registrationTypeKeys.has(key)) {
            issue(
              ["questions", i, "visibility", "registrationTypeKeys"],
              `question "${question.key}" references unknown registration type "${key}"`
            );
          }
        });
      }

      if (question.visibility.type === "questionAnswer") {
        const gatingQuestion = questionsByKey.get(question.visibility.questionKey);
        if (!gatingQuestion) {
          issue(
            ["questions", i, "visibility", "questionKey"],
            `question "${question.key}" references unknown prior question "${question.visibility.questionKey}"`
          );
        } else if (gatingQuestion.order >= question.order) {
          issue(
            ["questions", i, "visibility", "questionKey"],
            `conditioning question "${gatingQuestion.key}" must come earlier than question "${question.key}"`
          );
        }
      }
    });

    const admissionKeys = new Set(spec.registration.admissionItems.map((a) => a.key));
    spec.registration.paths.forEach((p, i) =>
      p.admissionItemKeys.forEach((k) => {
        if (!admissionKeys.has(k)) {
          issue(["registration", "paths", i], `path "${p.key}" references unknown admission item "${k}"`);
        }
      })
    );
    spec.registration.optionalItems.forEach((o, i) =>
      o.availableTo.forEach((k) => {
        if (!admissionKeys.has(k)) {
          issue(["registration", "optionalItems", i], `unknown admission item "${k}"`);
        }
      })
    );

    const defaults = spec.registration.paths.filter((p) => p.isDefault);
    if (spec.registration.paths.length > 0 && defaults.length !== 1) {
      issue(["registration", "paths"], `exactly one default path required, found ${defaults.length}`);
    }

    (spec.pages ?? []).forEach((page, pi) =>
      page.widgets.forEach((w, wi) => {
        if (w.type === "button" && w.action === "externalUrl" && !w.url) {
          issue(["pages", pi, "widgets", wi], "externalUrl button requires a url");
        }
      })
    );
  });

export type EventSpec = z.infer<typeof EventSpec>;
export type WebsitePage = z.infer<typeof WebsitePage>;
export type Widget = z.infer<typeof Widget>;
export type Registration = z.infer<typeof Registration>;
export type RegistrationType = z.infer<typeof RegistrationType>;
export type Question = z.infer<typeof Question>;
export type QuestionVisibility = z.infer<typeof QuestionVisibility>;
export type QuestionPage = z.infer<typeof QuestionPage>;
