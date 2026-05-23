import type {
  HyperPlugin,
  InternalRequest,
  HttpClientOptions,
  HttpResponse,
} from "@hyperttp/core";
import type { CacheManagerOptions } from "./types/cache.js";
import { CacheManager } from "./utils/CacheManager.js";

declare module "@hyperttp/core" {
  interface HttpClientOptions {
    cache?: CacheManagerOptions & {
      enabled: boolean;
    };
  }

  interface HyperCore {
    clearCache?: () => void;
  }
}

export function withCache(): HyperPlugin {
  let cache!: CacheManager;

  return {
    name: "hyperttp-cache",
    phase: "PREPARE",
    enabled: (config: HttpClientOptions) => !!config.cache?.enabled,

    setup(core, config) {
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
      return async <T>(req: InternalRequest): Promise<HttpResponse<T>> => {
        if (req.method !== "GET") return next<T>(req);

        const cached = await cache.get(req.url);
        if (cached !== undefined) {
          return (
            typeof (cached as any).clone === "function"
              ? (cached as any).clone()
              : cached
          ) as HttpResponse<T>;
        }

        const response = await next<T>(req);

        if (response !== undefined) {
          const valueToCache =
            typeof (response as any).clone === "function"
              ? (response as any).clone()
              : response;

          const headers = response.headers;

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

        return response;
      };
    },
  };
}
