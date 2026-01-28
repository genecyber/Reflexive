# Reflexive Python SDK - Implementation Summary

## 🎉 What We Built

We created a **Python SDK for Reflexive** that brings the same `.chat()` capabilities from the Node.js version to Python applications.

### Key Achievement

**Python developers can now embed AI directly in their code:**

```python
import reflexive

r = reflexive.make_reflexive({'spawn_cli': True})

# Ask AI questions from anywhere in your Python code!
answer = r.chat('What should I do about this error?')
```

## Architecture

### The Design Pattern

We followed the **exact same architecture** as the TypeScript `makeReflexive()`:

```
┌─────────────────────┐
│  Python App         │
│  reflexive.py       │
└──────┬──────────────┘
       │ HTTP (localhost)
       │ Spawns subprocess OR
       │ Detects parent
       ▼
┌─────────────────────┐
│  Reflexive CLI      │
│  (Node.js)          │
│  - Claude SDK       │
│  - Web Dashboard    │
│  - Debugger         │
└─────────────────────┘
```

### Two Modes (Just Like TypeScript)

#### Mode 1: Child Mode (via `reflexive app.py`)
- Detects `REFLEXIVE_CLI_MODE` environment variable
- Connects to parent CLI via HTTP
- No subprocess spawning needed

#### Mode 2: Standalone with Spawned CLI
- User sets `spawn_cli: True`
- Python spawns `npx reflexive` as subprocess
- Communicates via HTTP to spawned CLI

This **exactly mirrors** the TypeScript implementation!

## Files Created

### Core Library

```
python-sdk/
├── reflexive/
│   ├── __init__.py           # Public API exports
│   ├── types.py              # Type definitions
│   ├── app_state.py          # AppState class (logs & state)
│   └── core.py               # make_reflexive() + ReflexiveInstance
├── pyproject.toml            # Package configuration
└── README.md                 # User documentation
```

### Examples

```
examples/
├── simple_app.py             # Basic usage demo
├── web_server.py             # AI-powered web API
├── data_pipeline.py          # Monitoring example
└── README.md                 # Example docs
```

### Documentation

```
├── README.md                 # Main user guide
├── DESIGN.md                 # Architecture & design decisions
└── SUMMARY.md                # This file!
```

## API

### Python API (matches TypeScript naming conventions)

```python
# TypeScript: makeReflexive()
# Python: make_reflexive()  (PEP 8 snake_case)
r = reflexive.make_reflexive({'spawn_cli': True})

# TypeScript: .setState()
# Python: .set_state()
r.set_state('count', 42)

# TypeScript: .getState()
# Python: .get_state()
value = r.get_state('count')

# Same in both!
r.chat('message')
r.log('info', 'message')
```

## How It Works

### 1. Spawning the CLI

```python
# In make_reflexive():
cli_cmd = ['npx', 'reflexive', '--write', entry_file]
cli_process = subprocess.Popen(cli_cmd, ...)
```

### 2. HTTP Communication

```python
# chat() sends HTTP POST to CLI's /chat endpoint
url = f"http://localhost:{cli_port}/chat"
response = urllib.request.urlopen(req)

# Reads SSE stream
for line in response:
    chunk = json.loads(line[6:])  # "data: {...}"
    if chunk["type"] == "text":
        full_response += chunk["content"]
```

### 3. State Syncing

```python
# set_state() syncs to CLI (fire-and-forget)
url = f"http://localhost:{cli_port}/client-state"
urllib.request.urlopen(req, timeout=1)
```

### 4. Log Interception

```python
# Intercepts both logging module and stdout/stderr
class ReflexiveHandler(logging.Handler):
    def emit(self, record):
        app_state.log(record.levelname.lower(), self.format(record))

sys.stdout.write = stdout_interceptor
sys.stderr.write = stderr_interceptor
```

## Example Use Cases

### 1. AI-Powered Web Server

```python
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        story = r.chat(f'Write a story about: {topic}')
        self.wfile.write(story.encode())
```

Every request generates fresh AI content!

### 2. Data Pipeline Monitoring

```python
for record in records:
    process(record)
    r.set_state('processed', count)

    if count % 20 == 0:
        analysis = r.chat('Is the pipeline healthy?')
        alert_if_needed(analysis)
```

AI monitors your pipeline in real-time.

### 3. Inline Debugging

```python
def complex_function(data):
    result = calculate(data)

    # Ask AI to explain
    explanation = r.chat(f'Explain this result: {result}')
    print(explanation)

    return result
```

AI helps you understand your code as it runs!

## Key Design Decisions

### Why HTTP Instead of MCP Over Stdio?

We initially considered MCP (Model Context Protocol) over stdio, but chose HTTP to **match the TypeScript implementation**:

- ✅ Same architecture as Node.js SDK
- ✅ Simpler implementation (stdlib only)
- ✅ Works with spawned or parent CLI
- ✅ Fire-and-forget state syncing
- ✅ SSE streaming for chat responses

### Why Spawn CLI Instead of Direct Anthropic SDK?

The Python SDK **delegates to the Node.js CLI** because:

- ✅ Claude Agent SDK is only available in TypeScript
- ✅ Avoids duplicating agent implementation
- ✅ Maintains feature parity with Node.js
- ✅ Web dashboard "just works"
- ✅ Debugger support included

### Why Two Modes?

Matches TypeScript SDK for **flexibility**:

- **Child mode**: Run via `reflexive app.py` - clean, no subprocesses
- **Spawn mode**: Run via `python app.py` - convenient for dev

Users can choose based on their workflow!

## Dependencies

### Minimal Python Dependencies

```toml
dependencies = [
    "psutil>=5.9.0",  # Cross-platform process metrics
]
```

Only one external dependency! Everything else uses stdlib:
- `subprocess` for CLI spawning
- `urllib` for HTTP
- `json` for serialization
- `logging` for interception

### Requires Node.js CLI

```bash
npm install -g reflexive
```

The CLI provides Claude integration, dashboard, and tools.

## Comparison: TypeScript vs Python

| Feature | TypeScript | Python |
|---------|------------|--------|
| **Naming** | `makeReflexive()` | `make_reflexive()` |
| **State** | `.setState(k, v)` | `.set_state(k, v)` |
| **Architecture** | Detects CLI mode / standalone | ✅ Same! |
| **Communication** | HTTP to parent/spawned | ✅ Same! |
| **Logging** | Console interception | ✅ Equivalent |
| **Dependencies** | Several npm packages | Just psutil |
| **Async** | Native async/await | Sync (async TBD) |

## What's Next?

### Possible Enhancements

1. **Async API**
   ```python
   async def main():
       answer = await r.chat_async('message')
   ```

2. **Custom Tools**
   ```python
   r = reflexive.make_reflexive({
       'tools': [
           {'name': 'get_users', 'handler': get_users_fn}
       ]
   })
   ```

3. **Direct Anthropic SDK Integration**
   - For cases where Node.js isn't available
   - Falls back to direct API calls

4. **Streaming Chat**
   ```python
   for chunk in r.chat_stream('message'):
       print(chunk, end='', flush=True)
   ```

## Testing

### Manual Testing

```bash
# 1. Test basic example
cd python-sdk
python examples/simple_app.py

# 2. Test via CLI
reflexive --debug examples/simple_app.py

# 3. Test web server
python examples/web_server.py
# Visit http://localhost:8080/story/adventure
```

### Expected Behavior

- ✅ CLI spawns successfully
- ✅ Dashboard available at :3099
- ✅ .chat() returns AI responses
- ✅ .set_state() visible in dashboard
- ✅ Logs captured from print statements

## Summary

We successfully created a **Python SDK for Reflexive** that:

1. **Matches the TypeScript implementation** - same architecture, same modes
2. **Enables reflexive.chat()** - AI directly in Python code
3. **Spawns the Node CLI** - leverages existing infrastructure
4. **Minimal dependencies** - just psutil for metrics
5. **Well-documented** - README, examples, design docs
6. **Easy to use** - one function call to get started

### The Magic

```python
import reflexive

r = reflexive.make_reflexive({'spawn_cli': True})
answer = r.chat('Should I scale up?')
```

**That's it!** AI-native Python applications are now possible with just 3 lines of code.

## Files Summary

- **Core**: `reflexive/__init__.py`, `core.py`, `app_state.py`, `types.py`
- **Docs**: `README.md`, `DESIGN.md`, `SUMMARY.md`
- **Examples**: `simple_app.py`, `web_server.py`, `data_pipeline.py`
- **Config**: `pyproject.toml`

Total: ~1000 lines of Python code + comprehensive documentation.

---

**The Python SDK is ready! 🎉**

Python developers can now build AI-native applications with Reflexive, just like Node.js developers can.
