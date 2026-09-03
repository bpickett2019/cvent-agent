import { z } from "zod";

/**
 * Provisional Cvent event-copy contract.
 *
 * This module deliberately has no fetch/HTTP implementation. The endpoint and
 * payload must remain unusable until they are checked against a captured,
 * reviewed contract fixture and the caller explicitly enables that fixture.
 */
export const CVENT_TEMPLATE_COPY_CONTRACT_FIXTURE = "cvent-template-copy-provisional-v1" as const;

export interface CventContractRequest {
  method: "GET" | "POST";
  path: string;
  headers: Readonly<Record<string, string>>;
  body?: Readonly<Record<string, string>>;
}

export interface CventContractResponse {
  status: number;
  body: unknown;
}

export type CventTransport = (request: CventContractRequest) => Promise<CventContractResponse>;

const PendingOperation = z
  .object({
    operationId: z.string().trim().min(1),
    status: z.literal("pending"),
  })
  .strict();
export type CventPendingOperation = z.infer<typeof PendingOperation>;

const CompletedOperation = z.discriminatedUnion("status", [
  z.object({ operationId: z.string().trim().min(1), status: z.literal("succeeded"), eventId: z.string().trim().min(1) }).strict(),
  z.object({ operationId: z.string().trim().min(1), status: z.literal("failed"), code: z.string().trim().min(1).max(100) }).strict(),
]);
export type CventCompletedOperation = z.infer<typeof CompletedOperation>;

/** Polling policy (delay, backoff, timeout, and operation endpoint) is injected. */
export type CventOperationPoller = (operation: CventPendingOperation) => Promise<CventCompletedOperation>;

const CopyRequest = z
  .object({
    templateEventId: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().trim().min(1).max(256),
    event: z
      .object({
        title: z.string().trim().min(1).max(500),
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        timezone: z.string().trim().min(1).max(100),
      })
      .strict(),
  })
  .strict();
export type CventTemplateCopyRequest = z.infer<typeof CopyRequest>;

const EventResponse = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    status: z.string().trim().min(1),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    timezone: z.string().trim().min(1),
  })
  .strict();
export type CventTemplateCopyEvent = z.infer<typeof EventResponse>;

export interface CventTemplateCopyContract {
  copyTemplate(input: CventTemplateCopyRequest): Promise<CventTemplateCopyEvent>;
  getEvent(eventId: string): Promise<CventTemplateCopyEvent>;
}

export interface CventTemplateCopyContractOptions {
  transport: CventTransport;
  pollOperation: CventOperationPoller;
  verification?: {
    enabled: true;
    fixture: typeof CVENT_TEMPLATE_COPY_CONTRACT_FIXTURE;
  };
}

function parseResponse<T>(schema: z.ZodType<T>, response: CventContractResponse, expectedStatus: number, label: string): T {
  if (response.status !== expectedStatus) throw new Error(`${label} returned unexpected status ${response.status}`);
  const parsed = schema.safeParse(response.body);
  if (!parsed.success) throw new Error(`${label} returned an invalid response`);
  return parsed.data;
}

export function createCventTemplateCopyContract(options: CventTemplateCopyContractOptions): CventTemplateCopyContract {
  const verified = options.verification?.enabled === true && options.verification.fixture === CVENT_TEMPLATE_COPY_CONTRACT_FIXTURE;

  const getEvent = async (eventId: string): Promise<CventTemplateCopyEvent> => {
    const id = z.string().trim().min(1).max(200).safeParse(eventId);
    if (!id.success) throw new Error("invalid event id");
    const response = await options.transport({
      method: "GET",
      path: `/events/${encodeURIComponent(id.data)}`,
      headers: { accept: "application/json" },
    });
    return parseResponse(EventResponse, response, 200, "get event");
  };

  return {
    getEvent,
    async copyTemplate(input) {
      if (!verified) throw new Error("provisional Cvent template-copy contract is disabled pending a verified contract fixture");
      const parsed = CopyRequest.safeParse(input);
      if (!parsed.success) throw new Error("invalid template copy request");

      const { templateEventId, idempotencyKey, event } = parsed.data;
      const response = await options.transport({
        method: "POST",
        path: `/events/${encodeURIComponent(templateEventId)}/copy`,
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: event,
      });
      const operation = parseResponse(PendingOperation, response, 202, "copy event");
      const completed = CompletedOperation.parse(await options.pollOperation(operation));
      if (completed.status === "failed") throw new Error(`Cvent copy operation failed (${completed.code})`);
      return getEvent(completed.eventId);
    },
  };
}
