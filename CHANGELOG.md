# Changelog

## [1.2.0] - 2026-07-19

### Added
- `hcacher` as runtime dependency — event bus (`hit`, `miss`, `set`, `evict`, `expire`)
- `getOrSet()` with built-in concurrent request deduplication
- `enabled` flag to disable cache at runtime
- `MiniEmitter` and `CacheEvents` re-exported from `hcacher`

### Changed
- `CacheManager` replaced with `hcacher`'s implementation
- `getWithMetadata()` → `getEntry()`
- `setWithMetadata()` → `set()` with optional `meta` parameter
- `updateAgeOnGet` option renamed to `touchOnGet`

### Removed
- Local `CacheManager` implementation (185 lines)

## [1.1.6] - 2026-05-29

### Changed
- Refactored plugin logic, extracted `createHttpResponse` utility
- Removed test files

## [1.1.5] - 2026-05-29

### Changed
- Updated dev dependencies

## [1.1.1] - 2026-05-29

### Changed
- Updated README documentation

## [1.1.0] - 2026-05-27

### Added
- HTTP revalidation via `ETag` / `Last-Modified` conditional headers
- In-flight request deduplication
- Cache stampede protection

### Changed
- Refactored plugin architecture with `onRequest` / `onResponse` / `onError` hooks
- Expanded test suite

## [1.0.22] - 2026-05-25

### Changed
- Simplified package.json exports

## [1.0.18] - 2026-05-25

### Added
- `methods` option to configure cacheable HTTP methods

## [1.0.13] - 2026-05-24

### Changed
- Simplified plugin internals

## [1.0.11] - 2026-05-24

### Added
- CacheManager unit tests

## [1.0.8] - 2026-05-24

### Changed
- Split `CacheEntry` and `CacheManagerOptions` into dedicated types file

## [1.0.7] - 2026-05-24

### Changed
- Refactored plugin request/response handling

## [1.0.5] - 2026-05-23

### Changed
- Improved plugin configuration interface

## [1.0.2] - 2026-05-23

### Changed
- Refactored plugin structure

## [1.0.0] - 2026-05-21

### Added
- Initial release
- In-memory LRU cache with TTL
- `withCache` plugin factory for `@hyperttp/core`
- Configurable `maxSize`, `ttl`, `updateAgeOnGet`
- Isomorphic TypeScript (Bun + Node.js)
