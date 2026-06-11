import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { streamSse } from "../lib/sse";
import { buildRunModel } from "../agent/runModel";
import type { RunEvent, RunRequest } from "../types";

export type RunStatus = "idle" | "running" | "stopping" | "finished";

export function useRun() {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<{ abort: () => void } | null>(null);

  const model = useMemo(() => buildRunModel(events), [events]);

  // abort any in-flight reader when this component unmounts so the fetch doesn't leak
  useEffect(() => () => handleRef.current?.abort(), []);

  const start = useCallback(async (req: RunRequest) => {
    handleRef.current?.abort(); // tear down any previous stream before opening a new one
    handleRef.current = null;
    setError(null);
    setEvents([]);
    setStatus("running");
    try {
      const { run_id } = await api.startRun(req);
      setRunId(run_id);
      handleRef.current = await streamSse<RunEvent>(
        api.eventsUrl(run_id),
        { method: "GET" },
        (ev) => {
          setEvents((prev) => [...prev, ev]);
          if (ev.type === "run_finished") setStatus("finished");
        },
        (err) => {
          setError(String(err));
          setStatus("finished");
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  }, []);

  const approve = useCallback(
    async (approvalId: string, decision: "allow" | "deny") => {
      if (!runId) return;
      await api.approve(runId, approvalId, decision);
    },
    [runId],
  );

  const cancel = useCallback(async () => {
    if (!runId) return;
    setStatus("stopping");
    await api.cancel(runId);
  }, [runId]);

  const reset = useCallback(() => {
    handleRef.current?.abort();
    handleRef.current = null;
    setEvents([]);
    setStatus("idle");
    setRunId(null);
    setError(null);
  }, []);

  return { model, status, runId, error, start, approve, cancel, reset };
}
