// API client. Base defaults to same-origin /api (works for prod static serving and, via the Vite
// dev proxy, for development too). Override with VITE_API_BASE if you run the API elsewhere.

import type { Health, RunRequest, SessionEvent, SessionSummary } from "../types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json() as Promise<T>;
}

export const api = {
  base: BASE,

  health: () => json<Health>("/health"),

  startRun: (req: RunRequest) =>
    json<{ run_id: string }>("/run", { method: "POST", body: JSON.stringify(req) }),

  eventsUrl: (runId: string) => `${BASE}/run/${runId}/events`,

  approve: (runId: string, approvalId: string, decision: "allow" | "deny") =>
    json<{ ok: boolean }>(`/run/${runId}/approve`, {
      method: "POST",
      body: JSON.stringify({ approval_id: approvalId, decision }),
    }),

  cancel: (runId: string) =>
    json<{ ok: boolean }>(`/run/${runId}/cancel`, { method: "POST" }),

  assistantUrl: () => `${BASE}/assistant`,

  listSessions: () => json<SessionSummary[]>("/sessions"),

  getSession: (id: string) => json<{ id: string; events: SessionEvent[] }>(`/sessions/${id}`),
};
