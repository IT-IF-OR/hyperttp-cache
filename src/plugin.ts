import type { CacheManagerOptions, LightweightResponse } from "./types/cache.js";
import { CacheManager } from "hcacher";
import { createHttpResponse, createResponseSnapshot } from "./utils/createHttpResponse.js";
import type { HyperPlugin, RequestContext, SendRequest, UniversalResponse } from "@hyperttp/types";

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    cache?: CacheManagerOptions;
  }
}

interface InFlightTrigger {
  listeners: {
    resolve: (response: UniversalResponse<unknown>) => void;
    reject: (error: unknown) => void;
  }[];
}

function defaultCacheKey(request: SendRequest): string | undefined {
  try {
    return `${request.protocol}:${JSON.stringify({ input: request.input, metadata: request.metadata })}`;
  } catch {
    return;
  }
}

function defaultShouldCache(request: SendRequest): boolean {
  if (request.protocol !== "rest" || !request.input || typeof request.input !== "object") {
    return false;
  }

  const { method } = request.input as { method?: unknown };
  return typeof method === "string" && ["GET", "HEAD"].includes(method.toUpperCase());
}

function defaultShouldStoreResponse(response: UniversalResponse): boolean {
  return response.ok;
}

export function withCache(options?: CacheManagerOptions): HyperPlugin {
  if (options?.enabled === false) {
    return { name: "hyperttp-cache" };
  }

  let cache: CacheManager<LightweightResponse<unknown>>;
  const cacheKey = options?.key ?? defaultCacheKey;
  const shouldCache = options?.shouldCache ?? defaultShouldCache;
  const shouldStoreResponse = options?.shouldStoreResponse ?? defaultShouldStoreResponse;
  const inFlight = new Map<string, InFlightTrigger>();
  const requestKeys = new WeakMap<RequestContext, string>();

  function getRequestKey(request: SendRequest, context?: RequestContext): string | undefined {
    if (context) {
      const savedKey = requestKeys.get(context);
      if (savedKey) return savedKey;
    }

    const key = cacheKey(request, context);
    if (key && context) requestKeys.set(context, key);
    return key;
  }

  function takeRequestKey(request: SendRequest, context?: RequestContext): string | undefined {
    if (context) {
      const key = requestKeys.get(context);
      requestKeys.delete(context);
      return key;
    }

    return cacheKey(request, context);
  }

  return {
    name: "hyperttp-cache",

    setup() {
      cache = new CacheManager<LightweightResponse<unknown>>({
        maxSize: options?.maxSize ?? 1000,
        ttl: options?.ttl ?? 300_000,
        touchOnGet: options?.touchOnGet ?? true,
      });
    },

    onRequest(request, _, context) {
      if (!shouldCache(request, context)) return;

      const key = getRequestKey(request, context);
      if (!key) return;

      const cachedEntry = cache.getEntry(key);
      if (cachedEntry) {
        if (context) requestKeys.delete(context);
        return createHttpResponse(cachedEntry.data);
      }

      const currentInFlight = inFlight.get(key);
      if (currentInFlight) {
        return new Promise<UniversalResponse<unknown>>((resolve, reject) => {
          currentInFlight.listeners.push({ resolve, reject });
        });
      }

      inFlight.set(key, { listeners: [] });
    },

    onResponse(response, request, _, context) {
      if (!request) return;

      const key = context
        ? takeRequestKey(request, context)
        : shouldCache(request, context)
          ? takeRequestKey(request, context)
          : undefined;
      if (!key) return;

      const trigger = inFlight.get(key);
      const snapshot = createResponseSnapshot(response);
      if (shouldStoreResponse(response, request, context)) {
        cache.set(key, snapshot);
      }

      inFlight.delete(key);
      trigger?.listeners.forEach((listener) => listener.resolve(createHttpResponse(snapshot)));
    },

    onError(error, request, _, context) {
      if (!request) return;

      const key = context
        ? takeRequestKey(request, context)
        : shouldCache(request, context)
          ? takeRequestKey(request, context)
          : undefined;
      if (!key) return;

      const trigger = inFlight.get(key);
      if (trigger) {
        inFlight.delete(key);
        trigger.listeners.forEach((listener) => listener.reject(error));
      }
    },
  };
}
