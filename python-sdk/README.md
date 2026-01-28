# Reflexive Python SDK

Add AI-native capabilities to your Python applications with `reflexive.chat()`.

This Python SDK brings the same powerful AI integration from the Node.js version to Python, allowing you to embed Claude-powered chat directly into your code.

## Installation

```bash
# Install the Python SDK
pip install reflexive

# Install the Reflexive CLI (Node.js)
npm install -g reflexive
```

The Python SDK requires the Node.js CLI for AI capabilities. The CLI provides the Claude Agent SDK integration, web dashboard, and debugger.

## Quick Start

```python
import reflexive

# Create Reflexive instance
r = reflexive.make_reflexive({'spawn_cli': True})

# Track state (visible to AI)
r.set_state('users.count', 42)
r.set_state('cache.hit_rate', 0.95)

# Ask AI questions
answer = r.chat('What is the cache hit rate?')
print(answer)  # "The cache hit rate is currently 95%."

# AI has full context about your app
analysis = r.chat('Should I scale up based on user count?')
print(analysis)
```

## Two Usage Modes

### Mode 1: Via Reflexive CLI (Recommended)

Run your Python app through the Reflexive CLI:

```bash
reflexive --debug app.py
```

Your Python code:
```python
import reflexive

# Automatically connects to parent CLI
r = reflexive.make_reflexive()

# Chat works immediately!
response = r.chat('Analyze my app')
```

**Benefits:**
- ✅ Full AI capabilities
- ✅ Web dashboard
- ✅ Debugger support
- ✅ No background processes

### Mode 2: Standalone with Spawned CLI

The SDK spawns the CLI automatically:

```python
import reflexive

# Spawn CLI in background
r = reflexive.make_reflexive({
    'spawn_cli': True,  # Spawns npx reflexive
    'debug': True,
    'port': 3099
})

# Chat works!
response = r.chat('Hello AI')
```

**Benefits:**
- ✅ No manual CLI command
- ✅ Works with standard `python app.py`
- ✅ Good for development

## API Reference

### `make_reflexive(options=None)`

Create a Reflexive instance.

**Options:**
- `spawn_cli` (bool): Spawn CLI in background (default: False)
- `debug` (bool): Enable debugger for spawned CLI (default: False)
- `shell` (bool): Enable shell access (default: False)
- `write` (bool): Enable file writing (default: True)
- `port` (int): Dashboard port (default: 3099)
- `max_logs` (int): Maximum log entries (default: 500)

**Returns:** `ReflexiveInstance`

### `ReflexiveInstance.chat(message)`

Send a message to the AI and get a response.

```python
answer = r.chat('What is the current memory usage?')
```

The AI has full access to:
- Your app's state (set via `set_state()`)
- Logs
- Process metrics
- All MCP tools (file ops, shell, debugging)

### `ReflexiveInstance.set_state(key, value)`

Set state that's visible to the AI.

```python
r.set_state('users.active', 42)
r.set_state('db.connections', 10)
r.set_state('feature_flags.new_ui', True)
```

Use dot notation for hierarchy. Keep values small (metrics, not data).

### `ReflexiveInstance.get_state(key=None)`

Get state value(s).

```python
count = r.get_state('users.active')  # 42
all_state = r.get_state()  # {'users.active': 42, ...}
```

### `ReflexiveInstance.log(type, message)`

Add a log entry.

```python
r.log('info', 'Processing started')
r.log('warn', 'High memory usage detected')
r.log('error', f'Failed to connect: {error}')
```

**Note:** `print()` statements are automatically captured!

### `ReflexiveInstance.get_logs(count=None, log_type=None)`

Retrieve log entries.

```python
recent = r.get_logs(10)              # Last 10 logs
errors = r.get_logs(50, 'error')     # Last 50 errors
all_logs = r.get_logs()              # All logs (up to max_logs)
```

## Examples

### Example 1: AI-Powered Web Server

```python
import reflexive
from http.server import HTTPServer, BaseHTTPRequestHandler

r = reflexive.make_reflexive({'spawn_cli': True})

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/story/'):
            topic = self.path[7:]

            # Use AI to generate content!
            story = r.chat(f'Write a short story about: {topic}')

            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(story.encode())

            # Track metrics
            r.set_state('stories.generated', r.get_state('stories.generated') or 0 + 1)

HTTPServer(('', 8080), Handler).serve_forever()
```

Visit http://localhost:8080/story/space-adventure

### Example 2: Data Pipeline Monitoring

```python
import reflexive
import time

r = reflexive.make_reflexive({'spawn_cli': True, 'debug': True})

records_processed = 0
errors = 0

for record_id in range(100):
    success = process_record(record_id)

    if success:
        records_processed += 1
    else:
        errors += 1

    # Update state
    r.set_state('records.processed', records_processed)
    r.set_state('records.errors', errors)
    r.set_state('records.error_rate', errors / (record_id + 1))

    # Ask AI for insights every 20 records
    if record_id % 20 == 0:
        analysis = r.chat('Analyze the pipeline health. Should I be concerned?')
        print(f"AI: {analysis}")
```

### Example 3: Inline Debugging

```python
import reflexive

r = reflexive.make_reflexive({'spawn_cli': True, 'debug': True})

def complex_calculation(data):
    result = 0
    for item in data:
        result += item * 2

    # Ask AI to analyze
    explanation = r.chat(f'Explain what this calculation does. Result: {result}')
    print(explanation)

    return result
```

## How It Works

### Architecture

```
┌─────────────────────────────────────┐
│   Your Python App                   │
│                                     │
│   import reflexive                  │
│   r = make_reflexive(               │
│       {'spawn_cli': True}           │
│   )                                 │
│   r.chat('message')                 │
└──────────┬──────────────────────────┘
           │ HTTP (localhost)
           ▼
┌─────────────────────────────────────┐
│   Reflexive CLI (Node.js)           │
│   - Claude Agent SDK                │
│   - Web Dashboard                   │
│   - MCP Tools                       │
│   - Debugger                        │
└─────────────────────────────────────┘
```

1. Python SDK spawns `npx reflexive` as subprocess
2. CLI starts HTTP server on localhost
3. SDK communicates via HTTP POST (SSE for streaming)
4. AI responses flow back to Python

### Parent-Child Mode

When run via `reflexive app.py`:

```python
# Detects REFLEXIVE_CLI_MODE environment variable
r = reflexive.make_reflexive()  # No spawn_cli needed!
```

The SDK connects to the parent CLI automatically.

## Comparison with Node.js SDK

| Feature | Node.js | Python |
|---------|---------|--------|
| `make_reflexive()` | ✅ | ✅ |
| `.chat(message)` | ✅ | ✅ |
| `.setState(key, value)` | ✅ | ✅ `.set_state()` |
| `.getState(key)` | ✅ | ✅ `.get_state()` |
| `.log(type, msg)` | ✅ | ✅ |
| Auto log interception | ✅ | ✅ |
| Web dashboard | ✅ | ✅ (via CLI) |
| Custom tools | ✅ | ⏳ Coming soon |
| Async API | ✅ Native | ⏳ Coming soon |

## Best Practices

### 1. State Management

Keep state small and informative:

```python
# Good: Metrics and counters
r.set_state('requests.count', 1234)
r.set_state('cache.hit_rate', 0.95)
r.set_state('errors.last_hour', 5)

# Bad: Large objects
r.set_state('all_users', huge_list)  # ❌ Don't do this!
```

### 2. Chat Questions

Be specific with your questions:

```python
# Vague
r.chat('How are things?')

# Specific
r.chat('Is the error rate trending up?')
r.chat('Should I scale based on request count?')
r.chat('Explain this calculation: ...')
```

### 3. Development vs Production

Development:
```python
r = reflexive.make_reflexive({
    'spawn_cli': True,
    'debug': True,
    'shell': True
})
```

Production (via CLI):
```bash
reflexive --write app.py
```

```python
# Minimal in prod
r = reflexive.make_reflexive()
```

## Troubleshooting

### Chat returns "Error: Chat requires running under Reflexive CLI"

You need to either:
1. Run with `reflexive app.py`, OR
2. Set `spawn_cli: True` in options

### "Reflexive CLI not found"

Install the Node.js CLI:
```bash
npm install -g reflexive
```

### Spawned CLI exits immediately

Check the CLI output. Common issues:
- Missing Node.js
- Python file not found
- CLI flags conflict

## Learn More

- **API Docs:** [API.md](./API.md)
- **Design:** [DESIGN.md](./DESIGN.md)
- **Examples:** [examples/](./examples/)
- **Node.js SDK:** [../README.md](../README.md)

## License

MIT
