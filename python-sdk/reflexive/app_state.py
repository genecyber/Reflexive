"""Application state management for Reflexive"""

import os
import time
from collections import deque
from datetime import datetime
from typing import Any, Dict, List, Optional, Deque

from .types import LogEntry, LogType, AppStatus, get_memory_usage


class AppState:
    """Manages application logs and custom state"""

    def __init__(self, max_logs: int = 500):
        """
        Initialize AppState

        Args:
            max_logs: Maximum number of log entries to keep (default: 500)
        """
        self._logs: Deque[LogEntry] = deque(maxlen=max_logs)
        self._custom_state: Dict[str, Any] = {}
        self._start_time = time.time()
        self._pid = os.getpid()

    def log(self, log_type: str, message: str, meta: Optional[Dict[str, Any]] = None) -> None:
        """
        Add a log entry

        Args:
            log_type: Type of log (info, warn, error, debug, etc.)
            message: Log message
            meta: Optional metadata dictionary
        """
        entry: LogEntry = {
            "type": log_type,
            "message": message,
            "timestamp": datetime.now().isoformat(),
            "meta": meta,
        }
        self._logs.append(entry)

    def get_logs(self, count: Optional[int] = None, log_type: Optional[str] = None) -> List[LogEntry]:
        """
        Retrieve log entries

        Args:
            count: Number of logs to return (most recent first)
            log_type: Filter by log type

        Returns:
            List of log entries
        """
        logs = list(self._logs)

        # Filter by type if specified
        if log_type:
            logs = [log for log in logs if log["type"] == log_type]

        # Return most recent logs
        if count is not None:
            logs = logs[-count:]

        return logs

    def search_logs(self, query: str) -> List[LogEntry]:
        """
        Search logs by regex pattern

        Args:
            query: Regex pattern to search for

        Returns:
            List of matching log entries
        """
        import re
        pattern = re.compile(query)
        return [log for log in self._logs if pattern.search(log["message"])]

    def set_state(self, key: str, value: Any) -> None:
        """
        Set custom state value

        Args:
            key: State key (supports dot notation like 'users.count')
            value: State value
        """
        self._custom_state[key] = value

    def get_state(self, key: Optional[str] = None) -> Any:
        """
        Get custom state value

        Args:
            key: State key (if None, returns entire state dict)

        Returns:
            State value or entire state dict
        """
        if key is None:
            return self._custom_state
        return self._custom_state.get(key)

    def get_status(self) -> AppStatus:
        """
        Get application status snapshot

        Returns:
            AppStatus dictionary with current process info
        """
        return {
            "pid": self._pid,
            "uptime": time.time() - self._start_time,
            "memory": get_memory_usage(),
            "customState": self._custom_state.copy(),
            "startTime": self._start_time,
        }
