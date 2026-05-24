import { describe, it, expect, vi, beforeEach } from "vitest";
import { withCache } from "../src/plugin";
import type { InternalRequest } from "@hyperttp/core";

describe("Cache Plugin Full Test Suite", () => {
  let plugin: ReturnType<typeof withCache>;

  beforeEach(() => {
    plugin = withCache();
  });

  it("should perform request once for concurrent calls (Deduplication)", async () => {
    const ctx = {
      core: { getStats: () => ({}) },
      config: { cache: { enabled: true } },
    } as any;

    plugin.setup?.(ctx);

    const next = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        status: 200,
        headers: {},
        body: "payload",
        clone: function (this: any) {
          return { ...this };
        },
      } as any;
    });

    const req = {
      url: "/api/test",
      method: "GET",
      headers: {},
    } as InternalRequest;

    if (!plugin.wrapDispatch) throw new Error("wrapDispatch is undefined");

    const dispatch = plugin.wrapDispatch(next, ctx);

    const results = await Promise.all(
      Array.from({ length: 50 }).map(() => dispatch(req)),
    );

    expect(next).toHaveBeenCalledTimes(1);
    results.forEach((res: any) => {
      expect(res.body).toBe("payload");
    });
  });

  it("should serve from cache on subsequent calls without revalidation (No ETag)", async () => {
    const ctx = {
      core: { getStats: () => ({}) },
      config: { cache: { enabled: true } },
    } as any;
    plugin.setup?.(ctx);

    const next = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: "pure-cached",
      clone: function (this: any) {
        return { ...this };
      },
    } as any);

    const req = {
      url: "/api/cached",
      method: "GET",
      headers: {},
    } as InternalRequest;

    if (!plugin.wrapDispatch) throw new Error("wrapDispatch is undefined");
    const dispatch = plugin.wrapDispatch(next, ctx);

    await dispatch(req); // 1-й вызов
    const secondResponse = await dispatch(req); // 2-й вызов

    expect(next).toHaveBeenCalledTimes(1);
    expect((secondResponse as any).body).toBe("pure-cached");
  });

  it("should handle HTTP 304 Not Modified revalidation when ETag matches", async () => {
    const ctx = {
      core: { getStats: () => ({}) },
      config: { cache: { enabled: true } },
    } as any;
    plugin.setup?.(ctx);

    let callCount = 0;
    const next = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 200,
          headers: { etag: "hash123" },
          body: "initial-data",
          clone: function (this: any) {
            return { ...this };
          },
        } as any;
      }
      return {
        status: 304,
        headers: { etag: "hash123" },
        body: null,
      } as any;
    });

    const req = {
      url: "/api/etag-test",
      method: "GET",
      headers: {},
    } as InternalRequest;

    if (!plugin.wrapDispatch) throw new Error("wrapDispatch is undefined");
    const dispatch = plugin.wrapDispatch(next, ctx);

    await dispatch(req);
    const secondResponse = await dispatch(req);

    expect(next).toHaveBeenCalledTimes(2);
    expect(req.headers["if-none-match"]).toBe("hash123");
    expect((secondResponse as any).body).toBe("initial-data");
  });

  it("should not crash if response clone is not available", async () => {
    const ctx = {
      core: { getStats: () => ({}) },
      config: { cache: { enabled: true } },
    } as any;
    plugin.setup?.(ctx);

    const nextNoClone = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: "simple",
    } as any);

    const req = {
      url: "/api/no-clone",
      method: "GET",
      headers: {},
    } as InternalRequest;

    if (!plugin.wrapDispatch) throw new Error("wrapDispatch is undefined");
    await expect(
      plugin.wrapDispatch(nextNoClone, ctx)(req),
    ).resolves.toBeDefined();
  });
});
