// A compact line-level diff for edit_file, computed from the find -> replace strings with the
// `diff` package. edit_file's result only confirms success, so the diff is derived from the args.
import { diffLines } from "diff";

export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = diffLines(before, after);
  const rows: { sign: " " | "+" | "-"; text: string }[] = [];

  for (const part of parts) {
    const sign = part.added ? "+" : part.removed ? "-" : " ";
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const line of lines) rows.push({ sign: sign as " " | "+" | "-", text: line });
  }

  return (
    <pre className="overflow-auto px-0 py-1.5 text-[12.5px] leading-relaxed" style={{ maxHeight: 320 }}>
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            "flex px-3 " +
            (r.sign === "+"
              ? "bg-success/10 text-success"
              : r.sign === "-"
                ? "bg-danger/10 text-danger"
                : "text-muted")
          }
        >
          <span className="select-none pr-3 opacity-70">{r.sign}</span>
          <span className="whitespace-pre-wrap break-words">{r.text || " "}</span>
        </div>
      ))}
    </pre>
  );
}
