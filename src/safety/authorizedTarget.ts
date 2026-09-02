import type { EventSpec } from "../spec/eventSpec";

export const AUTHORIZED_CVENT_EVENT = {
  eventId: "e712e34c-6117-4d13-bf4c-8ed54cf2b495",
  eventName: "(C+D) Medtrade Testing Clone 2",
} as const;

export const AUTHORIZED_CVENT_EVENTS = [
  AUTHORIZED_CVENT_EVENT,
  {
    eventId: "f58e1bf4-7559-437a-bab2-9210e3cf1895",
    eventName: "MOCK ONLY - Medtrade CVENT Agent E2E 2027",
  },
] as const;

export function authorizedExecutionError(spec: EventSpec): string | null {
  if (spec.target?.mode === "copyTemplate") {
    if (
      spec.target.templateEventId !== AUTHORIZED_CVENT_EVENT.eventId ||
      spec.target.templateEventName !== AUTHORIZED_CVENT_EVENT.eventName ||
      spec.details.templateEventId !== AUTHORIZED_CVENT_EVENT.eventId ||
      spec.details.name !== spec.target.newEventName
    ) return `Template copy is restricted to ${AUTHORIZED_CVENT_EVENT.eventName} (${AUTHORIZED_CVENT_EVENT.eventId}).`;
    return null;
  }
  const target = spec.target;
  const authorizedEvent = target?.mode === "existingEvent"
    ? AUTHORIZED_CVENT_EVENTS.find((event) => event.eventId === target.eventId && event.eventName === target.eventName)
    : undefined;
  if (
    target?.mode !== "existingEvent" ||
    !authorizedEvent ||
    spec.details.name !== authorizedEvent.eventName
  ) {
    return `Execution is restricted to an explicitly authorized Cvent event (${AUTHORIZED_CVENT_EVENTS.map((event) => `${event.eventName} (${event.eventId})`).join(" or ")}).`;
  }
  if (spec.details.templateEventId) {
    return "Existing-event mode cannot create or copy an event; remove the template event ID before queueing.";
  }
  return null;
}

export function assertAuthorizedExecutionTarget(spec: EventSpec): void {
  const error = authorizedExecutionError(spec);
  if (error) throw new Error(error);
}