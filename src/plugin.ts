import type {
  HyperPlugin,
  InternalRequest,
  HttpClientOptions,
  HttpResponse,
  PluginContext,
  Cloneable,
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

function isCloneable<T>(obj: any): obj is Cloneable<T> {
  return typeof obj?.clone === "function";
}

export function withCache(): HyperPlugin {
  let cache: CacheManager;
  let allowedMethods: Set<string>;

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
        if (!allowedMethods.has(req.method.toUpperCase())) {
          return next<T>(req);
        }

        const cacheKey = req.url;

        const cachedEntry = cache.getWithMetadata<HttpResponse<T>>(cacheKey);

        if (cachedEntry !== undefined) {
          if (cachedEntry.etag || cachedEntry.lastModified) {
            req.headers = { ...req.headers };
            if (cachedEntry.etag) {
              req.headers["if-none-match"] = cachedEntry.etag;
            }
            if (cachedEntry.lastModified) {
              req.headers["if-modified-since"] = cachedEntry.lastModified;
            }
          } else {
            return Promise.resolve(
              isCloneable(cachedEntry.data)
                ? cachedEntry.data.clone()
                : cachedEntry.data,
            );
          }
        }

        return next<T>(req).then((response) => {
          if (!response) return response;

          if (response.status === 304 && cachedEntry !== undefined) {
            return isCloneable(cachedEntry.data)
              ? cachedEntry.data.clone()
              : cachedEntry.data;
          }

          if (response.status >= 200 && response.status < 300) {
            const valueToCache = isCloneable(response)
              ? response.clone()
              : response;

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
        });
      };
    },
  };
}
