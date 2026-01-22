# Make Reflexive

**Build applications by talking to them.**

Start with an empty file. Run it with Reflexive. Open the chat. Tell it what you want. Watch it build.

```bash
echo "console.log('hello')" > app.js
npx reflexive --write app.js
# Open http://localhost:3099
```

Now tell it: *"Turn this into an Express server with a /users endpoint"*

The agent can see your code, see it running, edit files, and restart the process. You iterate by chatting. The feedback loop is instant - you see stdout, errors, and behavior in real-time while the agent works.

**This is not just monitoring. This is collaborative development with an AI that lives inside your running application.**

---

Built on the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). Two modes:

1. **CLI Mode**: Run any Node.js app with an AI agent monitoring and modifying from outside
2. **Library Mode**: Embed the agent inside your app for deeper introspection

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

**Authentication** (choose one):

```bash
# Option 1: Use Claude Code CLI (recommended - no API key needed)
npm install -g @anthropic-ai/claude-code
claude  # Login with your Anthropic/Claude account

# Option 2: Use API key directly
export ANTHROPIC_API_KEY=your-api-key
```

Using Claude Code CLI means you authenticate once and Reflexive uses those credentials automatically - no API key management needed.

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
  -i, --interactive       Interactive mode for CLI chat apps
      --write             Enable file writing
      --shell             Enable shell access
      --node-args <args>  Arguments to pass to Node.js
      --help              Show help
```

### Interactive Mode

For **interactive CLI applications** (chat apps, REPLs, prompts), use the `-i` flag:

```bash
# Run an interactive chat CLI through Reflexive
reflexive -i ./my-chat-cli.js

# With write access so agent can modify code
reflexive -i --write ./my-cli.js chat
```

Interactive mode:
- **Proxies stdin/stdout** through the dashboard
- **Streams CLI output** into the chat panel with ANSI color support
- **Detects when CLI is waiting for input** (10 second settle time for streaming responses)
- **Two input modes**: "Ask Agent" (talk to Reflexive) vs "Direct to CLI" (type to the CLI)
- **Auto-handle checkbox**: Let the agent automatically respond to the CLI

When "Let agent handle CLI responses" is checked:
1. Agent watches the CLI output
2. Waits for output to stop (CLI waiting for input)
3. Automatically formulates and sends a response via `send_input`

This enables **AI-to-AI conversations** where Reflexive's agent talks to your interactive CLI.

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

### Production Safety (NODE_ENV Detection)

Prevent accidentally running Reflexive in production:

```javascript
// TODO: Not yet implemented
const r = makeReflexive({
  production: 'fail'  // 'fail' | 'warn' | 'disable' | 'allow'
});
```

| Mode | NODE_ENV=production behavior |
|------|------------------------------|
| `'fail'` | Throw error, refuse to start (default for `--write`, `--shell`) |
| `'warn'` | Log warning, continue with limited capabilities |
| `'disable'` | Silently no-op, app runs normally without Reflexive |
| `'allow'` | Run anyway (explicit opt-in for production debugging) |

```bash
# CLI flags
reflexive app.js --production=fail    # Error if NODE_ENV=production
reflexive app.js --production=warn    # Warn but continue
reflexive app.js --production=disable # No-op in production
reflexive app.js --production=allow   # Explicit production use

# Or via environment
REFLEXIVE_PRODUCTION=fail node app.js
```

**Capability restrictions by environment:**

```javascript
// TODO: Not yet implemented
const r = makeReflexive({
  capabilities: {
    development: { write: true, shell: true, inject: true, breakpoints: true },
    staging: { write: false, shell: false, inject: true, breakpoints: true },
    production: { write: false, shell: false, inject: false, breakpoints: false }
  }
});
```

**Warning banner in dashboard:**
```
⚠️  PRODUCTION MODE - Reflexive is running in production (NODE_ENV=production)
    Write and shell access disabled. Use --production=allow to override.
```

### Auto-Injection Mode (Hybrid CLI + Library)

The CLI currently monitors apps externally (stdout/stderr). With auto-injection, it injects deep instrumentation into the child process:

```bash
# TODO: Not yet implemented
reflexive app.js --inject  # Default in future versions

# Internally runs:
# node --require reflexive/inject app.js
```

This gives you **both** external control AND internal instrumentation:

```
┌─────────────────────────────────────────────────────────┐
│  reflexive CLI (parent)                                 │
│  - Process control (start/stop/restart)                 │
│  - Dashboard server                                     │
│  - Agent + MCP tools                                    │
│  - File read/write/shell (with flags)                   │
│                      ↕ IPC channel                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │  your-app.js (child) + reflexive/inject           │  │
│  │  - Console interception (log/warn/error)          │  │
│  │  - diagnostics_channel (http/net/fs)              │  │
│  │  - perf_hooks (GC, event loop)                    │  │
│  │  - Inspector integration (breakpoints)            │  │
│  │  - process.reflexive.setState() API               │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**What injection enables:**

| Feature | External Only | With Injection |
|---------|---------------|----------------|
| stdout/stderr | ✅ | ✅ |
| File operations | ✅ | ✅ |
| Process control | ✅ | ✅ |
| Console.log capture | ❌ (just stdout) | ✅ (structured) |
| HTTP request details | ❌ | ✅ (headers, body, timing) |
| Database queries | ❌ | ✅ (query, params, duration) |
| Custom app state | ❌ | ✅ (via process.reflexive) |
| Event loop metrics | ❌ | ✅ |
| Breakpoints | ❌ | ✅ |

**App can expose state without importing reflexive:**
```javascript
// In your app - no import needed, reflexive/inject provides this
process.reflexive?.setState('users.active', 42);
process.reflexive?.setState('cache.hitRate', 0.95);
```

### OpenTelemetry Integration

Full integration with OpenTelemetry for zero-code auto-instrumentation:

```bash
# TODO: Not yet implemented
# Auto-instrument with OpenTelemetry + Reflexive
node --require reflexive/otel ./app.js
```

```javascript
// Or programmatic setup
import { makeReflexive } from 'reflexive';
import { otel } from 'reflexive/otel';

const r = makeReflexive({
  otel: {
    enabled: true,
    serviceName: 'my-app',
    exporters: ['reflexive'],  // Send traces to Reflexive dashboard
    instrumentations: ['http', 'express', 'pg', 'redis']
  }
});

// Agent can now see:
// - Distributed traces across services
// - Database query performance
// - HTTP request/response details
// - Automatic span correlation
```

**Planned OTel MCP Tools:**

| Tool | Description |
|------|-------------|
| `get_traces` | Query distributed traces |
| `get_spans` | Get spans for a trace ID |
| `get_slow_operations` | Find performance bottlenecks |
| `get_service_map` | Visualize service dependencies |

### Node.js Native Hooks

Deep integration with Node.js built-in diagnostic APIs:

#### Inspector Protocol

```javascript
// TODO: Not yet implemented
const r = makeReflexive({
  inspector: {
    enabled: true,
    breakOnError: true,  // Pause on uncaught exceptions
    profiling: true      // CPU/memory profiling
  }
});

// Agent can:
// - Set breakpoints programmatically
// - Inspect variables at runtime
// - Take heap snapshots
// - CPU profile on demand
```

```bash
# Attach to already-running process (Linux/Mac)
kill -SIGUSR1 <pid>  # Enables inspector
reflexive --attach <pid>
```

#### AI-Powered Breakpoints

The agent can set breakpoints and receive full debugger state when hit:

```javascript
// TODO: Not yet implemented
const r = makeReflexive({
  inspector: {
    enabled: true,
    agentBreakpoints: true  // Allow agent to set/manage breakpoints
  }
});
```

**In chat:**
```
You: "Set a breakpoint on line 42 of server.js"
Agent: [set_breakpoint: file="server.js", line=42]
       Breakpoint set. I'll notify you when it's hit.

... later, request comes in ...

Agent: Breakpoint hit at server.js:42

       Call Stack:
       → handleRequest (server.js:42)
         processMiddleware (middleware.js:18)
         Server.emit (events.js:315)

       Local Variables:
       • req: IncomingMessage { method: "POST", url: "/api/users" }
       • res: ServerResponse { statusCode: 200 }
       • user: { id: 123, name: "Alice", email: "alice@..." }
       • db: PostgresClient { connected: true }

       Scopes:
       • Local: req, res, user, db, config
       • Closure: app, router, middleware
       • Global: process, console, Buffer

       What would you like me to inspect or do?

You: "What's in user.permissions?"
Agent: [evaluate: expression="user.permissions"]
       user.permissions = ["read", "write", "admin"]

You: "Step into the next function"
Agent: [debugger_step: action="stepInto"]
       Stepped to validateUser (auth.js:55)
       ...

You: "Continue execution"
Agent: [debugger_continue]
       Resumed. Breakpoint will trigger again on next hit.
```

**Planned Debugger MCP Tools:**

| Tool | Description |
|------|-------------|
| `set_breakpoint` | Set breakpoint at file:line or function name |
| `remove_breakpoint` | Remove a breakpoint |
| `list_breakpoints` | Show all active breakpoints |
| `get_call_stack` | Get current call stack when paused |
| `get_scope_variables` | Get variables in local/closure/global scope |
| `evaluate_expression` | Evaluate expression in current context |
| `debugger_step` | Step into/over/out |
| `debugger_continue` | Resume execution |
| `debugger_pause` | Pause execution immediately |

**Conditional Breakpoints:**
```
You: "Break on line 42 only when user.role === 'admin'"
Agent: [set_breakpoint: file="server.js", line=42, condition="user.role === 'admin'"]
```

**Logpoints (non-breaking):**
```
You: "Add a logpoint on line 42 that logs the user object"
Agent: [set_logpoint: file="server.js", line=42, expression="user"]
       Logpoint set. Will log without pausing.
```

#### diagnostics_channel

```javascript
// TODO: Not yet implemented
const r = makeReflexive({
  diagnostics: {
    channels: ['http', 'net', 'fs', 'worker_threads'],
    custom: ['my-app:requests', 'my-app:jobs']
  }
});

// Subscribes to Node.js diagnostic channels:
// - http.client.request / http.server.request
// - net.client.socket / net.server.socket
// - fs operations
// - Worker thread lifecycle
```

**Planned Diagnostics MCP Tools:**

| Tool | Description |
|------|-------------|
| `get_active_handles` | List open handles (sockets, files, timers) |
| `get_active_requests` | In-flight async operations |
| `subscribe_channel` | Live stream from diagnostic channel |
| `get_event_loop_stats` | Event loop lag, utilization |

#### perf_hooks

```javascript
// TODO: Not yet implemented
const r = makeReflexive({
  perf: {
    enabled: true,
    gcStats: true,        // Garbage collection metrics
    eventLoopStats: true, // Event loop delay histogram
    resourceTiming: true  // HTTP resource timing
  }
});

// Agent can query:
// - GC pause times and frequency
// - Event loop lag percentiles
// - DNS/TCP/TLS timing breakdown
```

#### Runtime Code Injection

```javascript
// TODO: Not yet implemented - DANGEROUS, requires explicit opt-in
const r = makeReflexive({
  inspector: {
    allowEval: true  // Let agent run code in your process
  }
});

// Agent can then use Runtime.evaluate to:
// - Inspect any variable
// - Call functions
// - Patch behavior at runtime
// - Hot-reload code
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

### 1Code Desktop Interface

Optional integration with [1Code](https://github.com/21st-dev/1code) for a richer desktop UI:

```bash
# TODO: Not yet implemented
reflexive app.js --ui=1code
```

**What 1Code provides:**
- **Cursor-like interface** with visual diff previews
- **Git worktree isolation** - each chat session in isolated branch
- **Plan mode** - see structured plans before execution
- **Integrated terminal** and project management
- **Local + remote** agent execution

```
┌─────────────────────────────────────────────────────────┐
│  1Code Desktop                                          │
│  ┌─────────────────┬───────────────────────────────┐   │
│  │ Project Files   │  Chat with Reflexive Agent    │   │
│  │ ├── src/        │  ┌─────────────────────────┐  │   │
│  │ │   └── app.js  │  │ You: Fix the memory leak│  │   │
│  │ ├── package.json│  │                         │  │   │
│  │ └── ...         │  │ Agent: I found the issue│  │   │
│  │                 │  │ [diff preview]          │  │   │
│  │ Process Logs    │  │ ┌─────────────────────┐ │  │   │
│  │ > Server started│  │ │- const data = []    │ │  │   │
│  │ > Request: GET /│  │ │+ const data = new   │ │  │   │
│  │ > 200 OK (45ms) │  │ │+   WeakMap()        │ │  │   │
│  │                 │  │ └─────────────────────┘ │  │   │
│  └─────────────────┴───────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Integration points:**
- Reflexive provides: process introspection, logs, state, MCP tools
- 1Code provides: desktop UI, diff viewer, git integration, plan mode

---

## License

MIT
