# Reflexive Python SDK - Implementation Summary

## What We Built

A Python SDK that mirrors the TypeScript `makeReflexive()` API, enabling Python developers to embed AI chat functionality directly into their applications using `.chat()`.

## Architecture Overview

### The Pattern (Matches TypeScript Exactly)

```
┌─────────────────────────────────────────────────────────────┐
│                    TypeScript Pattern                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  makeReflexive()                                             │
│    │                                                          │
│    ├─> Check REFLEXIVE_CLI_MODE env var                     │
│    │                                                          │
│    ├─> If TRUE → Client Mode:                               │
│    │      • HTTP POST to localhost:{CLI_PORT}/chat          │
│    │      • HTTP POST to localhost:{CLI_PORT}/client-state  │
│    │      • No server started                                │
│    │                                                          │
│    └─> If FALSE → Standalone Mode:                          │
│           • Starts HTTP server (if webUI: true)              │
│           • Uses @anthropic-ai/claude-agent-sdk directly     │
│           • Intercepts console.log/info/warn/error          │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Python Implementation                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  make_reflexive()                                            │
│    │                                                          │
│    ├─> Check REFLEXIVE_CLI_MODE env var                     │
│    │                                                          │
│    ├─> If TRUE → Client Mode:                               │
│    │      • HTTP POST to localhost:{CLI_PORT}/chat          │
│    │      • HTTP POST to localhost:{CLI_PORT}/client-state  │
│    │      • No subprocess spawned                            │
│    │                                                          │
│    └─> If FALSE → Standalone Mode:                          │
│           • Optionally spawns Node CLI subprocess            │
│           • Connects via HTTP (same as child mode)          │
│           • Intercepts logging.* and print()                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Key Difference: No Direct Claude SDK in Python

**TypeScript:**
```typescript
// Can import Claude SDK directly
import { query } from '@anthropic-ai/claude-agent-sdk';

async function chat(message: string) {
  for await (const chunk of query({ prompt: message })) {
    // Stream response
  }
}
```

**Python:**
```python
# Cannot import Claude SDK (no Python version exists)
# Solution: Use Node CLI as backend

def chat(message: str) -> str:
    # POST to Node CLI which has the SDK
    response = urllib.request.urlopen(
        f"http://localhost:{cli_port}/chat",
        data=json.dumps({"message": message})
    )
    return parse_sse_response(response)
```

## Implementation Details

### Files Created

```
python-sdk/
├── reflexive/
│   ├── __init__.py        # Public API exports
│   ├── types.py           # Type definitions
│   ├── app_state.py       # AppState class (logs & state management)
│   └── core.py            # make_reflexive() and ReflexiveInstance
├── examples/
│   ├── simple_app.py      # Basic usage demo
│   ├── web_server.py      # AI-powered web server
│   ├── data_pipeline.py   # Monitoring example
│   └── README.md          # Examples documentation
├── README.md              # Main documentation
├── DESIGN.md              # Design decisions
├── COMPARISON.md          # TypeScript vs Python comparison
├── pyproject.toml         # Python package metadata
├── setup.py               # Setup script
└── test_basic.py          # Basic tests
```

### Core API

```python
import reflexive

# Create instance (detects REFLEXIVE_CLI_MODE automatically)
r = reflexive.make_reflexive()

# Or spawn CLI in background
r = reflexive.make_reflexive({'spawn_cli': True})

# Use the API
r.set_state('count', 42)
r.log('info', 'Processing started')
answer = r.chat('What is the count?')
```

### HTTP Communication Protocol

**Chat Request:**
```
POST http://localhost:3099/chat
Content-Type: application/json

{
  "message": "What is the current state?"
}
```

**Chat Response (SSE):**
```
data: {"type":"text","content":"The"}
data: {"type":"text","content":" current"}
data: {"type":"text","content":" state..."}
data: {"type":"done"}
```

**State Sync (Fire-and-Forget):**
```
POST http://localhost:3099/client-state
Content-Type: application/json

{
  "key": "users.count",
  "value": 42
}
```

### Logging Interception

**TypeScript:**
```typescript
// Intercept console methods
const originalLog = console.log;
console.log = (...args) => {
  appState.log('info', args.join(' '));
  originalLog(...args);
};
```

**Python:**
```python
# Intercept logging module
class ReflexiveHandler(logging.Handler):
    def emit(self, record):
        app_state.log(record.levelname.lower(), self.format(record))

logging.root.addHandler(ReflexiveHandler())

# Also intercept print() via stdout/stderr
original_stdout = sys.stdout.write
def stdout_interceptor(text):
    if text and text.strip():
        app_state.log('stdout', text.rstrip())
    return original_stdout(text)
sys.stdout.write = stdout_interceptor
```

## How It Works: Three Scenarios

### Scenario 1: Run via CLI (Recommended)

**User runs:**
```bash
reflexive --debug app.py
```

**What happens:**
1. Reflexive CLI starts:
   - Spawns Python process: `python app.py`
   - Sets env vars: `REFLEXIVE_CLI_MODE=true`, `REFLEXIVE_CLI_PORT=3099`
   - Starts HTTP server on port 3099
   - Starts debugger (DAP) on dynamic port
   - Opens web dashboard

2. Python app calls `make_reflexive()`:
   - Detects `REFLEXIVE_CLI_MODE=true`
   - Creates client-mode instance
   - No subprocess spawning

3. Python calls `r.chat("message")`:
   - HTTP POST to `localhost:3099/chat`
   - CLI forwards to Claude Agent SDK
   - CLI streams SSE response back
   - Python collects text chunks and returns string

### Scenario 2: Spawn CLI in Background

**User code:**
```python
import reflexive
r = reflexive.make_reflexive({'spawn_cli': True})
r.chat("message")
```

**What happens:**
1. `make_reflexive()` is called:
   - Detects `REFLEXIVE_CLI_MODE` not set
   - Sees `spawn_cli=True` option
   - Spawns subprocess: `npx reflexive --write app.py`
   - Waits 2 seconds for CLI to start
   - Stores CLI port (3099) and process handle

2. Python calls `r.chat("message")`:
   - HTTP POST to `localhost:3099/chat` (same as Scenario 1)
   - Response handling identical

3. Python exits:
   - `atexit` handler calls `cli_process.terminate()`
   - CLI shuts down gracefully

### Scenario 3: Standalone (Chat Disabled)

**User code:**
```python
import reflexive
r = reflexive.make_reflexive()  # No CLI running, no spawn_cli
response = r.chat("message")
print(response)  # "Error: Chat requires running under Reflexive CLI"
```

**What happens:**
- `make_reflexive()` detects no CLI mode, no spawn option
- Creates instance with `cli_port=None`
- `.chat()` returns error message
- State management and logging still work

## Testing

### Manual Test (CLI Mode)

```bash
cd python-sdk
reflexive --debug examples/simple_app.py
```

Expected output:
```
✓ Reflexive CLI started (PID: 12345)
  Dashboard: http://localhost:3099/reflexive
[reflexive] Running in CLI child mode, connecting to parent on port 3099

🔄 Simple Reflexive App

State: users.count = 0
State: app.version = 1.0.0

Asking AI: How many users are there?
🤖 Response: Currently there are 0 users according to the state.
```

### Manual Test (Spawn Mode)

```bash
cd python-sdk
python examples/simple_app_spawn.py
```

Expected output:
```
[reflexive] Spawning Reflexive CLI for simple_app_spawn.py...
[reflexive] CLI started (PID: 12346)
[reflexive] Dashboard: http://localhost:3099/reflexive

🔄 Simple Reflexive App (with spawned CLI)

State: users.count = 0

Asking AI: How many users are there?
🤖 Response: The user count is currently 0.
```

## Differences from Initial Attempt

### What I Initially Built (Wrong):

```python
# WRONG: Tried to use MCP protocol over stdio

class MCPClient:
    def __init__(self, cli_process):
        self.process = cli_process  # subprocess with stdin/stdout pipes

    def call_tool(self, tool_name, args):
        # Send JSON-RPC via stdin
        msg = {"jsonrpc": "2.0", "method": "tools/call", ...}
        self.process.stdin.write(json.dumps(msg))

        # Read response from stdout
        response = self.process.stdout.readline()
        return json.loads(response)

# Spawn CLI with MCP mode
cli_process = subprocess.Popen(
    ['npx', 'reflexive', '--mcp', 'app.py'],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE
)
```

**Problems:**
- TypeScript library doesn't use MCP for child communication
- MCP is for external agents (Claude Code, Claude Desktop)
- Added unnecessary complexity
- Had to parse JSON-RPC responses
- Required background thread for stdout reading

### What TypeScript Actually Does (Correct):

```typescript
// Check if running under CLI
if (process.env.REFLEXIVE_CLI_MODE === 'true') {
  const cliPort = parseInt(process.env.REFLEXIVE_CLI_PORT);

  // Just HTTP POST to parent!
  async function chat(message) {
    const response = await fetch(`http://localhost:${cliPort}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });

    // Parse SSE stream
    for await (const chunk of response.body) {
      // ...
    }
  }
}
```

**Why this is better:**
- Simple HTTP client (no JSON-RPC parsing)
- No subprocess needed in child mode
- No pipe management
- Fire-and-forget state syncing
- Matches existing CLI HTTP API

### Final Python Implementation (Correct):

```python
# Detect CLI mode via environment variables
cli_mode = os.environ.get("REFLEXIVE_CLI_MODE") == "true"
cli_port = int(os.environ.get("REFLEXIVE_CLI_PORT", "0"))

if cli_mode and cli_port:
    # Client mode - HTTP to parent
    def chat(message):
        response = urllib.request.urlopen(
            f"http://localhost:{cli_port}/chat",
            data=json.dumps({"message": message}).encode()
        )
        # Parse SSE and collect text
        ...
else:
    # Standalone mode - optionally spawn CLI
    if options.get('spawn_cli'):
        cli_process = subprocess.Popen(['npx', 'reflexive', 'app.py'])
        # Then connect via HTTP (same as above)
```

**Benefits:**
- Matches TypeScript pattern exactly
- Simpler (no MCP protocol)
- Works with existing CLI HTTP endpoints
- Easy to debug (can use curl to test)
- No threading complexity

## API Comparison

| Feature | TypeScript | Python | Notes |
|---------|------------|--------|-------|
| **Entry point** | `makeReflexive(opts)` | `make_reflexive(opts)` | PEP 8 naming |
| **Return type** | `ReflexiveInstance` | `ReflexiveInstance` | Same |
| **Chat** | `await r.chat(msg)` | `r.chat(msg)` | Python is sync |
| **State** | `r.setState(k, v)` | `r.set_state(k, v)` | PEP 8 naming |
| **Logging** | `r.log(type, msg)` | `r.log(type, msg)` | Same |
| **Child detection** | `process.env.REFLEXIVE_CLI_MODE` | `os.environ.get("REFLEXIVE_CLI_MODE")` | Same var name |
| **HTTP endpoint** | `fetch('http://localhost:3099/chat')` | `urllib.request.urlopen(...)` | Same URL |
| **State sync** | Fire-and-forget POST | Fire-and-forget POST | Same |
| **Console intercept** | Monkey-patch `console.*` | Monkey-patch `sys.stdout.write` | Different target |
| **Standalone** | Uses Claude SDK | Spawns Node CLI | Python can't use SDK |

## Key Takeaways

### What Makes This Work

1. **Environment Variable Detection:**
   - Both TypeScript and Python check `REFLEXIVE_CLI_MODE`
   - Simple, portable, works across languages

2. **HTTP Communication:**
   - Universal protocol (not language-specific)
   - Easy to debug (use curl/Postman)
   - Existing CLI endpoints work for both

3. **Fire-and-Forget State Syncing:**
   - `.setState()` doesn't wait for response
   - Failures are silent (by design)
   - Keeps app responsive

4. **SSE for Chat Streaming:**
   - Standard format for streaming responses
   - Works with any HTTP client
   - Easy to parse line-by-line

### Design Decisions

1. **Why HTTP instead of MCP?**
   - MCP is for external agents (Claude Code)
   - Library mode needs simple parent-child IPC
   - HTTP is simpler, universal, debuggable

2. **Why spawn CLI instead of implementing Claude SDK in Python?**
   - No official Python SDK from Anthropic
   - Node CLI already has full implementation
   - Reuses existing, battle-tested code
   - Easier to maintain (one codebase)

3. **Why synchronous `.chat()` in Python?**
   - Simpler API (no async/await required)
   - Most AI use cases are already slow (10s+)
   - Can add async variant later if needed

4. **Why intercept `print()` and not just `logging.*`?**
   - Many Python apps use `print()` not `logging`
   - Need to capture all output for dashboard
   - Matches TypeScript's console interception

## Future Enhancements

### Short Term
- [ ] Add `.chat_async()` for async/await support
- [ ] Better error messages when CLI not found
- [ ] Auto-install CLI if missing (optional)
- [ ] Type stubs (`.pyi` files) for better IDE support

### Medium Term
- [ ] Direct Anthropic API integration (without CLI)
- [ ] Custom tools support
- [ ] Session management (resume chat sessions)
- [ ] Streaming chat responses (yield chunks)

### Long Term
- [ ] Native Python MCP server (remove Node dependency)
- [ ] WASM-based CLI (smaller, faster startup)
- [ ] Multi-process support (shared state across workers)
- [ ] Production deployment guides

## Conclusion

We successfully ported the TypeScript `makeReflexive()` pattern to Python by:

1. ✅ Matching the architecture exactly (child mode via HTTP)
2. ✅ Supporting standalone mode by spawning Node CLI
3. ✅ Using same environment variables for detection
4. ✅ Using same HTTP endpoints for communication
5. ✅ Providing identical user-facing API
6. ✅ Maintaining feature parity (state, logging, chat)

The result is a Python SDK that feels native while reusing the robust Node.js implementation under the hood. Python developers can now use `.chat()` in their apps just like TypeScript developers can!
