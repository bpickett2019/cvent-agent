/**
 * Cvent Platform REST API client.
 *
 * Scope split, per the coverage research:
 *   WRITE  — events (create/copy/update), discounts
 *   READ   — admission items, registration paths/types, fee items, vouchers,
 *            questions, event status
 *   NONE   — the site designer. Theme, header, footer, pages, and widgets have
 *            no API surface and are browser-only.
 *
 * The read surface is doing heavy lifting: it powers verification and the
 * idempotency checks that make "retries resume from the failed step" real. It
 * is also an independent channel from the browser that performed the writes,
 * which is what makes the Draft-status post-check credible to an auditor.
 *
 * NOTE: request/response shapes below are provisional. Confirm against the
 * OpenAPI spec pulled with Emerald's credentials in Week 1 before trusting.
 */

const NA = "https://api-platform.cvent.com/ea";

export interface CventCredentials {
  clientId: string;
  clientSecret: string;
  /** Regional host; EU accounts differ. */
  baseUrl?: string;
}

/** Least-privilege set. Writes are deliberately narrow. */
export const REQUIRED_SCOPES = {
  write: ["event/events:write"],
  read: [
    "event/events:read",
    "event/admission-items:read",
    "event/registration-paths:read",
    "event/registration-types:read",
    "event/fee-items:read",
    "event/vouchers:read",
    "event/questions:read",
  ],
} as const;

interface Token {
  value: string;
  expiresAt: number;
}

export class CventApi {
  private token?: Token;
  private readonly base: string;

  constructor(private readonly creds: CventCredentials) {
    this.base = creds.baseUrl ?? NA;
  }

  /** Client credentials flow. Tokens last 60 minutes; refreshed at 55. */
  private async auth(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;

    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64");
    const res = await fetch(`${this.base}/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    if (!res.ok) throw new Error(`cvent auth failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 300) * 1000 };
    return this.token.value;
  }

  private async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.auth()}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    // Essentials tier is rate limited. Respect Retry-After rather than hammering.
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get("retry-after") ?? 2 ** attempt) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return this.request<T>(path, init, attempt + 1);
    }
    if (!res.ok) throw new Error(`cvent ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  /** Follows `paging.nextToken` to completion. */
  private async listAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let token: string | undefined;
    do {
      const url = token ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : path;
      const page = await this.request<{ data: T[]; paging?: { nextToken?: string } }>(url);
      out.push(...(page.data ?? []));
      token = page.paging?.nextToken;
    } while (token);
    return out;
  }

  /* ------------------------------------------------------------------ writes */

  async createEvent(input: Record<string, unknown>): Promise<{ id: string }> {
    return this.request("/events", { method: "POST", body: JSON.stringify(input) });
  }

  /**
   * Disabled legacy surface. Event copy must use the transport-injected
   * templateCopyContract after its provisional fixture has been verified.
   */
  async copyEvent(_templateEventId: string, _input: Record<string, unknown>): Promise<{ id: string }> {
    throw new Error("provisional Cvent template-copy contract is disabled on the live CventApi client");
  }

  async updateEvent(eventId: string, patch: Record<string, unknown>): Promise<void> {
    await this.request(`/events/${eventId}`, { method: "PATCH", body: JSON.stringify(patch) });
  }

  /* ------------------------------------------------------------------- reads */

  async getEvent(eventId: string): Promise<CventEvent> {
    return this.request(`/events/${eventId}`);
  }

  async listAdmissionItems(eventId: string): Promise<CventAdmissionItem[]> {
    return this.listAll(`/admission-items?eventId=${eventId}`);
  }

  async listRegistrationPaths(eventId: string): Promise<CventRegistrationPath[]> {
    return this.listAll(`/events/${eventId}/registration-paths`);
  }

  async listRegistrationTypes(eventId: string): Promise<CventRegistrationType[]> {
    return this.listAll(`/events/${eventId}/registration-types`);
  }

  /** The question read surface does not expose conditional visibility rules. */
  async listQuestions(eventId: string): Promise<CventQuestion[]> {
    return this.listAll(`/events/${eventId}/questions`);
  }

  async listFees(eventId: string): Promise<CventFee[]> {
    return this.listAll(`/fees?eventId=${eventId}`);
  }

  async listVouchers(eventId: string): Promise<CventVoucher[]> {
    return this.listAll(`/vouchers?eventId=${eventId}`);
  }

  /**
   * Independent Draft-status confirmation. Deliberately read through the API
   * rather than the browser that performed the writes.
   */
  async isDraft(eventId: string): Promise<boolean> {
    const event = await this.getEvent(eventId);
    return (event.status ?? "").toLowerCase() === "draft";
  }
}

/* --------------------------------------------------------- response shapes -- */

export interface CventEvent {
  id: string;
  title?: string;
  status?: string;
  start?: string;
  end?: string;
  timezone?: string;
}
export interface CventAdmissionItem {
  id: string;
  name: string;
  capacity?: number;
  price?: number;
  currency?: string;
}
export interface CventRegistrationPath {
  id: string;
  name: string;
  isDefault?: boolean;
  admissionItems?: { id: string }[];
}
export interface CventRegistrationType {
  id: string;
  key?: string;
  name: string;
  description?: string;
}
export interface CventQuestion {
  id: string;
  key?: string;
  text: string;
  page?: string;
  order?: number;
  answerType?: string;
  answerValues?: string[];
  required?: boolean;
  // Conditional visibility is not present on the known API read surface.
}
export interface CventFee {
  id: string;
  name?: string;
  amount?: number;
  currency?: string;
  itemId?: string;
}
export interface CventVoucher {
  id: string;
  code: string;
  discountType?: string;
  amount?: number;
  maxUses?: number;
}
