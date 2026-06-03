#public surface of the harness package: import the pieces you need from here
from harness.loop import Agent
from harness.model import OllamaModel, StubModel
from harness.tools import Tool, ToolRegistry
from harness.context import ContextManager
from harness.permissions import Permission, classify_bash, can_dispatch
from harness.hooks import Hooks, HookContext, HookDecision
from harness.persistence import Session
from harness.prompt import assemble_system_prompt
from harness.subagents import SubAgentSpec, SubAgentRegistry
from harness import builtins
from harness.builtins import WorkspaceTools

__all__ = [
    "Agent",
    "OllamaModel",
    "StubModel",
    "Tool",
    "ToolRegistry",
    "ContextManager",
    "Permission",
    "classify_bash",
    "can_dispatch",
    "Hooks",
    "HookContext",
    "HookDecision",
    "Session",
    "assemble_system_prompt",
    "SubAgentSpec",
    "SubAgentRegistry",
    "builtins",
    "WorkspaceTools",
]
