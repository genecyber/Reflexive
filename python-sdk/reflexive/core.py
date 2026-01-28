"""
Core Reflexive functionality for Python

Matches the TypeScript makeReflexive() pattern:
- Detects REFLEXIVE_CLI_MODE for child mode (HTTP to parent)
- Standalone mode optionally spawns Node CLI in background
"""

import os
import sys
import json
import logging
import subprocess
import atexit
from typing import Optional, Any, Dict
from threading import Thread
import urllib.request
import time

from .app_state import AppState
from .types import MakeReflexiveOptions


class ReflexiveInstance:
    """
    Reflexive instance for Python applications

    Provides programmatic access to AI chat, state management, and logging.
    """

    def __init__(
        self,
        app_state: AppState,
        cli_process: Optional[subprocess.Popen] = None,
        cli_port: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None
    ):
        self.app_state = app_state
        self.cli_process = cli_process
        self._cli_port = cli_port
        self.options = options or {}
        self.logger = logging.getLogger(__name__)

        # Register cleanup if we spawned a CLI process
        if cli_process:
            atexit.register(self._cleanup)

    def _cleanup(self):
        """Clean up spawned CLI process on exit"""
        if self.cli_process and self.cli_process.poll() is None:
            try:
                self.cli_process.terminate()
                self.cli_process.wait(timeout=5)
            except Exception:
                try:
                    self.cli_process.kill()
                except Exception:
                    pass

    def log(self, log_type: str, message: str) -> None:
        """Add a log entry"""
        self.app_state.log(log_type, message)

    def set_state(self, key: str, value: Any) -> None:
        """Set custom state (syncs to CLI if running in child mode)"""
        self.app_state.set_state(key, value)

        # Sync to CLI if available (fire and forget)
        if self._cli_port:
            self._sync_state_to_cli(key, value)

    def get_state(self, key: Optional[str] = None) -> Any:
        """Get custom state"""
        return self.app_state.get_state(key)

    def get_logs(self, count: Optional[int] = None, log_type: Optional[str] = None):
        """Get log entries"""
        return self.app_state.get_logs(count, log_type)

    def chat(self, message: str) -> str:
        """
        Send a message to the AI and get a response

        Args:
            message: Message to send to the AI

        Returns:
            AI response as a string
        """
        if self._cli_port:
            return self._chat_via_http(message)
        else:
            return "Error: Chat requires running under Reflexive CLI (run: reflexive app.py)"

    def _chat_via_http(self, message: str) -> str:
        """Send chat request to parent CLI via HTTP (matches TypeScript pattern)"""
        try:
            url = f"http://localhost:{self._cli_port}/chat"
            headers = {"Content-Type": "application/json"}
            data = json.dumps({"message": message}).encode("utf-8")

            req = urllib.request.Request(url, data=data, headers=headers, method="POST")

            # Read SSE response
            with urllib.request.urlopen(req, timeout=60) as response:
                full_response = ""
                for line in response:
                    line_str = line.decode("utf-8")
                    if line_str.startswith("data: "):
                        try:
                            chunk = json.loads(line_str[6:])
                            if chunk.get("type") == "text":
                                full_response += chunk.get("content", "")
                        except json.JSONDecodeError:
                            pass

                return full_response or "No response"

        except Exception as e:
            return f"Error: {str(e)}"

    def _sync_state_to_cli(self, key: str, value: Any) -> None:
        """Sync state to parent CLI (fire and forget, matches TypeScript pattern)"""
        try:
            url = f"http://localhost:{self._cli_port}/client-state"
            headers = {"Content-Type": "application/json"}
            data = json.dumps({"key": key, "value": value}).encode("utf-8")

            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            urllib.request.urlopen(req, timeout=1)
        except Exception:
            # Silently ignore sync errors (fire and forget)
            pass


def _create_client_reflexive(cli_port: int) -> ReflexiveInstance:
    """
    Create a client-mode Reflexive instance that connects to parent CLI

    This is used when the app is run via `reflexive app.py` (matches TypeScript pattern)
    """
    app_state = AppState()
    print(f"[reflexive] Running in CLI child mode, connecting to parent on port {cli_port}")

    return ReflexiveInstance(app_state=app_state, cli_port=cli_port)


def _spawn_cli_process(entry_file: str, options: Dict[str, Any]) -> Optional[subprocess.Popen]:
    """
    Spawn the Node.js Reflexive CLI as a background process

    Returns the process if successful, None otherwise
    """
    # Build CLI command
    cli_cmd = ["npx", "reflexive"]

    # Add capability flags
    if options.get("write", True):
        cli_cmd.append("--write")

    if options.get("debug", False):
        cli_cmd.append("--debug")

    if options.get("shell", False):
        cli_cmd.append("--shell")

    # Add entry file
    cli_cmd.append(entry_file)

    try:
        # Spawn CLI process with stdout/stderr visible
        process = subprocess.Popen(
            cli_cmd,
            stdout=sys.stdout,
            stderr=sys.stderr,
            env=os.environ.copy()
        )

        # Give CLI time to start
        time.sleep(2)

        # Check if it's still running
        if process.poll() is not None:
            print("[reflexive] CLI process exited early")
            return None

        return process

    except FileNotFoundError:
        print("[reflexive] Error: Reflexive CLI not found. Install with: npm install -g reflexive")
        return None
    except Exception as e:
        print(f"[reflexive] Error starting CLI: {e}")
        return None


def make_reflexive(options: Optional[MakeReflexiveOptions] = None) -> ReflexiveInstance:
    """
    Create a Reflexive instance embedded in your Python application

    Matches the TypeScript makeReflexive() pattern:
    - Detects REFLEXIVE_CLI_MODE to connect to parent CLI
    - In standalone mode, optionally spawns CLI in background

    Args:
        options: Configuration options
            - spawn_cli: Spawn Node CLI in background (default: False)
            - write: Enable file writing for spawned CLI (default: True)
            - debug: Enable debugger for spawned CLI (default: False)
            - shell: Enable shell access for spawned CLI (default: False)
            - port: Port for spawned CLI (default: 3099)
            - max_logs: Maximum log entries (default: 500)

    Returns:
        ReflexiveInstance with .chat(), .set_state(), etc.

    Examples:
        >>> import reflexive
        >>>
        >>> # Minimal - requires running via CLI
        >>> r = reflexive.make_reflexive()
        >>> r.chat('message')  # Error unless run via: reflexive app.py
        >>>
        >>> # Spawn CLI in background
        >>> r = reflexive.make_reflexive({'spawn_cli': True})
        >>> r.chat('message')  # Works! CLI spawned automatically
    """
    opts = options or {}

    # Check if running under CLI - if so, connect to parent (matches TypeScript pattern)
    cli_mode = os.environ.get("REFLEXIVE_CLI_MODE") == "true"
    cli_port_str = os.environ.get("REFLEXIVE_CLI_PORT")

    if cli_mode and cli_port_str:
        cli_port = int(cli_port_str)
        return _create_client_reflexive(cli_port)

    # Standalone mode
    max_logs = opts.get("max_logs", 500)
    app_state = AppState(max_logs=max_logs)

    # Intercept Python logging and stdout/stderr
    _intercept_logging(app_state)

    # Option to spawn CLI in background
    spawn_cli = opts.get("spawn_cli", False)
    cli_process = None
    cli_port = None

    if spawn_cli:
        # Determine entry file (the Python script that called us)
        entry_file = opts.get("entry", sys.argv[0])
        port = opts.get("port", 3099)

        print(f"[reflexive] Spawning Reflexive CLI for {entry_file}...")

        cli_process = _spawn_cli_process(entry_file, opts)

        if cli_process:
            cli_port = port
            print(f"[reflexive] CLI started (PID: {cli_process.pid})")
            print(f"[reflexive] Dashboard: http://localhost:{port}/reflexive")
        else:
            print("[reflexive] Falling back to standalone mode (chat disabled)")

    return ReflexiveInstance(
        app_state=app_state,
        cli_process=cli_process,
        cli_port=cli_port,
        options=opts
    )


def _intercept_logging(app_state: AppState) -> None:
    """
    Intercept Python logging to capture logs in AppState

    Matches the TypeScript pattern of intercepting console methods
    """

    class ReflexiveHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            log_type = record.levelname.lower()
            if log_type == "warning":
                log_type = "warn"
            app_state.log(log_type, self.format(record))

    # Add handler to root logger
    handler = ReflexiveHandler()
    handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter("%(message)s")
    handler.setFormatter(formatter)
    logging.root.addHandler(handler)

    # Intercept stdout/stderr (similar to TypeScript console interception)
    original_stdout = sys.stdout.write
    original_stderr = sys.stderr.write

    def stdout_interceptor(text: str) -> int:
        if text and text.strip():
            app_state.log("stdout", text.rstrip())
        return original_stdout(text)

    def stderr_interceptor(text: str) -> int:
        if text and text.strip():
            app_state.log("stderr", text.rstrip())
        return original_stderr(text)

    sys.stdout.write = stdout_interceptor  # type: ignore
    sys.stderr.write = stderr_interceptor  # type: ignore
