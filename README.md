# @hyperttp/cache

> English | [Русский](https://github.com/IT-IF-OR/hyperttp-cache/tree/main/lang/ru)

High-performance LRU caching plugin for Hyperttp with TTL support and concurrent request deduplication.

## Features

- In-memory LRU cache with configurable TTL and size limits.
- Concurrent request deduplication and cache stampede protection.
- HTTP revalidation with `ETag` and `Last-Modified`.
- Core v2 plugin lifecycle integration.

## Installation

```bash
npm install @hyperttp/cache
# or
bun add @hyperttp/cache
```

## Usage

```ts
import { HyperClient } from "hyperttp";
import { withCache } from "@hyperttp/cache";

const client = new HyperClient({
  plugins: [withCache()],
});

const response = await client.get("https://api.example.com/data");
```

Configure the plugin with the exported `CacheOptions` type. Cache behavior is controlled by
options such as `enabled`, `ttl`, `maxSize`, `methods`, and `touchOnGet`.

## License

MIT © dirold2
