import type { HttpResponse } from "@hyperttp/types";
import { LightweightResponse } from "../types/cache.js";

/**
 * @en Reconstructs a full HttpResponse object from a lightweight cache response.
 * @ru Реконструирует полный объект HttpResponse из легковесного ответа кэша.
 *
 * @param snapshot - Lightweight response object containing cached data.
 * @returns A fully compatible HttpResponse object with methods like .text(), .json(), and .clone().
 *
 * @example
 * const cached = {
 *   status: 200,
 *   headers: { 'content-type': 'application/json' },
 *   url: 'https://api.example.com/data',
 *   body: { id: 1, name: 'John' }
 * };
 * const response = createHttpResponse(cached);
 * const data = await response.json(); // { id: 1, name: 'John' }
 */
export function createHttpResponse(
  snapshot: LightweightResponse<unknown>,
): HttpResponse<unknown> {
  return {
    status: snapshot.status,
    headers: { ...snapshot.headers },
    url: snapshot.url,
    body: snapshot.body,

    text() {
      if (typeof snapshot.body === "string") {
        return Promise.resolve(snapshot.body);
      }
      try {
        return Promise.resolve(JSON.stringify(snapshot.body));
      } catch {
        return Promise.resolve("");
      }
    },

    json<R = unknown>() {
      return Promise.resolve(snapshot.body as R);
    },

    dump() {
      return Promise.resolve();
    },

    clone(): HttpResponse<unknown> {
      let clonedBody = snapshot.body;

      if (snapshot.body && typeof snapshot.body === "object") {
        if (!(snapshot.body instanceof ReadableStream)) {
          try {
            clonedBody = structuredClone(snapshot.body);
          } catch {
            clonedBody = JSON.parse(JSON.stringify(snapshot.body));
          }
        }
      }

      return createHttpResponse({
        ...snapshot,
        body: clonedBody,
      });
    },
  };
}
