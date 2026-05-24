import type {
  HyperPlugin,
  InternalRequest,
  HttpClientOptions,
  HttpResponse,
  PluginContext,
} from "@hyperttp/core";
import type { CacheManagerOptions } from "./types/cache.js";
import { CacheManager } from "./utils/CacheManager.js";

declare module "@hyperttp/core" {
  interface PluginContext {
    cache?: CacheManager;
  }
  interface HttpClientOptions {
    cache?: CacheManagerOptions & {
      enabled: boolean;
    };
  }
  interface HyperCore {
    clearCache(key?: string): void;
  }
}

function safeCloneResponse(response: any): any {
  if (!response) return response;

  const cloned: any = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers ? { ...response.headers } : {},
  };

  if (response.data !== undefined) cloned.data = structuredClone(response.data);
  if (response.body !== undefined) cloned.body = structuredClone(response.body);

  for (const key of Object.keys(response)) {
    if (
      key !== "headers" &&
      key !== "data" &&
      key !== "body" &&
      key !== "clone"
    ) {
      cloned[key] = response[key];
    }
  }

  Object.defineProperty(cloned, "clone", {
    value: function (this: any) {
      return safeCloneResponse(this);
    },
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return cloned;
}

export function withCache(): HyperPlugin {
  let cache: CacheManager;
  let allowedMethods: Set<string>;
  const inFlight = new Map<string, Promise<any>>();

  return {
    name: "hyperttp-cache",
    phase: "PREPARE",
    enabled: (config: HttpClientOptions) => !!config.cache?.enabled,

    setup(ctx: PluginContext) {
      const { core, config } = ctx;
      cache = new CacheManager(config?.cache);
      ctx.cache = cache;

      const methods = config?.cache?.methods ?? ["GET"];
      allowedMethods = new Set(methods.map((m: string) => m.toUpperCase()));

      if (core && typeof core.getStats === "function") {
        const originalGetStats = core.getStats;
        core.getStats = function (this) {
          const stats = originalGetStats.call(this);
          if (stats) {
            stats.cacheSize = cache.size;
          }
          return stats;
        };
      }

      core.clearCache = (key?: string) => {
        return key ? cache.delete(key) : cache.clear();
      };
    },

    wrapDispatch: (next) => {
      return <T>(req: InternalRequest): Promise<HttpResponse<T>> => {
        const method = req.method.toUpperCase();
        if (!allowedMethods.has(method)) {
          return next<T>(req);
        }

        const cacheKey = req.url;

        const cachedEntry = cache.getWithMetadata<HttpResponse<T>>(cacheKey);
        if (cachedEntry !== undefined) {
          if (!cachedEntry.etag && !cachedEntry.lastModified) {
            return Promise.resolve(safeCloneResponse(cachedEntry.data));
          }

          req.headers = { ...req.headers };
          if (cachedEntry.etag) req.headers["if-none-match"] = cachedEntry.etag;
          if (cachedEntry.lastModified)
            req.headers["if-modified-since"] = cachedEntry.lastModified;
        }

        if (inFlight.has(cacheKey)) {
          return inFlight.get(cacheKey)!;
        }

        const requestPromise = next<T>(req)
          .then((response) => {
            inFlight.delete(cacheKey);

            if (!response) return response;

            if (response.status === 304 && cachedEntry !== undefined) {
              return safeCloneResponse(cachedEntry.data);
            }

            if (response.status >= 200 && response.status < 300) {
              const valueToCache = safeCloneResponse(response);
              const headers = response.headers;
              const etag = headers?.["etag"] || headers?.["ETag"];
              const lastModified =
                headers?.["last-modified"] || headers?.["Last-Modified"];

              cache.setWithMetadata(cacheKey, valueToCache, {
                etag: typeof etag === "string" ? etag : undefined,
                lastModified:
                  typeof lastModified === "string" ? lastModified : undefined,
              });
            }

            return response;
          })
          .catch((err) => {
            inFlight.delete(cacheKey);
            throw err;
          });

        inFlight.set(cacheKey, requestPromise);
        return requestPromise;
      };
    },
  };
}
