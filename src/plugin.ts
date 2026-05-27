import type {
  HttpClientOptions,
  HttpResponse,
  HyperPlugin,
  IHyperCore,
  PluginContext,
  InternalRequest,
  HyperttpError,
} from "@hyperttp/types";

import type { CacheManagerOptions } from "./types/cache.js";
import { CacheManager } from "./utils/CacheManager.js";

declare module "@hyperttp/types" {
  interface PluginContext {
    cache?: CacheManager;
  }
  interface HyperttpPluginsExtension {
    cache?: CacheManagerOptions & {
      enabled: boolean;
    };
  }
  interface IHyperCore {
    clearCache(key?: string): void;
    getStats?(): Record<string, any>;
  }
}

/**
 * @internal
 * @ru Структура отложенного управления результатом выполнения для дедупликации параллельных запросов (In-Flight).
 * @en Deferred execution trigger structure used for handling concurrent in-flight request deduplication.
 */
interface InFlightTrigger {
  promise: Promise<HttpResponse<any>>;
  resolve: (res: HttpResponse<any>) => void;
  reject: (err: HyperttpError) => void;
}

/**
 * @ru Фабрика плагина кэширования и дедупликации конкурентных запросов для HyperCore.
 * @en Cache management and concurrent request deduplication plugin factory for HyperCore.
 * @returns Модуль расширения ядра в рамках линейного жизненного цикла. / Configured extension plugin container.
 */
export function withCache(): HyperPlugin {
  /**
   * @private
   * @ru Изолированный инстанс менеджера кэша для текущего клиента.
   * @en Isolated cache manager orchestration instance allocated for the target client.
   */
  let cache: CacheManager;

  /**
   * @private
   * @ru Список HTTP-методов, для которых разрешено кэширование ответов.
   * @en Set of HTTP request methods authorized for downstream response caching.
   */
  let allowedMethods: Set<string>;

  /**
   * @private
   * @ru Карта активных сетевых запросов для предотвращения каскадного заваливания бэкенда (Cache Stampede).
   * @en Registry of concurrent requests in execution to prevent backend server breakdown (Cache Stampede).
   */
  const inFlight = new Map<string, InFlightTrigger>();

  return {
    name: "hyperttp-cache",

    /**
     * @ru Динамическая проверка необходимости активации кэширования на основе переданных опций.
     * @en Dynamic check evaluating if the caching plugin layer should be appended based on client runtime options.
     * @param config - Глобальная конфигурация инстанса клиента. / Global active client lifecycle options.
     * @returns Индикатор необходимости сборки плагина. / Lifecycle activation indicator status.
     */
    enabled: (config: HttpClientOptions & { cache?: { enabled: boolean } }) => {
      return !!config.cache?.enabled;
    },

    /**
     * @ru Однократный хук инициализации. Настраивает менеджер кэша и внедряет методы отладки/очистки в ядро.
     * @en One-time setup context hook. Orchestrates the cache manager and extends telemetry/purge interfaces inside the core.
     * @param ctx - Общий контекст окружения плагина. / Shared plugin execution context metadata.
     */
    setup(ctx: PluginContext) {
      const { core, config } = ctx as { core: IHyperCore; config: any };

      cache = new CacheManager(config?.cache);
      ctx.cache = cache;

      const methods = config?.cache?.methods ?? ["GET"];
      allowedMethods = new Set(methods.map((m: string) => m.toUpperCase()));

      if (core && typeof core.getStats === "function") {
        const originalGetStats = core.getStats;
        core.getStats = function (this: IHyperCore) {
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

    /**
     * @ru Перехватчик фазы отправки запроса. Проверяет локальные кэш-хиты и координирует пулинг конкурентных задач.
     * @en Request phase interceptor. Evaluates local cache hits, appends conditional headers, or hooks into active in-flight targets.
     * @param req - Сконфигурированный внутренний объект запроса. / Contextual internal request parameters.
     * @param ctx - Общий контекст окружения плагина. / Shared plugin execution context metadata.
     * @returns Мгновенный изолированный ответ из кэша, обертку гонки или void для продолжения сетевого цикла. / Short-circuit response clone, matching follower promise tracker, or void execution.
     */
    onRequest(
      req: InternalRequest,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _ctx: PluginContext,
    ): Promise<HttpResponse<any> | void> | HttpResponse<any> | void {
      const method = req.method.toUpperCase();
      if (!allowedMethods.has(method)) {
        return;
      }

      const cacheKey = req.url;
      const cachedEntry = cache.getWithMetadata<HttpResponse<any>>(cacheKey);

      if (
        cachedEntry !== undefined &&
        !cachedEntry.etag &&
        !cachedEntry.lastModified
      ) {
        return cachedEntry.data.clone();
      }

      // Частичный кэш-хит, подмешиваем заголовки проверки свежести
      if (cachedEntry !== undefined) {
        req.headers = { ...req.headers };
        if (cachedEntry.etag) req.headers["if-none-match"] = cachedEntry.etag;
        if (cachedEntry.lastModified)
          req.headers["if-modified-since"] = cachedEntry.lastModified;
      }

      const currentInFlight = inFlight.get(cacheKey);
      if (currentInFlight) {
        return currentInFlight.promise.then((res) => res.clone());
      }

      let resolveFn!: (res: HttpResponse<any>) => void;
      let rejectFn!: (err: any) => void;

      const promise = new Promise<HttpResponse<any>>((res, rej) => {
        resolveFn = res;
        rejectFn = rej;
      });

      promise.catch(() => {});

      inFlight.set(cacheKey, { promise, resolve: resolveFn, reject: rejectFn });
    },

    /**
     * @ru Перехватчик фазы получения ответа. Обновляет хранилище или трансформирует статус 304 в полные данные из кэша.
     * @en Response phase interceptor. Saves raw outputs to the storage layer or re-hydrates empty 304 responses with cached data bodies.
     */
    onResponse(
      res: HttpResponse<any>,
      req: InternalRequest,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _ctx: PluginContext,
    ): void {
      const cacheKey = req.url;
      const trigger = inFlight.get(cacheKey);

      if (!trigger) {
        return;
      }

      inFlight.delete(cacheKey);

      const cachedEntry = cache.getWithMetadata<HttpResponse<any>>(cacheKey);

      if (res.status === 304 && cachedEntry !== undefined) {
        const clonedCache = cachedEntry.data.clone();
        Object.assign(res, clonedCache);
        res.status = clonedCache.status ?? 200;

        trigger.resolve(clonedCache);
        return;
      }

      if (res.status >= 200 && res.status < 300) {
        const valueToCache = res.clone();
        const headers = res.headers;
        const etag = headers?.["etag"] || headers?.["ETag"];
        const lastModified =
          headers?.["last-modified"] || headers?.["Last-Modified"];

        cache.setWithMetadata(cacheKey, valueToCache, {
          etag: typeof etag === "string" ? etag : undefined,
          lastModified:
            typeof lastModified === "string" ? lastModified : undefined,
        });

        trigger.resolve(res.clone());
        return;
      }

      trigger.resolve(res.clone());
    },

    /**
     * @ru Перехватчик фазы критических сбоев. Разрывает пул ожидания дедупликации, транслируя ошибку всем подписчикам.
     * @en Error phase interceptor. Purges matching metadata maps and forwards pipeline processing exceptions to all waiting threads.
     * @param err - Специфичный объект ошибки сетевого клиента. / Normalized client-level error framework tracking details.
     * @param req - Сконфигурированный внутренний объект запроса. / Contextual internal request parameters.
     * @param ctx - Общий контекст окружения плагина. / Shared plugin execution context metadata.
     */
    onError(
      err: HyperttpError,
      req: InternalRequest,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _ctx: PluginContext,
    ): void {
      const cacheKey = req.url;
      const trigger = inFlight.get(cacheKey);

      if (trigger) {
        inFlight.delete(cacheKey);
        trigger.reject(err);
      }
    },
  };
}
