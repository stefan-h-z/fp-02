import { describe, expect, it, vi } from "vitest";
import { HttpSyncTransport, SyncHttpError, clampGuestLinkDays, withRetry } from "@fam/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("sync transport", () => {
  it("sends the device token as the only credential", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ops: [], nextCursor: 0, hasMore: false }));
    const transport = new HttpSyncTransport({ baseUrl: "https://api.test/", token: () => "device-token", fetchImpl });

    await transport.pull({ familyId: "f", deviceId: "d", cursor: 0 });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.test/api/v1/family/sync/pull");
    expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer device-token");
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
