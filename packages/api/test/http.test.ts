import { describe, expect, it, vi } from "vitest";
import { AuthClient, HttpSyncTransport, SyncHttpError, clampGuestLinkDays, withRetry } from "@fam/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("sync transport", () => {
  it("sends the device token as the only credential", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ops: [], nextCursor: 0, hasMore: false }));
    const transport = new HttpSyncTransport({ baseUrl: "https://api.test/", token: () => "device-token", fetchImpl });

    await transport.pull({ familyId: "f", deviceId: "d", cursor: 0 });

    const [url, init] = fetchImpl.mock.calls[0]!;
    // A pull is a read: GET, with the cursor in the query string, which is what
    // the server's route declares and what makes a retry safe.
    expect(url).toBe("https://api.test/api/v1/family/sync/pull?familyId=f&deviceId=d&cursor=0");
    expect(init?.method).toBe("GET");
    // Its own header: a device token is this module's credential, not one of
    // the platform's OAuth tokens, and the platform guard must not see it.
    expect((init?.headers as Record<string, string>)["x-family-device-token"]).toBe("device-token");
    expect((init?.headers as Record<string, string>)["authorization"]).toBeUndefined();
  });

  it("treats an unreachable network as a retryable failure, not a lost write", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("ENOTFOUND");
    });
    const transport = new HttpSyncTransport({ baseUrl: "https://api.test", token: () => "t", fetchImpl });

    await expect(transport.push({ familyId: "f", deviceId: "d", ops: [] })).rejects.toMatchObject({
      status: 0,
      retryable: true,
    });
  });

  it("reports a rejected device token so the app can ask for re-approval", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 401));
    const transport = new HttpSyncTransport({ baseUrl: "https://api.test", token: () => "t", fetchImpl, onUnauthorized });

    await expect(transport.pull({ familyId: "f", deviceId: "d", cursor: 0 })).rejects.toBeInstanceOf(SyncHttpError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("does not retry a request the server refused on its merits", async () => {
    const error = new SyncHttpError(422, "/push", "bad request");
    expect(error.retryable).toBe(false);
  });
});

describe("retry", () => {
  it("gives up immediately on a non-retryable failure", async () => {
    const operation = vi.fn(async () => {
      throw new SyncHttpError(401, "/push", "nope");
    });

    await expect(withRetry(operation, { sleep: async () => {}, random: () => 0.5 })).rejects.toBeInstanceOf(SyncHttpError);
    expect(operation).toHaveBeenCalledOnce();
  });

  it("keeps trying while the failure is transient, then succeeds", async () => {
    let calls = 0;
    const operation = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new SyncHttpError(503, "/push", "unavailable");
      return "done";
    });

    const result = await withRetry(operation, { sleep: async () => {}, random: () => 0.5 });

    expect(result).toBe("done");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("spreads retries out, so a family's devices do not all return in step", async () => {
    const delays: number[] = [];
    const operation = vi.fn(async () => {
      throw new SyncHttpError(500, "/push", "boom");
    });

    await expect(
      withRetry(operation, { attempts: 4, baseDelayMs: 100, sleep: async (ms) => void delays.push(ms), random: () => 1 }),
    ).rejects.toBeInstanceOf(SyncHttpError);

    expect(delays).toEqual([150, 300, 600]);
  });
});

describe("guest links (SPEC decision 19)", () => {
  it("defaults to a week", () => {
    expect(clampGuestLinkDays(0)).toBe(7);
    expect(clampGuestLinkDays(Number.NaN)).toBe(7);
  });

  it("never issues a link that outlives a quarter", () => {
    expect(clampGuestLinkDays(365)).toBe(90);
  });

  it("keeps a deliberate choice in between", () => {
    expect(clampGuestLinkDays(30)).toBe(30);
  });
});

/**
 * The platform decides which app a request belongs to from the access token's
 * OAuth client — and a family device does not hold one. Its token is this
 * module's own credential, so the platform falls back to the `X-Client-Id`
 * header, and without it every family endpoint answers `app_context_missing`.
 * That failure is invisible to any test that mocks the server, which is why it
 * is asserted here rather than assumed.
 */
describe("the app a request belongs to (platform app context)", () => {
  it("sends the client id on sync calls, alongside the device token", async () => {
    const seen: Record<string, string> = {};
    const transport = new HttpSyncTransport({
      baseUrl: "https://example.test",
      token: () => "device-token",
      clientId: "client-abc",
      fetchImpl: async (_url, init) => {
        for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
          seen[key.toLowerCase()] = value;
        }
        return new Response(JSON.stringify({ accepted: [], rejected: [], conflicts: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await transport.push({ familyId: "fam-1", deviceId: "dev-1", ops: [] });

    expect(seen["x-client-id"]).toBe("client-abc");
    expect(seen["x-family-device-token"]).toBe("device-token");
  });

  it("sends the client id when redeeming an invitation, which has no token yet", async () => {
    const seen: Record<string, string> = {};
    const auth = new AuthClient({
      baseUrl: "https://example.test",
      clientId: "client-abc",
      fetchImpl: async (_url, init) => {
        for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
          seen[key.toLowerCase()] = value;
        }
        // The platform's real envelope: nested under `data`, in its own nouns.
        return new Response(JSON.stringify({
          data: {
            family: { id: "f" },
            person: { id: "p", name: "Ben" },
            device: { id: "d", token: "t" },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await auth.redeemInvite({ inviteToken: "tok", deviceName: "This device" });

    expect(seen["x-client-id"]).toBe("client-abc");
    expect(seen["authorization"]).toBeUndefined();
  });
});

/**
 * `fetch` in a browser refuses to run with a `this` that is not the window —
 * it throws "Illegal invocation". Storing the global on an instance and calling
 * it as `this.fetchImpl(...)` does exactly that, and Node's fetch does not mind,
 * so this failed only in a real browser: the web build could not reach the
 * backend at all, and the app showed its own "check your connection" message
 * for a connection that was fine.
 *
 * The stand-in below is what makes the difference visible in Node — it refuses
 * any receiver that is not the global, the way a browser's does.
 */
describe("the global fetch is bound, not merely referenced", () => {
  it("still works when the client calls it as one of its own methods", async () => {
    const realFetch = globalThis.fetch;
    const strict = function (this: unknown, ..._args: unknown[]): Promise<Response> {
      if (this !== globalThis && this !== undefined) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ops: [], nextCursor: 0, hasMore: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    globalThis.fetch = strict as unknown as typeof fetch;

    try {
      const transport = new HttpSyncTransport({
        baseUrl: "https://api.test",
        token: () => "device-token",
      });

      await expect(transport.pull({ familyId: "f", deviceId: "d", cursor: 0 })).resolves.toEqual({
        ops: [],
        nextCursor: 0,
        hasMore: false,
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
