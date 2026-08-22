import { describe, expect, it, vi } from "vitest";
import type {
  PluginContext,
  RequestContext,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import { withCache } from "../src/index.js";

function context(id: string): RequestContext {
  return {
    requestId: id,
    startTime: 1,
    meta: { tenant: "one" },
    state: {},
  };
}

function request(id = "1"): SendRequest {
  return { protocol: "acme-rpc", input: { id } };
}

function response(data: unknown, ok = true): UniversalResponse {
  return {
    protocol: "acme-rpc",
    ok,
    status: ok ? 0 : 13,
    statusText: ok ? "OK" : "FAILED",
    headers: { version: "1" },
    data,
    metadata: { source: "network" },
  };
}

const pluginContext = { config: {}, core: {} } as PluginContext;

describe("withCache", () => {
  it("caches a custom protocol and passes RequestContext to callbacks", async () => {
    const key = vi.fn(
      (req: SendRequest, ctx?: RequestContext) =>
        `${req.protocol}:${(req.input as { id: string }).id}:${ctx?.meta.tenant}`,
    );
    const shouldCache = vi.fn((_req: SendRequest, ctx?: RequestContext) => !!ctx);
    const shouldStoreResponse = vi.fn(
      (_res: UniversalResponse, _req: SendRequest, ctx?: RequestContext) =>
        ctx?.meta.tenant === "one",
    );
    const plugin = withCache({ key, shouldCache, shouldStoreResponse });
    plugin.setup?.(pluginContext);
    const req = request();
    const firstContext = context("first");

    expect(await plugin.onRequest?.(req, pluginContext, firstContext)).toBeUndefined();
    plugin.onResponse?.(response({ value: 42 }), req, pluginContext, firstContext);

    const hitContext = context("hit");
    const hit = await plugin.onRequest?.(req, pluginContext, hitContext);
    expect(hit).toMatchObject({ protocol: "acme-rpc", data: { value: 42 } });
    expect(hit).not.toBe(response);
    expect(shouldCache).toHaveBeenCalledWith(req, firstContext);
    expect(key).toHaveBeenCalledWith(req, firstContext);
    expect(shouldStoreResponse).toHaveBeenCalledWith(expect.anything(), req, firstContext);
  });

  it("coalesces in-flight requests and gives listeners independent responses", async () => {
    const plugin = withCache({ shouldCache: () => true, key: () => "same" });
    plugin.setup?.(pluginContext);
    const req = request();
    const firstContext = context("first");
    const secondContext = context("second");

    await plugin.onRequest?.(req, pluginContext, firstContext);
    const waiting = plugin.onRequest?.(req, pluginContext, secondContext);
    plugin.onResponse?.(response({ value: 1 }), req, pluginContext, firstContext);

    await expect(waiting).resolves.toMatchObject({ data: { value: 1 } });
  });

  it("rejects in-flight listeners on error and permits a later retry", async () => {
    const plugin = withCache({ shouldCache: () => true, key: () => "same" });
    plugin.setup?.(pluginContext);
    const req = request();
    const firstContext = context("first");
    const secondContext = context("second");
    const error = new Error("transport failed");

    await plugin.onRequest?.(req, pluginContext, firstContext);
    const waiting = plugin.onRequest?.(req, pluginContext, secondContext);
    plugin.onError?.(error, req, pluginContext, firstContext);
    await expect(waiting).rejects.toBe(error);

    expect(await plugin.onRequest?.(req, pluginContext, context("retry"))).toBeUndefined();
  });

  it("bypasses requests and responses rejected by callbacks", async () => {
    const key = vi.fn(() => "never");
    const bypass = withCache({ shouldCache: () => false, key });
    bypass.setup?.(pluginContext);
    const req = request();
    expect(await bypass.onRequest?.(req, pluginContext, context("bypass"))).toBeUndefined();
    expect(key).not.toHaveBeenCalled();

    const noStore = withCache({
      shouldCache: () => true,
      key: () => "same",
      shouldStoreResponse: () => false,
    });
    noStore.setup?.(pluginContext);
    const firstContext = context("first");
    await noStore.onRequest?.(req, pluginContext, firstContext);
    noStore.onResponse?.(response("network"), req, pluginContext, firstContext);
    expect(await noStore.onRequest?.(req, pluginContext, context("second"))).toBeUndefined();
  });

  it("preserves REST GET/HEAD success defaults and bypasses POST/error responses", async () => {
    const plugin = withCache();
    plugin.setup?.(pluginContext);
    const get: SendRequest = { protocol: "rest", input: { method: "get", url: "/items" } };
    const post: SendRequest = { protocol: "rest", input: { method: "POST", url: "/items" } };

    const getContext = context("get");
    await plugin.onRequest?.(get, pluginContext, getContext);
    plugin.onResponse?.(
      { ...response("failed", false), protocol: "rest" },
      get,
      pluginContext,
      getContext,
    );
    const successContext = context("get-again");
    expect(await plugin.onRequest?.(get, pluginContext, successContext)).toBeUndefined();
    plugin.onResponse?.(
      { ...response("ok"), protocol: "rest" },
      get,
      pluginContext,
      successContext,
    );
    expect(await plugin.onRequest?.(get, pluginContext, context("hit"))).toMatchObject({
      data: "ok",
    });
    expect(await plugin.onRequest?.(post, pluginContext, context("post"))).toBeUndefined();
  });
});
