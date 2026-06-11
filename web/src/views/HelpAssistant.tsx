import { ArrowUp, Bot, Sparkles, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { bestAvailableModel } from "../lib/models";
import { streamSse, type SseHandle } from "../lib/sse";
import type { ChatMessage, Health } from "../types";

type Frame = { type: "token"; text: string } | { type: "done" } | { type: "error"; message: string };

const SUGGESTIONS = [
  "How do I install this?",
  "What can the agent do?",
  "Why was my command refused?",
  "What do the permission levels mean?",
];

export function HelpAssistant({ health }: { health: Health | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SseHandle | null>(null);

  // a usable model = the best available pulled model; null covers both "Ollama down" and
  // "no model pulled". The assistant uses the same selection as live runs.
  const model = bestAvailableModel(health?.models ?? [], health?.default_model);
  const unavailable = !model;

  // tear down the stream reader on unmount so the fetch doesn't leak
  useEffect(() => () => handleRef.current?.abort(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || streaming || unavailable) return;
    handleRef.current?.abort(); // never run two streams at once
    const next: ChatMessage[] = [...messages, { role: "user", content: text.trim() }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setDraft("");
    setStreaming(true);

    const append = (delta: string) =>
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + delta };
        return copy;
      });

    handleRef.current = await streamSse<Frame>(
      api.assistantUrl(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, model }),
      },
      (frame) => {
        if (frame.type === "token") append(frame.text);
        else if (frame.type === "error") append(`\n\n⚠ ${frame.message}`);
        else if (frame.type === "done") setStreaming(false);
      },
      (err) => {
        append(`\n\n⚠ Connection failed: ${err}`);
        setStreaming(false);
      },
    );
  };

  const empty = messages.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} aria-live="polite" className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {empty && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface">
                <Sparkles size={20} className="text-accent" />
              </div>
              <h2 className="text-[16px] font-semibold text-fg">Help assistant</h2>
              <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
                Ask about setup, what the agent can do, or the permission model. Answers come from your
                local model, grounded in this project's README.
              </p>
              {unavailable && (
                <p className="mx-auto mt-3 max-w-md rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
                  No local model is available — open the Setup tab to start Ollama and pull a model,
                  then come back to chat.
                </p>
              )}
              <div className="mx-auto mt-5 flex max-w-md flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={unavailable}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-muted transition hover:border-accent/40 hover:text-fg disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <Bubble key={i} message={m} streaming={streaming && i === messages.length - 1} />
          ))}
        </div>
      </div>

      <div className="border-t border-line bg-surface/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 focus-within:border-accent/50">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={1}
            disabled={unavailable}
            placeholder={unavailable ? "No local model available — see Setup" : "Ask about setup or capabilities…"}
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-[14px] text-fg outline-none placeholder:text-faint disabled:opacity-60"
          />
          <button
            onClick={() => send(draft)}
            disabled={!draft.trim() || streaming || unavailable}
            className="inline-flex items-center justify-center rounded-md bg-accent p-1.5 text-accent-fg transition hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUp size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const isUser = message.role === "user";
  return (
    <div className={"flex gap-3 " + (isUser ? "flex-row-reverse" : "")}>
      <div
        className={
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border " +
          (isUser ? "border-line bg-surface-2" : "border-accent/30 bg-accent-soft")
        }
      >
        {isUser ? <User size={14} className="text-muted" /> : <Bot size={14} className="text-accent" />}
      </div>
      <div
        className={
          "max-w-[85%] rounded-[var(--radius)] px-3.5 py-2.5 text-[13.5px] leading-relaxed " +
          (isUser ? "bg-accent text-accent-fg" : "border border-line bg-surface text-fg")
        }
      >
        <span className="whitespace-pre-wrap">{message.content}</span>
        {streaming && message.content === "" ? (
          <span className="inline-flex gap-1 align-middle">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
          </span>
        ) : (
          streaming && <span className="caret" />
        )}
      </div>
    </div>
  );
}
