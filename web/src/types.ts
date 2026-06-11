// The event contract the backend streams over SSE (§4.1). Discriminated on `type`.

export type Permission = "read" | "workspace" | "full";

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export type RunEvent =
  | { type: "run_started"; goal: string; workspace: string; model: string; permission: Permission; offline: boolean }
  | { type: "iteration"; n: number; max: number }
  | { type: "model_response"; stop_reason: string | null; text: string; tool_call: ToolCall | null }
  | { type: "compaction"; from: number; to: number }
  | { type: "tool_call"; tool: string; args: Record<string, any>; required_permission: Permission }
  | { type: "approval_request"; approval_id: string; tool: string; args: Record<string, any>; reason: string }
  | { type: "approval_resolved"; approval_id: string; decision: "allow" | "deny" }
  | { type: "tool_result"; tool: string; result: string; is_error: boolean }
  | { type: "permission_denied"; tool: string; required: Permission; ceiling: Permission }
  | { type: "hook_denied"; tool: string; args: Record<string, any> }
  | { type: "tool_error"; tool: string; error: string }
  | { type: "final"; text: string }
  | { type: "run_finished"; reason: "completed" | "max_iterations" | "cancelled" | "error"; error?: string };

// Persisted session events (§1.3) — the five shapes used by the History replay view.
export type SessionEvent =
  | { type: "goal"; content: string }
  | { type: "tool_call"; tool: string; args: Record<string, any> }
  | { type: "tool_result"; tool: string; result: string }
  | { type: "denied"; tool: string; args: Record<string, any> }
  | { type: "final"; content: string };

export interface Health {
  ollama_installed: boolean;
  ollama_running: boolean;
  models: string[];
  recommended_present: boolean;
  ollama_host: string;
  default_model: string;
  recommended_model: string;
  workspace_root: string;
  offline_available: boolean;
}

export interface ApprovalPolicy {
  auto_approve_reads: boolean;
  require_approval_for_writes: boolean;
  auto_approve_all: boolean;
}

export interface RunRequest {
  goal: string;
  offline: boolean;
  model?: string;
  permission: Permission;
  approval_policy: ApprovalPolicy;
}

export interface SessionSummary {
  id: string;
  goal: string;
  started: number;
  final_present: boolean;
  events: number;
}

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}
