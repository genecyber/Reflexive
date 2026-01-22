# Reflexive

**Make your application self-aware.** A wrapper around the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) that adds deep process introspection, so the agent truly *lives inside* your running application.

```javascript
import { createReflexive } from 'reflexive';
import express from 'express';

const app = express();
const reflex = createReflexive();

// The agent now lives inside your app
app.use('/reflex', reflex.router());

// Use logging the agent can query
reflex.log('Server starting', { port: 3000 });

// Expose internal state
reflex.expose('users.active', () => userService.getActiveCount());

// Capture errors with rich context
app.use((err, req, res, next) => {
  reflex.catch(err, { route: req.path });
  res.status(500).json({ error: err.message });
});

app.listen(3000);
// Visit http://localhost:3000/reflex/dashboard
```

## Why?

The Claude Agent SDK gives you file operations, code execution, and the full agentic loop. **Reflexive** adds the missing piece: **live process introspection**.

When the agent can see:
- Process state (memory, CPU, handles)
- HTTP request/response flow
- Your application's internal state
- Logs and errors with full context
- Event channels between services

...it becomes dramatically more capable at debugging, explaining, and extending your application.

## What's Different from Raw Claude Agent SDK?

| Feature | Raw Agent SDK | Reflexive |
|---------|--------------|-----------|
| File operations | ✅ Built-in | ✅ Inherited |
| Shell commands | ✅ Built-in | ✅ Inherited |
| Process introspection | ❌ | ✅ Memory, CPU, handles |
| Request tracing | ❌ | ✅ Middleware auto-tracks |
| Error capture | ❌ | ✅ Stack + context + state |
| Exposed state | ❌ | ✅ `reflex.expose()` |
| Event channels | ❌ | ✅ Pub/sub for agent |
| Dashboard UI | ❌ | ✅ Out of the box |
| Framework adapters | ❌ | ✅ Express, Next.js |

## Installation

**Prerequisites:** The Claude Agent SDK requires [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) to be installed:

```bash
# macOS/Linux
npm install -g @anthropic-ai/claude-code

# Then authenticate
claude
```

**Install Reflexive:**

```bash
npm install reflexive
```

**Or use the CLI directly:**

```bash
npx reflexive ./your-app.js
```

**Set your API key:**

```bash
export ANTHROPIC_API_KEY=your-api-key
```

## CLI Usage (Zero Code Changes)

The CLI lets you run **any** Node.js app with reflexive injected from the outside:

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
npx reflexive ./server.js -- --port 8080 --env production
```

### CLI Capabilities

The agent running via CLI can:
- **See stdout/stderr** from your process in real-time
- **Read your source files** to understand the code
- **Restart your process** after making changes
- **Modify files** (with `--write` flag)
- **Run shell commands** (with `--shell` flag)
- **Search through logs** to find errors

### CLI Options

```
OPTIONS:
  -p, --port <port>       Dashboard port (default: 3099)
  -h, --host <host>       Dashboard host (default: localhost)
  -o, --open              Open dashboard in browser
  -w, --watch             Restart on file changes
  -c, --capabilities      Enable capabilities (comma-separated)
      --write             Enable file writing
      --shell             Enable shell access
      --node-args <args>  Arguments to pass to Node.js
      --help              Show help
```

### Add to package.json

```json
{
  "scripts": {
    "dev": "reflexive --watch --open ./src/index.js",
    "dev:full": "reflexive --watch --write --shell ./src/index.js"
  }
}
```

## Quick Start

### Zero Config (Scripts, CLI tools, anything)

```javascript
import { createReflexive } from 'reflexive';

const reflex = createReflexive();
// Done. Dashboard running at http://localhost:3099

reflex.log('Hello from my script');
reflex.expose('myState', () => getMyState());
```

That's it. Open http://localhost:3099 and chat with your app.

### With Express (Mount to your server)

```javascript
import express from 'express';
import { createReflexive } from 'reflexive';

const app = express();

// Disable auto-server, mount to Express instead
const reflex = createReflexive({
  server: { enabled: false }
});

app.use(reflex.middleware());      // Track requests
app.use('/reflex', reflex.router()); // Mount dashboard

app.listen(3000);
// Dashboard at http://localhost:3000/reflex/dashboard
```

### With Next.js (App Router)

```typescript
// app/reflex/[[...path]]/route.ts
import { createReflexive } from 'reflexive/next';

export const { GET, POST } = createReflexive({
  server: { enabled: false }
});
```

## Core Concepts

### Capabilities

Control what the agent can do. Safe by default:

```javascript
const reflex = createReflexive({
  capabilities: {
    readFiles: true,      // Can read source files (default: true)
    writeFiles: false,    // Can modify files (default: false)
    executeCode: false,   // Can run arbitrary code (default: false)
    modifySelf: false,    // Can modify its own code (default: false)
    networkAccess: false, // Can make HTTP requests (default: false)
    shellAccess: false    // Can run shell commands (default: false)
  }
});
```

### Custom Introspection Tools (via MCP)

In addition to the standard Agent SDK tools (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch), Reflexive provides custom tools via an in-process MCP server:

| Tool | Description |
|------|-------------|
| `get_process_state` | Live process metrics: memory, CPU, uptime, handles |
| `get_exposed_state` | All state exposed via `reflex.expose()` |
| `query_logs` | Search/filter application logs |
| `get_recent_errors` | Errors with stack traces and context |
| `get_error_details` | Deep dive into a specific error by ID |
| `get_recent_requests` | HTTP request history |
| `get_current_request` | Current request context (if in a request) |
| `emit_event` | Publish to an event channel |
| `get_channel_history` | Get events from a channel |
| `list_channels` | List all active channels |
| `get_full_snapshot` | Complete application state dump |

The agent automatically has access to these when you chat with it.

### Exposing State

Make internal state visible to the agent:

```javascript
// Static values
reflex.expose('config', { version: '1.0.0', env: 'production' });

// Dynamic getters (called when the agent asks)
reflex.expose('db.connections', () => pool.totalCount);
reflex.expose('cache.hitRate', () => cache.hits / cache.total);

// With metadata
reflex.expose('queue.depth', () => queue.length, {
  description: 'Number of jobs waiting',
  category: 'metrics',
  sensitive: false
});
```

### Logging

Structured logging the agent can query:

```javascript
reflex.log('User signed up', { userId: '123', plan: 'pro' });
reflex.debug('Cache miss', { key: 'user:123' });
reflex.warn('Rate limit approaching', { current: 95, limit: 100 });
reflex.error('Payment failed', { error: err.message });

// Logs are queryable
reflex._options.logger.query({
  level: 'error',
  since: '2024-01-01',
  search: 'payment',
  limit: 10
});
```

### Error Capture

Intelligent error handling with context:

```javascript
// Wrap functions for automatic capture
const riskyFn = reflex.wrap(async (data) => {
  // if this throws, it's captured with full context
  return await dangerousOperation(data);
}, { operation: 'payment-processing' });

// Manual capture
try {
  await something();
} catch (error) {
  reflex.catch(error, { 
    userId: user.id,
    action: 'checkout'
  });
}
```

Captured errors include:
- Stack traces with source code snippets
- Request context (if in a request)
- Exposed state at time of error
- Recent logs leading up to the error

### Channels (Event Pub/Sub)

Inter-process communication:

```javascript
// Get or create a channel
const deployments = reflex.channel('deployments');

// Subscribe to events
deployments.on((event) => {
  console.log('Deployment:', event);
});

// Emit events
deployments.emit({ 
  version: '1.2.0', 
  status: 'success' 
});

// The agent can also emit/subscribe to channels
```

### Request Tracing

Track HTTP requests through your app:

```javascript
// Add middleware
app.use(reflex.middleware());

// Now the agent can see recent requests
// Including: method, path, duration, status code, headers
```

## API Reference

### `createReflexive(options)`

Creates a new reflexive instance.

```javascript
const reflex = createReflexive({
  // Project root (default: process.cwd())
  root: '/path/to/project',
  
  // Instance name
  name: 'my-app',
  
  // Model to use (default: 'sonnet')
  model: 'sonnet', // or 'opus', 'haiku'
  
  // AUTO-SERVER CONFIG (new!)
  server: {
    enabled: true,    // Auto-start dashboard server (default: true)
    port: 3099,       // Port to listen on (default: 3099)
    host: 'localhost',// Host to bind (default: 'localhost')
    open: false,      // Open browser automatically (default: false)
    silent: false     // Suppress console output (default: false)
  },
  
  // Capabilities (see above)
  capabilities: { ... },
  
  // File access boundaries
  boundaries: {
    canRead: ['src/**', 'package.json'],
    canWrite: ['src/**'],
    ignore: ['node_modules/**', '.env']
  },
  
  // Transport for cross-process communication
  transport: 'memory', // or 'websocket'
  
  // Auto-attach global error handlers
  autoAttachErrors: true,
  
  // Logging options
  logToConsole: true,
  logFormat: 'pretty', // or 'json'
  minLogLevel: 'debug'
});
```

### Instance Methods

| Method | Description |
|--------|-------------|
| `reflex.log(message, data?, meta?)` | Log at info level |
| `reflex.debug(message, data?, meta?)` | Log at debug level |
| `reflex.warn(message, data?, meta?)` | Log at warn level |
| `reflex.error(message, data?, meta?)` | Log at error level |
| `reflex.expose(name, value, meta?)` | Expose state to agent |
| `reflex.unexpose(name)` | Remove exposed state |
| `reflex.channel(name)` | Get/create event channel |
| `reflex.flag(type, message, location?)` | Add code annotation |
| `reflex.mark(name, data?)` | Performance mark |
| `reflex.wrap(fn, context?)` | Wrap function with error capture |
| `reflex.catch(error, context?)` | Manually capture error |
| `reflex.middleware()` | Get request tracking middleware |
| `reflex.router(framework?)` | Get framework router (disables auto-server) |
| `reflex.chat(message, options?)` | Chat with the agent |
| `reflex.inspect()` | Get full process snapshot |
| `reflex.start()` | Start agent and server |
| `reflex.stop()` | Stop agent and server |
| `reflex.serverUrl` | Get dashboard URL (e.g., `http://localhost:3099`) |
| `reflex.server` | Get server instance (for advanced use) |

### Endpoints (when using router)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/reflex/dashboard` | GET | Web UI |
| `/reflex/chat` | POST | Chat with agent |
| `/reflex/health` | GET | Health check |
| `/reflex/inspect` | GET | Full snapshot |
| `/reflex/logs` | GET | Query logs |
| `/reflex/errors` | GET | Recent errors |
| `/reflex/state` | GET | Exposed state |
| `/reflex/channels` | GET | List channels |
| `/reflex/files` | GET | File structure |
| `/reflex/files/*` | GET | Read file content |

## Transports

### Memory (default)

In-process EventEmitter. Zero config, works immediately.

### WebSocket

Cross-process communication:

```javascript
// Server process
const reflex = createReflexive({
  transport: 'websocket',
  // First instance becomes server, others connect as clients
});

// Worker process (auto-connects)
const reflex2 = createReflexive({
  transport: 'websocket'
});

// Events propagate across processes
reflex.channel('jobs').emit({ id: 1 }); // Worker receives this
```

### Custom

Implement your own:

```javascript
const customTransport = {
  broadcast(event, data) { /* ... */ },
  subscribe(event, callback) { /* return unsubscribe fn */ },
  connect() { /* async */ },
  disconnect() { /* async */ }
};

const reflex = createReflexive({ transport: customTransport });
```

## Security

Reflexive is designed with security in mind:

1. **Explicit capabilities** - Nothing dangerous is enabled by default
2. **File boundaries** - Control what the agent can read/write
3. **Redaction** - Sensitive env vars and headers are automatically redacted
4. **No auto-execution** - Even with `executeCode: true`, code runs in a sandbox (TODO)

For production, consider:
- Authentication on the `/reflex` routes
- Network isolation for the dashboard
- Audit logging for agent actions (via channels)

## Examples

See the `/examples` directory:
- `express-basic.js` - Full Express example
- `nextjs-route.js` - Next.js App Router
- `standalone.js` - CLI/script usage

## License

MIT
