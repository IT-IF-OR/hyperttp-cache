import { describe, it, expect, vi, beforeEach } from "vitest";
import { withCache } from "../src/plugin";
import type {
  InternalRequest,
  HttpResponse,
  HyperttpError,
} from "@hyperttp/types";

describe("Cache Plugin Full Test Suite", () => {
  let plugin: ReturnType<typeof withCache>;
  let ctx: any;

  // Вспомогательная функция, полностью имитирующая конвейер выполнения HyperCore.dispatch
  function createMockRunner(networkTransportMock: () => Promise<any>) {
    return async (req: InternalRequest) => {
      // 1. Фаза onRequest
      if (plugin.onRequest) {
        const shortCircuitResponse = await plugin.onRequest(req, ctx);
        if (shortCircuitResponse) {
          // Если перехвачено (кэш-хит или промис дедупликации) — сразу идем в onResponse
          if (plugin.onResponse) {
            plugin.onResponse(shortCircuitResponse, req, ctx);
          }
          return shortCircuitResponse;
        }
      }

      // 2. Имитация ухода в сеть через транспорт
      try {
        const rawResponse = await networkTransportMock();

        // 3. Фаза onResponse для успешного исхода
        if (plugin.onResponse) {
          plugin.onResponse(rawResponse, req, ctx);
        }
        return rawResponse;
      } catch (error) {
        // 4. Фаза onError при сетевых сбоях
        if (plugin.onError) {
          plugin.onError(error as HyperttpError, req, ctx);
        }
        throw error;
      }
    };
  }

  // Фабрика для создания изолированных копий объектов ответов с поддержкой .clone()
  function createMockResponse(
    data: Partial<HttpResponse<any>>,
  ): HttpResponse<any> {
    return {
      status: 200,
      headers: {},
      body: null,
      ...data,
      clone: function (this: any) {
        return createMockResponse({
          ...this,
          headers: { ...this.headers },
        });
      },
    } as HttpResponse<any>;
  }

  beforeEach(() => {
    plugin = withCache();
    ctx = {
      core: {
        getStats: () => ({}),
        clearCache: () => {},
      },
      config: {
        cache: {
          enabled: true,
          methods: ["GET"],
        },
      },
    };
  });

  it("should perform request once for concurrent calls (Deduplication)", async () => {
    plugin.setup?.(ctx);

    const transportMock = vi.fn().mockImplementation(async () => {
      // Искусственная задержка сети для создания состояния конкурентности
      await new Promise((resolve) => setTimeout(resolve, 10));
      return createMockResponse({ body: "dedup-payload" });
    });

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/concurrent",
      method: "GET",
      headers: {},
    } as InternalRequest;

    // Веерный запуск 50 одновременных запросов
    const results = await Promise.all(
      Array.from({ length: 50 }).map(() => dispatch(req)),
    );

    // Сетевой транспорт должен быть вызван строго один раз
    expect(transportMock).toHaveBeenCalledTimes(1);

    // Все 50 подписчиков должны получить корректный payload
    results.forEach((res) => {
      expect(res.body).toBe("dedup-payload");
    });
  });

  it("should serve from cache on subsequent calls without revalidation (No ETag)", async () => {
    plugin.setup?.(ctx);

    const transportMock = vi
      .fn()
      .mockResolvedValue(createMockResponse({ body: "static-payload" }));

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/pure-cache",
      method: "GET",
      headers: {},
    } as InternalRequest;

    // Первый запрос — прогрев кэша (идет в сеть)
    await dispatch(req);

    // Второй запрос — полный локальный кэш-хит (в сеть не идет)
    const secondResponse = await dispatch(req);

    expect(transportMock).toHaveBeenCalledTimes(1);
    expect(secondResponse.body).toBe("static-payload");
  });

  it("should handle HTTP 304 Not Modified revalidation when ETag matches", async () => {
    plugin.setup?.(ctx);

    let callCount = 0;
    const transportMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({
          status: 200,
          headers: { etag: "v1" },
          body: "initial-heavy-data",
        });
      }
      // При повторном запросе сервер возвращает пустой 304
      return createMockResponse({
        status: 304,
        headers: { etag: "v1" },
        body: null,
      });
    });

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/revalidate-etag",
      method: "GET",
      headers: {},
    } as InternalRequest;

    // 1. Базовый запрос для записи ETag в кэш
    await dispatch(req);

    // 2. Повторный запрос — плагин обязан подмешать условный заголовок
    const secondResponse = await dispatch(req);

    expect(transportMock).toHaveBeenCalledTimes(2);
    expect(req.headers["if-none-match"]).toBe("v1");
    // Плагин должен гидрировать пустой 304-ответ данными из памяти
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body).toBe("initial-heavy-data");
  });

  it("should cleanly propagate network errors and unlock in-flight map", async () => {
    plugin.setup?.(ctx);

    const transportMock = vi
      .fn()
      .mockRejectedValue(new Error("Network connection breakdown"));

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/faulty-endpoint",
      method: "GET",
      headers: {},
    } as InternalRequest;

    // Первая попытка падает из-за сети
    await expect(dispatch(req)).rejects.toThrow("Network connection breakdown");

    // Вторая попытка должна снова пойти в сеть, так как onError обязан очистить in-flight пулы
    await expect(dispatch(req)).rejects.toThrow("Network connection breakdown");
    expect(transportMock).toHaveBeenCalledTimes(2);
  });

  it("should correctly evaluate plugin activation via enabled method", () => {
    expect(plugin.enabled({ cache: { enabled: true } })).toBe(true);
    expect(plugin.enabled({ cache: { enabled: false } })).toBe(false);
    expect(plugin.enabled({})).toBe(false);
  });

  it("should extend core with stats tracking and cache clearing capabilities", () => {
    let originalStatsCalled = false;
    ctx.core.getStats = () => {
      originalStatsCalled = true;
      return { nativeMetric: 100 };
    };

    plugin.setup?.(ctx);

    // Проверяем работу getStats() и подмешивание cacheSize
    const stats = ctx.core.getStats();
    expect(originalStatsCalled).toBe(true);
    expect(stats?.nativeMetric).toBe(100);
    expect(stats?.cacheSize).toBe(0);

    // Проверяем вызовы очистки кэша
    const clearSpy = vi.spyOn(ctx.cache, "clear");
    const deleteSpy = vi.spyOn(ctx.cache, "delete");

    ctx.core.clearCache();
    expect(clearSpy).toHaveBeenCalledTimes(1);

    ctx.core.clearCache("custom-key");
    expect(deleteSpy).toHaveBeenCalledWith("custom-key");
  });

  it("should skip caching and short-circuit early for non-allowed HTTP methods", async () => {
    plugin.setup?.(ctx);
    const transportMock = vi.fn().mockResolvedValue(createMockResponse({}));
    const dispatch = createMockRunner(transportMock);

    const req = {
      url: "/api/submit",
      method: "POST", // POST не входит в разрешенные по умолчанию ["GET"]
      headers: {},
    } as InternalRequest;

    await dispatch(req);
    expect(transportMock).toHaveBeenCalledTimes(1);
  });

  it("should handle conditional validation via Last-Modified header", async () => {
    plugin.setup?.(ctx);

    let callCount = 0;
    const transportMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({
          status: 200,
          headers: { "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
          body: "timestamped-payload",
        });
      }
      return createMockResponse({ status: 304, headers: {}, body: null });
    });

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/last-modified-check",
      method: "GET",
      headers: {},
    } as InternalRequest;

    await dispatch(req); // Пишем в кэш с метаданными Last-Modified
    const secondResponse = await dispatch(req); // Идем на ревалидацию

    expect(transportMock).toHaveBeenCalledTimes(2);
    expect(req.headers["if-modified-since"]).toBe(
      "Wed, 21 Oct 2015 07:28:00 GMT",
    );
    expect(secondResponse.body).toBe("timestamped-payload");
  });

  it("should transparently forward non-2xx/non-304 server responses without caching them", async () => {
    plugin.setup?.(ctx);

    const transportMock = vi
      .fn()
      .mockResolvedValue(
        createMockResponse({ status: 404, body: "Not Found" }),
      );

    const dispatch = createMockRunner(transportMock);
    const req = {
      url: "/api/missing-page",
      method: "GET",
      headers: {},
    } as InternalRequest;

    const res = await dispatch(req);
    expect(res.status).toBe(404);
    expect(res.body).toBe("Not Found");
  });
});
