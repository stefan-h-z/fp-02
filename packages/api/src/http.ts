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
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async push(request: PushRequest): Promise<PushResponse> {
    return this.post<PushResponse>("/api/v1/family/sync/push", request);
  }

  async pull(request: PullRequest): Promise<PullResponse> {
    return this.post<PullResponse>("/api/v1/family/sync/pull", request);
  }

  async snapshot(request: SnapshotRequest): Promise<SnapshotResponse> {
    return this.post<SnapshotResponse>("/api/v1/family/sync/snapshot", request);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const token = this.options.token();
    let response: Response;

    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(token === undefined ? {} : { authorization: "Bearer " + token }),
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
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

    return (await response.json()) as T;
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
