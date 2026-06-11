import { afterEach, describe, expect, test, vi } from "vitest";
import { streamSse } from "./sse";

// Build a Response whose body is a ReadableStream delivering `chunks` one-per-read (pull-based),
// so each test controls exactly how frames are split across reads. If `gateAfter` is set, the
// stream parks (never closes) after that many chunks — used to prove the handle is usable while
// frames are still pending and that abort() interrupts an in-flight stream. The mock honors the
// AbortSignal the way fetch does: aborting errors the body stream.
function responseFromChunks(
  chunks: string[],
  opts: { status?: number; signal?: AbortSignal | null; gateAfter?: number } = {},
): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      opts.signal?.addEventListener("abort", () => {
        try {
          controller.error(new DOMException("aborted", "AbortError"));
        } catch {
          /* already closed */
        }
      });
    },
    pull(controller) {
      if (opts.gateAfter !== undefined && i >= opts.gateAfter) {
        return new Promise<void>(() => {}); // park here until aborted
      }
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else controller.close();
    },
  });
  return new Response(body, { status: opts.status ?? 200 });
}

function mockFetch(chunks: string[], opts: { status?: number; gateAfter?: number } = {}) {
  globalThis.fetch = vi.fn(async (_url: any, init: any) =>
    responseFromChunks(chunks, { signal: init?.signal, ...opts }),
  ) as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("streamSse frame parsing", () => {
  test("1. one complete frame in a single read", async () => {
    mockFetch([`data: {"type":"x"}\n\n`]);
    const frames: any[] = [];
    await streamSse(`/x`, { method: "GET" }, (f) => frames.push(f));
    await vi.waitFor(() => expect(frames.length).toBe(1));
    expect(frames[0]).toEqual({ type: "x" });
  });

  test("2. one frame split across two reads yields exactly one frame", async () => {
    mockFetch([`data: {"type":"to`, `ken","text":"hi"}\n\n`]);
    const frames: any[] = [];
    await streamSse(`/x`, { method: "GET" }, (f) => frames.push(f));
    await vi.waitFor(() => expect(frames.length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(frames).toEqual([{ type: "token", text: "hi" }]);
  });

  test("3. two frames in a single read yields both, in order", async () => {
    mockFetch([`data: {"n":1}\n\ndata: {"n":2}\n\n`]);
    const frames: any[] = [];
    await streamSse(`/x`, { method: "GET" }, (f) => frames.push(f));
    await vi.waitFor(() => expect(frames.length).toBe(2));
    expect(frames).toEqual([{ n: 1 }, { n: 2 }]);
  });

  test("4. payload containing \\n and } is not mis-split", async () => {
    // a realistic tool_result whose `result` has newlines, a '}' and the marker substrings
    const result = "exit_code=0\nstdout: a}b\nstderr: \n";
    const payload = JSON.stringify({ type: "tool_result", tool: "bash", result, is_error: false });
    mockFetch([`data: ${payload}\n\n`]);
    const frames: any[] = [];
    await streamSse(`/x`, { method: "GET" }, (f) => frames.push(f));
    await vi.waitFor(() => expect(frames.length).toBe(1));
    expect(frames[0].result).toBe(result); // whole JSON parsed; result preserved verbatim
    expect(frames[0].tool).toBe("bash");
  });

  test("5. trailing partial frame (no terminating \\n\\n) is not emitted", async () => {
    mockFetch([`data: {"a":1}\n\n`, `data: {"partial":`]); // 2nd never terminates, then stream ends
    const frames: any[] = [];
    await streamSse(`/x`, { method: "GET" }, (f) => frames.push(f));
    await vi.waitFor(() => expect(frames.length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(frames).toEqual([{ a: 1 }]); // the partial is held back, never parsed
  });

  test("6a. onError on a non-OK HTTP response", async () => {
    mockFetch([`data: {}\n\n`], { status: 500 });
    const frames: any[] = [];
    let err: unknown = null;
    await streamSse(`/x`, { method: "GET" }, (f) => frames.push(f), (e) => (err = e));
    await vi.waitFor(() => expect(err).not.toBeNull());
    expect(frames.length).toBe(0);
  });

  test("6b. onError when fetch/stream throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as any;
    let err: any = null;
    await streamSse(`/x`, { method: "GET" }, () => {}, (e) => (err = e));
    await vi.waitFor(() => expect(err).not.toBeNull());
    expect(String(err)).toContain("network down");
  });

  test("7 + 2b. handle is returned before drain, and abort() stops consumption", async () => {
    // gateAfter:1 → one frame then the stream parks forever. If streamSse awaited the full drain,
    // this `await` would hang (the stream never ends) and the test would time out — so resolving
    // here proves the handle is returned before the stream is drained.
    mockFetch([`data: {"i":1}\n\n`, `data: {"i":2}\n\n`], { gateAfter: 1 });
    const frames: any[] = [];
    const handle = await streamSse(`/x`, { method: "GET" }, (f) => frames.push(f));
    await vi.waitFor(() => expect(frames.length).toBe(1)); // frame 1 arrived; frame 2 still pending
    handle.abort();
    await new Promise((r) => setTimeout(r, 30));
    expect(frames.length).toBe(1); // no further frames after abort
  });
});
