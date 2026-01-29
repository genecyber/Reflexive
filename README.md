# Reflexive - Ai's missing debugger

![Demo](demo1.gif)

[View full video (mp4)](demo1_clipped_4x.mp4)

Reflexive is like puppeteer but for the cli, it embeds Claude inside your running application. It sees logs, reads source, edits files, sets breakpoints, and responds to runtime events.

**Supports:** Node.js, Python, Go, .NET, Rust

## Quickstart

```bash
# Node.js
echo "console.log('hello')" > app.js
npx reflexive --write app.js

# Python
echo "print('hello')" > app.py
npx reflexive --write app.py

# Open http://localhost:3099 and chat with your app
```

## Oneliner
```bash
npm i -g reflexive
echo "console.log('hello')" > app.js; reflexive --write --inject --open app.js
```

## What This Is

       Claude Agent SDK (Claude Code as a library) + your running application = an agent that:

- **Agent loop** - keeps working until done, tool calls, retries, reasoning
- **Process lifecycle** - start, stop, restart, watch for file changes
- **Multi-language debugging** - breakpoints, stepping, scope inspection (Node.js, Python, Go, .NET, Rust)
- **Watch triggers** - pattern-match logs and auto-prompt the agent
- **File read/write + shell** - behind explicit flags

```
+---------------------------------------------------------+
|  reflexive CLI                                          |
|  - Dashboard server (chat UI + logs)                    |
|  - Claude Agent SDK with MCP tools                      |
|  - Process control, file ops, shell                     |
|                                                         |
|  +---------------------------------------------------+  |
|  |  your-app.js / app.py / main.go (child process)   |  |
|  |  - stdout/stderr captured                         |  |
|  |  - Optional: deep instrumentation (Node.js)       |  |
|  +---------------------------------------------------+  |
+---------------------------------------------------------+
```

## Safety Model

**Default is read-only.** No flags = agent can see logs, read files, ask questions. Cannot modify anything.

Capabilities require explicit opt-in:

| Flag | Enables |
|------|---------|
| `--write` | File modification |
| `--shell` | Shell command execution |
| `--inject` | Deep instrumentation (Node.js only: console intercept, diagnostics, perf metrics) |
| `--eval` | Runtime code evaluation (Node.js only, implies --inject) |
| `--debug` | Multi-language debugging (breakpoints, stepping, scope inspection) |

This is a development tool. For production, use read-only mode.

## Authentication

Choose one:

```bash
# Option 1: Claude Code CLI (recommended)
npm install -g @anthropic-ai/claude-code
claude  # Login once

# Option 2: API key
export ANTHROPIC_API_KEY=your-key
```

---

## CLI Reference

```bash
reflexive [options] [entry-file] [-- app-args...]
```

### Options

```
-p, --port <port>       Dashboard port (default: 3099)
-h, --host <host>       Dashboard host (default: localhost)
-o, --open              Open dashboard in browser
-w, --watch             Restart on file changes
-i, --interactive       Proxy stdin/stdout for CLI apps
    --mcp               Run as MCP server for external AI agents
    --no-webui          Disable web dashboard (MCP mode only)
    --inject            Deep instrumentation (Node.js only)
    --eval              Runtime eval (Node.js only, DANGEROUS)
-d, --debug             Multi-language debugging (breakpoints, stepping)
    --write             Enable file writing
    --shell             Enable shell access
    --dangerously-skip-permissions  Enable everything
    --node-args <args>  Pass args to Node.js (Node.js only)
```

### Examples

```bash
# Basic - read-only monitoring
npx reflexive ./server.js

# Python app
npx reflexive ./app.py

# Development - full control
npx reflexive --write --shell --watch ./server.js

# Debugging - set breakpoints, step through code (any language)
npx reflexive --debug ./server.js    # Node.js
npx reflexive --debug ./app.py       # Python (requires: pip install debugpy)
npx reflexive --debug ./main.go      # Go (requires: dlv)

# Deep instrumentation - GC stats, event loop, HTTP tracking (Node.js only)
npx reflexive --inject ./server.js

# MCP server - let Claude Code or other AI agents control your app
npx reflexive --mcp --write --shell ./server.js

# Pass args to your app
npx reflexive ./server.js -- --port 8080
```

## MCP Server Mode

Run reflexive as an MCP server that external AI agents can connect to. This lets you control your app from Claude Code, Claude Desktop, ChatGPT, or any MCP-compatible client.

The MCP server can run with or without a pre-specified app - use the `run_app` tool to dynamically start or switch between different applications (Node.js, Python, Go, etc.).

```bash
# Start with a specific app
npx reflexive --mcp --write ./app.js

# Start without an app (use run_app tool to start apps dynamically)
npx reflexive --mcp --write

# With file writing and shell access
npx reflexive --mcp --write --shell ./app.js

# With debugging (breakpoints, stepping, scope inspection)
npx reflexive --mcp --write --debug ./app.js

# Without web dashboard
npx reflexive --mcp --no-webui ./app.js
```

### Claude Code Integration

```bash
# Add reflexive as an MCP server (no app - use run_app tool)
claude mcp add --transport stdio reflexive -- npx reflexive --mcp --write --shell

# With debugging support (breakpoints, stepping, scope inspection)
claude mcp add --transport stdio reflexive -- npx reflexive --mcp --write --shell --debug

# Or with a specific app
claude mcp add --transport stdio reflexive -- npx reflexive --mcp --write ./app.js
```

Or add to your Claude Code project settings (`.mcp.json`):

```json
{
  "reflexive": {
    "command": "npx",
    "args": ["reflexive", "--mcp", "--write", "--shell", "--debug"]
  }
}
```

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "reflexive": {
      "command": "npx",
      "args": ["reflexive", "--mcp", "--write", "--debug"]
    }
  }
}
```

## External MCP Server Support

Reflexive can discover and connect to external MCP servers, giving the embedded agent access to tools from other MCP servers you have installed (like those from Claude Code plugins).

### Auto-Discovery

At startup, Reflexive discovers MCP servers from:
- Your project's `.mcp.json`
- User-level `~/.mcp.json`
- Claude Code plugin directories

```
[reflexive] Discovered 5 available MCP servers (use list_available_mcp_servers tool)
[reflexive] Connecting to MCP servers from .mcp.json: my-server
```

### Dynamic Enabling

The agent can list and enable discovered servers on-demand - no restart required:

```
You: "What MCP servers are available?"
Agent: [list_available_mcp_servers]
       Connected: my-server
       Available: context7, firebase, playwright, serena

You: "Enable context7"
Agent: [enable_mcp_server: server_name="context7"]
       Enabled! Available on your next message.
```

Once enabled, the server's tools are immediately available. The config is also saved to `.mcp.json` for persistence across restarts.

### Project MCP Config

Add external MCP servers to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  }
}
```

---

### Available MCP Tools

When running as an MCP server, these tools are available to connected agents:

| Tool | Description |
|------|-------------|
| `run_app` | Start or switch to a different app (Node.js, Python, Go, etc.) |
| `get_process_state` | Get app status (PID, uptime, running state) |
| `get_output_logs` | Get stdout/stderr logs |
| `restart_process` | Restart the app |
| `stop_process` | Stop the app |
| `start_process` | Start a stopped app |
| `send_input` | Send stdin to interactive apps |
| `search_logs` | Search through logs |
| `read_file` | Read project files |
| `list_directory` | List directory contents |
| `write_file` | Write files (requires `--write`) |
| `edit_file` | Edit files (requires `--write`) |
| `exec_shell` | Run shell commands (requires `--shell`) |
| `chat` | Chat with embedded Reflexive agent |
| `reflexive_self_knowledge` | Get Reflexive documentation |
| `list_available_mcp_servers` | List discovered external MCP servers |
| `enable_mcp_server` | Enable a discovered MCP server (instant, no restart) |

With `--debug`: `debug_set_breakpoint`, `debug_resume`, `debug_step_*`, etc. (all languages)
With `--eval`: `evaluate_in_app`, `list_app_globals` (Node.js only)

### Dynamic App Switching

The `run_app` tool allows switching between different apps without restarting the MCP server:

```
Agent: [run_app: path="./server.js"]
       Started: /path/to/server.js

Agent: [run_app: path="./worker.js", args=["--queue", "tasks"]]
       Started: /path/to/worker.js with args: --queue tasks
```

The web dashboard also supports file picking to switch apps via the browser's File System Access API.

---

## Library Mode (Node.js/TypeScript)

Embed the agent inside your Node.js app for deeper introspection. A [Python SDK](./python-sdk/) is also available.

**Note:** Web UI is disabled by default for security. The `chat()` function works regardless.

```javascript
import { makeReflexive } from 'reflexive';

// Minimal - no web UI, just programmatic chat
const r = makeReflexive({ title: 'My App' });

// With web dashboard enabled
const r = makeReflexive({
  webUI: true,     // Enable web dashboard (off by default)
  port: 3099,
  title: 'My App',
  tools: []        // Add custom MCP tools
});

// Console output captured automatically
console.log('Server started');

// Expose custom state the agent can query
r.setState('activeUsers', 42);
r.setState('cache.hitRate', 0.95);

// Programmatic chat (works with or without webUI)
const answer = await r.chat("What's the memory usage?");
```

### Custom Tools

```javascript
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const r = makeReflexive({
  tools: [
    tool(
      'get_order',
      'Look up order by ID',
      { orderId: z.string() },
      async ({ orderId }) => ({
        content: [{ type: 'text', text: JSON.stringify(orders.get(orderId)) }]
      })
    )
  ]
});
```

## Multi-Language Debugging

With `--debug`, the agent can set real breakpoints and step through code. Reflexive supports multiple languages through the Debug Adapter Protocol (DAP):

| Language | Extension | Debugger | Install |
|----------|-----------|----------|---------|
| Node.js | `.js`, `.ts` | V8 Inspector | Built-in |
| Python | `.py` | debugpy | `pip install debugpy` |
| Go | `.go` | Delve | `go install github.com/go-delve/delve/cmd/dlv@latest` |
| .NET | `.cs` | netcoredbg | See [netcoredbg releases](https://github.com/Samsung/netcoredbg/releases) |
| Rust | `.rs` | CodeLLDB | `cargo install codelldb` |

### Node.js Debugging

```bash
npx reflexive --debug ./server.js
```

```
You: "Set a breakpoint on line 42 of server.js"
Agent: [debug_set_breakpoint: file="server.js", line=42]
       Breakpoint set.

... request comes in ...

Agent: Breakpoint hit at server.js:42

       Call Stack:
       - handleRequest (server.js:42)
       - processMiddleware (middleware.js:18)

       Local Variables:
       - req: { method: "POST", url: "/api/users" }
       - user: { id: 123, name: "Alice" }

You: "What's in user.permissions?"
Agent: [debug_evaluate: "user.permissions"]
       ["read", "write", "admin"]

You: "Step into the next function"
Agent: [debug_step_into]
       Stepped to validateUser (auth.js:55)
```

### Python Debugging

```bash
# First, install debugpy
pip install debugpy

# Then run your Python app with debugging
npx reflexive --debug ./app.py
```

```
You: "Set a breakpoint at line 15 in app.py"
Agent: [debug_set_breakpoint: file="app.py", line=15]
       Breakpoint set.

You: "What variables are in scope?"
Agent: [debug_get_scope_variables]
       - request: <Request object>
       - user_id: 42
       - db_session: <Session object>

You: "Evaluate db_session.query(User).count()"
Agent: [debug_evaluate: "db_session.query(User).count()"]
       127
```

### Breakpoint Prompts

Set breakpoints with AI prompts that trigger automatically when hit:

```
You: "Set a breakpoint on line 50 with prompt 'Analyze the request object'"
Agent: [debug_set_breakpoint: file="server.js", line=50, prompt="Analyze the request object"]
       Breakpoint with prompt set.

... breakpoint hits ...

Agent: Analyzing the request object at server.js:50...
       The request is a POST to /api/users with body containing
       email and password fields. The password appears to be
       unhashed - this may be a security concern.

## Watch Triggers

Click the eye icon on any log entry to create a watch. When that pattern appears again, the agent is automatically prompted.

Use cases:
- "When you see 'Error:', investigate and suggest a fix"
- "When 'user signed up' appears, summarize the signup"
- "When memory exceeds 500MB, analyze what's using it"

## Injection Mode (Node.js Only)

With `--inject`, your Node.js app gets automatic instrumentation without code changes:

| What's Captured | Source |
|-----------------|--------|
| Console methods | log, info, warn, error, debug |
| HTTP requests | Incoming and outgoing via diagnostics_channel |
| GC events | Duration and type |
| Event loop | Latency histogram (p50, p99) |
| Uncaught errors | With stack traces |

Your app can optionally use the injected API:

```javascript
if (process.reflexive) {
  process.reflexive.setState('db.connections', pool.size);
  process.reflexive.emit('userSignup', { userId: 123 });
}
```

## Runtime Eval (Node.js Only)

With `--eval`, the agent can execute JavaScript in your running Node.js app:

```
You: "What's in the config object?"
Agent: [evaluate_in_app: code="config"]
       { port: 3000, debug: true }

You: "Clear the cache"
Agent: [evaluate_in_app: code="cache.clear()"]
       undefined
```

**Warning:** `--eval` allows arbitrary code execution. Development only.

## Dashboard

The web UI at `http://localhost:3099` provides:

- Real-time chat with the agent
- Live logs with ANSI color support
- Process controls (stop/restart)
- Watch pattern management
- Breakpoint controls (with --debug)

## Demos

```bash
npm run demo          # Library mode - task queue
npm run demo:app      # CLI mode - HTTP server
npm run demo:inject   # Deep instrumentation
npm run demo:eval     # Runtime eval
npm run demo:ai       # AI-powered endpoints
```

---

## Links

- Built on [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/agent-sdk) (Claude Code as a library)
- TypeScript CLI with Next.js dashboard
- [Python SDK](./python-sdk/) for embedding in Python apps
- [Troubleshooting](./FAILURES.md)

## License

MIT
