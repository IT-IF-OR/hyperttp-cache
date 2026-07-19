import type { CacheManagerOptions, LightweightResponse } from "./types/cache.js";
import { CacheManager } from "hcacher";
import { createHttpResponse } from "./utils/createHttpResponse.js";
import type { InternalRequest, HttpResponse, HyperPlugin, HyperttpError } from "@hyperttp/types";

/**
 * @en Extends the PluginContext to include the cache manager instance.
 * @ru Расширяет PluginContext, добавляя экземпляр менеджера кэша.
 */
declare module "@hyperttp/types" {
  interface PluginContext {
    /**
     * @en The active cache manager instance.
     * @ru Активный экземпляр менеджера кэша.
     */
    cache?: CacheManager<LightweightResponse>;
  }
  /**
   * @en Extends HyperttpPluginsExtension to include cache configuration options.
   * @ru Расширяет HyperttpPluginsExtension, добавляя опции конфигурации кэша.
   */
  interface HyperttpPluginsExtension {
    /**
     * @en Cache configuration and enablement flags.
     * @ru Конфигурация кэша и флаги включения.
     */
    cache?: CacheManagerOptions & {
      /**
       * @en Enables or disables the caching plugin.
       * @ru Включает или отключает плагин кэширования.
       */
      enabled: boolean;
      /**
       * @en List of HTTP methods allowed for caching (e.g., ["GET"]).
       * @ru Список HTTP-методов, разрешенных для кэширования (например, ["GET"]).
       */
      methods?: string[];
    };
  }

  /**
   * @en Extends IHyperCore with cache management methods.
   * @ru Расширяет IHyperCore методами управления кэшем.
   */
  interface IHyperCore {
    /**
     * @en Clears the cache. If a key is provided, only that entry is removed.
     * @ru Очищает кэш. Если указан ключ, удаляется только соответствующая запись.
     * @param key - Optional cache key to delete.
     */
    clearCache(key?: string): void;
  }
}

interface InFlightTrigger {
  listeners: {
    resolve: (r: HttpResponse<unknown>) => void;
    reject: (e: unknown) => void;
  }[];
  timestamp: number;
}

export function withCache(options?: CacheManagerOptions): HyperPlugin {
  if (options?.enabled === false) {
    return { name: "hyperttp-cache" };
  }

  let cache: CacheManager<LightweightResponse<unknown>>;

  const allowedMethods = new Set<string>(
    options?.methods ? options.methods.map((m) => m.toUpperCase()) : ["GET", "HEAD"],
  );

  const inFlight = new Map<string, InFlightTrigger>();

  return {
    name: "hyperttp-cache",

    setup() {
      cache = new CacheManager<LightweightResponse<unknown>>({
        maxSize: options?.maxSize ?? 1000,
        ttl: options?.ttl ?? 300_000,
        touchOnGet: options?.touchOnGet ?? true,
      });
    },

    onRequest(req: InternalRequest) {
      if (!allowedMethods.has(req.method.toUpperCase())) return;

      const cacheKey = req.url;
      const cachedEntry = cache.getEntry(cacheKey);

      if (cachedEntry && !cachedEntry.etag && !cachedEntry.lastModified) {
        return createHttpResponse(cachedEntry.data);
      }

      if (cachedEntry) {
        req.headers = { ...req.headers };
        if (cachedEntry.etag) req.headers["if-none-match"] = cachedEntry.etag;
        if (cachedEntry.lastModified) {
          req.headers["if-modified-since"] = cachedEntry.lastModified;
        }
      }

      const currentInFlight = inFlight.get(cacheKey);
      if (currentInFlight) {
        return new Promise<HttpResponse<unknown>>((resolve, reject) => {
          currentInFlight.listeners.push({ resolve, reject });
        });
      }

      inFlight.set(cacheKey, { listeners: [], timestamp: Date.now() });
    },

    onResponse(res: HttpResponse<unknown>, req?: InternalRequest): void {
      if (!req) return;
      const cacheKey = req.url;
      const trigger = inFlight.get(cacheKey);

      if (res.status === 304) {
        if (res.body && typeof (res.body as Record<string, unknown>).cancel === "function") {
          (res.body as ReadableStream).cancel().catch(() => {});
        }

        const cachedEntry = cache.getEntry(cacheKey);
        if (cachedEntry) {
          const restoredRes = createHttpResponse(cachedEntry.data);

          res.status = restoredRes.status;
          res.headers = restoredRes.headers;
          res.body = restoredRes.body;

          if (trigger) {
            inFlight.delete(cacheKey);
            trigger.listeners.forEach((l) => l.resolve(restoredRes.clone()));
          }
          return;
        }

        const err = new Error("304 status received, but cache entry is missing");
        if (trigger) {
          inFlight.delete(cacheKey);
          trigger.listeners.forEach((l) => l.reject(err));
        }
        throw err;
      }

      if (res.status >= 200 && res.status < 300) {
        const cleanHeaders = { ...res.headers } as Record<string, string>;

        cache.set(
          cacheKey,
          {
            body: res.body,
            status: res.status,
            headers: cleanHeaders,
            url: res.url ?? "",
          },
          {
            etag: cleanHeaders["etag"] ?? cleanHeaders["ETag"],
            lastModified: cleanHeaders["last-modified"] ?? cleanHeaders["Last-Modified"],
          },
        );
      }

      if (trigger) {
        inFlight.delete(cacheKey);
        if (trigger.listeners.length > 0) {
          const clonedForDependents = res.clone();
          trigger.listeners.forEach((l) => l.resolve(clonedForDependents));
        }
      }
    },

    onError(err: HyperttpError, req?: InternalRequest): void {
      if (!req) return;
      const trigger = inFlight.get(req.url);
      if (trigger) {
        inFlight.delete(req.url);
        trigger.listeners.forEach((l) => l.reject(err));
      }
    },
  };
}
