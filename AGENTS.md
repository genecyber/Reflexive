# AGENTS.md

A guide to running AI agents and long-lived applications under Reflexive supervision.

---

## What Reflexive Does for Your Agent

Reflexive wraps your application with an AI-powered supervisor that can:

- **See everything** — stdout, stderr, logs captured in real-time
- **Read source code** — navigate your codebase to understand context
- **Debug interactively** — set breakpoints, step through code, inspect variables
- **React to events** — watch triggers auto-prompt the agent on patterns
- **Modify code** — edit files, run shell commands (with explicit flags)
- **Stay alive** — process supervision with auto-restart

```
┌─────────────────────────────────────────────────────┐
│  Reflexive                                          │
│  ├── Claude Agent (Claude Code as a library)        │
│  ├── Dashboard server (localhost:3099)              │
│  ├── MCP tools (process control, debugging, files)  │
│  │                                                  │
│  │  ┌─────────────────────────────────────────┐     │
│  │  │  Your Agent (child process)             │     │
│  │  │  - Any language: Node, Python, Go, etc  │     │
│  │  │  - stdout/stderr captured               │     │
│  │  │  - Optional: debugger attached          │     │
│  │  └─────────────────────────────────────────┘     │
│  │                                                  │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# Install
npm install -g reflexive

# Run your agent with full capabilities
reflexive --dangerously-skip-permissions --port 3099 ./your-agent.js

# Open dashboard
open http://localhost:3099
```

---

## Capability Flags

Reflexive is **read-only by default**. Capabilities require explicit opt-in:

| Flag | What It Enables |
|------|-----------------|
| `--write` | File modification (create, edit, delete) |
| `--shell` | Shell command execution |
| `--debug` | Debugging (breakpoints, stepping, scope inspection) |
| `--inject` | Deep instrumentation: GC stats, event loop, HTTP tracking (Node.js only) |
| `--eval` | Runtime code evaluation in the running process (Node.js only, DANGEROUS) |
| `--watch` | Auto-restart on file changes |
| `--dangerously-skip-permissions` | Enable ALL capabilities |

### Common Combinations

```bash
# Read-only monitoring (safe for production)
reflexive ./agent.js

# Development mode
reflexive --write --shell --watch ./agent.js

# Full debugging
reflexive --debug --write ./agent.js

# Daemon mode (no prompts, all capabilities)
reflexive --dangerously-skip-permissions ./agent.js
```

---

## Debugging

Reflexive supports multi-language debugging through V8 Inspector (Node.js) and Debug Adapter Protocol (Python, Go, .NET, Rust).

### Supported Languages

| Language | Extension | Debugger | Install |
|----------|-----------|----------|---------|
| Node.js | `.js`, `.ts` | V8 Inspector | Built-in |
| Python | `.py` | debugpy | `pip install debugpy` |
| Go | `.go` | Delve | `go install github.com/go-delve/delve/cmd/dlv@latest` |
| .NET | `.cs` | netcoredbg | [releases](https://github.com/Samsung/netcoredbg/releases) |
| Rust | `.rs` | CodeLLDB | `cargo install codelldb` |

### Debug Tools

With `--debug`, the agent gains these tools:

| Tool | Description |
|------|-------------|
| `debug_set_breakpoint` | Set breakpoint at file:line |
| `debug_remove_breakpoint` | Remove a breakpoint |
| `debug_resume` | Continue execution |
| `debug_pause` | Pause execution |
| `debug_step_over` | Step over current line |
| `debug_step_into` | Step into function call |
| `debug_step_out` | Step out of current function |
| `debug_get_call_stack` | Get current call stack |
| `debug_evaluate` | Evaluate expression in current scope |
| `debug_get_scope_variables` | List variables in scope |

### Breakpoint Prompts

Set breakpoints with AI prompts that trigger automatically:

```
You: "Set a breakpoint on line 50 with prompt 'Analyze what's happening here'"
Agent: [debug_set_breakpoint: file="agent.js", line=50, prompt="Analyze what's happening here"]

... breakpoint hits ...

Agent: Analyzing the execution state at agent.js:50...
       The request handler received a malformed payload. The 'userId' field
       is missing which will cause the downstream validation to fail.
```

---

## Watch Triggers

Watch triggers auto-prompt the agent when specific patterns appear in logs.

### Via Dashboard

1. Click the eye icon on any log entry
2. The pattern is saved
3. When it appears again, the agent is automatically engaged

### Use Cases

- **Error handling:** "When you see 'Error:', investigate and suggest a fix"
- **Event tracking:** "When 'user signed up' appears, log the signup details"
- **Resource monitoring:** "When memory exceeds 500MB, analyze what's using it"
- **Security:** "When 'unauthorized' appears, investigate the request"

---

## Injection Mode (Node.js Only)

With `--inject`, your Node.js app gets automatic instrumentation:

| What's Captured | Source |
|-----------------|--------|
| Console methods | `log`, `info`, `warn`, `error`, `debug` |
| HTTP requests | Incoming and outgoing via `diagnostics_channel` |
| GC events | Duration and type |
| Event loop | Latency histogram (p50, p99) |
| Uncaught errors | With stack traces |

### Optional In-App API

Your app can expose custom state:

```javascript
if (process.reflexive) {
  process.reflexive.setState('db.connections', pool.size);
  process.reflexive.setState('queue.pending', queue.length);
  process.reflexive.emit('taskCompleted', { taskId: 123 });
}
```

---

## MCP Server Mode

Run Reflexive as an MCP server that external AI agents (Claude Code, Claude Desktop) can connect to:

```bash
# Start as MCP server
reflexive --mcp --write --shell ./agent.js

# Without a pre-specified app (use run_app tool to start dynamically)
reflexive --mcp --write --shell
```

### Claude Code Integration

```bash
# Add to Claude Code
claude mcp add --transport stdio reflexive -- npx reflexive --mcp --write --shell --debug
```

Or add to `.mcp.json`:

```json
{
  "reflexive": {
    "command": "npx",
    "args": ["reflexive", "--mcp", "--write", "--shell", "--debug"]
  }
}
```

### MCP Tools Available

| Tool | Description |
|------|-------------|
| `run_app` | Start or switch to a different app |
| `get_process_state` | Get app status (PID, uptime, running) |
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

---

## External MCP Servers

Reflexive discovers and connects to external MCP servers from:
- Project `.mcp.json`
- User `~/.mcp.json`
- Claude Code plugins

### Dynamic Enabling

```
You: "What MCP servers are available?"
Agent: [list_available_mcp_servers]
       Connected: my-server
       Available: context7, firebase, playwright

You: "Enable context7"
Agent: [enable_mcp_server: server_name="context7"]
       Enabled! Available on your next message.
```

---

## Dashboard

The web UI at `http://localhost:3099` provides:

- **Chat** — Real-time conversation with the agent
- **Logs** — Live stdout/stderr with ANSI colors
- **Controls** — Stop, restart, send input
- **Watches** — Manage watch triggers
- **Breakpoints** — Debug controls (with `--debug`)

---

## Daemon Mode (macOS LaunchAgent)

For long-running agents, create a LaunchAgent:

### Template

`~/Library/LaunchAgents/com.example.my-agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.example.my-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/usr/local/lib/node_modules/reflexive/dist/cli.js</string>
        <string>--dangerously-skip-permissions</string>
        <string>--port</string>
        <string>3099</string>
        <string>/path/to/your/agent.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/path/to/logs/agent.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/logs/agent.err.log</string>
    <key>WorkingDirectory</key>
    <string>/path/to/working/dir</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>/Users/YOUR_USERNAME</string>
    </dict>
</dict>
</plist>
```

### Load/Unload

```bash
# Load (starts immediately and on login)
launchctl load ~/Library/LaunchAgents/com.example.my-agent.plist

# Unload (stops and disables)
launchctl unload ~/Library/LaunchAgents/com.example.my-agent.plist

# Restart
launchctl kickstart -k gui/$(id -u)/com.example.my-agent
```

---

## Real-World Examples

### OpenClaw (formerly ClawdBot)

A Telegram bot gateway that connects Claude to Telegram chats.

**Install:**
```bash
npm install -g reflexive openclaw
```

**Run:**
```bash
reflexive --dangerously-skip-permissions --port 3099 \
  /usr/local/lib/node_modules/openclaw/dist/index.js gateway
```

**LaunchAgent:** `~/Library/LaunchAgents/ai.openclaw.reflexive-guardian.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.openclaw.reflexive-guardian</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/usr/local/lib/node_modules/reflexive/dist/cli.js</string>
        <string>--dangerously-skip-permissions</string>
        <string>--port</string>
        <string>3099</string>
        <string>/usr/local/lib/node_modules/openclaw/dist/index.js</string>
        <string>gateway</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.openclaw/logs/reflexive.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.openclaw/logs/reflexive.err.log</string>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>/Users/YOUR_USERNAME</string>
    </dict>
</dict>
</plist>
```

**Dashboard:** http://localhost:3099

---

*Add your agent here! Submit a PR with your Reflexive-supervised application.*
