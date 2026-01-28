# Reflexive: Node.js vs Python SDK Comparison

## Side-by-Side Examples

### Basic Setup

<table>
<tr>
<th>Node.js</th>
<th>Python</th>
</tr>
<tr>
<td>

```javascript
import { makeReflexive } from 'reflexive';

const r = makeReflexive();
```

</td>
<td>

```python
import reflexive

r = reflexive.make_reflexive()
```

</td>
</tr>
</table>

### With Web UI

<table>
<tr>
<th>Node.js</th>
<th>Python</th>
</tr>
<tr>
<td>

```javascript
const r = makeReflexive({
  webUI: true,
  port: 3099,
  title: 'My App'
});
```

</td>
<td>

```python
r = reflexive.make_reflexive({
  'web_ui': True,
  'port': 3099,
  'title': 'My App'
})
```

</td>
</tr>
</table>

### State Management

<table>
<tr>
<th>Node.js</th>
<th>Python</th>
</tr>
<tr>
<td>

```javascript
// Set state
r.setState('users.count', 42);
r.setState('server.status', 'running');

// Get state
const count = r.getState('users.count');
const all = r.getState();
```

</td>
<td>

```python
# Set state
r.set_state('users.count', 42)
r.set_state('server.status', 'running')

# Get state
count = r.get_state('users.count')
all = r.get_state()
```

</td>
</tr>
</table>

### Logging

<table>
<tr>
<th>Node.js</th>
<th>Python</th>
</tr>
<tr>
<td>

```javascript
// Direct logging
r.log('info', 'Server started');
r.log('error', 'Connection failed');

// Console interception (automatic)
console.log('Hello');  // Captured
console.error('Error'); // Captured
```

</td>
<td>

```python
# Direct logging
r.log('info', 'Server started')
r.log('error', 'Connection failed')

# Logging interception (automatic)
import logging
logging.info('Hello')  # Captured
print('World')         # Captured
```

</td>
</tr>
</table>

### AI Chat

<table>
<tr>
<th>Node.js</th>
<th>Python</th>
</tr>
<tr>
<td>

```javascript
// Async/await
const answer = await r.chat(
  'What is the current uptime?'
);
console.log(answer);
```

</td>
<td>

```python
# Synchronous
answer = r.chat(
  'What is the current uptime?'
)
print(answer)
```

</td>
</tr>
</table>

### AI-Powered Web Server

<table>
<tr>
<th>Node.js</th>
<th>Python</th>
</tr>
<tr>
<td>

```javascript
import { makeReflexive } from 'reflexive';
import http from 'http';

const r = makeReflexive();

http.createServer(async (req, res) => {
  if (req.url?.startsWith('/story/')) {
    const topic = req.url.slice(7);

    // Use AI inline!
    const story = await r.chat(
      `Write a short story about: ${topic}`
    );

    res.end(JSON.stringify({ story }));
  }
}).listen(8080);
```

</td>
<td>

```python
import reflexive
from http.server import HTTPServer, BaseHTTPRequestHandler

r = reflexive.make_reflexive()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/story/'):
            topic = self.path[7:]

            # Use AI inline!
            story = r.chat(
                f'Write a short story about: {topic}'
            )

            self.wfile.write(story.encode('utf-8'))

HTTPServer(('', 8080), Handler).serve_forever()
```

</td>
</tr>
</table>

### Running with CLI

<table>
<tr>
<th>Node.js</th>
<th>Python</th>
</tr>
<tr>
<td>

```bash
# Run with debugging
reflexive --debug app.js

# Run with eval mode
reflexive --eval app.js

# Full capabilities
reflexive --full app.js
```

</td>
<td>

```bash
# Run with debugging
reflexive --debug app.py

# Run with eval mode
reflexive --eval app.py

# Full capabilities
reflexive --full app.py
```

</td>
</tr>
</table>

## Feature Comparison Matrix

| Feature | Node.js | Python | Notes |
|---------|---------|--------|-------|
| **Core API** |
| `make_reflexive()` | ✅ | ✅ | Same concept, different naming |
| `.chat()` | ✅ | ✅ | Node: async, Python: sync |
| `.setState()` / `.set_state()` | ✅ | ✅ | Same functionality |
| `.getState()` / `.get_state()` | ✅ | ✅ | Same functionality |
| `.log()` | ✅ | ✅ | Same functionality |
| **Modes** |
| Standalone mode | ✅ | ✅ | Works without CLI |
| CLI child mode | ✅ | ✅ | Auto-detects parent CLI |
| Web dashboard | ✅ | ✅ | Same UI (Next.js) |
| **Interception** |
| Console/print capture | ✅ | ✅ | Auto-captures output |
| Logging capture | ✅ | ✅ | Standard logging libs |
| HTTP interception | ✅ | 🚧 | Node: via injection |
| **CLI Features** |
| Process management | ✅ | ✅ | Start/stop/restart |
| Debugger | ✅ | ✅ | V8 / DAP (debugpy) |
| Breakpoints | ✅ | ✅ | Set/remove/list |
| Eval mode | ✅ | ✅ | Runtime inspection |
| File operations | ✅ | ✅ | Read/write/edit |
| **Advanced** |
| Custom tools | ✅ | 🚧 | Coming to Python |
| Async chat | ✅ | 🚧 | Python: sync for now |
| Type safety | ✅ (TS) | ✅ | Type hints |
| **Deployment** |
| Package manager | npm | pip | Native ecosystems |
| Dependencies | Many | Minimal | Python: just psutil |
| Platform support | ✅ All | ✅ All | Cross-platform |

**Legend:**
- ✅ Fully supported
- 🚧 Planned/partial support
- ❌ Not supported

## Key Differences

### 1. Language Conventions

**Node.js (JavaScript/TypeScript):**
- camelCase: `makeReflexive`, `setState`
- Objects: `{ webUI: true }`
- Async/await: `await r.chat()`

**Python:**
- snake_case: `make_reflexive`, `set_state`
- Dicts: `{'web_ui': True}`
- Sync by default: `r.chat()`

### 2. Async Handling

**Node.js:**
```javascript
const answer = await r.chat('question');
// Uses async generators and promises
```

**Python (current):**
```python
answer = r.chat('question')
# Synchronous - blocks until complete
```

**Python (future):**
```python
answer = await r.chat_async('question')
# Async variant using aiohttp
```

### 3. Dependencies

**Node.js SDK:**
- `@anthropic-ai/claude-agent-sdk` (for chat)
- `ws` (websockets)
- Various Node.js built-ins

**Python SDK:**
- `psutil` (for memory stats)
- Standard library only (urllib, http.server, etc.)

### 4. Logging Interception

**Node.js:**
- Uses `--require` injection
- Intercepts at runtime before app starts
- Hooks into console methods

**Python:**
- Uses `logging.Handler`
- Monkey-patches `sys.stdout.write`
- More explicit, less "magical"

## Performance

### Memory Overhead

| Metric | Node.js | Python |
|--------|---------|--------|
| Base SDK | ~2 MB | ~1 MB |
| Log buffer | ~100 KB | ~100 KB |
| State storage | User-dependent | User-dependent |
| Total typical | ~5 MB | ~3 MB |

### Chat Latency

Both SDKs proxy to the same CLI/API, so latency is similar:
- Initial request: ~100-200ms
- Streaming: ~50-100ms per token
- Network overhead: Minimal (localhost)

### Logging Performance

| Operation | Node.js | Python |
|-----------|---------|--------|
| Add log | O(1) | O(1) |
| Get logs | O(n) | O(n) |
| Search logs | O(n) | O(n) |
| Memory | Bounded | Bounded |

Both use circular buffers with max size (default 500 entries).

## Use Cases

### Best for Node.js
- TypeScript projects with strict typing
- Async-heavy applications (many concurrent operations)
- Deep integration with Node.js ecosystem
- Complex custom tool definitions

### Best for Python
- Data science / ML workflows
- Django / Flask web apps
- Batch processing / ETL pipelines
- Scientific computing
- Simpler dependency management

### Works Great in Both
- Web servers with AI endpoints
- Background task monitoring
- Log analysis and debugging
- Real-time application introspection
- Hybrid AI-native applications

## Migration Tips

### Node.js → Python

1. **Rename function calls:**
   - `makeReflexive` → `make_reflexive`
   - `setState` → `set_state`
   - `getState` → `get_state`

2. **Update options:**
   - `{ webUI: true }` → `{'web_ui': True}`

3. **Remove await:**
   - `await r.chat()` → `r.chat()`

4. **Update imports:**
   - `import { makeReflexive } from 'reflexive'` → `import reflexive`

### Python → Node.js

1. **Rename function calls (reverse):**
   - `make_reflexive` → `makeReflexive`
   - `set_state` → `setState`

2. **Add async:**
   - `r.chat()` → `await r.chat()`

3. **Update options:**
   - `{'web_ui': True}` → `{ webUI: true }`

4. **Update imports:**
   - `import reflexive` → `import { makeReflexive } from 'reflexive'`

## Conclusion

Both SDKs provide the same core functionality with idioms native to their respective languages. Choose based on your application's primary language - both integrate seamlessly with the Reflexive CLI for full AI capabilities.

The key innovation - **inline AI chat with `.chat()`** - works identically in both, enabling truly AI-native applications regardless of language choice.
