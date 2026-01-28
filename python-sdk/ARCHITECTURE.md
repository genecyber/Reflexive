# Reflexive Python SDK - Architecture

## System Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     User's Python Application                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  import reflexive                                         │  │
│  │                                                            │  │
│  │  r = reflexive.make_reflexive()                          │  │
│  │                                                            │  │
│  │  # Your application code                                  │  │
│  │  r.set_state('users.count', 42)                          │  │
│  │  r.log('info', 'Processing request')                     │  │
│  │                                                            │  │
│  │  # Ask AI anything                                        │  │
│  │  response = r.chat('Analyze current state')              │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                             │
                             │ Detects:
                             │ REFLEXIVE_CLI_MODE=true
                             │ REFLEXIVE_CLI_PORT=3099
                             │
                             ▼
┌────────────────────────────────────────────────────────────────┐
│              Reflexive Python SDK (reflexive/)                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ReflexiveInstance                                        │  │
│  │  ├─ Intercepts logging (logging.Handler)                 │  │
│  │  ├─ Intercepts stdout/stderr (sys.stdout.write)          │  │
│  │  ├─ Manages AppState (logs + custom state)               │  │
│  │  └─ Proxies to CLI via HTTP                              │  │
│  │                                                            │  │
│  │  .chat(msg)      → POST http://localhost:3099/chat       │  │
│  │  .set_state(k,v) → POST http://localhost:3099/client-state│ │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                             │
                             │ HTTP (localhost only)
                             │
                             ▼
┌────────────────────────────────────────────────────────────────┐
│             Reflexive CLI (Node.js/TypeScript)                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Process Manager                                          │  │
│  │  ├─ Spawns Python app with env vars                      │  │
│  │  ├─ Captures stdout/stderr                               │  │
│  │  ├─ Manages process lifecycle                            │  │
│  │  └─ Coordinates with debugger                            │  │
│  │                                                            │  │
│  │  HTTP Server (port 3099)                                  │  │
│  │  ├─ /chat         → Claude Agent SDK                     │  │
│  │  ├─ /client-state → Sync child state                     │  │
│  │  ├─ /state        → Get app status                       │  │
│  │  └─ /logs         → Get log entries                      │  │
│  │                                                            │  │
│  │  MCP Tools                                                │  │
│  │  ├─ read_file, write_file                                │  │
│  │  ├─ debug_set_breakpoint                                 │  │
│  │  ├─ get_process_state                                    │  │
│  │  └─ ... and more                                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                             │
                             │ AI API
                             │
                             ▼
┌────────────────────────────────────────────────────────────────┐
│              Claude Agent SDK (Anthropic)                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  • Streams chat responses via SSE                        │  │
│  │  • Manages conversation state                            │  │
│  │  • Executes MCP tools                                    │  │
│  │  • Provides AI with app context                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Communication Flow

### 1. Application Startup

```
User runs: reflexive --debug app.py

1. CLI starts Node.js process
2. CLI spawns Python app with:
   - REFLEXIVE_CLI_MODE=true
   - REFLEXIVE_CLI_PORT=3099
3. Python app imports reflexive
4. make_reflexive() detects env vars
5. Creates client-mode instance
6. Python app starts running
```

### 2. State Update Flow

```python
r.set_state('users.count', 42)
```

```
1. Python: Updates local AppState
   app_state._custom_state['users.count'] = 42

2. Python: Fire-and-forget HTTP POST
   → http://localhost:3099/client-state
   Body: {"key": "users.count", "value": 42}

3. CLI: Receives request, updates state
   CLI's appState.setState('users.count', 42)

4. CLI: Broadcasts to web dashboard
   Dashboard shows updated state in real-time

5. Python: Continues execution (doesn't wait)
```

### 3. Chat Flow

```python
response = r.chat('How many users are online?')
```

```
1. Python: POST http://localhost:3099/chat
   Body: {"message": "How many users are online?"}

2. CLI: Receives request
   - Gets current app state & logs
   - Enriches message with context

3. CLI: Calls Claude Agent SDK
   query({
     prompt: "<app_context>...\n\nHow many users are online?",
     mcpServers: { reflexive: mcpServer }
   })

4. Claude: Processes message
   - Uses MCP tools (get_custom_state, get_logs)
   - Analyzes app state
   - Generates response

5. CLI: Streams SSE response
   data: {"type": "text", "content": "You currently..."}
   data: {"type": "text", "content": " have 42..."}
   data: {"type": "done"}

6. Python: Collects SSE chunks
   fullResponse = ""
   for each data chunk:
     if chunk.type == 'text':
       fullResponse += chunk.content

7. Python: Returns complete response
   return "You currently have 42 users online."
```

### 4. Logging Flow

```python
print("Hello")
logging.info("Processing")
```

```
1. Python: Intercepts via monkey-patching
   sys.stdout.write → stdout_interceptor()

2. Python: Adds to AppState
   app_state.log('stdout', 'Hello')

3. Python: Also calls original
   original_stdout('Hello')

4. CLI: Captures via process stdout
   CLI's appState.log('stdout', 'Hello')

5. CLI: Broadcasts to dashboard
   Dashboard shows log in real-time

Result: Logs visible in both Python and CLI/dashboard
```

## Class Hierarchy

### Python SDK Classes

```
reflexive/
├── types.py
│   ├── LogType (Literal)
│   ├── LogEntry (TypedDict)
│   ├── AppStatus (TypedDict)
│   └── MakeReflexiveOptions (TypedDict)
│
├── app_state.py
│   └── AppState
│       ├── _logs: Deque[LogEntry]
│       ├── _custom_state: Dict[str, Any]
│       ├── log(type, message, meta?)
│       ├── get_logs(count?, type?)
│       ├── search_logs(query)
│       ├── set_state(key, value)
│       ├── get_state(key?)
│       └── get_status() → AppStatus
│
└── core.py
    ├── ReflexiveInstance
    │   ├── app_state: AppState
    │   ├── server: HTTPServer | None
    │   ├── _cli_port: int | None
    │   ├── log(type, message)
    │   ├── set_state(key, value)
    │   ├── get_state(key?)
    │   ├── get_logs(count?, type?)
    │   ├── chat(message) → str
    │   ├── _chat_via_cli(message) → str
    │   └── _sync_state_to_cli(key, value)
    │
    ├── _create_client_reflexive(port) → ReflexiveInstance
    ├── _intercept_logging(app_state)
    ├── _start_server(app_state, port) → HTTPServer
    └── make_reflexive(options?) → ReflexiveInstance
```

## Data Structures

### LogEntry

```python
{
    "type": "info" | "warn" | "error" | "debug" | "stdout" | "stderr",
    "message": "Log message text",
    "timestamp": "2024-01-28T12:34:56.789Z",
    "meta": {  # Optional
        "key": "value"
    }
}
```

### AppStatus

```python
{
    "pid": 12345,
    "uptime": 123.45,
    "memory": {
        "rss": 22830080,    # Resident Set Size
        "vms": 45056000     # Virtual Memory Size
    },
    "customState": {
        "users.count": 42,
        "requests.total": 1337
    },
    "startTime": 1706440496.789
}
```

### HTTP Request: Chat

```
POST http://localhost:3099/chat
Content-Type: application/json

{
    "message": "How many users are online?"
}
```

### HTTP Response: Chat (SSE)

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"session","sessionId":"abc-123"}

data: {"type":"text","content":"You currently"}

data: {"type":"text","content":" have 42"}

data: {"type":"text","content":" users online."}

data: {"type":"done"}
```

### HTTP Request: State Sync

```
POST http://localhost:3099/client-state
Content-Type: application/json

{
    "key": "users.count",
    "value": 42
}
```

## Memory Management

### Log Circular Buffer

```python
from collections import deque

_logs = deque(maxlen=500)  # Circular buffer

_logs.append(log_entry)  # O(1), auto-removes oldest if full
```

**Memory usage:**
- Each log: ~200 bytes (type, message, timestamp, meta)
- Max logs: 500
- Total: ~100 KB

### State Storage

```python
_custom_state: Dict[str, Any] = {}
```

**No size limit!** User controls what goes in state.

**Best practice:** Only store metrics/counters, not large objects:
- ✅ `{'users.count': 42}`
- ✅ `{'cache.hit_rate': 0.95}`
- ❌ `{'all_users': [1000s of objects]}`

## Concurrency Model

### Python SDK (Single-threaded)

```
Main Thread:
├─ User application code
├─ Reflexive interception (stdout, logging)
├─ AppState management
└─ HTTP requests to CLI (blocking)
```

**No thread safety needed** - all operations on main thread.

Exception: HTTP server (if web_ui=True) runs in daemon thread.

### CLI (Multi-threaded/Async)

```
Node.js Event Loop:
├─ Process manager (child_process)
├─ HTTP server (http.createServer)
├─ MCP tool handlers
└─ Claude Agent SDK (streaming)
```

**Fully async** - handles multiple requests concurrently.

## Security Model

### Threat Model

**In scope:**
- Local development environment
- Single user on local machine
- Trusted code execution

**Out of scope:**
- Multi-user systems
- Production server deployment
- Untrusted code execution

### Security Measures

1. **HTTP only on localhost:**
   ```python
   url = f"http://localhost:{cli_port}/chat"
   # Never accepts remote connections
   ```

2. **No authentication:**
   - CLI and child communicate via localhost
   - Parent-child relationship trusted
   - Port from environment, not user input

3. **No code execution in SDK:**
   - No `eval()` or `exec()`
   - State values are data, not code

4. **CLI controls capabilities:**
   - File operations via CLI (--write flag)
   - Eval mode via CLI (--eval flag)
   - Python SDK is just a client

## Error Handling

### Network Errors

```python
def _sync_state_to_cli(self, key, value):
    try:
        urllib.request.urlopen(req, timeout=1)
    except Exception:
        # Silently ignore - state sync is best-effort
        pass
```

**Philosophy:** State sync is fire-and-forget. Don't fail the app.

### Chat Errors

```python
def _chat_via_cli(self, message):
    try:
        # ... HTTP request ...
        return full_response
    except Exception as e:
        return f"Error: {str(e)}"
```

**Philosophy:** Return error string, don't raise exception.

### Logging Errors

```python
class ReflexiveHandler(logging.Handler):
    def emit(self, record):
        try:
            app_state.log(...)
        except Exception:
            # Don't crash on logging errors
            pass
```

**Philosophy:** Never let monitoring crash the app.

## Performance Characteristics

### Latency

| Operation | Latency |
|-----------|---------|
| `.log()` | <1 µs (in-memory) |
| `.set_state()` | <1 µs (local) + fire-and-forget HTTP |
| `.get_state()` | <1 µs (dict lookup) |
| `.get_logs()` | O(n) scan, n ≤ 500 |
| `.chat()` | 100-500 ms (network + AI) |

### Memory

| Component | Memory |
|-----------|--------|
| AppState | ~100 KB (logs) |
| Custom state | User-controlled |
| ReflexiveInstance | <1 KB |
| Total overhead | ~101 KB + state |

### CPU

**Negligible overhead:**
- Logging: Simple append to deque
- State: Dict operations
- HTTP: Only on `.chat()` and state sync

## Debugging

### Enable Verbose Logging

```python
import logging
logging.basicConfig(level=logging.DEBUG)

import reflexive
r = reflexive.make_reflexive()
```

### Inspect Communication

```bash
# Terminal 1: Run CLI with debug
DEBUG=* reflexive --debug app.py

# Terminal 2: Watch HTTP requests
watch -n 1 'curl -s http://localhost:3099/state | jq'
```

### Test Without CLI

```python
import reflexive

# Standalone mode (no CLI)
r = reflexive.make_reflexive()

print(r.get_state())  # Works
print(r.get_logs())   # Works
print(r.chat('hi'))   # Returns error (expected)
```

## Deployment

### Development

```bash
# Install in editable mode
cd python-sdk
pip install -e .

# Run examples
reflexive --debug examples/simple_app.py
```

### Production (Standalone)

```python
# No CLI needed if you don't use .chat()
import reflexive

r = reflexive.make_reflexive({'web_ui': True, 'port': 3099})
# Dashboard at http://localhost:3099
```

### Production (With CLI)

```bash
# Run app with CLI
reflexive --debug app.py

# Or via Docker
docker run -p 3099:3099 -v $(pwd):/app reflexive --debug /app/app.py
```

## Future Architecture Changes

### Direct Claude SDK Integration

```python
r = reflexive.make_reflexive({
    'api_key': 'sk-...',
    'model': 'claude-3-5-sonnet'
})

# Works standalone without CLI
response = r.chat('question')
```

### Async Support

```python
import asyncio

async def main():
    r = await reflexive.make_reflexive_async()
    response = await r.chat('question')

asyncio.run(main())
```

### Custom Tools

```python
r = reflexive.make_reflexive({
    'tools': [
        {
            'name': 'get_users',
            'handler': lambda: database.get_user_count()
        }
    ]
})
```

## Comparison with Node.js Architecture

| Aspect | Node.js | Python |
|--------|---------|--------|
| **Injection** | --require flag | Import-time |
| **Interception** | console.* | logging + stdout |
| **HTTP** | http module | urllib |
| **Server** | Express-like | http.server |
| **Async** | Native | Sync (future: asyncio) |
| **Process** | child_process | subprocess |
| **Types** | TypeScript | Type hints |

**Same architecture, different implementations.**

Both use HTTP localhost communication, both have two modes (standalone vs CLI child), both provide the same conceptual API.

---

**This architecture enables AI-native Python applications with minimal overhead and maximum flexibility.** 🚀
