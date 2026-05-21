import type {
  HyperCore,
  HyperPlugin,
  InternalRequest,
  HttpClientOptions,
} from "@hyperttp/core";
import type { CacheManagerOptions } from "./types/cache.js";
import { CacheManager } from "./utils/CacheManager.js";

interface CacheableHyperCore extends HyperCore {
  clearCache?: () => void;
}

export function withCache(
  client: HyperCore,
  options: CacheManagerOptions,
): CacheableHyperCore {
  const cache = new CacheManager(options);
  const next = client.dispatch;
  const originalGetStats = client.getStats.bind(client);

  client.getStats = () => ({
    ...originalGetStats(),
    cacheSize: cache.size ?? 0,
  });

  client.dispatch = async <T = any>(req: InternalRequest): Promise<T> => {
    if (!req.isGet) return next(req) as T;

    const urlString = typeof req.url === "string" ? req.url : req.url.getURL();
    const cached = await cache.get(urlString);
    if (cached !== undefined) return cached as T;

    const result = await next(req);
    if (result !== undefined) cache.set(urlString, result);
    return result as T;
  };

  const extendedClient = client as CacheableHyperCore;
  extendedClient.clearCache = () => cache.clear();

  return extendedClient;
}

declare module "@hyperttp/core" {
  interface HyperttpPluginsExtension {
    cache?: CacheManagerOptions & {
      enabled: boolean;
    };
  }
}

export const CachePlugin: HyperPlugin = {
  name: "hyperttp-cache",
  phase: "CONTROL",
  enabled: (config: HttpClientOptions) => !!config.cache?.enabled,

  apply: (client: HyperCore, config: HttpClientOptions) => {
    return withCache(client, config.cache!);
  },
};
