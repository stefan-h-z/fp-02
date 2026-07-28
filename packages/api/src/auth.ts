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

/**
 * What the backend actually returns.
 *
 * The platform wraps every response in `data` and answers with its own nouns —
 * `family`, `person`, `device` — rather than with the flat session this app
 * works in. These types exist so the translation happens once, at the seam,
 * instead of the shape leaking into the screens.
 */
interface DeviceBody {
  readonly family: { readonly id: string };
  readonly device: { readonly id: string; readonly token: string };
}

interface RedeemedInviteBody {
  readonly data: DeviceBody & { readonly person: { readonly id: string; readonly name: string } };
}

interface CreatedFamilyBody {
  readonly data: DeviceBody & {
    readonly person: { readonly id: string; readonly name: string };
    readonly recoveryCode: string;
  };
}

interface RedeemedRecoveryBody {
  readonly data: DeviceBody & { readonly recoveryCode: string };
}

export interface AuthClientOptions {
  readonly baseUrl: string;
  /**
   * The OAuth client this build is. The platform resolves which app a request
   * belongs to from the access token's client, and for the endpoints that have
   * no token yet — redeeming an invitation or a recovery code — from this
   * header instead. Without it every family endpoint answers
   * `app_context_missing`, so it is not optional in practice; it is optional
   * here only so tests can leave it out.
   */
  readonly clientId?: string;
  readonly fetchImpl?: typeof fetch;
}

export class AuthClient {
  private readonly baseUrl: string;
  private readonly clientId: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AuthClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.clientId = options.clientId;
    // Bound to the global, not merely referenced. A browser's `fetch` throws
    // "Illegal invocation" when called with any other `this`, and storing it on
    // an instance and calling `this.fetchImpl(...)` does exactly that. Node's
    // fetch does not care, so every test passes and only a browser breaks — the
    // web build could not reach the backend at all until this was bound.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * One adult creates the family; everyone else joins by link (FR-118).
   *
   * `platformToken` is the platform's own access token, from the magic link or
   * OTP that proved the address. This is the single endpoint in the whole app
   * that needs one — the route carries `auth:api` and `verified.email` — and
   * from here on the family never signs in again.
   */
  async createFamily(input: {
    readonly familyName: string;
    readonly personName: string;
    readonly deviceName: string;
    readonly platformToken?: string;
  }): Promise<CreateFamilyResult> {
    const body = await this.post<CreatedFamilyBody>(
      "/api/v1/family/families",
      { name: input.familyName, personName: input.personName, deviceName: input.deviceName },
      input.platformToken,
      { platform: true },
    );
    return {
      session: {
        token: body.data.device.token,
        deviceId: body.data.device.id,
        familyId: body.data.family.id,
        personId: body.data.person.id,
        kiosk: false,
      },
      recoveryCode: body.data.recoveryCode,
    };
  }

  /**
   * Read an invitation before redeeming it, so the joiner sees what they join.
   * Reading deliberately does not spend it: an invitation is single-use, and a
   * joiner who hesitates must not be locked out of their own family.
   */
  async inspectInvite(inviteToken: string): Promise<InviteDetails> {
    const body = await this.post<{ readonly data: InviteDetails }>(
      "/api/v1/family/invites/inspect",
      { token: inviteToken },
    );
    return body.data;
  }

  async redeemInvite(input: {
    readonly inviteToken: string;
    readonly deviceName: string;
    readonly kiosk?: boolean;
  }): Promise<DeviceSession> {
    const kiosk = input.kiosk ?? false;
    const body = await this.post<RedeemedInviteBody>("/api/v1/family/invites/redeem", {
      token: input.inviteToken,
      deviceName: input.deviceName,
      kiosk,
    });
    return {
      token: body.data.device.token,
      deviceId: body.data.device.id,
      familyId: body.data.family.id,
      // A kiosk device is the household rather than a person (FR-116). The
      // server issues the device either way and does not echo the flag, so the
      // request is what decides.
      personId: kiosk ? null : body.data.person.id,
      kiosk,
    };
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

  /**
   * The fallback when there is no second adult (FR-120).
   *
   * No family id travels with it: the code identifies the family by itself, so
   * asking a person to type an opaque id alongside it would be asking for
   * something they do not have.
   */
  async redeemRecoveryCode(input: {
    readonly recoveryCode: string;
    readonly deviceName: string;
  }): Promise<{ readonly session: DeviceSession; readonly recoveryCode: string }> {
    const body = await this.post<RedeemedRecoveryBody>("/api/v1/family/recovery/redeem", {
      code: input.recoveryCode,
      deviceName: input.deviceName,
    });
    return {
      session: {
        token: body.data.device.token,
        deviceId: body.data.device.id,
        familyId: body.data.family.id,
        // Recovery restores a device, not a person: which member it belongs to
        // is settled by the family afterwards.
        personId: null,
        kiosk: false,
      },
      recoveryCode: body.data.recoveryCode,
    };
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

  /**
   * `token` is a *device* token — this module's own credential, which the
   * backend reads from its own header. The one exception is creating a family,
   * which needs a platform access token and passes `platform: true`, because
   * that endpoint is guarded by the platform rather than by this module.
   */
  private async post<T>(
    path: string,
    body: unknown,
    token?: string,
    options?: { readonly platform?: boolean },
  ): Promise<T> {
    const response = await this.fetchImpl(this.baseUrl + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // Sent on every request, not only the unauthenticated ones. A device
        // token is this module's own credential rather than a platform access
        // token, so the platform cannot derive the app from it and falls back
        // to this header — which means "authenticated" requests need it too.
        ...(this.clientId === undefined ? {} : { "x-client-id": this.clientId }),
        ...(token === undefined
          ? {}
          : options?.platform === true
            ? { authorization: "Bearer " + token }
            : { "x-family-device-token": token }),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error("auth request failed: " + path + " (" + response.status + ")");
    }
    return (await response.json()) as T;
  }
}
