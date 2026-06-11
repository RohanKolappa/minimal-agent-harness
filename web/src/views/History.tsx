import { ArrowLeft, Ban, Check, FileText, History as HistoryIcon, Loader2, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { CodeBlock } from "../components/CodeBlock";
import { Badge } from "../components/ui";
import { api } from "../lib/api";
import { langForPath, parseBashResult, timeAgo } from "../lib/format";
import type { SessionEvent, SessionSummary } from "../types";

export function History() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSessions()
      .then((s) => {
        setSessions(s);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (openId) return <Replay id={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="text-[18px] font-semibold text-fg">History</h1>
      <p className="mt-1 text-[13px] text-muted">Past runs, replayed from their persisted session logs.</p>

      <div className="mt-5 space-y-2">
        {error && (
          <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/5 px-4 py-3 text-[13px] text-danger">
            Couldn't load history: {error}. Is the backend running?
          </div>
        )}
        {!error && sessions === null && <div className="text-[13px] text-muted">Loading…</div>}
        {!error && sessions?.length === 0 && (
          <div className="rounded-[var(--radius)] border border-dashed border-line px-4 py-10 text-center">
            <HistoryIcon size={22} className="mx-auto mb-2 text-faint" />
            <div className="text-[13px] text-muted">No runs yet. Start one in the Agent tab.</div>
          </div>
        )}
        {sessions?.map((s) => (
          <button
            key={s.id}
            onClick={() => setOpenId(s.id)}
            className="flex w-full items-center gap-3 rounded-[var(--radius)] border border-line bg-surface px-4 py-3 text-left transition hover:border-accent/40"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] text-fg">{s.goal || "(untitled run)"}</div>
              <div className="mt-0.5 text-[11.5px] text-faint">
                {timeAgo(s.started)} · {s.events} events
              </div>
            </div>
            {s.final_present ? (
              <Badge tone="success">
                <Check size={11} /> done
              </Badge>
            ) : (
              <Badge tone="neutral">partial</Badge>
            )}
          </button>
        ))}
        </div>
      </div>
    </div>
  );
}

function Replay({ id, onBack }: { id: string; onBack: () => void }) {
  const [events, setEvents] = useState<SessionEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSession(id)
      .then((r) => setEvents(r.events))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted transition hover:text-fg">
        <ArrowLeft size={14} /> back to history
      </button>

      {error ? (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          Couldn't load this run: {error}.
        </div>
      ) : events === null ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={14} className="animate-spin" /> loading…
        </div>
      ) : (
        <div className="space-y-2.5">
          {events.map((e, i) => (
            <ReplayEvent key={i} event={e} />
          ))}
          <div className="pt-1 text-[11px] text-faint">
            Replayed from the persisted log (tool results are truncated to 500 chars on disk).
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function ReplayEvent({ event }: { event: SessionEvent }) {
  if (event.type === "goal")
    return (
      <div className="text-[13px] text-muted">
        <span className="text-faint">goal</span> · <span className="text-fg">{event.content}</span>
      </div>
    );

  if (event.type === "final")
    return (
      <div className="rounded-[var(--radius)] border border-accent/30 bg-accent-soft px-4 py-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-accent">Final</div>
        <div className="whitespace-pre-wrap text-[13.5px] text-fg">{event.content}</div>
      </div>
    );

  if (event.type === "denied")
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">
        <Ban size={12} className="mr-1 inline" /> denied: <span className="font-mono">{event.tool}</span>
      </div>
    );

  const Icon = event.tool === "bash" ? Terminal : FileText;
  if (event.type === "tool_call")
    return (
      <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
        <div className="flex items-center gap-2 px-3 py-2">
          <Icon size={14} className="text-muted" />
          <span className="font-mono text-[13px] text-fg">{event.tool}</span>
        </div>
        <pre className="overflow-auto border-t border-line px-3 py-2 text-[11.5px] text-muted">
          {JSON.stringify(event.args, null, 2)}
        </pre>
      </div>
    );

  // tool_result
  if (event.type === "tool_result") {
    if (event.tool === "bash") {
      const p = parseBashResult(event.result);
      return (
        <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
          <div className="px-3 py-1.5 text-[11px] text-faint">result · {event.tool}</div>
          {p.stdout.trim() && <CodeBlock code={p.stdout} language="bash" />}
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
        <div className="px-3 py-1.5 text-[11px] text-faint">result · {event.tool}</div>
        <CodeBlock code={event.result} language={langForPath(event.tool)} />
      </div>
    );
  }
  return null;
}
