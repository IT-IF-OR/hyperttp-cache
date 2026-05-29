import { describe, it, expect, vi, beforeEach } from "vitest";
import { withCache } from "../src/plugin";
import type {
  InternalRequest,
  HttpResponse,
  HyperttpError,
} from "@hyperttp/types";

describe("Cache Plugin Full Test Suite", () => {
  let plugin: ReturnType<typeof withCache>;
  let ctx: any;

  function createMockRunner(networkTransportMock: () => Promise<any>) {
    return async (req: InternalRequest) => {
      if (plugin.onRequest) {
        const shortCircuitResponse = await plugin.onRequest(req, ctx);
        if (shortCircuitResponse) {
          if (plugin.onResponse) {
            plugin.onResponse(shortCircuitResponse, req, ctx);
          }
          return shortCircuitResponse;
        }
      }

      try {
        const rawResponse = await networkTransportMock();

        if (plugin.onResponse) {
          plugin.onResponse(rawResponse, req, ctx);
        }
        return rawResponse;
      } catch (error) {
        if (plugin.onError) {
          plugin.onError(error as HyperttpError, req, ctx);
        }
        throw error;
      }
    };
  }

  function createMockResponse(
    data: Partial<HttpResponse<any>>,
  ): HttpResponse<any> {
    return {
      status: 200,
      headers: {},
      body: null,
      ...data,
      clone: function (this: any) {
        return createMockResponse({
          ...this,
          headers: { ...this.headers },
        });
      },
    } as HttpResponse<any>;
  }

  beforeEach(() => {
    plugin = withCache();
    ctx = {
      core: {
        getStats: () => ({}),
        clearCache: () => {},
      },
      config: {
        cache: {
          enabled: true,
          methods: ["GET"],
        },
      },
    };
  });

  it("should perform request once for concurrent calls (Deduplication)", async () => {
    plugin.setup?.(ctx);

    const transportMock = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return createMockResponse({ body: "dedup-payload" });
    });

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/concurrent",
      method: "GET",
      headers: {},
    } as InternalRequest;

    const results = await Promise.all(
      Array.from({ length: 50 }).map(() => dispatch(req)),
    );

    expect(transportMock).toHaveBeenCalledTimes(1);

    results.forEach((res) => {
      expect(res.body).toBe("dedup-payload");
    });
  });

  it("should serve from cache on subsequent calls without revalidation (No ETag)", async () => {
    plugin.setup?.(ctx);

    const transportMock = vi
      .fn()
      .mockResolvedValue(createMockResponse({ body: "static-payload" }));

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/pure-cache",
      method: "GET",
      headers: {},
    } as InternalRequest;

    await dispatch(req);

    const secondResponse = await dispatch(req);

    expect(transportMock).toHaveBeenCalledTimes(1);
    expect(secondResponse.body).toBe("static-payload");
  });

  it("should handle HTTP 304 Not Modified revalidation when ETag matches", async () => {
    plugin.setup?.(ctx);

    let callCount = 0;
    const transportMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({
          status: 200,
          headers: { etag: "v1" },
          body: "initial-heavy-data",
        });
      }
      return createMockResponse({
        status: 304,
        headers: { etag: "v1" },
        body: null,
      });
    });

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/revalidate-etag",
      method: "GET",
      headers: {},
    } as InternalRequest;

    await dispatch(req);

    const secondResponse = await dispatch(req);

    expect(transportMock).toHaveBeenCalledTimes(2);
    expect(req.headers["if-none-match"]).toBe("v1");
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body).toBe("initial-heavy-data");
  });

  it("should cleanly propagate network errors and unlock in-flight map", async () => {
    plugin.setup?.(ctx);

    const transportMock = vi
      .fn()
      .mockRejectedValue(new Error("Network connection breakdown"));

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/faulty-endpoint",
      method: "GET",
      headers: {},
    } as InternalRequest;

    await expect(dispatch(req)).rejects.toThrow("Network connection breakdown");

    await expect(dispatch(req)).rejects.toThrow("Network connection breakdown");
    expect(transportMock).toHaveBeenCalledTimes(2);
  });

  it("should correctly evaluate plugin activation via enabled method", () => {
    expect(plugin.enabled!({ cache: { enabled: true } })).toBe(true);
    expect(plugin.enabled!({ cache: { enabled: false } })).toBe(false);
    expect(plugin.enabled!({})).toBe(false);
  });

  it("should extend core with stats tracking and cache clearing capabilities", () => {
    let originalStatsCalled = false;
    ctx.core.getStats = () => {
      originalStatsCalled = true;
      return { nativeMetric: 100 };
    };

    plugin.setup?.(ctx);

    const stats = ctx.core.getStats();
    expect(originalStatsCalled).toBe(true);
    expect(stats?.nativeMetric).toBe(100);
    expect(stats?.cacheSize).toBe(0);

    const clearSpy = vi.spyOn(ctx.cache, "clear");
    const deleteSpy = vi.spyOn(ctx.cache, "delete");

    ctx.core.clearCache();
    expect(clearSpy).toHaveBeenCalledTimes(1);

    ctx.core.clearCache("custom-key");
    expect(deleteSpy).toHaveBeenCalledWith("custom-key");
  });

  it("should skip caching and short-circuit early for non-allowed HTTP methods", async () => {
    plugin.setup?.(ctx);
    const transportMock = vi.fn().mockResolvedValue(createMockResponse({}));
    const dispatch = createMockRunner(transportMock);

    const req = {
      url: "/api/submit",
      method: "POST",
      headers: {},
    } as InternalRequest;

    await dispatch(req);
    expect(transportMock).toHaveBeenCalledTimes(1);
  });

  it("should handle conditional validation via Last-Modified header", async () => {
    plugin.setup?.(ctx);

    let callCount = 0;
    const transportMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({
          status: 200,
          headers: { "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
          body: "timestamped-payload",
        });
      }
      return createMockResponse({ status: 304, headers: {}, body: null });
    });

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/last-modified-check",
      method: "GET",
      headers: {},
    } as InternalRequest;

    await dispatch(req);
    const secondResponse = await dispatch(req);

    expect(transportMock).toHaveBeenCalledTimes(2);
    expect(req.headers["if-modified-since"]).toBe(
      "Wed, 21 Oct 2015 07:28:00 GMT",
    );
    expect(secondResponse.body).toBe("timestamped-payload");
  });

  it("should transparently forward non-2xx/non-304 server responses without caching them", async () => {
    plugin.setup?.(ctx);

    const transportMock = vi
      .fn()
      .mockResolvedValue(
        createMockResponse({ status: 404, body: "Not Found" }),
      );

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/missing-page",
      method: "GET",
      headers: {},
    } as InternalRequest;

    const res = await dispatch(req);
    expect(res.status).toBe(404);
    expect(res.body).toBe("Not Found");
  });
});
