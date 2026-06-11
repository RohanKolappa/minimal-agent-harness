import { Bot, History, Moon, Settings, Sparkles, Sun, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { useHealth } from "./hooks/useHealth";
import { useTheme } from "./hooks/useTheme";
import { AgentWorkspace } from "./views/AgentWorkspace";
import { HelpAssistant } from "./views/HelpAssistant";
import { History as HistoryView } from "./views/History";
import { Setup } from "./views/Setup";

type Tab = "agent" | "setup" | "help" | "history";

const NAV: { id: Tab; label: string; icon: typeof Terminal }[] = [
  { id: "agent", label: "Agent", icon: Terminal },
  { id: "setup", label: "Setup", icon: Settings },
  { id: "help", label: "Help", icon: Sparkles },
  { id: "history", label: "History", icon: History },
];

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const { health } = useHealth(6000);
  const [tab, setTab] = useState<Tab>(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    return (["agent", "setup", "help", "history"] as Tab[]).includes(q as Tab) ? (q as Tab) : "agent";
  });

  // first-run nudge: if the model clearly isn't ready, land the user on Setup once.
  const [nudged, setNudged] = useState(false);
  useEffect(() => {
    if (!nudged && health && (!health.ollama_running || !health.recommended_present)) {
      setTab("setup");
      setNudged(true);
    } else if (health) {
      setNudged(true);
    }
  }, [health, nudged]);

  const ready = health?.ollama_running && health?.recommended_present;

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      {/* sidebar */}
      <aside className="flex w-[68px] flex-col items-center border-r border-line bg-surface/50 py-4 sm:w-56 sm:items-stretch sm:px-3">
        <div className="mb-6 flex items-center gap-2 px-1 sm:px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Terminal size={16} />
          </div>
          <div className="hidden sm:block">
            <div className="text-[13px] font-semibold leading-tight">Agent Harness</div>
            <div className="text-[11px] text-faint">local · sandboxed</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={label}
              className={
                "flex items-center justify-center gap-2.5 rounded-md px-2 py-2 text-[13px] transition sm:justify-start " +
                (tab === id ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")
              }
            >
              <Icon size={16} className="shrink-0" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 pt-3">
          <HealthDot ready={!!ready} health={health} />
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="flex items-center justify-center gap-2 rounded-md px-2 py-2 text-[13px] text-muted transition hover:bg-surface-2 hover:text-fg sm:justify-start"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
        </div>
      </aside>

      {/* main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 sm:px-6">
          <Bot size={15} className="text-accent" />
          <h1 className="text-[14px] font-medium">{NAV.find((n) => n.id === tab)?.label}</h1>
        </header>
        <div className="min-h-0 flex-1">
          {tab === "agent" && <AgentWorkspace health={health} />}
          {tab === "setup" && <Setup onTryOffline={() => setTab("agent")} />}
          {tab === "help" && <HelpAssistant health={health} />}
          {tab === "history" && <HistoryView />}
        </div>
      </main>
    </div>
  );
}

function HealthDot({ ready, health }: { ready: boolean; health: ReturnType<typeof useHealth>["health"] }) {
  const state = !health
    ? { color: "bg-faint", label: "checking…" }
    : ready
      ? { color: "bg-success", label: "model ready" }
      : health.ollama_running
        ? { color: "bg-warn", label: "model not pulled" }
        : { color: "bg-danger", label: "ollama offline" };
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[11.5px] text-muted">
      <span className={"h-2 w-2 shrink-0 rounded-full " + state.color} />
      <span className="hidden sm:inline">{state.label}</span>
    </div>
  );
}
