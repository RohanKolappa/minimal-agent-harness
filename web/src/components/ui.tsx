// Small shared UI primitives: permission badges, status badges, and a section card.
import type { ReactNode } from "react";
import type { Permission } from "../types";

const PERM_STYLE: Record<Permission, string> = {
  read: "text-success border-success/30 bg-success/10",
  workspace: "text-accent border-accent/30 bg-accent-soft",
  full: "text-danger border-danger/30 bg-danger/10",
};

export function PermissionBadge({ level }: { level: Permission }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${PERM_STYLE[level]}`}
      title={`requires '${level}' permission`}
    >
      {level}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "danger" | "warn" | "accent";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "text-muted border-line bg-surface-2",
    success: "text-success border-success/30 bg-success/10",
    danger: "text-danger border-danger/30 bg-danger/10",
    warn: "text-warn border-warn/30 bg-warn/10",
    accent: "text-accent border-accent/30 bg-accent-soft",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[var(--radius)] border border-line bg-surface ${className}`}>{children}</div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
      {children}
    </kbd>
  );
}
