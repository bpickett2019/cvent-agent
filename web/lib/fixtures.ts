import type { Task } from "../../src/planner/plan";
import type { TaskStatus } from "../../src/run/orchestrator";
import type { EventSpec } from "../../src/spec/eventSpec";
import type { VerificationReport } from "../../src/verify/verifier";

export interface DashboardTask {
  task: Pick<Task, "id" | "kind" | "channel" | "label">;
  status: TaskStatus;
  detail: string | null;
  completedAt: string | null;
}

export interface DashboardRun {
  id: string;
  eventName: string;
  eventCode: string;
  templateName: string;
  owner: string;
  startedAt: string;
  completedAt: string | null;
  status: "passed" | "review" | "halted";
  report: VerificationReport | null;
  tasks: DashboardTask[];
  screenshots: Array<{ src: string; label: string; capturedAt: string }>;
  halt?: {
    taskLabel: string;
    reason: string;
    operatorGuidance: string;
    screenshot: string;
  };
}

export const initialSpec: EventSpec = {
  specVersion: "1.0",
  details: {
    name: "Med Trade 2027",
    code: "MEDTRADE27",
    description: "Annual home medical equipment conference and expo.",
    timezone: "America/New_York",
    start: "2027-03-02T14:00:00.000Z",
    end: "2027-03-04T22:00:00.000Z",
    format: "inPerson",
    venue: {
      name: "Kay Bailey Hutchison Convention Center",
      address1: "650 S Griffin Street",
      city: "Dallas",
      state: "TX",
      postalCode: "75202",
      country: "US",
    },
    templateEventId: "MEDTRADE-2026-PRODUCTION",
  },
  registrationTypes: [
    { key: "attendee", name: "Attendee", description: "Qualified HME providers and buyers" },
    { key: "exhibitor", name: "Exhibitor", description: "Exhibiting companies and booth staff" },
    { key: "speaker", name: "Speaker", description: "Conference faculty and moderators" },
  ],
  questions: [
    {
      key: "first-time",
      text: "Is this your first time attending Med Trade?",
      page: "show-questions",
      order: 1,
      answerType: "boolean",
      answerValues: [],
      required: true,
      visibility: { type: "always" },
    },
    {
      key: "product-interest",
      text: "Which product categories are you most interested in seeing?",
      page: "show-questions",
      order: 2,
      answerType: "multiSelect",
      answerValues: ["Mobility", "Respiratory", "Sleep", "Rehab", "Retail"],
      required: true,
      visibility: { type: "registrationTypes", registrationTypeKeys: ["attendee"] },
    },
    {
      key: "first-time-help",
      text: "Would you like information about the first-time attendee orientation?",
      page: "show-questions",
      order: 3,
      answerType: "boolean",
      answerValues: [],
      required: false,
      visibility: { type: "questionAnswer", questionKey: "first-time", matchingValues: ["true"] },
    },
  ],
  registration: {
    admissionItems: [
      {
        key: "expo-conference",
        name: "Expo + Conference Pass",
        description: "Full access to education and expo hall",
        price: 499,
        currency: "USD",
      },
    ],
    optionalItems: [
      { key: "workshop", name: "Power Mobility Workshop", price: 149, availableTo: ["expo-conference"] },
    ],
    vouchers: [
      { key: "association", code: "ASSOCIATION27", discountType: "percent", amount: 15, appliesTo: ["expo-conference"] },
    ],
    paths: [
      {
        key: "attendee-path",
        name: "Attendee Registration",
        admissionItemKeys: ["expo-conference"],
        isDefault: true,
        requiresApproval: false,
      },
    ],
    advancedRules: [],
    waitlistEnabled: false,
  },
};

const passedTasks: DashboardTask[] = [
  ...baseTasks("BDNY 2026"),
  task("reg.question.current-project", "reg.question.create", "browser", "Configure current project question"),
  task("reg.question.current-project.visibility", "reg.question.visibility", "browser", "Set current project visibility"),
  task("verify.registration", "verify.registration", "api", "Verify registration configuration"),
].map((item, index) => ({ ...item, status: "succeeded", detail: null, completedAt: `2027-01-12T15:${10 + index}:00.000Z` }));

const passReport: VerificationReport = {
  eventId: "evt-bdny-2027",
  specHash: "a18c7b42e199d2a1",
  passed: true,
  findings: [
    {
      severity: "warning",
      area: "registration",
      message: 'Cvent\'s API does not expose question visibility rules. The visibility rule for question "Are you sourcing for a current project?" (current-project) could not be verified programmatically; review it in the Cvent registration UI.',
    },
  ],
  siteVerifiedBy: "screenshot-review",
  checkedAt: "2027-01-12T15:24:00.000Z",
};

const blockingReport: VerificationReport = {
  eventId: "evt-surf-expo-2027",
  specHash: "114cc943cb89a4f0",
  passed: false,
  findings: [
    {
      severity: "blocking",
      area: "registration",
      message: 'Registration question "Which retail categories do you buy for?" was not created.',
      expected: "Question present on Show Questions",
      actual: "Question not returned by Cvent",
    },
    {
      severity: "blocking",
      area: "registration",
      message: 'Registration type "Retail Buyer" was not created.',
      expected: "Retail Buyer",
      actual: "Not found",
    },
    {
      severity: "warning",
      area: "registration",
      message: 'Cvent\'s API does not expose question visibility rules. The visibility rule for question "Annual purchasing volume" (purchase-volume) could not be verified programmatically; review it in the Cvent registration UI.',
    },
  ],
  siteVerifiedBy: "screenshot-review",
  checkedAt: "2027-02-03T19:42:00.000Z",
};

export const runs: DashboardRun[] = [
  {
    id: "RUN-BDNY-270112",
    eventName: "BDNY 2027",
    eventCode: "BDNY27",
    templateName: "BDNY 2026",
    owner: "Maya Chen",
    startedAt: "2027-01-12T15:08:00.000Z",
    completedAt: "2027-01-12T15:24:00.000Z",
    status: "passed",
    report: passReport,
    tasks: passedTasks,
    screenshots: [
      { src: "/screenshots/bdny-registration.svg", label: "Registration — Show Questions", capturedAt: "2027-01-12T15:20:00.000Z" },
      { src: "/screenshots/bdny-summary.svg", label: "Registration Summary", capturedAt: "2027-01-12T15:21:00.000Z" },
    ],
  },
  {
    id: "RUN-SURF-270203",
    eventName: "Surf Expo September 2027",
    eventCode: "SURFSEP27",
    templateName: "Surf Expo September 2026",
    owner: "Jordan Rivera",
    startedAt: "2027-02-03T19:18:00.000Z",
    completedAt: "2027-02-03T19:42:00.000Z",
    status: "review",
    report: blockingReport,
    tasks: [
      ...baseTasks("Surf Expo September 2026").map((item, index) => ({ ...item, status: "succeeded" as const, completedAt: `2027-02-03T19:${20 + index}:00.000Z` })),
      { ...task("reg.question.retail-category", "reg.question.create", "browser", "Configure retail category question"), status: "halted", detail: "The requested question was not visible after configuration.", completedAt: "2027-02-03T19:34:00.000Z" },
      { ...task("verify.registration", "verify.registration", "api", "Verify registration configuration"), status: "succeeded", detail: "Two items require correction.", completedAt: "2027-02-03T19:42:00.000Z" },
    ],
    screenshots: [
      { src: "/screenshots/surf-questions.svg", label: "Show Questions — operator review", capturedAt: "2027-02-03T19:39:00.000Z" },
    ],
  },
  {
    id: "RUN-MED-270218",
    eventName: "Med Trade 2027",
    eventCode: "MEDTRADE27",
    templateName: "Med Trade 2026",
    owner: "Alex Morgan",
    startedAt: "2027-02-18T14:02:00.000Z",
    completedAt: null,
    status: "halted",
    report: null,
    tasks: [
      ...baseTasks("Med Trade 2026").map((item, index) => ({ ...item, status: "succeeded" as const, completedAt: `2027-02-18T14:0${4 + index}:00.000Z` })),
      { ...task("reg.question.product-interest", "reg.question.create", "browser", "Configure product interest question"), status: "halted", detail: "Cvent did not show the expected answer-value controls.", completedAt: "2027-02-18T14:11:00.000Z" },
      { ...task("reg.question.product-interest.visibility", "reg.question.visibility", "browser", "Set product interest visibility"), status: "blocked", detail: "Waiting for the question to be completed.", completedAt: null },
      { ...task("verify.registration", "verify.registration", "api", "Verify registration configuration"), status: "skipped", detail: "Verification will run after retry.", completedAt: null },
    ],
    screenshots: [],
    halt: {
      taskLabel: "Configure product interest question",
      reason: "Cvent did not display the answer choices for this multiple-choice question.",
      operatorGuidance: "Open the question in Cvent and confirm that Multiple Choice is available, then retry this step.",
      screenshot: "/screenshots/medtrade-halt.svg",
    },
  },
];

function baseTasks(templateName: string): DashboardTask[] {
  return [
    task("event.shell", "event.copy", "api", `Clone ${templateName}`),
    task("event.details", "event.update", "api", "Apply current event details"),
    task("reg.type.attendee", "reg.registrationType.create", "browser", "Confirm Attendee registration type"),
  ];
}

function task(id: string, kind: string, channel: Task["channel"], label: string): DashboardTask {
  return {
    task: { id, kind, channel, label },
    status: "succeeded",
    detail: null,
    completedAt: null,
  };
}
