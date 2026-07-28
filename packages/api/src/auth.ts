/**
 * Joining a family, and staying joined (SPEC §4.2–4.4).
 *
 * The guiding rule is that a person signs in at most once per device and then
 * never again — the documented reason family apps fail is the second adult
 * forgetting their login and not coming back (SPEC §4.2). So there is no
 * password anywhere in this file, and nothing here can expire on its own.
 */
export type MemberRole = "adult" | "teen" | "child" | "guest" | "separated-parent";

export interface DeviceSession {
  readonly token: string;
  readonly deviceId: string;
  readonly familyId: string;
  /** Null on a shared device: the kitchen tablet is the household (FR-116). */
  readonly personId: string | null;
  readonly kiosk: boolean;
}

export interface InviteDetails {
  /** The invitation already carries name and role — the joiner fills in nothing (FR-118). */
  readonly name: string;
  readonly role: MemberRole;
  readonly familyName: string;
  readonly expiresAt: string;
}

export interface CreateFamilyResult {
  readonly session: DeviceSession;
  /**
   * Shown exactly once, at family creation. It is the fallback for the family
   * that has no second adult to approve a new device (SPEC FR-120), so the UI
   * must push the person to write it down rather than tuck it away.
   */
  readonly recoveryCode: string;
}

export interface GuestLinkRequest {
  /** What the guest may see — a topic, never the whole family (FR-108). */
  readonly scope: readonly string[];
  readonly expiresInDays: number;
  readonly label: string;
}

export interface GuestLink {
  readonly url: string;
  readonly expiresAt: string;
  readonly scope: readonly string[];
}

/** SPEC decision 19: a week by default, a quarter at most, and never unlimited. */
export const GUEST_LINK_DEFAULT_DAYS = 7;
export const GUEST_LINK_MAX_DAYS = 90;

export function clampGuestLinkDays(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return GUEST_LINK_DEFAULT_DAYS;
  return Math.min(Math.round(days), GUEST_LINK_MAX_DAYS);
}

export interface AuthClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export class AuthClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AuthClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** One adult creates the family; everyone else joins by link (FR-118). */
  async createFamily(input: {
    readonly familyName: string;
    readonly personName: string;
    readonly deviceName: string;
  }): Promise<CreateFamilyResult> {
    return this.post<CreateFamilyResult>("/api/v1/family/families", input);
  }

  /** Read an invitation before redeeming it, so the joiner sees what they join. */
  async inspectInvite(inviteToken: string): Promise<InviteDetails> {
    return this.post<InviteDetails>("/api/v1/family/invites/inspect", { inviteToken });
  }

  async redeemInvite(input: {
    readonly inviteToken: string;
    readonly deviceName: string;
    readonly kiosk?: boolean;
  }): Promise<DeviceSession> {
    return this.post<DeviceSession>("/api/v1/family/invites/redeem", input);
  }

  /** Create an invitation carrying the name and role the inviter chose. */
  async createInvite(
    token: string,
    input: { readonly name: string; readonly role: MemberRole },
  ): Promise<{ readonly url: string; readonly expiresAt: string }> {
    return this.post("/api/v1/family/invites", input, token);
  }

  /** The normal recovery path: another adult approves the new device (FR-119). */
  async approveDevice(token: string, requestId: string): Promise<void> {
    await this.post("/api/v1/family/devices/approve", { requestId }, token);
  }

  /** The fallback when there is no second adult (FR-120). */
  async redeemRecoveryCode(input: {
    readonly familyId: string;
    readonly recoveryCode: string;
    readonly deviceName: string;
  }): Promise<{ readonly session: DeviceSession; readonly recoveryCode: string }> {
    return this.post("/api/v1/family/recovery/redeem", input);
  }

  /** Only where an address exists — joining never requires one (FR-121). */
  async requestMagicLink(email: string): Promise<void> {
    await this.post("/api/v1/family/recovery/magic-link", { email });
  }

  async listDevices(token: string): Promise<readonly { readonly id: string; readonly name: string; readonly lastSeenAt: string }[]> {
    return this.post("/api/v1/family/devices/list", {}, token);
  }

  /** Remote sign-out of a lost device (FR-122, SEC-01). */
  async revokeDevice(token: string, deviceId: string): Promise<void> {
    await this.post("/api/v1/family/devices/revoke", { deviceId }, token);
  }

  async createGuestLink(token: string, request: GuestLinkRequest): Promise<GuestLink> {
    return this.post("/api/v1/family/guest-links", { ...request, expiresInDays: clampGuestLinkDays(request.expiresInDays) }, token);
  }

  async revokeGuestLink(token: string, linkId: string): Promise<void> {
    await this.post("/api/v1/family/guest-links/revoke", { linkId }, token);
  }

  private async post<T>(path: string, body: unknown, token?: string): Promise<T> {
    const response = await this.fetchImpl(this.baseUrl + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(token === undefined ? {} : { authorization: "Bearer " + token }),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error("auth request failed: " + path + " (" + response.status + ")");
    }
    return (await response.json()) as T;
  }
}
