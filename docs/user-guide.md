# User Guide

Comprehensive guide to using Reflexive for Node.js application introspection and development.

## Table of Contents

- [Operating Modes](#operating-modes)
  - [Local Mode](#local-mode)
  - [Sandbox Mode](#sandbox-mode)
  - [Hosted Mode](#hosted-mode)
- [CLI Reference](#cli-reference)
  - [Basic Usage](#basic-usage)
  - [Capability Flags](#capability-flags)
  - [Configuration Options](#configuration-options)
  - [Process Arguments](#process-arguments)
- [Dashboard](#dashboard)
  - [Chat Interface](#chat-interface)
  - [Log Viewer](#log-viewer)
  - [Process Controls](#process-controls)
  - [Debugger Panel](#debugger-panel)
- [AI Capabilities](#ai-capabilities)
  - [Available Tools](#available-tools)
  - [Tool Permissions](#tool-permissions)
- [Configuration File](#configuration-file)
  - [File Locations](#file-locations)
  - [Configuration Options](#configuration-options-1)
  - [Example Configurations](#example-configurations)
- [Advanced Features](#advanced-features)
  - [V8 Debugger](#v8-debugger)
  - [Watch Triggers](#watch-triggers)
  - [Injection Mode](#injection-mode)
  - [Runtime Eval](#runtime-eval)
  - [Hybrid AI-Native Patterns](#hybrid-ai-native-patterns)
- [Troubleshooting](#troubleshooting)

## Operating Modes

Reflexive supports three operating modes, each suited to different use cases.

### Local Mode

The default mode where Reflexive spawns and monitors your application as a child process.

#### When to Use
- Local development and debugging
- Full control over the process
- Need for V8 debugging, file watching, or injection
- Running CLI applications interactively

#### Features
- Process lifecycle management (start, stop, restart)
- File watching with auto-restart (`--watch`)
- V8 Inspector debugging (`--debug`)
- Deep instrumentation (`--inject`)
- Interactive stdin/stdout (`--interactive`)
- Custom Node.js arguments

#### Example
```bash
# Basic monitoring
reflexive server.js

# Development with hot reload
reflexive --write --watch server.js

# Debugging session
reflexive --debug server.js

# Interactive CLI app
reflexive --interactive cli-tool.js

# Pass arguments to Node.js
reflexive --node-args="--max-old-space-size=4096" server.js
```

#### Limitations
- Requires Node.js installed locally
- Process runs on host machine (not isolated)
- Cannot snapshot/restore state

### Sandbox Mode

Runs your application in an isolated Vercel Sandbox while Reflexive controls it locally.

#### When to Use
- Need filesystem isolation
- Testing destructive operations safely
- Snapshot and restore application state
- Clean environment for each run
- Multi-environment testing

#### Features
- Complete filesystem isolation
- Network isolation
- Snapshot and restore capabilities
- Clean state for each execution
- File upload and download
- Remote command execution

#### Example
```bash
# Basic sandbox mode
reflexive --sandbox app.js

# With write permissions
reflexive --sandbox --write app.js

# With configuration
reflexive --sandbox --config sandbox.config.js app.js
```

#### Configuration
```javascript
// reflexive.config.js
export default {
  mode: 'sandbox',
  sandbox: {
    provider: 'vercel',
    vcpus: 2,
    memory: 2048,
    timeout: '30m',
    runtime: 'node22'
  }
};
```

#### Limitations
- Requires Vercel account and `VERCEL_TOKEN`
- Additional latency for remote operations
- Costs associated with sandbox usage
- No V8 debugging support (yet)

### Hosted Mode

Multi-tenant deployment where Reflexive runs as a service managing multiple sandboxes.

#### When to Use
- Production monitoring infrastructure
- Multi-user environments
- Team collaboration
- CI/CD integration via REST API
- Persistent sandbox management

#### Features
- REST API for programmatic control
- Multi-sandbox management
- Persistent snapshots (S3/R2)
- API authentication and rate limiting
- Per-sandbox isolation
- Web dashboard for all sandboxes

#### Deployment
```bash
# Deploy to Railway
railway up

# Or Docker
docker build -t reflexive .
docker run -p 3099:3099 \
  -e ANTHROPIC_API_KEY=sk-xxx \
  -e REFLEXIVE_API_KEY=your-api-key \
  reflexive
```

#### API Usage
```bash
# Create sandbox
curl -X POST https://your-reflexive.app/api/sandboxes \
  -H "Authorization: Bearer your-api-key" \
  -d '{"id":"my-app"}'

# Start sandbox
curl -X POST https://your-reflexive.app/api/sandboxes/my-app/start \
  -H "Authorization: Bearer your-api-key" \
  -d '{"entryFile":"/app/server.js"}'

# Create snapshot
curl -X POST https://your-reflexive.app/api/sandboxes/my-app/snapshot \
  -H "Authorization: Bearer your-api-key"
```

See [Deployment Guide](./deployment.md) for complete instructions.

## CLI Reference

### Basic Usage

```bash
reflexive [options] [entry-file] [-- app-args...]
```

### Capability Flags

Control what the AI agent can do:

| Flag | Default | Description |
|------|---------|-------------|
| `--write` | OFF | Enable file modification via `edit_file`, `create_file` |
| `--shell` | OFF | Enable shell command execution via `exec_shell` |
| `--inject` | OFF | Deep instrumentation: console, HTTP, GC, event loop |
| `--eval` | OFF | Runtime code evaluation (DANGEROUS, implies `--inject`) |
| `--debug` | OFF | V8 Inspector debugging: breakpoints, stepping, scope |
| `--dangerously-skip-permissions` | OFF | Enable ALL capabilities |

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `-p, --port <port>` | number | 3099 | Dashboard server port |
| `-h, --host <host>` | string | localhost | Dashboard server host |
| `-o, --open` | boolean | false | Open dashboard in browser |
| `-w, --watch` | boolean | false | Auto-restart on file changes |
| `-i, --interactive` | boolean | false | Proxy stdin/stdout for CLI apps |
| `--sandbox` | boolean | false | Run in Vercel Sandbox |
| `--config <file>` | string | | Load configuration file |
| `--node-args <args>` | string | | Arguments to pass to Node.js |
| `--no-restart` | boolean | | Disable process restart capability |

### Process Arguments

Pass arguments to your application using `--`:

```bash
# App receives --port 8080 --verbose
reflexive server.js -- --port 8080 --verbose

# App receives -u admin
reflexive cli-tool.js -- -u admin
```

### Examples

```bash
# Read-only monitoring
reflexive app.js

# Development mode
reflexive --write --watch app.js

# Full permissions (development only)
reflexive --write --shell --inject app.js

# Debugging
reflexive --debug app.js

# Sandbox with auto-browser
reflexive --sandbox --write --open app.js

# Custom port
reflexive --port 3100 app.js

# Node.js options
reflexive --node-args="--max-old-space-size=8192 --trace-gc" app.js
```

## Dashboard

The web dashboard provides a complete interface for interacting with your application.

### Chat Interface

Located on the left side of the dashboard.

#### Features
- **Multi-turn conversations**: Agent maintains context
- **Syntax highlighting**: Code blocks with language detection
- **Tool visualization**: See what tools the agent uses
- **Streaming responses**: Real-time text generation
- **Session persistence**: Conversations survive page refresh

#### Example Conversation
```
You: What is this app doing?

Agent: This is an Express server running on port 3000 with 3 routes:
- GET /health - Returns health status
- GET /users - Returns mock user list
- POST /users - Creates a new user

The server has been running for 2 minutes and has handled 15 requests.

You: Show me the /users endpoint code

Agent: [read_file: server.js]

Here's the /users endpoint:

```javascript
app.get('/users', (req, res) => {
  res.json([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' }
  ]);
});
```

You: Add pagination to this endpoint

Agent: [edit_file: server.js]
I've added pagination with query parameters:
- ?page=1 (default)
- ?limit=10 (default)
```

### Log Viewer

Real-time log streaming and analysis.

#### Features
- **Live streaming**: Logs appear instantly
- **Type filtering**: Filter by stdout, stderr, info, warn, error
- **Search**: Full-text search across all logs
- **ANSI colors**: Preserves terminal color codes
- **Timestamps**: ISO format with milliseconds
- **Watch patterns**: Click eye icon to create triggers

#### Log Types
- `stdout` - Process standard output
- `stderr` - Process standard error
- `info` - Console.log, console.info
- `warn` - Console.warn
- `error` - Console.error, uncaught exceptions
- `debug` - Console.debug
- `system` - Reflexive system messages
- `stdin` - Interactive input (with `--interactive`)
- `inject:*` - Injection mode events (GC, HTTP, etc.)

#### Searching Logs
Use the search box to filter logs in real-time:
```
memory         # Show all logs containing "memory"
error:.*user   # Regex: errors mentioning "user"
```

### Process Controls

Manage the monitored process lifecycle.

#### Controls Available
- **Start**: Start a stopped process
- **Stop**: Stop the running process
- **Restart**: Stop and start (useful for applying code changes)
- **Process Info**: View PID, uptime, memory usage

#### Process Information Display
```
Process: server.js
PID: 12345
Status: Running
Uptime: 5m 23s
Memory: 45.2 MB
Restarts: 2
Exit Code: null
```

### Debugger Panel

Available when running with `--debug` flag.

#### Features
- **Breakpoint list**: All active breakpoints
- **Call stack**: Current execution stack when paused
- **Scope variables**: Local, closure, and global variables
- **Evaluation**: Evaluate expressions at breakpoint
- **Step controls**: Step over, into, out, resume

#### Breakpoint Display
```
Breakpoints:
✓ server.js:42 (active)
✓ middleware.js:18 (active)
○ utils.js:100 (unbound)

Call Stack:
- handleRequest (server.js:42)
- processMiddleware (middleware.js:18)
- app.use (node:internal/...)

Variables:
req = { method: "POST", url: "/api/users" }
user = { id: 123, name: "Alice" }
```

## AI Capabilities

### Available Tools

The AI agent has access to different tools based on the operating mode:

#### Local Mode Tools

**File Operations** (always enabled):
- `read_file` - Read file contents
- `list_directory` - List directory contents
- `search_files` - Search for files by pattern

**File Modification** (requires `--write`):
- `edit_file` - Modify existing files
- `create_file` - Create new files
- `delete_file` - Delete files

**Shell Access** (requires `--shell`):
- `exec_shell` - Execute shell commands

**Process Control**:
- `get_process_state` - View process status
- `get_output_logs` - Retrieve logs
- `search_logs` - Search log entries
- `restart_process` - Restart the process
- `stop_process` - Stop the process
- `start_process` - Start a stopped process
- `send_input` - Send stdin (with `--interactive`)

**Debugging Tools** (requires `--debug`):
- `debug_set_breakpoint` - Set breakpoint at file:line
- `debug_remove_breakpoint` - Remove breakpoint
- `debug_resume` - Resume execution
- `debug_pause` - Pause execution
- `debug_step_over` - Step over function call
- `debug_step_into` - Step into function
- `debug_step_out` - Step out of function
- `debug_get_call_stack` - View call stack
- `debug_evaluate` - Evaluate expression at breakpoint
- `debug_get_scope_variables` - View scope variables

**Injection Tools** (requires `--inject`):
- `evaluate_in_app` - Execute code in running app (requires `--eval`)
- `get_custom_state` - Read app-set state

#### Sandbox Mode Tools

- `get_sandbox_state` - View sandbox status
- `get_output_logs` - Retrieve logs
- `restart_sandbox` - Restart sandbox
- `get_custom_state` - Read injected state
- `search_logs` - Search log entries

Plus all file operation tools.

#### Hosted Mode Tools

All sandbox mode tools plus:
- `create_snapshot` - Snapshot sandbox state
- `restore_from_snapshot` - Restore from snapshot
- `list_snapshots` - List available snapshots
- `delete_snapshot` - Delete snapshot

### Tool Permissions

Tools are gated by capability flags for safety:

```bash
# Read-only (default)
reflexive app.js
# Tools: read_file, list_directory, get_logs

# Add file writing
reflexive --write app.js
# Tools: + edit_file, create_file, delete_file

# Add shell access
reflexive --write --shell app.js
# Tools: + exec_shell

# Add debugging
reflexive --debug app.js
# Tools: + debug_* tools

# Add injection
reflexive --inject app.js
# Tools: + get_custom_state

# Add eval (DANGEROUS)
reflexive --eval app.js
# Tools: + evaluate_in_app
```

## Configuration File

### File Locations

Reflexive searches for configuration in this order:
1. `--config` flag value
2. `reflexive.config.js`
3. `reflexive.config.mjs`
4. `reflexive.config.json`
5. `.reflexiverc`
6. `.reflexiverc.json`

### Configuration Options

```typescript
interface ReflexiveConfig {
  mode: 'local' | 'sandbox' | 'hosted';
  port: number;
  capabilities: {
    readFiles: boolean;
    writeFiles: boolean;
    shellAccess: boolean;
    restart: boolean;
    inject: boolean;
    eval: boolean;
    debug: boolean;
  };
  sandbox?: {
    provider: 'vercel';
    vcpus: number;      // 1-4
    memory: number;     // MB, 128-8192
    timeout: string;    // e.g., '30m', '1h'
    runtime: 'node22' | 'node20';
  };
  hosted?: {
    maxSandboxes: number;
    defaultTimeout: string;
    snapshotStorage: {
      provider: 's3' | 'r2' | 'memory';
      bucket?: string;
      endpoint?: string;
    };
  };
  tools?: CustomTool[];
}
```

### Example Configurations

#### Development Configuration
```javascript
// reflexive.config.js
export default {
  mode: 'local',
  port: 3099,
  capabilities: {
    readFiles: true,
    writeFiles: true,
    shellAccess: false,
    restart: true,
    inject: false,
    eval: false,
    debug: false
  }
};
```

#### Sandbox Configuration
```javascript
// reflexive.config.js
export default {
  mode: 'sandbox',
  port: 3099,
  sandbox: {
    provider: 'vercel',
    vcpus: 2,
    memory: 2048,
    timeout: '30m',
    runtime: 'node22'
  },
  capabilities: {
    readFiles: true,
    writeFiles: true,
    shellAccess: true,
    restart: true,
    inject: true,
    eval: false,
    debug: false
  }
};
```

#### Hosted Configuration
```javascript
// reflexive.config.js
export default {
  mode: 'hosted',
  port: 3099,
  hosted: {
    maxSandboxes: 10,
    defaultTimeout: '30m',
    snapshotStorage: {
      provider: 's3',
      bucket: process.env.REFLEXIVE_SNAPSHOT_BUCKET,
      endpoint: process.env.REFLEXIVE_S3_ENDPOINT
    }
  },
  capabilities: {
    readFiles: true,
    writeFiles: true,
    shellAccess: true,
    restart: true,
    inject: false,
    eval: false,
    debug: false
  }
};
```

## Advanced Features

### V8 Debugger

Real breakpoint debugging with the V8 Inspector protocol.

#### Enabling
```bash
reflexive --debug app.js
```

#### Setting Breakpoints
```
You: "Set a breakpoint on line 42 of server.js"

Agent: [debug_set_breakpoint: file="server.js", line=42]
Breakpoint set at server.js:42
```

#### When Breakpoint Hits
```
Agent: Breakpoint hit at server.js:42 in handleRequest

Call Stack:
1. handleRequest (server.js:42)
2. processRequest (middleware.js:18)
3. anonymous (server.js:10)

Local Variables:
- req: Object { method: "POST", url: "/api/users", ... }
- res: Object { statusCode: 200, ... }
- user: Object { id: 123, name: "Alice" }
```

#### Evaluation
```
You: "What's in user.permissions?"

Agent: [debug_evaluate: "user.permissions"]
["read", "write", "admin"]
```

#### Stepping
```
You: "Step into the next function"

Agent: [debug_step_into]
Stepped to validateUser at auth.js:55
```

### Watch Triggers

Automatically prompt the agent when specific log patterns appear.

#### Creating Watches
1. Find a log entry you want to watch
2. Click the eye icon next to it
3. Enter a prompt for the agent
4. Watch is now active

#### Example Use Cases
```
Pattern: /Error:/
Prompt: "Investigate this error and suggest a fix"

Pattern: /user signed up/
Prompt: "Summarize the signup event"

Pattern: /memory.*MB/
When: Memory exceeds 500MB
Prompt: "Analyze memory usage and suggest optimizations"
```

### Injection Mode

Deep instrumentation without code changes.

#### Enabling
```bash
reflexive --inject app.js
```

#### What Gets Captured
- **Console methods**: log, info, warn, error, debug
- **HTTP requests**: Incoming and outgoing via diagnostics_channel
- **GC events**: Garbage collection type and duration
- **Event loop**: Latency histogram (p50, p95, p99)
- **Uncaught errors**: With full stack traces

#### Using Injected API
```javascript
// Your app code (optional usage)
if (process.reflexive) {
  process.reflexive.setState('db.connections', pool.size);
  process.reflexive.emit('userSignup', { userId: 123 });
}
```

#### Querying Injected State
```
You: "What's the current custom state?"

Agent: [get_custom_state]
{
  "db.connections": 5,
  "cache.hitRate": 0.95,
  "lastDeployment": "2024-01-15T10:30:00Z"
}
```

### Runtime Eval

Execute code in your running application.

#### Enabling (DANGEROUS)
```bash
reflexive --eval app.js
```

#### Example Usage
```
You: "What's in the config object?"

Agent: [evaluate_in_app: code="config"]
{ port: 3000, debug: true, apiKey: "***" }

You: "Clear the cache"

Agent: [evaluate_in_app: code="cache.clear()"]
undefined

You: "How many items were in the cache?"

Agent: [evaluate_in_app: code="cache.size"]
142
```

**Warning**: `--eval` allows arbitrary code execution in your application. Use only in trusted development environments.

#### How Eval/Inject Work with Library Mode

Understanding the interaction between `--eval`, `--inject`, and `makeReflexive()` is important:

**Key Insight**: These are orthogonal, independent systems that work together seamlessly:

1. **Injection System** (`--inject` / `--eval`):
   - Loads `inject.cjs` via Node's `--require` flag at process startup
   - Instruments console methods, captures HTTP/GC events, event loop metrics
   - `--eval` implies `--inject` and additionally enables `evaluate_in_app` tool
   - Communicates via IPC (inter-process communication) with the CLI

2. **Library Mode** (`makeReflexive()`):
   - Your app calls `makeReflexive()` in its code
   - Detects CLI mode via `REFLEXIVE_CLI_MODE` environment variable
   - Connects as an HTTP client to the CLI's dashboard server
   - `.chat()` and `.setState()` proxy to the CLI's endpoints

**When used together** (`reflexive --eval app.js` where `app.js` uses `makeReflexive()`):
- Both systems work independently and simultaneously
- The agent gets eval capabilities from the injection system
- The agent gets chat/state capabilities from the library integration
- No conflicts - they use different communication channels (IPC vs HTTP)

**Example: Full-Stack AI Application**
```javascript
import { makeReflexive } from 'reflexive';

// Library mode: enables .chat() and .setState()
const r = makeReflexive({ title: 'My App' });

// Expose state for the agent
r.setState('cache.size', 0);

// Your app logic
const cache = new Map();

function addToCache(key, value) {
  cache.set(key, value);
  r.setState('cache.size', cache.size);  // Library mode
}

// Use AI programmatically
const analysis = await r.chat('Analyze the cache usage');  // Library mode
```

Run with: `reflexive --eval --write app.js`

Now the agent can:
- Use `evaluate_in_app` to inspect `cache` directly (from `--eval` injection)
- Use `get_custom_state` to read `cache.size` (from `makeReflexive()`)
- Use `r.chat()` in your code for hybrid AI features (from `makeReflexive()`)
- Modify files with `edit_file` (from `--write`)

This powerful combination enables both AI-native application features AND deep runtime introspection.

### Hybrid AI-Native Patterns

One of Reflexive's most powerful features is building "hybrid" applications that use AI inline in your code via `reflexive.chat()`.

#### The Pattern

```typescript
import { makeReflexive } from 'reflexive';

const r = makeReflexive({ title: 'My App' });

// Use .chat() to get AI responses programmatically
const analysis = await r.chat('Analyze this error: ' + error.stack);
```

#### Why This Is Powerful

Unlike typical AI integrations that just call an inference API, `reflexive.chat()`:
- Has full context of your application (logs, state, process info)
- Can use MCP tools (read files, execute commands if enabled)
- Works both standalone AND when run via the CLI
- Enables "AI-native" application features

#### Example: Dynamic AI Endpoint

```typescript
import { makeReflexive } from 'reflexive';
import http from 'http';

const r = makeReflexive({ title: 'Story API' });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // /story/dragons → AI writes a story about dragons
  if (url.pathname.startsWith('/story/')) {
    const topic = decodeURIComponent(url.pathname.slice(7));
    const story = await r.chat(
      `Write a short, creative story about: ${topic}. Return ONLY the story.`
    );
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ topic, story }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}).listen(8080);

console.log('Story API running on :8080');
console.log('Try: curl http://localhost:8080/story/dragons');
```

#### Example: AI-Enhanced Error Handling

```typescript
import { makeReflexive } from 'reflexive';
import fs from 'fs';

const r = makeReflexive({ title: 'Error Logger' });

async function riskyOperation() {
  // ... code that might fail
}

try {
  await riskyOperation();
} catch (error) {
  // Use AI to analyze the error
  const analysis = await r.chat(
    `Analyze this error and suggest fixes:\n\n${error.stack}`
  );

  // Log the analysis
  const logEntry = `[${new Date().toISOString()}]\n${error.message}\n\nAI Analysis:\n${analysis}\n\n`;
  fs.appendFileSync('error-log.txt', logEntry);

  console.error('Error occurred, analysis logged to error-log.txt');
}
```

#### Example: Smart Data Filtering

```typescript
import { makeReflexive } from 'reflexive';

const r = makeReflexive({ title: 'Smart Filter' });

const users = [
  { name: 'Alice', role: 'Engineer', skills: ['Go', 'K8s'] },
  { name: 'Bob', role: 'Designer', skills: ['Figma', 'CSS'] },
  // ... more users
];

// Natural language filtering
async function filterUsers(query) {
  const response = await r.chat(
    `Given this data: ${JSON.stringify(users)}\n\n` +
    `Filter for: "${query}"\n\n` +
    `Return ONLY a JSON array of matching names.`
  );

  const names = JSON.parse(response);
  return users.filter(u => names.includes(u.name));
}

// Usage: filterUsers("engineers who know Kubernetes")
```

#### Running Hybrid Apps

Your hybrid app works in both modes:

```bash
# Standalone - app has its own dashboard
node app.js
# Dashboard at http://localhost:3099/reflexive

# With CLI - uses CLI's dashboard, .chat() still works
reflexive app.js
# Dashboard at CLI's port, same functionality
```

When run via CLI, `makeReflexive()` automatically detects this and connects to the parent CLI instead of starting its own server. This is seamless - your code doesn't need to change.

## Troubleshooting

### Common Issues

#### "Command not found: reflexive"

**Solution 1**: Use npx
```bash
npx reflexive app.js
```

**Solution 2**: Fix PATH
```bash
npm config get prefix
export PATH="$(npm config get prefix)/bin:$PATH"
```

#### "ANTHROPIC_API_KEY not found"

**Solution**: Authenticate
```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

#### Dashboard won't load

**Check port availability**:
```bash
lsof -i :3099
```

**Use different port**:
```bash
reflexive --port 3100 app.js
```

#### Process keeps crashing

**Check Node version**:
```bash
node --version  # Must be >= 18.0.0
```

**Check entry file**:
```bash
ls -la app.js
node app.js  # Test directly
```

#### Debugger won't connect

**Ensure no other debuggers**:
```bash
# Only one debugger can connect at a time
# Close VS Code debugger, Chrome DevTools, etc.
```

**Check inspector port**:
```bash
# Default is random port, check logs for actual port
# Look for: "Debugger listening on ws://..."
```

### Getting Help

- Check [Examples](./examples.md) for similar use cases
- Review [API Reference](./api-reference.md) for detailed API docs
- Open an issue on GitHub for bugs
- Use GitHub Discussions for questions

---

**Next**: Explore [Examples](./examples.md) for real-world usage patterns.
