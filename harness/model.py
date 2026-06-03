#the model layer talks to an LLM and returns a normalized response the loop understands
#we use Ollama (https://ollama.com) so everything runs locally and free, no API key required
#open models don't all support native tool-calling, so we use a small prompt-engineered JSON protocol instead:
#   the model must reply with ONE json object, either
#       {"action": "tool",  "tool": "<name>", "args": {...}}   -> call a tool
#       {"action": "final", "text": "<answer>"}                 -> stop and return text
#the loop only cares about a dict shaped like {"stop_reason", "text", "tool_call"}, so both
#OllamaModel and StubModel return that exact shape. StubModel lets us test the loop without an LLM.

import ast
import json
import urllib.request
import urllib.error

_PROTOCOL = """\
You are driving a tool-using agent. On every turn you MUST reply with exactly ONE JSON object and nothing else.
To call a tool:   {"action": "tool", "tool": "<tool_name>", "args": {<argument_name>: <value>, ...}}
To finish:        {"action": "final", "text": "<your final answer>"}
Only use tools from the list below. Do not wrap the JSON in markdown fences or add commentary.

Available tools:
"""


def _render_tools(tool_descriptors: list[dict]) -> str:
    lines = []
    for d in tool_descriptors:
        lines.append(f'- {d["name"]} (permission={d.get("permission", "?")}): {d.get("description", "")}')
    return "\n".join(lines) if lines else "(none)"


def _try_parse(candidate: str) -> dict | None:
    try:
        result = json.loads(candidate)
    except json.JSONDecodeError:
        #local models often emit Python-style dicts (single quotes, True/None) instead of strict
        #JSON; ast.literal_eval safely parses those without executing anything
        try:
            result = ast.literal_eval(candidate)
        except (ValueError, SyntaxError):
            return None
    return result if isinstance(result, dict) else None


def _extract_json(text: str) -> dict | None:
    #find the first balanced {...} that parses as a dict. A balanced-brace scan handles nesting
    #correctly and naturally ignores surrounding prose or ```json fences (they contain no braces).
    #If a candidate doesn't parse (e.g. prose like "use {curly} braces"), we try the next '{'.
    for start, ch in enumerate(text):
        if ch != "{":
            continue
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    parsed = _try_parse(text[start : i + 1])
                    if parsed is not None:
                        return parsed
                    break  # this candidate failed; advance to the next '{'
    return None


#words a model might use in the "action" slot when it means "I'm done"
_FINAL_ACTIONS = {"final", "finish", "done", "answer", "respond", "reply", "stop"}


def _final(text: str) -> dict:
    return {"stop_reason": "end_turn", "text": (text or "").strip(), "tool_call": None}


def _tool(name: str, args: dict) -> dict:
    return {"stop_reason": "tool_call", "text": "", "tool_call": {"name": name, "args": args or {}}}


def _normalize(parsed: dict | None, raw_text: str, tool_names: set[str]) -> dict:
    #map the model's reply onto the {stop_reason, text, tool_call} shape the loop expects.
    #local models are inconsistent, so we accept several near-equivalent protocol shapes:
    #   {"action":"tool","tool":"X","args":{}}   (the spec)
    #   {"action":"X","args":{}}                  (tool name in 'action')
    #   {"tool":"X","args":{}} / {"name":"X",...} (no 'action')
    #   {"action":"final","text":"..."}           (done)
    if not isinstance(parsed, dict):
        return _final(raw_text)

    action = parsed.get("action")
    if isinstance(action, str) and action.lower() in _FINAL_ACTIONS:
        return _final(parsed.get("text") or parsed.get("answer") or parsed.get("content") or raw_text)

    name = parsed.get("tool") or parsed.get("name") or parsed.get("tool_name")
    if name is None and isinstance(action, str) and action.lower() != "tool":
        name = action  # variant where the tool name lives in 'action'
    args = parsed.get("args") or parsed.get("arguments") or parsed.get("parameters") or {}

    if name in tool_names:
        return _tool(name, args)
    if action == "tool" and name:
        return _tool(name, args)  # unknown tool: dispatch anyway so the loop reports it back to the model

    #no recognizable tool call -> treat as a final answer so we never hang
    return _final(parsed.get("text") or parsed.get("answer") or parsed.get("content") or raw_text)


class OllamaModel:
    #a thin, dependency-free client for a locally running Ollama server
    def __init__(
        self,
        model: str = "qwen2.5-coder:7b",
        host: str = "http://localhost:11434",
        temperature: float = 0.0,
        timeout: int = 120,
    ) -> None:
        self.model = model
        self.host = host.rstrip("/")
        self.temperature = temperature
        self.timeout = timeout

    def __call__(self, system_prompt: str, messages: list[dict], tool_descriptors: list[dict]) -> dict:
        full_system = f"{system_prompt}\n\n{_PROTOCOL}{_render_tools(tool_descriptors)}"
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": full_system}, *messages],
            "stream": False,
            "options": {"temperature": self.temperature},
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.host}/api/chat",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            #server is reachable but the request failed (e.g. model not pulled, or a runtime error)
            detail = e.read().decode("utf-8", "ignore")[:500] if e.fp else ""
            raise RuntimeError(
                f"Ollama returned HTTP {e.code} for model {self.model!r}. "
                f"Is the model pulled ('ollama pull {self.model}')? Server said: {detail}"
            ) from e
        except urllib.error.URLError as e:
            #couldn't connect at all
            raise RuntimeError(
                f"Could not connect to Ollama at {self.host}. Is the server running "
                f"('ollama serve' or launch the Ollama app)? Original error: {e}"
            ) from e

        raw_text = body.get("message", {}).get("content", "")
        tool_names = {d["name"] for d in tool_descriptors}
        return _normalize(_extract_json(raw_text), raw_text, tool_names)


class StubModel:
    #a scripted model for tests and offline demos: feed it a list of response dicts and it returns them in order
    def __init__(self, scripted_responses: list[dict]) -> None:
        self._responses = list(scripted_responses)
        self.calls: list[dict] = []

    def __call__(self, system_prompt: str, messages: list[dict], tool_descriptors: list[dict]) -> dict:
        self.calls.append({"system_prompt": system_prompt, "messages": list(messages)})
        if self._responses:
            return self._responses.pop(0)
        return {"stop_reason": "end_turn", "text": "(stub: no more scripted responses)", "tool_call": None}
