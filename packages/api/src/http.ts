/**
 * The HTTP transport.
 *
 * The counterpart to the reference server: same three calls, same shapes, but
 * against the backend module. Everything above it — the sync client, the whole
 * app — cannot tell which one it is talking to, which is what lets the acceptance
 * suite run the real client against an in-process server.
 *
 * Two behaviours matter more than the wire format:
 *  - A failed request throws rather than returning a partial result, so the sync
 *    client keeps the work in its outbox and simply tries again (SPEC FR-1217).
 *  - The device token goes on every request and is the only credential; there is
 *    no password to expire and no session to renew (SPEC FR-112, FR-114).
 */
import type {
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  SnapshotRequest,
  SnapshotResponse,
  SyncTransport,
} from "@fam/sync";

export interface HttpTransportOptions {
  readonly baseUrl: string;
  /** Long-lived device token (SPEC FR-112). */
  readonly token: () => string | undefined;
  /**
   * The OAuth client this build is. A device token is this module's own
   * credential, not a platform access token, so the platform cannot read the
   * app off it and resolves the app from this header instead — without it every
   * sync call answers `app_context_missing`.
   */
  readonly clientId?: string;
  readonly fetchImpl?: typeof fetch;
  /** Injected so tests do not sleep. */
  readonly onUnauthorized?: () => void;
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "SyncHttpError";
  }

  /** Worth retrying unchanged: the request was fine, the network or server was not. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export class HttpSyncTransport implements SyncTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    // Bound to the global, not merely referenced. A browser's `fetch` throws
    // "Illegal invocation" when called with any other `this`, and storing it on
    // an instance and calling `this.fetchImpl(...)` does exactly that. Node's
    // fetch does not care, so every test passes and only a browser breaks — the
    // web build could not reach the backend at all until this was bound.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async push(request: PushRequest): Promise<PushResponse> {
    return this.post<PushResponse>("/api/v1/family/sync/push", request);
  }

  /**
   * Reads are GET, writes are POST — which is what the server's routes declare
   * and, less incidentally, what lets a pull be retried or cached without a
   * proxy having to guess whether it is safe.
   */
  async pull(request: PullRequest): Promise<PullResponse> {
    return this.get<PullResponse>("/api/v1/family/sync/pull", {
      familyId: request.familyId,
      deviceId: request.deviceId,
      cursor: String(request.cursor),
      ...(request.limit === undefined ? {} : { limit: String(request.limit) }),
    });
  }

  async snapshot(request: SnapshotRequest): Promise<SnapshotResponse> {
    return this.get<SnapshotResponse>("/api/v1/family/sync/snapshot", {
      familyId: request.familyId,
      deviceId: request.deviceId,
    });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("POST", path, body);
  }

  private get<T>(path: string, query: Record<string, string>): Promise<T> {
    return this.send<T>("GET", path + "?" + new URLSearchParams(query).toString());
  }

  private async send<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = this.options.token();
    let response: Response;

    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(this.options.clientId === undefined
            ? {}
            : { "x-client-id": this.options.clientId }),
          // Its own header rather than `Authorization: Bearer`. A device token
          // is this module's credential, not one of the platform's OAuth
          // tokens, and putting it where the platform's guard looks would have
          // that guard try to resolve it as a user and fail.
          ...(token === undefined ? {} : { "x-family-device-token": token }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      // Being offline is the normal case, not an error worth decorating.
      throw new SyncHttpError(0, path, "network unavailable");
    }

    if (response.status === 401) {
      this.options.onUnauthorized?.();
      throw new SyncHttpError(401, path, "device token rejected");
    }
    if (!response.ok) {
      throw new SyncHttpError(response.status, path, "request failed");
    }

    // The platform wraps every response in `data`; the sync protocol is defined
    // flat. Unwrapping here keeps that envelope out of the engine.
    const payload = (await response.json()) as { readonly data?: T };
    return payload.data ?? (payload as T);
  }
}

/**
 * Retry with exponential backoff and jitter.
 *
 * Every device in a family wakes on the same realtime event, so without jitter a
 * transient server error would bring them all back in step and keep it transient.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    readonly attempts?: number;
    readonly baseDelayMs?: number;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly random?: () => number;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof SyncHttpError ? error.retryable : true;
      if (!retryable || attempt === attempts - 1) break;
      await sleep(baseDelayMs * 2 ** attempt * (0.5 + random()));
    }
  }
  throw lastError;
}
