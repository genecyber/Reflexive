"""Type definitions for Reflexive Python SDK"""

from typing import Any, Dict, List, Literal, Optional, TypedDict
from datetime import datetime
import os
import psutil

# Log types
LogType = Literal["info", "warn", "error", "debug", "stdout", "stderr", "system"]


class LogEntry(TypedDict):
    """A single log entry"""
    type: str
    message: str
    timestamp: str
    meta: Optional[Dict[str, Any]]


class AppStatus(TypedDict):
    """Application status snapshot"""
    pid: int
    uptime: float
    memory: Dict[str, int]
    customState: Dict[str, Any]
    startTime: float


class MakeReflexiveOptions(TypedDict, total=False):
    """Options for make_reflexive()"""
    web_ui: bool  # Enable web dashboard (default: False)
    port: int  # Dashboard port (default: 3099)
    title: str  # Dashboard title
    system_prompt: str  # Additional system prompt for AI
    # tools: List[CustomTool]  # Custom MCP tools (future)
    # on_ready: Callable  # Callback when ready (future)


def get_memory_usage() -> Dict[str, int]:
    """Get current process memory usage"""
    try:
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()
        return {
            "rss": mem_info.rss,  # Resident Set Size
            "vms": mem_info.vms,  # Virtual Memory Size
        }
    except Exception:
        return {"rss": 0, "vms": 0}
