import { Method } from "@hyperttp/types";

/**
 * @en Structure representing a cached item with optional HTTP validation metadata.
 * @ru Структура, представляющая элемент кэша с опциональными метаданными для HTTP-валидации.
 * @template T - Type of the cached data.
 */
export interface CacheEntry<T> {
  /**
   * @en The cached data payload.
   * @ru Сохраненные данные.
   */
  data: T;

  /**
   * @en HTTP ETag header value for conditional requests.
   * @ru Значение заголовка HTTP ETag для условных запросов.
   */
  etag?: string;

  /**
   * @en HTTP Last-Modified header value for conditional requests.
   * @ru Значение заголовка HTTP Last-Modified для условных запросов.
   */
  lastModified?: string;
}

/**
 * @en Configuration options for the CacheManager.
 * @ru Конфигурационные опции для CacheManager.
 */
export interface CacheManagerOptions {
  /**
   * @en Enable cache functionality.
   * @ru Включить кэш.
   */
  enabled?: boolean;

  /**
   * @en Cache time-to-live in milliseconds.
   * @ru Время жизни кэша (мс).
   */
  ttl?: number;

  /**
   * @en Maximum number of entries in the cache.
   * @ru Максимальный размер кэша.
   */
  maxSize?: number;

  /**
   * @en HTTP methods allowed to be cached.
   * @ru HTTP методы, которые можно кэшировать.
   */
  methods?: readonly Method[];

  /**
   * @en Update the expiration time when an entry is accessed.
   * @ru Обновлять время истечения при доступе к записи.
   */
  updateAgeOnGet?: boolean;
}

/**
 * @en A simplified response object used for efficient cache storage.
 * @ru Упрощенный объект ответа, используемый для эффективного хранения в кэше.
 */
export interface LightweightResponse<T = unknown> {
  /**
   * @en The response body content.
   * @ru Содержимое тела ответа.
   */
  body: T;

  /**
   * @en The HTTP status code.
   * @ru HTTP-код статуса.
   */
  status: number;

  /**
   * @en The response headers.
   * @ru Заголовки ответа.
   */
  headers: Record<string, string | string[]>;

  /**
   * @en The final URL of the response.
   * @ru Финальный URL ответа.
   */
  url: string;
}
