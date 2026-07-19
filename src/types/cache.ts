import type { Method } from "@hyperttp/types";
import type { CacheManagerOptions as HcacherOptions } from "hcacher";

export type { CacheEntry } from "hcacher";

/**
 * @en Configuration options for the CacheManager.
 * @ru Конфигурационные опции для CacheManager.
 */
export interface CacheManagerOptions extends HcacherOptions {
  /**
   * @en HTTP methods allowed to be cached.
   * @ru HTTP методы, которые можно кэшировать.
   */
  methods?: readonly Method[];
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
