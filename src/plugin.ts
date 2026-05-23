import type { HyperCore, HyperPlugin, InternalRequest } from "@hyperttp/core";
import type { CacheManagerOptions } from "./types/cache.js";
import { CacheManager } from "./utils/CacheManager.js";

export interface CacheableHyperCore extends HyperCore {
  clearCache?: () => void;
}

declare module "@hyperttp/core" {
  interface HyperttpPluginsExtension {
    cache?: CacheManagerOptions & {
      enabled: boolean;
    };
  }
}

export function withCache(): HyperPlugin {
  let cache!: CacheManager;

  return {
    name: "hyperttp-cache",
    phase: "PREPARE",
    enabled: (config) => !!config.cache?.enabled,

    setup(core: CacheableHyperCore, config) {
      cache = new CacheManager(config.cache!);

      core.clearCache = () => cache.clear();

      if (core && typeof core.getStats === "function") {
        const originalGetStats = core.getStats.bind(core);
        core.getStats = () => ({
          ...originalGetStats(),
          cacheSize: cache?.size ?? 0,
        });
      }
    },

    wrapDispatch: (next) => {
      return async <T = any>(req: InternalRequest): Promise<T> => {
        if (req.method !== "GET") return next(req) as Promise<T>;

        const cached = await cache.get(req.url);
        if (cached !== undefined) {
          return (
            typeof (cached as any).clone === "function"
              ? (cached as any).clone()
              : cached
          ) as T;
        }

        const result = await next(req);

        if (result !== undefined) {
          const valueToCache =
            typeof (result as any).clone === "function"
              ? (result as any).clone()
              : result;

          const headers = (result as any).headers;
          if (headers) {
            const etag = headers["etag"] || headers["ETag"];
            const lastModified =
              headers["last-modified"] || headers["Last-Modified"];

            cache.setWithMetadata(req.url, valueToCache, {
              etag: typeof etag === "string" ? etag : undefined,
              lastModified:
                typeof lastModified === "string" ? lastModified : undefined,
            });
          } else {
            cache.set(req.url, valueToCache);
          }
        }

        return result as T;
      };
    },
  };
}
