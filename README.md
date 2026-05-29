# hyperttp-cache

> [Русский](https://github.com/IT-IF-OR/hyperttp-cache/tree/main/lang/ru) | English

---

## 🌐 Language

- 🇺🇸 English
- 🇷🇺 [Русский](https://github.com/IT-IF-OR/hyperttp-cache/tree/main/lang/ru)

---

Blazing fast, isomorphic cache management and concurrent request deduplication plugin for the high-performance
`Hyperttp` HTTP client. Optimized for **Bun** and **Node.js** runtimes.

The plugin seamlessly integrates into the flat `HyperCore` lifecycle pipeline, protecting your backend from server
breakdown (**Cache Stampede Protection**) and providing smart in-memory storage based on the **LRU (Least Recently Used)**
strategy.

---

## 🔥 Key Features

- 🧠 **LRU Strategy with TTL Support:** Automatically evicts old entries when reaching limits. With every `GET`
  request, the entry age resets (`updateAgeOnGet: true`), keeping hot data cached in memory.
- 🚀 **In-Flight Deduplication:** Concurrent fan-out requests targeting the same URL are grouped into a single network
  hot path. The response is cloned and distributed to all waiting subscribers simultaneously.
- 🔄 **HTTP Revalidation:** Full freshness verification support via `ETag` (`If-None-Match`) and `Last-Modified`
  (`If-Modified-Since`). Automatically re-hydrates empty `304` responses with cached data bodies.
- 🛡️ **Fail-Safe Processing:** When network processing exceptions occur, the in-flight waiting pool is instantly
  purged (`onError`), unblocking immediate subsequent retry attempts.
- 📊 **Core Extension:** Automatically injects cache management methods (`clearCache`) and appends a `cacheSize`
  telemetry metric into the core `getStats()` architecture.

---

## 📦 Installation

```bash
bun add hyperttp-cache
# or
npm install hyperttp-cache

```

---

## 🚀 Quick Start

Simply import the `withCache` factory and append it to your client's plugin array. Cache configurations are
passed directly within the global options block.

```typescript
import { createClient } from "@hyperttp/core";
import { withCache } from "hyperttp-cache";

const client = createClient({
  plugins: [withCache()],
  cache: {
    enabled: true,
    ttl: 60_000,       // 1 minute (defaults to 300_000 ms)
    maxSize: 1000,    // Limit to 1000 items (defaults to 500)
    methods: ["GET"], // HTTP methods authorized for downstream caching
  },
});

// 1. The first request goes out to the network and populates the cache
const res1 = await client.get("/api/data");

// 2. Subsequent requests instantly return an isolated clone from the cache
const res2 = await client.get("/api/data");

```

---

## ⚙️ Configuration Options (`CacheManagerOptions`)

The plugin configuration layer is fully typed and extends the default client option interfaces:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `cache.enabled` | `boolean` | `false` | Activation status flag for the caching layer. |
| `cache.ttl` | `number` | `300_000` (5 min) | Cache entry time-to-live threshold (in milliseconds). |
| `cache.maxSize` | `number` | `500` | Maximum entries allowed inside the LRU pool before eviction begins. |
| `cache.methods` | `Method[]` | `["GET"]` | Array of HTTP methods authorized for response interception. |

---

## 🛠️ Core API Extensions

The plugin extends the global `@hyperttp/types` interface declarations. The following lifecycle methods become
directly accessible via the client core instance:

### Purging Cache

```typescript
// Purge the entire cache system
client.clearCache();

// Evict a specific URL key from the storage
client.clearCache("/api/data");

```

### Telemetry

If your core implementation supports the `getStats()` routine, the plugin automatically appends the current cache size:

```typescript
const stats = client.getStats();
console.log(stats.cacheSize); // Outputs the current number of active entries inside the LRU storage

```

---

## 📐 Lifecycle Architecture

The plugin utilizes atomic, decoupled lifecycle hooks instead of overhead-heavy middleware wrappers:

1. **`onRequest`**: Evaluates local key hits inside the `CacheManager`. If the matching record is fresh and doesn't
require validation, it returns a clone, short-circuiting the chain. If a concurrent request to the same URL is active,
it hooks into its matching follower `Promise`. If a partial hit requires validation, it appends conditional headers
(`If-None-Match` / `If-Modified-Since`).
2. **`onResponse`**: Intercepts successful downstream outputs. Re-hydrates an empty `304 Not Modified` status code
back into a full `200 OK` response by recovering body content from memory. Saves valid `200` ranges containing validation
metadata and resolves execution triggers for all waiting `In-Flight` threads.
3. **`onError`**: In the event of a critical network failure, it instantly flushes matching active tracking task entries
from the map to ensure subsequent retries targeting the failed endpoint are never deadlocked.

---

## 📄 License

MIT
