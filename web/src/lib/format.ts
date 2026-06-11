// Result parsers and small formatting helpers.

// Parse the bash tool result. It is "exit_code=<int>\nstdout: <...>\nstderr: <...>" where stdout
// and stderr may themselves contain newlines, so we locate the markers rather than splitting lines.
export interface BashResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  raw: string;
}

export function parseBashResult(raw: string): BashResult {
  const exitMatch = raw.match(/^exit_code=(-?\d+)/);
  const stdoutMarker = "\nstdout: ";
  const stderrMarker = "\nstderr: ";
  const sIdx = raw.indexOf(stdoutMarker);
  const eIdx = raw.indexOf(stderrMarker, sIdx >= 0 ? sIdx : 0);

  if (sIdx === -1 || eIdx === -1) {
    return { exitCode: exitMatch ? Number(exitMatch[1]) : null, stdout: "", stderr: "", raw };
  }
  const stdout = raw.slice(sIdx + stdoutMarker.length, eIdx);
  const stderr = raw.slice(eIdx + stderrMarker.length);
  return {
    exitCode: exitMatch ? Number(exitMatch[1]) : null,
    stdout,
    stderr,
    raw,
  };
}

// Parse grep output: "<path>:<lineno>:<text>" lines, grouped by file. "(no matches)" → empty.
export interface GrepHit {
  line: number;
  text: string;
}
export function parseGrep(raw: string): Map<string, GrepHit[]> {
  const groups = new Map<string, GrepHit[]>();
  if (!raw || raw.trim() === "(no matches)") return groups;
  for (const line of raw.split("\n")) {
    const m = line.match(/^(.*?):(\d+):(.*)$/);
    if (!m) continue;
    const [, file, lineno, text] = m;
    if (!groups.has(file)) groups.set(file, []);
    groups.get(file)!.push({ line: Number(lineno), text });
  }
  return groups;
}

// Map a file path's extension to a prism-react-renderer language id.
const EXT_LANG: Record<string, string> = {
  py: "python",
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  html: "markup",
  css: "css",
  txt: "text",
};

export function langForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "text";
}

export function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function timeAgo(epochSeconds: number): string {
  const diff = Date.now() / 1000 - epochSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
