import { z } from "zod";
import { EventSpec } from "../spec/eventSpec";

export const RUN_EVENT_JOB_KIND = "event.run";

export const RunEventJobPayload = z
  .object({
    spec: EventSpec,
    operator: z
      .object({
        id: z.string().min(1),
        email: z.string().email(),
      })
      .strict(),
    requestedAt: z.string().datetime(),
  })
  .strict();

export type RunEventJobPayload = z.infer<typeof RunEventJobPayload>;

export const RunEventJobOutput = z
  .object({
    runId: z.string().min(1),
    eventId: z.string().nullable(),
    status: z.enum(["succeeded", "halted"]),
    triageSummary: z.string(),
  })
  .strict();

export type RunEventJobOutput = z.infer<typeof RunEventJobOutput>;
