import type { UniversalResponse } from "@hyperttp/types";
import type { LightweightResponse } from "../types/cache.js";
/**
 * @en Creates a cacheable snapshot of a universal response.
 * @ru Создаёт пригодный для кэширования снимок универсального ответа.
 */
export declare function createResponseSnapshot<T>(response: UniversalResponse<T>): LightweightResponse<T>;
/**
 * @en Reconstructs a universal response from a cached snapshot.
 * @ru Восстанавливает универсальный ответ из снимка кэша.
 */
export declare function createHttpResponse<T = unknown>(snapshot: LightweightResponse<T>): UniversalResponse<T>;
//# sourceMappingURL=createHttpResponse.d.ts.map