import type {
  HttpClientOptions,
  HttpResponse,
  HyperPlugin,
  PluginContext,
  InternalRequest,
  HyperttpError,
} from "@hyperttp/types";

import type {
  CacheManagerOptions,
  LightweightResponse,
} from "./types/cache.js";
import { CacheManager } from "./utils/CacheManager.js";

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

    /**
     * @en Returns runtime statistics, including cache size.
     * @ru Возвращает статистику выполнения, включая размер кэша.
     */
    getStats?(): Record<string, any>;
  }
}

/**
 * @en Helper function to create a standardized HttpResponse object from lightweight data.
 * @ru Вспомогательная функция для создания стандартизированного объекта HttpResponse из легких данных.
 * @param data - The lightweight response data.
 * @returns A full HttpResponse object.
 */
const createHttpResponse = (data: LightweightResponse): HttpResponse<any> => ({
  status: data.status,
  headers: data.headers,
  body: data.body,
  url: data.url,
  clone: () => createHttpResponse(data),
});

/**
 * @en Structure representing a pending in-flight request promise and its resolvers.
 * @ru Структура, представляющая ожидающее выполнение обещание запроса и его разрешающие функции.
 */
interface InFlightTrigger {
  promise: Promise<HttpResponse<any>>;
  resolve: (res: HttpResponse<any>) => void;
  reject: (err: HyperttpError) => void;
}

/**
 * @en Creates a caching plugin for Hyperttp.
 * Handles in-memory caching, conditional requests (ETag/Last-Modified), and request deduplication.
 * @ru Создает плагин кэширования для Hyperttp.
 * Обрабатывает кэширование в памяти, условные запросы (ETag/Last-Modified) и дедупликацию запросов.
 * @returns The configured HyperPlugin instance.
 */
export function withCache(): HyperPlugin {
  let cache!: CacheManager<LightweightResponse>;
  let allowedMethods: Set<string> = new Set();
  const inFlight = new Map<string, InFlightTrigger>();

  return {
    name: "hyperttp-cache",

    enabled: (config: HttpClientOptions): boolean => {
      return !!(config as any).cache?.enabled;
    },

    setup(ctx: PluginContext) {
      const core = ctx.core;
      const config = ctx.config as any;

      cache = new CacheManager<LightweightResponse>(config?.cache);
      ctx.cache = cache;

      const methods = config?.cache?.methods ?? ["GET"];
      allowedMethods = new Set(methods.map((m: string) => m.toUpperCase()));

      if (core && typeof core.getStats === "function") {
        const originalGetStats = core.getStats.bind(core);
        core.getStats = function () {
          const stats = originalGetStats();
          return {
            ...stats,
            cacheSize: cache.size,
          };
        };
      }

      core.clearCache = (key?: string) => {
        if (key) {
          cache.delete(key);
        } else {
          cache.clear();
        }
      };
    },

    onRequest(req: InternalRequest) {
      if (!allowedMethods.has(req.method.toUpperCase())) {
        return;
      }

      const cacheKey = req.url;

      const cachedEntry = cache.getWithMetadata(cacheKey);

      if (cachedEntry && !cachedEntry.etag && !cachedEntry.lastModified) {
        return createHttpResponse(cachedEntry.data);
      }

      if (cachedEntry) {
        req.headers = { ...req.headers };

        if (cachedEntry.etag) {
          req.headers["if-none-match"] = cachedEntry.etag;
        }
        if (cachedEntry.lastModified) {
          req.headers["if-modified-since"] = cachedEntry.lastModified;
        }
      }

      const currentInFlight = inFlight.get(cacheKey);
      if (currentInFlight) {
        return currentInFlight.promise.then((res) => res.clone());
      }

      let resolveFn!: (res: HttpResponse<any>) => void;
      let rejectFn!: (err: HyperttpError) => void;

      const promise = new Promise<HttpResponse<any>>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
      });

      const trigger: InFlightTrigger = {
        promise,
        resolve: resolveFn,
        reject: (err) => {
          inFlight.delete(cacheKey);
          rejectFn(err);
        },
      };

      inFlight.set(cacheKey, trigger);

      setTimeout(() => {
        if (inFlight.has(cacheKey)) {
          console.warn(
            `[Cache] Warning: Request hung for ${cacheKey}, forcing cleanup`,
          );

          trigger.reject(
            new Error("Request timed out in cache plugin") as HyperttpError,
          );
        }
      }, 30_000);

      return;
    },

    onResponse(res: HttpResponse<any>, req?: InternalRequest) {
      if (!req) return;

      const cacheKey = req.url;
      const trigger = inFlight.get(cacheKey);

      if (!trigger) return;

      inFlight.delete(cacheKey);
      if (res.status === 304) {
        const cachedEntry = cache.getWithMetadata(cacheKey);

        if (cachedEntry) {
          const cachedData = cachedEntry.data;
          const restoredRes: HttpResponse<any> = {
            status: cachedData.status,
            headers: cachedData.headers,
            body: cachedData.body,
            url: cachedData.url,
            clone: () => createHttpResponse(cachedData),
          };

          trigger.resolve(restoredRes);
          return;
        } else {
          console.warn(
            `[Cache] Received 304 for ${cacheKey} but no cache entry found.`,
          );
        }
      }

      if (res.status >= 200 && res.status < 300) {
        const headers = res.headers || {};

        const lightResponse: LightweightResponse = {
          body: res.body,
          status: res.status,
          headers: res.headers,
          url: res.url as string,
        };

        cache.setWithMetadata(cacheKey, lightResponse, {
          etag: Array.isArray(headers["etag"])
            ? headers["etag"][0]
            : (headers["etag"] as string),
          lastModified: Array.isArray(headers["last-modified"])
            ? headers["last-modified"][0]
            : (headers["last-modified"] as string),
        });
      }

      trigger.resolve(res.clone());
    },

    onError(err: HyperttpError, req?: InternalRequest) {
      if (!req) return;

      const trigger = inFlight.get(req.url);
      if (trigger) {
        inFlight.delete(req.url);
        trigger.reject(err);
      }
    },
  };
}
