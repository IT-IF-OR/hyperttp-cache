export type Method =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "OPTIONS"
  | "DELETE"
  | "HEAD";

export interface CacheEntry<T> {
  data: T;
  etag?: string;
  lastModified?: string;
}

export interface CacheManagerOptions {
  /**
   * @ru Включить кэш
   * @en Enable cache
   */
  enabled?: boolean;
  /**
   * @ru Время жизни кэша (мс)
   * @en Cache time-to-live in milliseconds
   */
  ttl?: number;

  /**
   * @ru Максимальный размер кэша
   * @en Maximum cache size
   */
  maxSize?: number;

  /**
   * @ru HTTP методы, которые можно кэшировать
   * @en HTTP methods allowed to be cached
   */
  methods?: readonly Method[];
}

export interface CacheEntry<T> {
  data: T;
  etag?: string;
  lastModified?: string;
}
