import type { CacheEntry, CacheManagerOptions } from "../types/cache.ts";

/**
 * @en Internal structure for a cached item including metadata and expiration.
 * @ru Внутренняя структура элемента кэша, включающая метаданные и срок действия.
 * @template T - Type of the cached data.
 */
interface InternalCacheEntry<T> {
  data: T;
  etag?: string;
  lastModified?: string;
  expiresAt: number;
}

/**
 * @en High-performance inline in-memory cache with no external dependencies.
 * Uses native Map and lazy invalidation to ensure maximum RPS.
 * @ru Высокопроизводительный инлайновый in-memory кэш без внешних зависимостей.
 * Использует нативный Map и ленивую инвалидацию для обеспечения максимального RPS.
 *
 * @template T - Type of the data stored in the cache. Defaults to unknown.
 */
export class CacheManager<T = unknown> {
  private readonly storage = new Map<string, InternalCacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttl: number;
  private readonly updateAgeOnGet: boolean;

  constructor(options?: CacheManagerOptions) {
    this.maxSize = options?.maxSize ?? 500;
    this.ttl = options?.ttl ?? 300_000;
    this.updateAgeOnGet = options?.updateAgeOnGet ?? true;
  }

  /**
   * @en Retrieves a value from the cache by key.
   * @ru Получает значение из кэша по ключу.
   * @param key - The cache key.
   * @returns The cached value or undefined if not found or expired.
   */
  get(key: string): T | undefined {
    const entry = this.storage.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.storage.delete(key);
      return undefined;
    }

    if (this.updateAgeOnGet) {
      entry.expiresAt = now + this.ttl;
      // Move to end for LRU
      this.storage.delete(key);
      this.storage.set(key, entry);
    }

    return entry.data;
  }

  /**
   * @en Stores a value in the cache.
   * @ru Сохраняет значение в кэш.
   * @param key - The cache key.
   * @param value - The data to store.
   */
  set(key: string, value: T): void {
    const now = Date.now();

    if (this.storage.has(key)) {
      this.storage.delete(key);
    } else if (this.storage.size >= this.maxSize) {
      const oldestKey = this.storage.keys().next().value;
      if (oldestKey !== undefined) this.storage.delete(oldestKey);
    }

    this.storage.set(key, {
      data: value,
      expiresAt: now + this.ttl,
    });
  }

  /**
   * @en Retrieves a cache entry along with its metadata (etag, lastModified).
   * @ru Получает запись кэша вместе с метаданными (etag, lastModified).
   * @param key - The cache key.
   * @returns The cache entry with metadata or undefined if not found or expired.
   */
  getWithMetadata(key: string): CacheEntry<T> | undefined {
    const entry = this.storage.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.storage.delete(key);
      return undefined;
    }

    if (this.updateAgeOnGet) {
      entry.expiresAt = now + this.ttl;
      this.storage.delete(key);
      this.storage.set(key, entry);
    }

    return {
      data: entry.data,
      etag: entry.etag,
      lastModified: entry.lastModified,
    };
  }

  /**
   * @en Stores a value with additional HTTP metadata.
   * @ru Сохраняет значение с дополнительными HTTP метаданными.
   * @param key - The cache key.
   * @param data - The response data to store.
   * @param meta - Optional HTTP metadata (etag, lastModified).
   */
  setWithMetadata(
    key: string,
    data: T,
    meta?: { etag?: string; lastModified?: string },
  ): void {
    const now = Date.now();

    if (this.storage.has(key)) {
      this.storage.delete(key);
    } else if (this.storage.size >= this.maxSize) {
      const oldestKey = this.storage.keys().next().value;
      if (oldestKey !== undefined) {
        this.storage.delete(oldestKey);
      }
    }

    this.storage.set(key, {
      data,
      etag: meta?.etag,
      lastModified: meta?.lastModified,
      expiresAt: now + this.ttl,
    });
  }

  /**
   * @en Checks for the existence of a key in the cache without updating its TTL.
   * @ru Проверяет наличие ключа в кэше без обновления его времени жизни.
   * @param key - The cache key.
   * @returns True if the key exists and is not expired.
   */
  has(key: string): boolean {
    const entry = this.storage.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.storage.delete(key);
      return false;
    }
    return true;
  }

  /**
   * @en Removes a value from the cache by key.
   * @ru Удаляет значение из кэша по ключу.
   * @param key - The cache key.
   * @returns True if the element was removed, false otherwise.
   */
  delete(key: string): boolean {
    return this.storage.delete(key);
  }

  /**
   * @en Clears the entire cache.
   * @ru Очищает весь кэш.
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * @en Returns the current number of items in the cache.
   * @ru Возвращает текущий размер кэша.
   */
  get size(): number {
    return this.storage.size;
  }
}
