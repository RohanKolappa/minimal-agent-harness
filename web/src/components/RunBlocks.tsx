// Renderers for every block kind the run view produces. Tool-specific blocks (bash terminal,
// file viewer, grep matches, write preview, edit diff) follow §5.1.
import {
  Ban,
  Check,
  ChevronRight,
  CircleSlash,
  FileEdit,
  FilePlus2,
  FileText,
  Loader2,
  ShieldAlert,
  Terminal,
  X,
} from "lucide-react";
import { useState } from "react";
import type { Block } from "../agent/runModel";
import { basename, langForPath, parseBashResult, parseGrep, type GrepHit } from "../lib/format";
import type { Permission } from "../types";
import { CodeBlock } from "./CodeBlock";
import { DiffView } from "./DiffView";
import { Badge, PermissionBadge } from "./ui";

const TOOL_ICON: Record<string, typeof FileText> = {
  read_file: FileText,
  grep: FileText,
  write_file: FilePlus2,
  edit_file: FileEdit,
  bash: Terminal,
};

function ToolHeader({ tool, required }: { tool: string; required?: Permission }) {
  const Icon = TOOL_ICON[tool] ?? Terminal;
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Icon size={14} className="text-muted" />
      <span className="font-mono text-[13px] font-medium text-fg">{tool}</span>
      {required && <PermissionBadge level={required} />}
    </div>
  );
}

function BashBody({ args, result }: { args: Record<string, any>; result?: string }) {
  const parsed = result ? parseBashResult(result) : null;
  return (
    <div className="border-t border-line">
      <div className="flex items-center gap-2 bg-surface-2/60 px-3 py-2 font-mono text-[12.5px]">
        <span className="text-accent">$</span>
        <span className="text-fg">{args.cmd}</span>
      </div>
      {parsed && (
        <div className="border-t border-line">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span
              className={
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium " +
                (parsed.exitCode === 0
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-danger/30 bg-danger/10 text-danger")
              }
            >
              exit {parsed.exitCode}
            </span>
          </div>
          {parsed.stdout.trim() && <CodeBlock code={parsed.stdout} language="bash" />}
          {parsed.stderr.trim() && (
            <div className="border-t border-line">
              <div className="px-3 pt-1.5 text-[11px] uppercase tracking-wide text-danger/80">stderr</div>
              <CodeBlock code={parsed.stderr} language="bash" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolBody({ block }: { block: Block & { kind: "tool" } }) {
  const { tool, args, result, isError } = block;

  if (isError && result) {
    return (
      <div className="border-t border-line bg-danger/5 px-3 py-2 font-mono text-[12.5px] text-danger">
        {result}
      </div>
    );
  }

  if (tool === "bash") return <BashBody args={args} result={result} />;

  if (tool === "read_file") {
    return (
      <div className="border-t border-line">
        <div className="px-3 py-1.5 font-mono text-[11px] text-muted">{args.path}</div>
        {result !== undefined && (
          <div className="border-t border-line">
            <CodeBlock code={result} language={langForPath(String(args.path ?? ""))} showLineNumbers />
          </div>
        )}
      </div>
    );
  }

  if (tool === "grep") {
    const groups: Map<string, GrepHit[]> = result !== undefined ? parseGrep(result) : new Map();
    return (
      <div className="border-t border-line">
        <div className="px-3 py-1.5 font-mono text-[11px] text-muted">
          /{String(args.pattern)}/ in {args.path ?? "."}
        </div>
        {result !== undefined &&
          (groups.size === 0 ? (
            <div className="border-t border-line px-3 py-2 text-[12.5px] text-muted">no matches</div>
          ) : (
            <div className="border-t border-line">
              {[...groups.entries()].map(([file, hits]) => (
                <div key={file} className="border-b border-line/60 last:border-0">
                  <div className="bg-surface-2/50 px-3 py-1 font-mono text-[11px] text-accent">
                    {basename(file)}
                  </div>
                  {hits.map((h, i) => (
                    <div key={i} className="flex gap-3 px-3 py-0.5 font-mono text-[12px]">
                      <span className="w-8 shrink-0 text-right text-faint tabular-nums">{h.line}</span>
                      <span className="whitespace-pre-wrap break-words text-fg/90">{h.text}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
      </div>
    );
  }

  if (tool === "write_file") {
    return (
      <div className="border-t border-line">
        <div className="px-3 py-1.5 font-mono text-[11px] text-muted">
          {result ? "wrote " : "will write "}
          <span className="text-fg">{args.path}</span>
        </div>
        {args.content !== undefined && (
          <div className="border-t border-line">
            <CodeBlock code={String(args.content)} language={langForPath(String(args.path ?? ""))} />
          </div>
        )}
      </div>
    );
  }

  if (tool === "edit_file") {
    return (
      <div className="border-t border-line">
        <div className="px-3 py-1.5 font-mono text-[11px] text-muted">{args.path}</div>
        <div className="border-t border-line">
          <DiffView before={String(args.find ?? "")} after={String(args.replace ?? "")} />
        </div>
      </div>
    );
  }

  // fallback for any other tool
  return result !== undefined ? (
    <div className="border-t border-line px-3 py-2 font-mono text-[12.5px] text-fg/90">{result}</div>
  ) : null;
}

function ApprovalCard({
  block,
  onDecide,
  disabled,
}: {
  block: Block & { kind: "tool" };
  onDecide: (id: string, decision: "allow" | "deny") => void;
  disabled: boolean;
}) {
  const decided = block.decision === "allow" || block.decision === "deny";
  // lock the buttons the instant one is clicked, before approval_resolved arrives, so the same
  // approval_id can't be POSTed twice.
  const [submitted, setSubmitted] = useState(false);
  const locked = disabled || submitted;
  const decide = (d: "allow" | "deny") => {
    if (locked) return;
    setSubmitted(true);
    onDecide(block.approvalId!, d);
  };
  return (
    <div className="border-t border-warn/30 bg-warn/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warn" />
        <div className="flex-1">
          <div className="text-[13px] font-medium text-fg">Approval required</div>
          <div className="mt-0.5 text-[12.5px] text-muted">{block.reason}</div>
        </div>
      </div>
      {!decided ? (
        <div className="mt-2.5 flex gap-2">
          <button
            disabled={locked}
            onClick={() => decide("allow")}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
          >
            <Check size={13} /> Approve
          </button>
          <button
            disabled={locked}
            onClick={() => decide("deny")}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-fg transition hover:bg-surface-2 disabled:opacity-50"
          >
            <X size={13} /> Deny
          </button>
        </div>
      ) : (
        <div className="mt-2">
          <Badge tone={block.decision === "allow" ? "success" : "danger"}>
            {block.decision === "allow" ? <Check size={11} /> : <Ban size={11} />}
            {block.decision === "allow" ? "Approved" : "Denied"}
          </Badge>
        </div>
      )}
    </div>
  );
}

function ToolBlock({
  block,
  onDecide,
  interactive,
}: {
  block: Block & { kind: "tool" };
  onDecide: (id: string, decision: "allow" | "deny") => void;
  interactive: boolean;
}) {
  const pending = block.decision === "pending";
  const denied = block.deniedByHook;
  return (
    <div className="animate-in overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
      <ToolHeader tool={block.tool} required={block.required} />
      {block.approvalId && (
        <ApprovalCard block={block} onDecide={onDecide} disabled={!interactive || !pending} />
      )}
      {denied ? (
        <div className="border-t border-line bg-danger/5 px-3 py-2 text-[12.5px] text-danger">
          Denied by approval — the tool did not run.
        </div>
      ) : block.result === undefined && !pending && block.required !== undefined ? (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12.5px] text-muted">
          <Loader2 size={13} className="animate-spin" /> running…
        </div>
      ) : (
        <ToolBody block={block} />
      )}
    </div>
  );
}

function BlockedBlock({ block }: { block: Block & { kind: "blocked" } }) {
  const copy =
    block.variant === "permission"
      ? {
          title: "Blocked by permission ceiling",
          body: (
            <>
              <span className="font-mono">{block.tool}</span> needs{" "}
              <PermissionBadge level={block.required ?? "full"} /> but the run ceiling is{" "}
              <PermissionBadge level={block.ceiling ?? "workspace"} />. It was rejected before any
              approval — raise the ceiling to <span className="font-mono">full</span> to allow it.
            </>
          ),
        }
      : block.variant === "hook"
        ? { title: "Denied by hook", body: <>The pre-hook denied <span className="font-mono">{block.tool}</span>.</> }
        : { title: "Unknown tool", body: <>The model called an unregistered tool <span className="font-mono">{block.tool}</span>.</> };
  return (
    <div className="animate-in rounded-[var(--radius)] border border-danger/30 bg-danger/5 px-3 py-2.5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-danger">
        <CircleSlash size={14} /> {copy.title}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">{copy.body}</div>
    </div>
  );
}

function ModelCollapsible({ block }: { block: Block & { kind: "model" } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[12px]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-faint transition hover:text-muted"
      >
        <ChevronRight size={12} className={"transition " + (open ? "rotate-90" : "")} />
        model decision
      </button>
      {open && (
        <pre className="mt-1 overflow-auto rounded-md border border-line bg-surface-2 px-2.5 py-2 text-[11.5px] text-muted">
          {JSON.stringify({ text: block.text, tool_call: block.toolCall }, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function RenderBlock({
  block,
  onDecide,
  interactive,
}: {
  block: Block;
  onDecide: (id: string, decision: "allow" | "deny") => void;
  interactive: boolean;
}) {
  switch (block.kind) {
    case "iteration":
      return (
        <div className="flex items-center gap-3 py-1 text-[11px] text-faint">
          <div className="h-px flex-1 bg-line" />
          <span className="tabular-nums">
            iteration {block.n} / {block.max}
          </span>
          <div className="h-px flex-1 bg-line" />
        </div>
      );
    case "compaction":
      return (
        <div className="py-0.5 text-center text-[11px] text-faint">
          history compacted ({block.from} → {block.to} messages)
        </div>
      );
    case "model":
      return <ModelCollapsible block={block} />;
    case "tool":
      return <ToolBlock block={block} onDecide={onDecide} interactive={interactive} />;
    case "blocked":
      return <BlockedBlock block={block} />;
    case "final":
      return (
        <div className="animate-in rounded-[var(--radius)] border border-accent/30 bg-accent-soft px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-accent">
            <Check size={12} /> Final answer
          </div>
          <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-fg">{block.text}</div>
        </div>
      );
    case "finished":
      return <FinishedBanner reason={block.reason} error={block.error} />;
  }
}

export function FinishedBanner({ reason, error }: { reason: string; error?: string }) {
  const map: Record<string, { tone: "success" | "danger" | "warn" | "neutral"; label: string }> = {
    completed: { tone: "success", label: "Completed" },
    max_iterations: { tone: "warn", label: "Stopped — reached max iterations" },
    cancelled: { tone: "neutral", label: "Cancelled" },
    error: { tone: "danger", label: "Error" },
  };
  const m = map[reason] ?? { tone: "neutral", label: reason };
  return (
    <div className="animate-in flex items-center justify-between py-1">
      <Badge tone={m.tone}>
        {reason === "completed" ? <Check size={11} /> : reason === "error" ? <Ban size={11} /> : null}
        {m.label}
      </Badge>
      {error && (
        <span className="ml-3 text-[12px] text-danger">
          {error} — open <span className="font-medium">Setup</span> or run offline.
        </span>
      )}
    </div>
  );
}
