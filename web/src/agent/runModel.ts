// Folds the raw SSE event stream (§4.1) into an ordered list of renderable blocks, pairing each
// tool_call with its approval (if any) and its tool_result. The backend emits, in order:
//   approval_request -> approval_resolved -> tool_call -> tool_result        (gated tool, allowed)
//   approval_request -> approval_resolved -> hook_denied                     (gated tool, denied)
//   tool_call -> tool_result                                                 (auto-approved tool)
//   permission_denied | tool_error                                          (rejected before the hook)

import type { Permission, RunEvent, ToolCall } from "../types";

export interface RunMeta {
  goal: string;
  workspace: string;
  model: string;
  permission: Permission;
  offline: boolean;
}

export type Block =
  | { kind: "iteration"; n: number; max: number }
  | { kind: "model"; text: string; toolCall: ToolCall | null }
  | { kind: "compaction"; from: number; to: number }
  | {
      kind: "tool";
      tool: string;
      args: Record<string, any>;
      required?: Permission;
      approvalId?: string;
      reason?: string;
      decision?: "pending" | "allow" | "deny";
      result?: string;
      isError?: boolean;
      deniedByHook?: boolean;
    }
  | { kind: "blocked"; variant: "permission" | "hook" | "unknown"; tool: string; required?: Permission; ceiling?: Permission }
  | { kind: "final"; text: string }
  | { kind: "finished"; reason: string; error?: string };

export interface RunModel {
  meta: RunMeta | null;
  blocks: Block[];
  pendingApproval: { approvalId: string; tool: string; args: Record<string, any>; reason: string } | null;
  finished: boolean;
  finishReason: string | null;
  finishError?: string;
}

export function buildRunModel(events: RunEvent[]): RunModel {
  let meta: RunMeta | null = null;
  const blocks: Block[] = [];
  let openIdx: number | null = null; // index of the current unfinished tool block
  let pendingApproval: RunModel["pendingApproval"] = null;
  let finished = false;
  let finishReason: string | null = null;
  let finishError: string | undefined;

  const openTool = (): (Block & { kind: "tool" }) | null =>
    openIdx !== null && blocks[openIdx]?.kind === "tool" ? (blocks[openIdx] as any) : null;

  for (const e of events) {
    switch (e.type) {
      case "run_started":
        meta = { goal: e.goal, workspace: e.workspace, model: e.model, permission: e.permission, offline: e.offline };
        break;
      case "iteration":
        blocks.push({ kind: "iteration", n: e.n, max: e.max });
        break;
      case "compaction":
        blocks.push({ kind: "compaction", from: e.from, to: e.to });
        break;
      case "model_response":
        // only the tool-turn decisions are interesting as a collapsible; the final turn is rendered
        // as its own highlighted block.
        if (e.stop_reason === "tool_call") {
          blocks.push({ kind: "model", text: e.text, toolCall: e.tool_call });
        }
        break;
      case "approval_request": {
        blocks.push({
          kind: "tool",
          tool: e.tool,
          args: e.args,
          approvalId: e.approval_id,
          reason: e.reason,
          decision: "pending",
        });
        openIdx = blocks.length - 1;
        pendingApproval = { approvalId: e.approval_id, tool: e.tool, args: e.args, reason: e.reason };
        break;
      }
      case "approval_resolved": {
        const b = openTool();
        if (b && b.approvalId === e.approval_id) b.decision = e.decision;
        if (pendingApproval?.approvalId === e.approval_id) pendingApproval = null;
        break;
      }
      case "tool_call": {
        const b = openTool();
        if (b && b.result === undefined && b.required === undefined) {
          b.required = e.required_permission;
          b.tool = e.tool;
          b.args = e.args;
        } else {
          blocks.push({ kind: "tool", tool: e.tool, args: e.args, required: e.required_permission });
          openIdx = blocks.length - 1;
        }
        break;
      }
      case "tool_result": {
        const b = openTool();
        if (b) {
          b.result = e.result;
          b.isError = e.is_error;
        }
        openIdx = null;
        break;
      }
      case "hook_denied": {
        const b = openTool();
        if (b) {
          b.deniedByHook = true;
          if (b.decision === "pending") b.decision = "deny";
        } else {
          blocks.push({ kind: "blocked", variant: "hook", tool: e.tool });
        }
        if (pendingApproval?.tool === e.tool) pendingApproval = null;
        openIdx = null;
        break;
      }
      case "permission_denied":
        blocks.push({ kind: "blocked", variant: "permission", tool: e.tool, required: e.required, ceiling: e.ceiling });
        break;
      case "tool_error":
        blocks.push({ kind: "blocked", variant: "unknown", tool: e.tool });
        break;
      case "final":
        blocks.push({ kind: "final", text: e.text });
        break;
      case "run_finished":
        finished = true;
        finishReason = e.reason;
        finishError = e.error;
        pendingApproval = null; // clear any still-pending card on terminal
        blocks.push({ kind: "finished", reason: e.reason, error: e.error });
        break;
    }
  }

  return { meta, blocks, pendingApproval, finished, finishReason, finishError };
}
