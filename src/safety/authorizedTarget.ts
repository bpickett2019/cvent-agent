import type { EventSpec } from "../spec/eventSpec";

export const AUTHORIZED_CVENT_EVENT = {
  eventId: "e712e34c-6117-4d13-bf4c-8ed54cf2b495",
  eventName: "(C+D) Medtrade Testing Clone 2",
} as const;

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
  if (
    spec.target?.mode !== "existingEvent" ||
    spec.target.eventId !== AUTHORIZED_CVENT_EVENT.eventId ||
    spec.target.eventName !== AUTHORIZED_CVENT_EVENT.eventName ||
    spec.details.name !== AUTHORIZED_CVENT_EVENT.eventName
  ) {
    return `Execution is restricted to the authorized Cvent clone ${AUTHORIZED_CVENT_EVENT.eventName} (${AUTHORIZED_CVENT_EVENT.eventId}).`;
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