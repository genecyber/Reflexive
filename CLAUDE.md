# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reflexive is an AI-powered introspection framework for Node.js applications using the Claude Agent SDK. It enables building applications by talking to them — an AI agent that lives inside your running application and can see logs, read source files, and modify code through chat conversation.

## Commands

```bash
npm run demo          # Run self-instrumenting demo (library mode)
npm run demo:app      # Run CLI mode monitoring demo-app.js
```

There is no build step, test suite, or linter configured. The project runs directly as ES modules with Node.js >= 18.

## Architecture

### Two Operating Modes

**Library Mode** — Embed the agent inside your app:
```javascript
import { makeReflexive } from 'reflexive';
const r = makeReflexive({ port: 3099, title: 'My App' });
r.setState('key', value);  // Expose state to agent
```

**CLI Mode** — Monitor any Node.js app from outside:
```bash
reflexive [options] <script.js> [-- app-args]
```

### Single-File Implementation

All functionality lives in `src/reflexive.js` (~1,500 lines). This monolithic design is intentional — no build step, direct execution. Key components within:

- **AppState class** — Circular log buffer (500 entries), custom key-value state, event emitter
- **ProcessManager class** — Child process spawning, stdout/stderr capture, restart logic, file watching
- **MCP Server** — Tool definitions using Zod schemas for agent capabilities
- **Dashboard HTML generator** — Self-contained SPA with chat interface and log viewer
- **Chat streaming** — SSE-based real-time responses via Claude Agent SDK

### Dashboard Server

Runs on port 3099 by default. Routes:
- `/reflexive` — Web dashboard UI
- `/reflexive/chat` — POST, SSE stream for chat
- `/reflexive/status` — GET, JSON status
- `/reflexive/logs` — GET, JSON logs with filtering

### MCP Tools Pattern

Agent capabilities are exposed as MCP tools with Zod-validated parameters:
- Library mode: `get_app_status`, `get_logs`, `search_logs`, `get_custom_state`
- CLI mode: `get_process_state`, `get_output_logs`, `restart_process`, `stop_process`, `start_process`, `send_input`, `search_logs`

Additional tools can be registered via the `tools` option when calling `makeReflexive()`.

### CLI Capability Flags

Dangerous operations are gated behind flags:
- `--write` — Allow file modifications
- `--shell` — Allow shell command execution
- `--watch` — Hot-reload on file changes

## Dependencies

Only two runtime dependencies:
- `@anthropic-ai/claude-agent-sdk` — Claude AI integration
- `zod` — Parameter validation for MCP tools

## Authentication

Requires Claude API access via either:
1. Claude Code CLI authentication (recommended)
2. `ANTHROPIC_API_KEY` environment variable
