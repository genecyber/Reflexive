# Reflexive Python SDK - Design Document

## Overview

The Reflexive Python SDK brings the same AI-native capabilities from the Node.js version to Python applications. It enables developers to embed AI chat functionality directly into their Python code using `reflexive.chat()`.

## Architecture

### Core Components

```
reflexive/
├── __init__.py           # Public API exports
├── types.py              # Type definitions (LogEntry, AppStatus, etc.)
├── app_state.py          # AppState class (logs & state management)
└── core.py               # make_reflexive() and ReflexiveInstance
```

### Key Classes

#### `AppState`
- Manages application logs (circular buffer with max size)
- Stores custom state (key-value pairs visible to AI)
- Tracks process metrics (PID, uptime, memory)
- Provides search and filtering capabilities

#### `ReflexiveInstance`
- Main interface returned by `make_reflexive()`
- Provides methods: `.chat()`, `.set_state()`, `.get_state()`, `.log()`, `.get_logs()`
- Handles two modes: standalone and CLI child

### Two Operating Modes

#### Standalone Mode
When you call `make_reflexive()` directly in your Python script:

```python
import reflexive

r = reflexive.make_reflexive()
r.set_state('count', 42)
# Note: chat() requires web_ui=True or running via CLI
```

What happens:
1. Creates `AppState` instance
2. Intercepts Python logging and stdout/stderr
3. Optionally starts HTTP server (if `web_ui=True`)
4. `.chat()` returns error message (requires SDK integration or CLI mode)

#### CLI Child Mode
When you run your script with `reflexive app.py`:

```python
import reflexive

r = reflexive.make_reflexive()
response = r.chat('Analyze my app')  # Works! Proxies to CLI
```

What happens:
1. Detects `REFLEXIVE_CLI_MODE=true` environment variable
2. Reads `REFLEXIVE_CLI_PORT` to get parent CLI port
3. Creates client-mode instance that proxies to CLI
4. `.chat()` sends HTTP POST to `http://localhost:{CLI_PORT}/chat`
5. `.set_state()` syncs to `http://localhost:{CLI_PORT}/client-state`

## Design Decisions

### Why Two Modes?

**Standalone mode** enables:
- Simple embedding without external dependencies
- Development/testing without CLI
- Web dashboard for monitoring (optional)

**CLI child mode** enables:
- Full AI capabilities via parent Reflexive CLI
- No need for Claude Agent SDK in Python
- Consistent experience with Node.js SDK
- Access to all CLI features (debugging, file ops, etc.)

### Why HTTP for Parent-Child Communication?

Alternatives considered:
- **stdio**: Used by MCP, but requires structured protocol
- **Unix sockets**: Platform-specific, more complex
- **IPC pipes**: Platform-specific

HTTP chosen because:
- ✅ Simple, cross-platform
- ✅ Already have HTTP server in CLI
- ✅ Easy to test with curl
- ✅ Works with any HTTP client library
- ✅ Fire-and-forget for state syncing

### Why Intercept stdout/stderr?

Unlike Node.js where we inject at runtime, Python SDK uses:
- `logging.Handler` for standard logging
- Monkey-patching `sys.stdout.write` and `sys.stderr.write`

This captures:
- Explicit logging: `logging.info("message")`
- Print statements: `print("message")`
- Uncaught exceptions and tracebacks

### Why psutil?

Python's built-in modules don't provide clean cross-platform memory stats:
- `resource.getrusage()` is Unix-only
- `psutil` works on Windows, Linux, macOS
- Widely used, well-maintained, small dependency

## API Alignment with Node.js

| Node.js | Python | Notes |
|---------|--------|-------|
| `makeReflexive()` | `make_reflexive()` | PEP 8 naming |
| `.chat(message)` | `.chat(message)` | Returns string |
| `.setState(key, value)` | `.set_state(key, value)` | PEP 8 naming |
| `.getState(key)` | `.get_state(key)` | PEP 8 naming |
| `.log(type, msg)` | `.log(type, msg)` | Same |
| `appState` | `app_state` | PEP 8 naming |
| `webUI: true` | `web_ui: True` | PEP 8 naming |

## Chat Implementation

### Standalone Mode with web_ui=True
```python
r = reflexive.make_reflexive({'web_ui': True})
r.chat('message')  # Returns error (SDK integration TBD)
```

Currently returns error message. Future: Integrate Claude Agent SDK or use HTTP API.

### CLI Child Mode
```python
# User runs: reflexive --debug app.py
r = reflexive.make_reflexive()
r.chat('message')  # Proxies to CLI's /chat endpoint
```

Flow:
1. Python sends POST to `http://localhost:{CLI_PORT}/chat`
2. CLI's chat endpoint creates SSE stream
3. Python reads SSE events, collects text chunks
4. Returns complete response as string

## State Synchronization

When in CLI child mode, `set_state()` syncs to parent:

```python
r.set_state('users.count', 42)
```

1. Updates local `app_state`
2. Sends POST to `http://localhost:{CLI_PORT}/client-state`
3. CLI receives and updates its dashboard
4. Fire-and-forget (errors ignored)

This makes the Python app's state visible in the CLI dashboard and to the AI agent.

## Logging Interception

### Standard Logging
```python
class ReflexiveHandler(logging.Handler):
    def emit(self, record):
        app_state.log(record.levelname.lower(), self.format(record))

logging.root.addHandler(ReflexiveHandler())
```

Captures all `logging.info()`, `logging.error()`, etc.

### stdout/stderr
```python
original_stdout = sys.stdout.write

def stdout_interceptor(text):
    if text and text.strip():
        app_state.log('stdout', text.rstrip())
    return original_stdout(text)

sys.stdout.write = stdout_interceptor
```

Captures all `print()` statements and stdout writes.

## Memory Management

### Log Circular Buffer
```python
self._logs: Deque[LogEntry] = deque(maxlen=max_logs)
```

Uses `collections.deque` with max size:
- Automatically removes oldest when full
- O(1) append and pop
- Memory-bounded (default 500 logs)

### State Storage
Simple dict with no size limit:
```python
self._custom_state: Dict[str, Any] = {}
```

Users should avoid storing large objects in state (only metadata/metrics).

## Future Enhancements

### Custom Tools
Similar to Node.js SDK:
```python
r = reflexive.make_reflexive({
    'tools': [
        {
            'name': 'get_user_count',
            'description': 'Get active user count',
            'handler': lambda: {'count': get_users()}
        }
    ]
})
```

### Async Support
```python
async def chat_async(self, message: str) -> str:
    # Use aiohttp for async HTTP requests
    pass
```

### Type Stubs
Full typing with `.pyi` files for better IDE support.

### Direct Claude SDK Integration
For standalone mode without CLI:
```python
from anthropic import Anthropic

# If API key available
r = reflexive.make_reflexive({'api_key': 'sk-...'})
r.chat('message')  # Uses Anthropic SDK directly
```

## Testing Strategy

### Unit Tests
- `test_app_state.py`: Test logging, state management
- `test_core.py`: Test `make_reflexive()` modes
- `test_types.py`: Test type definitions

### Integration Tests
- Test with actual Reflexive CLI
- Verify parent-child communication
- Test state syncing

### Example Apps
- `simple_app.py`: Basic usage demo
- `web_server.py`: AI-powered web server
- `data_pipeline.py`: Monitoring example

## Comparison with Node.js Implementation

### Similarities
- Same conceptual API (`make_reflexive`, `.chat()`, `.setState()`)
- Same two-mode architecture (standalone vs CLI child)
- Same parent-child communication (HTTP to CLI)
- Same state and logging system

### Differences
- **Injection**: Node.js uses `--require` flag, Python uses imports
- **Logging**: Node.js intercepts console, Python uses logging + stdout/stderr
- **Async**: Node.js native async, Python uses sync with urllib (async TBD)
- **Dependencies**: Node.js has more deps, Python minimal (just psutil)
- **Typing**: TypeScript native, Python uses type hints

## Performance Considerations

### Logging Overhead
- Circular buffer: O(1) append
- Type filtering: O(n) scan (n = log count, max 500)
- Search: O(n) regex matching

### State Updates
- Local update: O(1) dict set
- CLI sync: Fire-and-forget HTTP (doesn't block)

### Memory Usage
- Logs: ~500 entries × ~200 bytes = ~100 KB
- State: User-controlled (should be small)
- Total: <1 MB overhead

## Security Considerations

### HTTP Communication
- Only localhost (127.0.0.1)
- No authentication (trusts local CLI)
- CLI port from environment variable (not user input)

### Code Execution
- No eval() or exec()
- No dynamic imports from user input
- State values are not executed

### File Access
- SDK itself doesn't read/write files
- File operations via CLI (controlled by CLI flags)

## Deployment

### Package Distribution
```bash
pip install reflexive
```

### Requirements
- Python 3.8+
- psutil (auto-installed)

### Platform Support
- ✅ Linux
- ✅ macOS
- ✅ Windows (with psutil)

## Migration Guide (Node.js → Python)

```javascript
// Node.js
import { makeReflexive } from 'reflexive';
const r = makeReflexive({ webUI: true });
r.setState('count', 42);
const answer = await r.chat('What is count?');
```

```python
# Python
import reflexive
r = reflexive.make_reflexive({'web_ui': True})
r.set_state('count', 42)
answer = r.chat('What is count?')
```

Changes:
1. `makeReflexive` → `make_reflexive`
2. `webUI` → `web_ui`
3. `.setState` → `.set_state`
4. `await` not needed (sync API)

## Conclusion

The Python SDK successfully ports the core Reflexive concepts to Python while respecting Python conventions (PEP 8 naming, type hints, standard library patterns). The two-mode architecture enables both standalone usage and full CLI integration, making it flexible for different use cases.

The fire-and-forget state syncing and SSE-based chat proxying provide a simple yet effective parent-child communication mechanism that works across platforms and requires minimal dependencies.
