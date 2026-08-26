import type { CacheManagerOptions } from "./types/cache.js";
import type { HyperPlugin } from "@hyperttp/types";
declare module "@hyperttp/types" {
    interface HyperClientOptions {
        cache?: CacheManagerOptions;
    }
}
export declare function withCache(options?: CacheManagerOptions): HyperPlugin;
//# sourceMappingURL=plugin.d.ts.map