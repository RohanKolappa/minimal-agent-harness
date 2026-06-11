#Pydantic v2 request/response models for the API.

from pydantic import BaseModel, Field


class ApprovalPolicy(BaseModel):
    auto_approve_reads: bool = True
    require_approval_for_writes: bool = True
    auto_approve_all: bool = False


class RunRequest(BaseModel):
    goal: str = ""  # ignored in offline mode (the script is fixed server-side)
    offline: bool = False
    model: str | None = None
    permission: str = "workspace"  # read | workspace | full
    workspace_root: str | None = None  # absolute path; defaults to the dedicated sandbox
    approval_policy: ApprovalPolicy = Field(default_factory=ApprovalPolicy)
    max_iterations: int = 15  # clamped to 1..50 server-side


class RunResponse(BaseModel):
    run_id: str


class ApproveRequest(BaseModel):
    approval_id: str
    decision: str  # "allow" | "deny"


class ChatMessage(BaseModel):
    role: str
    content: str


class AssistantRequest(BaseModel):
    messages: list[ChatMessage]
    model: str | None = None  # falls back to config.default_model server-side
