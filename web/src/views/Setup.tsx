import { Check, Circle, Copy, Loader2, Play, X } from "lucide-react";
import { useState } from "react";
import { useHealth } from "../hooks/useHealth";
import type { Health } from "../types";

type StepState = "done" | "todo" | "blocked";

function CommandRow({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2/60 px-3 py-2">
      <code className="overflow-x-auto whitespace-nowrap text-[12.5px] text-fg">{cmd}</code>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(cmd);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-[11.5px] text-muted transition hover:text-fg"
      >
        {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <Check size={16} className="text-success" />;
  if (state === "blocked") return <X size={16} className="text-danger" />;
  return <Circle size={16} className="text-faint" />;
}

function Step({
  index,
  title,
  state,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border " +
            (state === "done"
              ? "border-success/40 bg-success/10"
              : state === "blocked"
                ? "border-danger/40 bg-danger/10"
                : "border-line bg-surface")
          }
        >
          <StepIcon state={state} />
        </div>
        {index < 3 && <div className="my-1 w-px flex-1 bg-line" />}
      </div>
      <div className="flex-1 pb-6">
        <div className="text-[14px] font-medium text-fg">{title}</div>
        <div className="mt-1 text-[13px] leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  );
}

export function Setup({ onTryOffline }: { onTryOffline: () => void }) {
  const { health, loading, refresh } = useHealth(3500);

  const installed = !!health?.ollama_installed;
  const running = !!health?.ollama_running;
  const modelPresent = !!health?.recommended_present;
  const allGreen = installed && running && modelPresent;

  const s1: StepState = installed ? "done" : "todo";
  const s2: StepState = running ? "done" : installed ? "todo" : "blocked";
  const s3: StepState = modelPresent ? "done" : running ? "todo" : "blocked";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-fg">Setup</h1>
          <p className="mt-1 text-[13px] text-muted">
            Get a local model running, or skip straight to offline mode.
          </p>
        </div>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-muted transition hover:text-fg"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          re-check
        </button>
      </div>

      {allGreen && (
        <div className="mb-6 flex items-center gap-2 rounded-[var(--radius)] border border-success/30 bg-success/10 px-4 py-3 text-[13px] text-success">
          <Check size={16} /> Everything's ready — {health?.recommended_model} is pulled and the server
          is up. Head to the Agent tab.
        </div>
      )}

      <div className="rounded-[var(--radius)] border border-line bg-surface px-5 py-5">
        <Step index={1} title="Install Ollama" state={s1}>
          On macOS install the <span className="font-medium text-fg">app bundle (cask)</span>, not the
          bare formula — the plain formula ships without the inference backend.
          <CommandRow cmd="brew install --cask ollama-app" />
        </Step>

        <Step index={2} title="Start the server (127.0.0.1:11434)" state={s2}>
          Launch the app once; it keeps the local server running.
          <CommandRow cmd="open -a Ollama" />
          <div className="mt-1 text-[12px] text-faint">…or run <code>ollama serve</code> in a terminal.</div>
        </Step>

        <Step index={3} title="Pull the recommended model" state={s3}>
          <span className="font-mono text-[12px]">{health?.recommended_model ?? "qwen2.5-coder:7b"}</span>{" "}
          (~4.7GB) is strongest at the JSON tool protocol.
          <CommandRow cmd={`ollama pull ${health?.recommended_model ?? "qwen2.5-coder:7b"}`} />
          {running && health && health.models.length > 0 && (
            <div className="mt-2 text-[12px] text-muted">
              Installed: {health.models.map((m) => <span key={m} className="font-mono">{m} </span>)}
            </div>
          )}
        </Step>
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-[var(--radius)] border border-accent/30 bg-accent-soft px-4 py-3">
        <div className="flex-1 text-[13px] text-fg">
          <div className="font-medium">In a hurry?</div>
          <div className="text-muted">
            Offline mode runs a scripted demo of the full loop — no Ollama required.
          </div>
        </div>
        <button
          onClick={onTryOffline}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-[13px] font-medium text-accent-fg transition hover:opacity-90"
        >
          <Play size={14} /> Skip — try offline
        </button>
      </div>

      <HealthFooter health={health} />
    </div>
  );
}

function HealthFooter({ health }: { health: Health | null }) {
  if (!health) return null;
  return (
    <div className="mt-4 text-[11.5px] text-faint">
      host <span className="font-mono">{health.ollama_host}</span> · sandbox{" "}
      <span className="font-mono">{health.workspace_root}</span>
    </div>
  );
}
