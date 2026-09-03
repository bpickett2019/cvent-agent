import { EventSpec, type EventSpec as EventSpecType } from "../spec/eventSpec";

/** One conspicuous event-local object. Bailey removes it manually after certification. */
export const liveBoundedVoucherSpec: EventSpecType = EventSpec.parse({
  specVersion: "1.0",
  target: {
    tenantId: "emerald-pilot",
    accountId: "emerald-cvent",
    eventId: "e712e34c-6117-4d13-bf4c-8ed54cf2b495",
    eventName: "(C+D) Medtrade Testing Clone 2",
    mode: "existingEvent",
  },
  details: {
    name: "(C+D) Medtrade Testing Clone 2",
    description: "Join us for Medtrade March 2-4, 2026 at the Phoenix Convention Center.",
    timezone: "America/Denver",
    start: "2026-10-26T00:00:00-07:00",
    end: "2026-11-24T23:59:00-07:00",
    format: "hybrid",
    venue: {
      name: "Phoenix Convention Center",
      address1: "100 North 3rd Street",
      city: "Phoenix",
      state: "AZ",
      postalCode: "85004",
      country: "US",
    },
  },
  registrationTypes: [],
  questions: [],
  registration: {
    admissionItems: [],
    optionalItems: [],
    paths: [],
    advancedRules: [],
    discounts: [],
    vouchers: [{
      key: "HERMESQA260901",
      code: "HERMESQA260901",
      discountType: "fixed",
      amount: 0,
      appliesTo: [],
      description: "",
      capacity: 1,
      maxUses: 1,
    }],
    waitlistEnabled: false,
  },
});
