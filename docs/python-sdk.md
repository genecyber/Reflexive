# Python SDK

The Reflexive Python SDK brings AI-native capabilities to Python applications. Use `.chat()` to embed Claude-powered reasoning directly in your Python code.

## Installation

```bash
# Install Reflexive CLI (Node.js - required)
npm install -g reflexive

# Install Python SDK
pip install reflexive
```

The Python SDK requires the Node.js CLI for AI capabilities.

## Quick Start

```python
import reflexive

# Create Reflexive instance with spawned CLI
r = reflexive.make_reflexive({'spawn_cli': True})

# Track state
r.set_state('users.count', 42)

# Ask AI
answer = r.chat('How many users are there?')
print(answer)  # "There are currently 42 users."
```

## Architecture

The Python SDK communicates with the Node.js Reflexive CLI via HTTP:

```
Python App                    Node.js CLI
    │                              │
    │  make_reflexive()           │
    │  {'spawn_cli': True}        │
    ├──────────────────────────►  │
    │                              │ Starts HTTP server
    │                              │ Port 3099
    │                              │
    │  .chat("message")            │
    ├──HTTP POST /chat ────────►  │
    │                              │ Claude Agent SDK
    │  ◄────SSE stream────────────┤
    │  "AI response"               │
    │                              │
    │  .set_state(key, value)     │
    ├──HTTP POST /client-state──► │
    │  (fire-and-forget)           │
```

### Two Modes

#### 1. CLI Child Mode (via `reflexive app.py`)

When you run `reflexive app.py`, the CLI sets environment variables:
- `REFLEXIVE_CLI_MODE=true`
- `REFLEXIVE_CLI_PORT=3099`

Your Python code detects these and connects automatically:

```python
import reflexive

# No spawn_cli needed - detects CLI mode
r = reflexive.make_reflexive()

# Chat works immediately
r.chat('Analyze my app')
```

#### 2. Standalone Mode (spawned CLI)

The SDK spawns the CLI as a subprocess:

```python
import reflexive

# Spawns: npx reflexive --write app.py
r = reflexive.make_reflexive({'spawn_cli': True})

# CLI runs in background, shuts down on exit
r.chat('Hello AI')
```

## API Reference

### `make_reflexive(options=None)`

Create a Reflexive instance.

**Options:**
- `spawn_cli` (bool): Spawn CLI in background (default: False)
- `debug` (bool): Enable debugger (default: False)
- `shell` (bool): Enable shell access (default: False)
- `write` (bool): Enable file writing (default: True)
- `port` (int): Dashboard port (default: 3099)
- `entry` (str): Python file to run (default: current script)
- `max_logs` (int): Maximum log entries (default: 500)

**Returns:** `ReflexiveInstance`

### ReflexiveInstance Methods

#### `.chat(message: str) -> str`

Send message to AI and get response.

```python
answer = r.chat('What should I do next?')
```

Requires either:
- Running via `reflexive app.py`, OR
- `spawn_cli=True` option

#### `.set_state(key: str, value: Any) -> None`

Set state visible to AI.

```python
r.set_state('users.active', 42)
r.set_state('cache.hit_rate', 0.95)
```

#### `.get_state(key: Optional[str] = None) -> Any`

Get state value(s).

```python
count = r.get_state('users.active')
all_state = r.get_state()
```

#### `.log(type: str, message: str) -> None`

Add log entry.

```python
r.log('info', 'Processing started')
r.log('warn', 'High memory usage')
r.log('error', f'Failed: {error}')
```

**Note:** `print()` statements are automatically captured.

#### `.get_logs(count: Optional[int] = None, log_type: Optional[str] = None)`

Retrieve logs.

```python
recent = r.get_logs(10)
errors = r.get_logs(50, 'error')
```

#### `.get_status() -> Dict`

Get application status.

```python
status = r.get_status()
# {'pid': 12345, 'uptime': 60.5, 'memory': {...}}
```

## Examples

### AI-Powered Web Server

```python
import reflexive
from http.server import HTTPServer, BaseHTTPRequestHandler

r = reflexive.make_reflexive({'spawn_cli': True})

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/story/'):
            topic = self.path[7:]

            # Use AI to generate content
            story = r.chat(f'Write a short story about: {topic}')

            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(story.encode())

            # Track metrics
            count = r.get_state('stories.generated') or 0
            r.set_state('stories.generated', count + 1)

HTTPServer(('', 8080), Handler).serve_forever()
```

### Data Pipeline Monitoring

```python
import reflexive

r = reflexive.make_reflexive({'spawn_cli': True})

for i in range(100):
    success = process_record(i)

    r.set_state('records.processed', i + 1)
    r.set_state('records.success_rate', success_rate)

    # Ask AI for analysis every 20 records
    if i % 20 == 0:
        analysis = r.chat('How is the pipeline performing?')
        print(f"AI: {analysis}")
```

### Inline Decision Making

```python
import reflexive

r = reflexive.make_reflexive({'spawn_cli': True})

def handle_request(data):
    # Ask AI for decision
    should_cache = r.chat(
        f"Should I cache this request? Data: {data}"
    )

    if 'yes' in should_cache.lower():
        cache.set(data)

    return process(data)
```

## Comparison with TypeScript SDK

| Feature | TypeScript | Python |
|---------|------------|--------|
| Create instance | `makeReflexive()` | `make_reflexive()` |
| Chat | `await r.chat()` | `r.chat()` (sync) |
| Set state | `r.setState()` | `r.set_state()` |
| Get state | `r.getState()` | `r.get_state()` |
| Logging | Intercepts `console.*` | Intercepts `print()` |
| Standalone | Uses Claude SDK | Spawns Node CLI |
| Child mode | HTTP to parent | HTTP to parent |

**Key difference:** Python spawns the Node CLI (no native Claude SDK), but the API is otherwise identical.

## Best Practices

### State Management

Keep state small:

```python
# Good
r.set_state('users.count', 42)
r.set_state('cache.hit_rate', 0.95)

# Bad
r.set_state('all_data', huge_list)  # Don't do this!
```

### Chat Performance

`.chat()` takes 5-30 seconds. Use sparingly:

```python
# Good: Periodic checks
if iteration % 100 == 0:
    health = r.chat('Analyze health')

# Bad: Per-request
@app.route('/api')
def handler():
    r.chat('Process this')  # Too slow!
```

### Development vs Production

**Development:**
```python
r = reflexive.make_reflexive({
    'spawn_cli': True,
    'debug': True,
    'shell': True
})
```

**Production:**
```bash
reflexive --write app.py
```

```python
# Minimal in prod
r = reflexive.make_reflexive()
```

## Troubleshooting

### "Chat requires running under Reflexive CLI"

**Solution:**
```bash
# Option 1: Use CLI
reflexive app.py

# Option 2: Spawn in code
r = reflexive.make_reflexive({'spawn_cli': True})
```

### "Reflexive CLI not found"

**Solution:**
```bash
npm install -g reflexive
```

### Chat is slow

This is normal! AI inference takes time. Don't use `.chat()` in hot paths or per-request handlers.

## Implementation Notes

The Python SDK matches the TypeScript `makeReflexive()` pattern:

1. **Environment Detection:** Checks `REFLEXIVE_CLI_MODE` to detect parent CLI
2. **HTTP Communication:** Uses HTTP POST (not MCP/stdio) for parent-child IPC
3. **Fire-and-Forget State Sync:** `.set_state()` doesn't wait for response
4. **SSE Parsing:** Collects text chunks from Server-Sent Events
5. **Logging Interception:** Monkey-patches `sys.stdout.write` and `logging` module

The Node CLI provides the Claude Agent SDK, web dashboard, and debugger. Python communicates via simple HTTP endpoints.

## Future Enhancements

- Async/await support (`.chat_async()`)
- Custom tools registration
- Direct Anthropic API integration (without CLI)
- Native Python MCP server

## Learn More

- **Full Docs:** [python-sdk/README.md](../python-sdk/README.md)
- **Examples:** [python-sdk/examples/](../python-sdk/examples/)
- **Design:** [python-sdk/DESIGN.md](../python-sdk/DESIGN.md)
- **Architecture:** [python-sdk/ARCHITECTURE.md](../python-sdk/ARCHITECTURE.md)
