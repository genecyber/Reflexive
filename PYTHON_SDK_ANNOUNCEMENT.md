# 🐍 Introducing: Reflexive Python SDK

## What is it?

The Reflexive Python SDK brings AI-native capabilities to Python applications, mirroring the functionality of the Node.js SDK. Now you can use `.chat()` to add inline AI to any Python app!

## Quick Example

```python
import reflexive

# Create Reflexive instance
r = reflexive.make_reflexive()

# Track application state
r.set_state('users.online', 42)
r.set_state('requests.total', 1337)

# Ask AI about your application
response = r.chat('How many users are online?')
print(response)  # "You currently have 42 users online."
```

## Why is this cool?

### Before Reflexive
```python
# Complex: Separate AI service, manual context
import requests

def analyze_performance():
    context = gather_metrics()
    response = requests.post(
        'https://ai-service.com/api',
        json={
            'prompt': f'Analyze: {context}',
            'api_key': 'xxx'
        }
    )
    return response.json()['result']
```

### With Reflexive
```python
# Simple: AI is just a function call
import reflexive

r = reflexive.make_reflexive()
r.set_state('metrics', get_metrics())

analysis = r.chat('Analyze performance')
# AI automatically has context from state!
```

## AI-Powered Web Server Example

```python
import reflexive
from http.server import HTTPServer, BaseHTTPRequestHandler

r = reflexive.make_reflexive()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startsWith('/story/'):
            topic = self.path[7:]

            # Generate content with AI inline!
            story = r.chat(f'Write a short story about: {topic}')

            self.send_response(200)
            self.wfile.write(story.encode('utf-8'))

HTTPServer(('', 8080), Handler).serve_forever()
```

Visit `http://localhost:8080/story/space%20adventure` and get an AI-generated story on demand!

## Key Features

✅ **Same API as Node.js** - Use familiar Reflexive patterns
✅ **Python conventions** - `snake_case`, type hints, Pythonic
✅ **Minimal dependencies** - Just `psutil` required
✅ **CLI integration** - Run with `reflexive --debug app.py`
✅ **Auto-interception** - Captures logging and stdout
✅ **Web dashboard** - Real-time monitoring at `:3099`
✅ **State management** - Share state with AI automatically
✅ **Production ready** - Type safe, well tested

## Installation

```bash
pip install reflexive
```

## Usage

### Method 1: Standalone
```python
import reflexive

r = reflexive.make_reflexive()
r.set_state('count', 42)

# Note: .chat() requires CLI mode or web_ui=True
```

### Method 2: With CLI (Recommended)
```bash
# Install Reflexive CLI (Node.js)
npm install -g reflexive

# Run your Python app
reflexive --debug app.py
```

Now `.chat()` works fully, with:
- Complete AI context about your app
- Debugger support (breakpoints, stepping)
- Web dashboard for monitoring
- All MCP tools available

## Example Apps

Three complete examples included:

1. **simple_app.py** - Basic usage, state tracking, periodic AI analysis
2. **web_server.py** - AI-powered HTTP API with on-demand content generation
3. **data_pipeline.py** - Real-time monitoring with AI health checks

Run any with:
```bash
reflexive --debug examples/simple_app.py
```

## Architecture

```
┌─────────────────────────────┐
│   Python Application         │
│                              │
│   import reflexive          │
│   r = make_reflexive()      │
│   r.chat('...')             │
└──────────┬──────────────────┘
           │ HTTP
           ▼
┌─────────────────────────────┐
│   Reflexive CLI (Node.js)   │
│                              │
│   • Claude Agent SDK        │
│   • Process management      │
│   • Debugger (debugpy)      │
│   • Web dashboard           │
└─────────────────────────────┘
```

The Python SDK automatically detects when running under the CLI and proxies `.chat()` calls seamlessly.

## API Reference

### `make_reflexive(options=None)`

Create Reflexive instance.

**Options:**
- `web_ui` (bool): Enable web dashboard (default: False)
- `port` (int): Dashboard port (default: 3099)
- `title` (str): Dashboard title
- `system_prompt` (str): Additional AI prompt

**Returns:** `ReflexiveInstance`

### `ReflexiveInstance` Methods

- **`.chat(message: str) -> str`** - Send message to AI, get response
- **`.set_state(key: str, value: Any) -> None`** - Set state (visible to AI)
- **`.get_state(key: str = None) -> Any`** - Get state value(s)
- **`.log(type: str, message: str) -> None`** - Add log entry
- **`.get_logs(count: int = None, type: str = None) -> List`** - Get log entries

## Comparison with Node.js

| Feature | Node.js | Python |
|---------|---------|--------|
| API naming | camelCase | snake_case |
| Chat | `await .chat()` | `.chat()` (sync) |
| State | `.setState()` | `.set_state()` |
| Web UI | ✅ | ✅ |
| CLI mode | ✅ | ✅ |
| Debugger | V8 Inspector | debugpy (DAP) |
| Dependencies | Many | Minimal |

## Documentation

📚 Full documentation available in `python-sdk/`:

- **README.md** - Installation, API reference, usage
- **DESIGN.md** - Architecture and design decisions
- **COMPARISON.md** - Side-by-side with Node.js SDK
- **SUMMARY.md** - Project overview and achievements
- **examples/README.md** - Example walkthroughs

## What Makes This Cool?

### 1. Inline AI
No need for separate AI services or complex integrations. AI is just a function call:

```python
result = r.chat('analyze this')
```

### 2. Automatic Context
The AI automatically knows about your application:
- Current state (from `.set_state()`)
- Recent logs
- Process metrics (memory, uptime, etc.)

### 3. Hybrid Applications
Build apps that are **part traditional code, part AI**:

```python
def process_order(order):
    # Traditional code
    validate(order)
    charge_payment(order)

    # AI decides fulfillment strategy
    strategy = r.chat(f'Best fulfillment for: {order.location}')

    # More traditional code
    ship_order(order, strategy)
```

### 4. Zero Configuration
Just `import reflexive` and you're ready. No API keys, no separate services, no complex setup.

## Use Cases

✅ **Data Science** - Ask AI to analyze datasets inline
✅ **Web APIs** - Generate dynamic content on demand
✅ **DevOps** - AI-powered monitoring and alerting
✅ **ETL Pipelines** - Intelligent data processing
✅ **Research** - Interactive AI assistance during computation
✅ **Automation** - Smart decision-making in scripts

## Example: Smart Data Pipeline

```python
import reflexive

r = reflexive.make_reflexive()

for batch in data_batches:
    # Process data
    result = process_batch(batch)

    # Track metrics
    r.set_state('batches.processed', r.get_state('batches.processed') + 1)
    r.set_state('errors.count', result.errors)

    # Every 10 batches, ask AI
    if batch_num % 10 == 0:
        health = r.chat('Is the pipeline healthy? Should we slow down?')

        if 'slow down' in health.lower():
            time.sleep(5)  # AI-suggested backoff
```

## Next Steps

1. **Install:** `pip install reflexive`
2. **Try it:** `python -c "import reflexive; r = reflexive.make_reflexive(); print(r)"`
3. **Run example:** `reflexive --debug examples/simple_app.py`
4. **Build something:** Create your first AI-native Python app!

## Repository

The Python SDK lives in `python-sdk/` in the main Reflexive repository:

```
Reflexive/
├── src/              # Node.js/TypeScript source
├── python-sdk/       # Python SDK
│   ├── reflexive/    # Core package
│   ├── examples/     # Example apps
│   └── docs/         # Documentation
└── ...
```

## Credits

Built with inspiration from the Reflexive Node.js SDK, adapted to Python conventions and ecosystem.

## License

MIT

---

**Welcome to the future of Python development. Build AI-native applications today.** 🚀🐍
