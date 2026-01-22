# Reflexive

**AI-powered introspection for Node.js applications.** Built on the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

Two ways to use it:

1. **CLI Mode**: Run any Node.js app with an AI agent monitoring from outside
2. **Library Mode**: Embed the agent inside your own app

```javascript
import { makeReflexive } from 'reflexive';

const r = makeReflexive({ title: 'My App' });

// Console output is automatically captured
console.log('Server started on port 3000');

// Track custom state the agent can query
r.setState('activeUsers', 42);

// Open http://localhost:3099/reflexive and chat with your app
```

## Installation

```bash
npm install reflexive
```

Set your API key:

```bash
export ANTHROPIC_API_KEY=your-api-key
```

## CLI Mode

Run **any** Node.js app with an AI agent that can see stdout/stderr, read source files, and control the process:

```bash
# Basic usage - dashboard at http://localhost:3099
npx reflexive ./index.js

# Custom port
npx reflexive --port 4000 ./server.js

# Auto-open browser
npx reflexive --open ./app.js

# Watch mode - restart on file changes
npx reflexive --watch ./server.js

# Enable file writing and shell access
npx reflexive --write --shell ./script.js

# Pass arguments to your app
npx reflexive ./server.js -- --port 8080
```

### CLI Options

```
OPTIONS:
  -p, --port <port>       Dashboard port (default: 3099)
  -h, --host <host>       Dashboard host (default: localhost)
  -o, --open              Open dashboard in browser
  -w, --watch             Restart on file changes
      --write             Enable file writing
      --shell             Enable shell access
      --node-args <args>  Arguments to pass to Node.js
      --help              Show help
```

### CLI Agent Capabilities

The agent running via CLI can:
- See **stdout/stderr** from your process in real-time
- **Read source files** to understand the code
- **Restart** your process after making changes
- **Modify files** (with `--write` flag)
- **Run shell commands** (with `--shell` flag)
- **Search through logs** to find errors

### CLI MCP Tools

| Tool | Description |
|------|-------------|
| `get_process_state` | PID, uptime, restart count, exit code |
| `get_output_logs` | stdout/stderr with count and type filter |
| `search_logs` | Search through process output |
| `restart_process` | Restart the monitored process |
| `stop_process` | Stop the process |
| `start_process` | Start the process if stopped |
| `send_input` | Send text to process stdin |

## Library Mode

Embed the agent inside your own application:

```javascript
import { makeReflexive } from 'reflexive';

const r = makeReflexive({
  port: 3099,              // Dashboard port (default: 3099)
  title: 'My App',         // Dashboard title
  systemPrompt: '',        // Additional context for the agent
  tools: [],               // Custom MCP tools (see below)
  onReady: ({ port }) => { // Called when server starts
    console.log(`Dashboard: http://localhost:${port}/reflexive`);
  }
});

// Returned object
r.appState              // AppState instance
r.server                // HTTP server instance
r.log(type, message)    // Manual log entry ('info', 'warn', 'error', 'debug')
r.setState(key, value)  // Set custom state
r.getState(key)         // Get custom state (or all if no key)
```

### Automatic Console Capture

All console methods are automatically intercepted and logged:

```javascript
console.log('User signed up');      // Captured as 'info'
console.info('Cache hit');          // Captured as 'info'
console.warn('Rate limit close');   // Captured as 'warn'
console.error('Payment failed');    // Captured as 'error'
console.debug('Query took 45ms');   // Captured as 'debug'
```

### Custom State

Track application-specific state the agent can query:

```javascript
r.setState('queue.length', jobs.length);
r.setState('cache.hitRate', hits / total);
r.setState('db.connections', pool.activeCount);

// Agent can then ask: "What's the current queue length?"
```

### Library MCP Tools

| Tool | Description |
|------|-------------|
| `get_app_status` | PID, uptime, memory usage, custom state |
| `get_logs` | Recent logs with count and type filter |
| `search_logs` | Search through application logs |
| `get_custom_state` | Get custom state by key |

### Custom Tools

Add your own MCP tools for domain-specific introspection:

```javascript
import { makeReflexive } from 'reflexive';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const r = makeReflexive({
  tools: [
    tool(
      'get_user_count',
      'Get the number of active users',
      {},
      async () => ({
        content: [{ type: 'text', text: String(activeUsers.size) }]
      })
    ),
    tool(
      'get_order',
      'Look up an order by ID',
      { orderId: z.string().describe('The order ID') },
      async ({ orderId }) => ({
        content: [{ type: 'text', text: JSON.stringify(orders.get(orderId)) }]
      })
    )
  ]
});
```

### Dashboard Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/reflexive` | GET | Web dashboard UI |
| `/reflexive/chat` | POST | Chat with agent (SSE stream) |
| `/reflexive/status` | GET | App status JSON |
| `/reflexive/logs` | GET | Logs JSON (?count=N&type=T) |

## Exports

```javascript
import {
  makeReflexive,              // Main function
  AppState,                   // State tracking class
  createIntrospectionServer   // Create MCP server manually
} from 'reflexive';
```

---

## TODO: Planned Features

The following features are planned but not yet implemented:

### Programmatic Chat API

Chat with the agent directly from code (no HTTP):

```javascript
// TODO: Not yet implemented
const response = await r.chat("What's causing the memory leak?");
console.log(response);

// Streaming
for await (const chunk of r.chat("Analyze errors", { stream: true })) {
  process.stdout.write(chunk);
}
```

Use cases: automated monitoring, Slack integration, scripted queries, testing.

### State Exposure API

```javascript
// TODO: Not yet implemented
r.expose('db.connections', () => pool.totalCount);
r.expose('cache.hitRate', () => cache.hits / cache.total);
r.unexpose('db.connections');
```

### Error Capture

```javascript
// TODO: Not yet implemented
r.catch(error, { userId: user.id, action: 'checkout' });

const riskyFn = r.wrap(async (data) => {
  return await dangerousOperation(data);
}, { operation: 'payment' });
```

### Event Channels

```javascript
// TODO: Not yet implemented
const deployments = r.channel('deployments');
deployments.on((event) => console.log(event));
deployments.emit({ version: '1.2.0', status: 'success' });
```

### Express/Next.js Integration

```javascript
// TODO: Not yet implemented
app.use(r.middleware());        // Request tracing
app.use('/reflex', r.router()); // Mount dashboard
```

### Additional MCP Tools (Planned)

| Tool | Description |
|------|-------------|
| `get_recent_errors` | Errors with stack traces and context |
| `get_recent_requests` | HTTP request history |
| `emit_event` | Publish to event channel |
| `get_channel_history` | Get events from a channel |

### Cross-Process Communication

```javascript
// TODO: Not yet implemented
const r = makeReflexive({ transport: 'websocket' });
// Events propagate across processes
```

### Python Support

Native Python implementation using the Python Claude Agent SDK:

```python
# TODO: Not yet implemented
from reflexive import make_reflexive

r = make_reflexive(port=3099, title="My Python App")

# Console capture
print("Server started")  # Captured automatically

# Custom state
r.set_state("active_users", 42)

# CLI mode
# $ reflexive ./app.py
```

### Other Language Support (Shims)

Since the Claude Agent SDK only has native implementations for **Node.js** and **Python**, other languages need a shim/bridge approach:

```
┌─────────────┐     HTTP/IPC      ┌──────────────────┐
│  Your App   │ ←───────────────→ │  Reflexive Node  │
│  (Go/Rust/  │   logs, state,    │  or Python host  │
│   Ruby/etc) │   commands        │                  │
└─────────────┘                   └──────────────────┘
```

**Planned shim approaches:**

1. **HTTP Shim**: Your app POSTs logs/state to a Reflexive sidecar
   ```bash
   # Start reflexive as sidecar
   reflexive --shim-mode --port 3099

   # Your Go app sends logs via HTTP
   curl -X POST localhost:3099/ingest -d '{"type":"log","message":"started"}'
   ```

2. **Stdout Protocol**: Reflexive parses structured stdout from any process
   ```bash
   # Your app prints JSON to stdout
   echo '{"reflexive":"log","level":"info","msg":"User signed up"}'

   # Reflexive CLI captures and parses it
   reflexive --protocol=json ./my-rust-app
   ```

3. **Language-specific client libraries**: Lightweight clients that talk to Reflexive host
   ```go
   // TODO: Not yet implemented
   import "github.com/anthropics/reflexive-go"

   r := reflexive.Connect("localhost:3099")
   r.Log("info", "Server started")
   r.SetState("connections", 42)
   ```

---

## License

MIT
