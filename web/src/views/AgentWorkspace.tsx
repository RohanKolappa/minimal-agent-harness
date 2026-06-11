import { ArrowUp, Cpu, FolderLock, RotateCcw, Settings2, Square, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RenderBlock } from "../components/RunBlocks";
import { Badge, Kbd, PermissionBadge } from "../components/ui";
import { useRun } from "../hooks/useRun";
import { bestAvailableModel } from "../lib/models";
import type { ApprovalPolicy, Health, Permission } from "../types";

const DEFAULT_POLICY: ApprovalPolicy = {
  auto_approve_reads: true,
  require_approval_for_writes: true,
  auto_approve_all: false,
};

export function AgentWorkspace({ health }: { health: Health | null }) {
  const { model, status, error, start, approve, cancel, reset } = useRun();
  const [goal, setGoal] = useState("");
  const [offline, setOffline] = useState(false);
  const [permission, setPermission] = useState<Permission>("workspace");
  const [policy, setPolicy] = useState<ApprovalPolicy>(DEFAULT_POLICY);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingFull, setPendingFull] = useState(false);
  const [chosenModel, setChosenModel] = useState<string | null>(() => localStorage.getItem("agent_model"));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const running = status === "running" || status === "stopping";
  const workspace = health?.workspace_root ?? "the sandbox";

  const models = health?.models ?? [];
  const selectedModel = bestAvailableModel(models, health?.default_model, chosenModel);
  const noModel = !offline && models.length === 0;

  const pickModel = (m: string) => {
    setChosenModel(m);
    localStorage.setItem("agent_model", m);
  };

  // a signal that changes when the LAST block's content grows in place (a long tool_result or the
  // final answer filling an existing block), not only when a new block is appended.
  const lastBlock = model.blocks[model.blocks.length - 1] as any;
  const tailSig = lastBlock
    ? `${lastBlock.kind}:${String(lastBlock.result ?? lastBlock.text ?? "").length}:${lastBlock.decision ?? ""}`
    : "";

  // auto-scroll to latest while the user is at the bottom
  useEffect(() => {
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [model.blocks.length, tailSig, atBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const submit = () => {
    if (running) return;
    if (!offline && !goal.trim()) return;
    if (noModel) return; // no pulled model and not offline — Run is disabled
    start({
      goal: goal.trim(),
      offline,
      permission,
      model: offline ? undefined : selectedModel ?? undefined,
      approval_policy: policy,
    });
  };

  const setCeiling = (p: Permission) => {
    if (p === "full") {
      setPendingFull(true);
      return;
    }
    setPermission(p);
  };

  const hasRun = model.blocks.length > 0 || running;

  return (
    <div className="flex h-full flex-col">
      {/* run transcript */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        aria-live="polite"
        className="relative flex-1 overflow-y-auto px-4 py-5 sm:px-6"
      >
        <div className="mx-auto max-w-3xl space-y-2.5">
          {!hasRun && <EmptyState workspace={workspace} offline={offline} />}

          {model.meta && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <span className="text-fg/80">{model.meta.goal || "(scripted offline demo)"}</span>
              <PermissionBadge level={model.meta.permission} />
              {model.meta.offline && (
                <Badge tone="neutral">
                  <WifiOff size={11} /> offline demo
                </Badge>
              )}
              <Badge tone="neutral">{model.meta.model}</Badge>
            </div>
          )}

          {model.blocks.map((b, i) => (
            <RenderBlock key={i} block={b} onDecide={approve} interactive={running} />
          ))}

          {error && status !== "finished" && (
            <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">
              {error}
            </div>
          )}
        </div>

        {!atBottom && (
          <button
            onClick={() => {
              setAtBottom(true);
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
            }}
            className="sticky bottom-3 left-1/2 ml-[-72px] inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-muted shadow-lg transition hover:text-fg"
          >
            ↓ Jump to latest
          </button>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-line bg-surface/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1">
              <FolderLock size={12} /> sandbox:
            </span>
            <span className="font-mono text-[11.5px] text-fg/70">{workspace}</span>
            <span className="text-faint">· the agent is confined here</span>
          </div>

          <div className="flex items-end gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 focus-within:border-accent/50">
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              disabled={running}
              placeholder={offline ? "Offline scripted demo — goal text is not interpreted" : "What should the agent do?"}
              className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-[14px] text-fg outline-none placeholder:text-faint disabled:opacity-60"
            />
            {running ? (
              <button
                onClick={cancel}
                disabled={status === "stopping"}
                className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-[12.5px] font-medium text-danger transition hover:bg-danger/15 disabled:opacity-60"
              >
                <Square size={12} /> {status === "stopping" ? "Stopping…" : "Stop"}
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={(!offline && !goal.trim()) || noModel}
                title={noModel ? "No model pulled — see Setup, or run offline" : undefined}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-40"
              >
                <ArrowUp size={13} /> Run
              </button>
            )}
          </div>

          {noModel && (
            <div className="mt-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
              No model is pulled. Open the <span className="font-medium">Setup</span> tab to install
              one, or tick <span className="font-medium">Offline</span> to run the scripted demo.
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-muted">
              <input
                type="checkbox"
                checked={offline}
                onChange={(e) => setOffline(e.target.checked)}
                disabled={running}
                className="accent-[var(--accent)]"
              />
              <WifiOff size={12} /> Offline (scripted demo)
            </label>

            {!offline && models.length > 0 && (
              <label className="inline-flex items-center gap-1.5 text-muted">
                <Cpu size={12} /> model:
                <select
                  value={selectedModel ?? ""}
                  disabled={running}
                  onChange={(e) => pickModel(e.target.value)}
                  className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11.5px] text-fg outline-none focus:border-accent/50 disabled:opacity-50"
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                      {m === health?.default_model ? "  (default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="inline-flex items-center gap-1.5 text-muted">
              ceiling:
              <div className="inline-flex overflow-hidden rounded-md border border-line">
                {(["read", "workspace", "full"] as Permission[]).map((p) => (
                  <button
                    key={p}
                    disabled={running}
                    onClick={() => setCeiling(p)}
                    className={
                      "px-2 py-0.5 text-[11.5px] transition disabled:opacity-50 " +
                      (permission === p ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2")
                    }
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowSettings((s) => !s)}
              className="inline-flex items-center gap-1 text-muted transition hover:text-fg"
            >
              <Settings2 size={12} /> approvals
            </button>

            {status === "finished" && (
              <button onClick={reset} className="inline-flex items-center gap-1 text-muted transition hover:text-fg">
                <RotateCcw size={12} /> new run
              </button>
            )}

            <span className="ml-auto text-faint">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd> to run
            </span>
          </div>

          {showSettings && (
            <ApprovalSettings policy={policy} setPolicy={setPolicy} disabled={running} />
          )}
        </div>
      </div>

      {pendingFull && (
        <FullCeilingConfirm
          onCancel={() => setPendingFull(false)}
          onConfirm={() => {
            setPermission("full");
            setPendingFull(false);
          }}
        />
      )}
    </div>
  );
}

function ApprovalSettings({
  policy,
  setPolicy,
  disabled,
}: {
  policy: ApprovalPolicy;
  setPolicy: (p: ApprovalPolicy) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-2 rounded-[var(--radius)] border border-line bg-surface-2/50 px-3 py-2.5 text-[12.5px]">
      <label className="flex items-center gap-2 py-0.5 text-muted">
        <input
          type="checkbox"
          checked={policy.auto_approve_reads}
          disabled={disabled}
          onChange={(e) => setPolicy({ ...policy, auto_approve_reads: e.target.checked })}
          className="accent-[var(--accent)]"
        />
        Auto-approve reads (read_file, grep, safe bash)
      </label>
      <label className="flex items-center gap-2 py-0.5 text-muted">
        <input
          type="checkbox"
          checked={policy.require_approval_for_writes}
          disabled={disabled || policy.auto_approve_all}
          onChange={(e) => setPolicy({ ...policy, require_approval_for_writes: e.target.checked })}
          className="accent-[var(--accent)]"
        />
        Require approval for writes & workspace bash
      </label>
      <label className="flex items-center gap-2 py-0.5 text-warn">
        <input
          type="checkbox"
          checked={policy.auto_approve_all}
          disabled={disabled}
          onChange={(e) => setPolicy({ ...policy, auto_approve_all: e.target.checked })}
          className="accent-[var(--warn)]"
        />
        Auto-approve everything (skips all cards — use with care)
      </label>
    </div>
  );
}

function FullCeilingConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-in w-full max-w-md rounded-[var(--radius)] border border-danger/40 bg-surface p-5"
      >
        <div className="flex items-center gap-2 text-[15px] font-semibold text-danger">Raise ceiling to full?</div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          <span className="font-medium text-fg">full</span> permission lets the agent run dangerous
          shell commands (<span className="font-mono">rm</span>, <span className="font-mono">git</span>,
          pipes, redirects). The file sandbox still confines paths, but a full shell is{" "}
          <span className="font-medium text-fg">not containerized</span>. Such actions will then reach
          an approval card instead of being hard-blocked.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-fg transition hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-danger px-3 py-1.5 text-[13px] font-medium text-white transition hover:opacity-90"
          >
            I understand, enable full
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ workspace, offline }: { workspace: string; offline: boolean }) {
  const examples = [
    "Create a file notes.md with three setup tips, then read it back.",
    "List the files in the workspace and summarize what's here.",
    "Grep welcome.txt for the word 'sandbox' and explain the match.",
  ];
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface">
        <FolderLock size={20} className="text-accent" />
      </div>
      <h2 className="text-[16px] font-semibold text-fg">Agent workspace</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
        Give the agent a plain-English task. It runs step by step inside{" "}
        <span className="font-mono text-[12px] text-fg/70">{workspace}</span>, asking for approval
        before it writes or runs commands.
        {offline && " Offline mode runs a fixed scripted demo."}
      </p>
      {!offline && (
        <div className="mt-5 space-y-1.5 text-left">
          {examples.map((ex) => (
            <div
              key={ex}
              className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-muted"
            >
              {ex}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
