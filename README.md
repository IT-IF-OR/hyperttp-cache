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

Configure the plugin with the exported `CacheManagerOptions` type. Cache behavior is controlled by
`enabled`, `ttl`, `maxSize`, `touchOnGet`, `key`, `shouldCache`, and `shouldStoreResponse`.
By default, only successful REST GET/HEAD responses are stored.

## Authentication and cache keys

Register `withAuth()` before `withCache()`. The default key bypasses requests with
`@hyperttp/auth.identity` or standard credential headers (`Authorization`,
`Proxy-Authorization`, `Cookie`, `X-API-Key`), rather than serializing their secrets.
This applies to both cached responses and in-flight deduplication.

**Migration from 2.0.3:** Identity alone no longer enables the default cache key.
Configure a safe custom key to retain authenticated caching and deduplication.

Auth only publishes an identity when `getCacheKey()` is configured and returns one.
Without it, query credentials and arbitrary auth headers are not automatically
recognized: explicitly bypass those requests or provide a safe custom key.

For authenticated requests, provide an explicit credential-free `key` that includes
the non-secret identity supplied by auth's `getCacheKey()`. Return `undefined` when
that identity is unavailable:

```ts
withCache({
  key(request, context) {
    const identity = context?.state["@hyperttp/auth.identity"];
    if (typeof identity !== "string" || !identity) return undefined;
    if (request.protocol !== "rest") return undefined;
    const { method, url } = request.input as { method: string; url: string };
    // This endpoint uses header credentials, not query credentials.
    return JSON.stringify({ protocol: request.protocol, method, url, identity });
  },
});
```

Include all non-secret response-varying fields in custom keys. Never include tokens,
passwords, cookies, or API keys. Arbitrary credential names, query credentials and
custom protocol adapters cannot be detected automatically: configure a safe `key`
or bypass those requests with `shouldCache`. Do not use the default key for them.

## License

MIT © dirold2
