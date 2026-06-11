// A single fetch-based SSE parser used for BOTH streams (the GET run stream and the POST
// help-assistant stream). EventSource cannot POST, so we read the ReadableStream ourselves and
// parse `data: <json>\n\n` frames. Returns an async iterator of parsed JSON payloads.

export interface SseHandle {
  abort: () => void;
}

export async function streamSse<T>(
  url: string,
  init: RequestInit,
  onMessage: (data: T) => void,
  onError?: (err: unknown) => void,
): Promise<SseHandle> {
  const controller = new AbortController();
  const handle: SseHandle = { abort: () => controller.abort() };

  (async () => {
    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      if (!resp.ok || !resp.body) {
        throw new Error(`SSE request failed: ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // frames are separated by a blank line
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(line.indexOf(":") + 1).trim();
          if (!payload) continue;
          try {
            onMessage(JSON.parse(payload) as T);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    } catch (err) {
      if ((err as any)?.name !== "AbortError") onError?.(err);
    }
  })();

  return handle;
}
