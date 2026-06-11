// Syntax-highlighted code surface using prism-react-renderer with a custom theme tuned to our
// neutral/accent palette. Optional line numbers; falls back gracefully for plain text.
import { Highlight, type PrismTheme } from "prism-react-renderer";

const theme: PrismTheme = {
  plain: { color: "var(--fg)", backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "var(--faint)", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "var(--muted)" } },
    { types: ["property", "tag", "boolean", "number", "constant", "symbol"], style: { color: "#e0a23a" } },
    { types: ["selector", "attr-name", "string", "char", "builtin"], style: { color: "#46c66b" } },
    { types: ["operator", "entity", "url", "variable"], style: { color: "var(--fg)" } },
    { types: ["atrule", "attr-value", "keyword"], style: { color: "var(--accent)" } },
    { types: ["function", "class-name"], style: { color: "#7cc7ff" } },
    { types: ["regex", "important"], style: { color: "#f8615a" } },
  ],
};

export function CodeBlock({
  code,
  language = "text",
  showLineNumbers = false,
  maxHeight = 360,
}: {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  maxHeight?: number;
}) {
  return (
    <Highlight theme={theme} code={code.replace(/\n$/, "")} language={language}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre
          className="overflow-auto px-3 py-2.5 text-[12.5px] leading-relaxed"
          style={{ maxHeight }}
        >
          {tokens.map((line, i) => {
            const lineProps = getLineProps({ line });
            return (
              <div key={i} {...lineProps} className="table-row">
                {showLineNumbers && (
                  <span className="table-cell select-none pr-4 text-right text-faint tabular-nums">
                    {i + 1}
                  </span>
                )}
                <span className="table-cell whitespace-pre-wrap break-words">
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}
