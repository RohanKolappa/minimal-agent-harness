import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Health } from "../types";

// Polls /api/health. Re-checks every `intervalMs` while the model isn't fully ready, so the
// onboarding chips update live as the user installs/pulls. Backs off once everything is green.
export function useHealth(intervalMs = 4000) {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const h = await api.health();
      setHealth(h);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const tick = () => {
      refresh();
      timer.current = window.setTimeout(tick, intervalMs);
    };
    timer.current = window.setTimeout(tick, intervalMs);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [refresh, intervalMs]);

  return { health, loading, refresh };
}
