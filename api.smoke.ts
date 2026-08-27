/** API client smoke tests. No live Cvent network — fetch is doubled. */

import {
  CventApi,
  REQUIRED_SCOPES,
  eventPublicationState,
  isPublishedStatus,
  isUnpublishedStatus,
} from "./src/cvent/api";

const EVENT_ID = "020c932b-59d7-484a-80e1-229f20d57a7e";
const CLIENT_ID = "test-client-id";

let failures = 0;
let checks = 0;
const check = (label: string, ok: boolean, detail = "") => {
  checks += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

console.log("\n[1] Status helpers");
check("Pending is unpublished", isUnpublishedStatus("Pending") && eventPublicationState("Pending") === "unpublished");
check("Pending is never published", !isPublishedStatus("Pending") && !isPublishedStatus("pending"));
check("Draft is unpublished", isUnpublishedStatus("Draft"));
check("Active is published", isPublishedStatus("Active") && !isUnpublishedStatus("Active"));
check("unknown status is neither", eventPublicationState("mystery") === "unknown");

console.log("\n[2] Least-privilege scopes");
const allScopes = [...REQUIRED_SCOPES.write, ...REQUIRED_SCOPES.read].join(" ");
check(
  "no contacts/attendees scopes",
  !/contact|attendee|invitee|registrant|address-book/i.test(allScopes),
  allScopes
);

console.log("\n[3] No activate/publish methods");
const proto = CventApi.prototype as unknown as Record<string, unknown>;
const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(new CventApi({ clientId: "x", clientSecret: "y" })));
check(
  "prototype has no activate/publish writers",
  !methodNames.some((name) => /^(activate|publish|goLive|launch)/i.test(name)),
  methodNames.join(",")
);
check("isDraft exists", typeof proto.isDraft === "function");
check("isUnpublished exists", typeof proto.isUnpublished === "function");

type Recorded = { url: string; method: string; headers: Record<string, string>; body: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeApi(eventBody: unknown, scope: string | null = null) {
  const recorded: Recorded[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw as Record<string, string>)) {
        headers[key.toLowerCase()] = value;
      }
    }
    recorded.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers,
      body: typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : "",
    });
    if (url.endsWith("/oauth2/token")) {
      return jsonResponse({
        access_token: "test-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope,
      });
    }
    if (url.includes(`/events/${EVENT_ID}`)) return jsonResponse(eventBody);
    return new Response("not found", { status: 404 });
  };
  const api = new CventApi({ clientId: CLIENT_ID, clientSecret: "test-secret" }, fetchImpl);
  return { api, recorded };
}

console.log("\n[4] Token request shape (null scope accepted)");
{
  const event = {
    id: EVENT_ID,
    title: "(C+D) Medtrade Testing Site",
    code: "TDNCS7DRXCM",
    status: "Pending",
  };
  const { api, recorded } = makeApi(event, null);
  const got = await api.getEvent(EVENT_ID);
  const tokenCall = recorded[0];
  const params = new URLSearchParams(tokenCall.body);
  check("token hits default /ea/oauth2/token", tokenCall.url === "https://api-platform.cvent.com/ea/oauth2/token");
  check("token is POST", tokenCall.method === "POST");
  check("token uses Basic auth", tokenCall.headers.authorization.startsWith("Basic "));
  check("grant_type=client_credentials", params.get("grant_type") === "client_credentials");
  check("client_id is in the form body", params.get("client_id") === CLIENT_ID);
  check("null scope is accepted", got.id === EVENT_ID);
  check("event title/code/status mapped", got.title === event.title && got.code === event.code && got.status === "Pending");
  check("Pending isDraft/isUnpublished", (await api.isDraft(EVENT_ID)) && (await api.isUnpublished(EVENT_ID)));
  check("Pending is not published", (await api.isPublished(EVENT_ID)) === false);
}

console.log("\n[5] Wrapped GET /events/{id} data envelope");
{
  const { api } = makeApi({
    data: {
      id: EVENT_ID,
      title: "(C+D) Medtrade Testing Site",
      code: "TDNCS7DRXCM",
      status: "Pending",
    },
  });
  const got = await api.getEvent(EVENT_ID);
  check("unwraps data envelope", got.status === "Pending" && got.code === "TDNCS7DRXCM");
  check("wrapped Pending is unpublished", await api.isDraft(EVENT_ID));
}

console.log(`\n${failures === 0 ? `ALL API CHECKS PASSED (${checks} checks)` : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
