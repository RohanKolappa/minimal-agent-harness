import { describe, expect, test } from "vitest";
import { parseBashResult, parseGrep } from "./format";

describe("parseBashResult", () => {
  test("simple exit 0 with single-line streams", () => {
    const r = parseBashResult("exit_code=0\nstdout: hello\nstderr: ");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hello");
    expect(r.stderr).toBe("");
  });

  test("multiline stdout is preserved verbatim (not truncated or line-split)", () => {
    const out = "line1\nline2\nline3";
    const r = parseBashResult(`exit_code=0\nstdout: ${out}\nstderr: `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(out);
    expect(r.stderr).toBe("");
  });

  test("stdout containing the substrings 'stderr:' and 'exit_code=' does not mis-split", () => {
    // these appear inline (not as the real '\nstderr: ' marker / not at string start), so the
    // marker-based parser must keep them inside stdout.
    const out = "exit_code=99 was printed and stderr: was mentioned\nsecond line";
    const r = parseBashResult(`exit_code=0\nstdout: ${out}\nstderr: real-err`);
    expect(r.exitCode).toBe(0); // anchored ^exit_code= → the leading 0, not the inline 99
    expect(r.stdout).toBe(out); // inline 'stderr:' stayed in stdout
    expect(r.stderr).toBe("real-err");
  });

  test("non-zero exit code parses, with multiline stderr", () => {
    const err = "Traceback\n  File x\nError: boom";
    const r = parseBashResult(`exit_code=1\nstdout: \nstderr: ${err}`);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(err);
  });

  test("malformed input degrades gracefully", () => {
    const r = parseBashResult("totally unexpected");
    expect(r.exitCode).toBeNull();
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
    expect(r.raw).toBe("totally unexpected");
  });
});

describe("parseGrep", () => {
  test("groups hits by file with correct line and text", () => {
    const raw = ["/ws/a.py:3:def foo():", "/ws/a.py:7:    return 1", "/ws/b.txt:1:hello world"].join("\n");
    const g = parseGrep(raw);
    expect([...g.keys()]).toEqual(["/ws/a.py", "/ws/b.txt"]);
    expect(g.get("/ws/a.py")).toEqual([
      { line: 3, text: "def foo():" },
      { line: 7, text: "    return 1" },
    ]);
    expect(g.get("/ws/b.txt")).toEqual([{ line: 1, text: "hello world" }]);
  });

  test("text containing colons is preserved (non-greedy path, greedy text)", () => {
    const g = parseGrep("/ws/a.py:10:url = http://x:8080/path");
    expect(g.get("/ws/a.py")).toEqual([{ line: 10, text: "url = http://x:8080/path" }]);
  });

  test("'(no matches)' yields an empty map", () => {
    expect(parseGrep("(no matches)").size).toBe(0);
  });

  test("empty string yields an empty map", () => {
    expect(parseGrep("").size).toBe(0);
  });
});
