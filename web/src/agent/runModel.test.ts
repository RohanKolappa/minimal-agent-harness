import { describe, expect, test } from "vitest";
import { buildRunModel, type Block } from "./runModel";
import type { RunEvent } from "../types";

// terse event constructors (the backend also stamps run_id/ts, which buildRunModel ignores)
const started = (over: Partial<any> = {}): RunEvent =>
  ({ type: "run_started", goal: "g", workspace: "/ws", model: "m", permission: "workspace", offline: false, ...over }) as any;
const iter = (n: number, max = 15): RunEvent => ({ type: "iteration", n, max }) as any;
const modelResp = (stop = "tool_call"): RunEvent => ({ type: "model_response", stop_reason: stop, text: "", tool_call: null }) as any;
const toolCall = (tool: string, required: string, args: any = {}): RunEvent =>
  ({ type: "tool_call", tool, args, required_permission: required }) as any;
const toolResult = (tool: string, result: string, is_error = false): RunEvent =>
  ({ type: "tool_result", tool, result, is_error }) as any;
const apprReq = (tool: string, id = "a1", args: any = {}): RunEvent =>
  ({ type: "approval_request", approval_id: id, tool, args, reason: "r" }) as any;
const apprRes = (id: string, decision: "allow" | "deny"): RunEvent =>
  ({ type: "approval_resolved", approval_id: id, decision }) as any;
const hookDenied = (tool: string): RunEvent => ({ type: "hook_denied", tool, args: {} }) as any;
const permDenied = (tool: string, required: string, ceiling: string): RunEvent =>
  ({ type: "permission_denied", tool, required, ceiling }) as any;
const toolErr = (tool: string): RunEvent => ({ type: "tool_error", tool, error: "unknown_tool" }) as any;
const final = (text: string): RunEvent => ({ type: "final", text }) as any;
const finished = (reason: string, error?: string): RunEvent => ({ type: "run_finished", reason, error }) as any;

const tools = (m: { blocks: Block[] }) => m.blocks.filter((b): b is Block & { kind: "tool" } => b.kind === "tool");
const blocked = (m: { blocks: Block[] }) => m.blocks.filter((b): b is Block & { kind: "blocked" } => b.kind === "blocked");

describe("buildRunModel", () => {
  test("1. auto-approved read", () => {
    const m = buildRunModel([
      started({ goal: "read it", permission: "workspace", model: "qwen", offline: false }),
      iter(1),
      modelResp("tool_call"),
      toolCall("read_file", "read", { path: "welcome.txt" }),
      toolResult("read_file", "file contents here", false),
      final("done"),
      finished("completed"),
    ]);

    expect(m.meta).toEqual({ goal: "read it", workspace: "/ws", model: "qwen", permission: "workspace", offline: false });

    const t = tools(m);
    expect(t).toHaveLength(1);
    expect(t[0].tool).toBe("read_file");
    expect(t[0].required).toBe("read");
    expect(t[0].result).toBe("file contents here");
    expect(t[0].isError).toBe(false);
    expect(t[0].approvalId).toBeUndefined();
    expect(t[0].deniedByHook).toBeFalsy();

    expect(m.blocks.some((b) => b.kind === "final")).toBe(true);
    const fin = m.blocks.find((b) => b.kind === "finished") as any;
    expect(fin?.reason).toBe("completed");
    expect(m.finished).toBe(true);
    expect(m.pendingApproval).toBeNull();
  });

  test("2. gated write, approved → one tool block, decision allow, result present, not denied", () => {
    const m = buildRunModel([
      started(),
      iter(1),
      modelResp("tool_call"),
      apprReq("write_file", "w1", { path: "out.txt", content: "hi" }),
      apprRes("w1", "allow"),
      toolCall("write_file", "workspace", { path: "out.txt", content: "hi" }),
      toolResult("write_file", "wrote /ws/out.txt: 2 chars", false),
      final("done"),
      finished("completed"),
    ]);

    const t = tools(m);
    expect(t).toHaveLength(1); // approval + tool_call fold into ONE block
    expect(t[0].approvalId).toBe("w1");
    expect(t[0].decision).toBe("allow");
    expect(t[0].required).toBe("workspace");
    expect(t[0].result).toContain("wrote");
    expect(t[0].isError).toBe(false);
    expect(t[0].deniedByHook).toBeFalsy();
    expect(m.pendingApproval).toBeNull();
  });

  test("3. gated write, denied (no tool_call) → renders denied / did not run, no success result", () => {
    const m = buildRunModel([
      started(),
      iter(1),
      modelResp("tool_call"),
      apprReq("write_file", "w1", { path: "out.txt" }),
      apprRes("w1", "deny"),
      hookDenied("write_file"),
      final("could not"),
      finished("completed"),
    ]);

    const t = tools(m);
    expect(t).toHaveLength(1);
    expect(t[0].decision).toBe("deny");
    expect(t[0].deniedByHook).toBe(true);
    expect(t[0].result).toBeUndefined(); // the gated write never ran → no successful result
    expect(m.pendingApproval).toBeNull();
  });

  test("4. hard-blocked by ceiling → blocked(permission) distinct from an approval card", () => {
    const m = buildRunModel([
      started(),
      iter(1),
      modelResp("tool_call"),
      permDenied("bash", "full", "workspace"),
      final("blocked"),
      finished("completed"),
    ]);

    expect(tools(m)).toHaveLength(0); // NOT a tool/approval block
    const b = blocked(m);
    expect(b).toHaveLength(1);
    expect(b[0].variant).toBe("permission");
    expect(b[0].tool).toBe("bash");
    expect(b[0].required).toBe("full");
    expect(b[0].ceiling).toBe("workspace");
  });

  test("5. unknown tool → blocked(unknown)", () => {
    const m = buildRunModel([started(), iter(1), modelResp("tool_call"), toolErr("does_not_exist"), final("recovered"), finished("completed")]);
    const b = blocked(m);
    expect(b).toHaveLength(1);
    expect(b[0].variant).toBe("unknown");
    expect(b[0].tool).toBe("does_not_exist");
  });

  test("6. iteration + compaction markers preserved, in order", () => {
    const m = buildRunModel([
      started(),
      iter(1, 15),
      { type: "compaction", from: 18, to: 5 } as any,
      iter(2, 15),
      finished("completed"),
    ]);
    const kinds = m.blocks.map((b) => b.kind);
    expect(kinds).toEqual(["iteration", "compaction", "iteration", "finished"]);
    const comp = m.blocks[1] as any;
    expect(comp).toMatchObject({ kind: "compaction", from: 18, to: 5 });
    const it2 = m.blocks[2] as any;
    expect(it2).toMatchObject({ kind: "iteration", n: 2, max: 15 });
  });

  test("multiple tools in sequence stay paired independently", () => {
    const m = buildRunModel([
      started(),
      toolCall("read_file", "read", { path: "a" }),
      toolResult("read_file", "AAA", false),
      apprReq("write_file", "w1", { path: "b" }),
      apprRes("w1", "allow"),
      toolCall("write_file", "workspace", { path: "b" }),
      toolResult("write_file", "wrote b", false),
      finished("completed"),
    ]);
    const t = tools(m);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ tool: "read_file", result: "AAA" });
    expect(t[0].approvalId).toBeUndefined();
    expect(t[1]).toMatchObject({ tool: "write_file", decision: "allow", result: "wrote b" });
  });
});
