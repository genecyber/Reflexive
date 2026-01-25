# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reflexive is an AI-powered introspection framework for Node.js applications using the Claude Agent SDK. It enables building applications by talking to them - an AI agent that lives inside your running application and can see logs, read source files, and modify code through chat conversation.

## Commands

```bash
# Development
npm run build         # Build TypeScript to dist/
npm run dev           # Watch mode for development
npm run test          # Run all tests (vitest)
npm run test:watch    # Watch mode for tests
npm run test:coverage # Run tests with coverage
npm run typecheck     # Type check without emitting
npm run lint          # Run ESLint
npm run clean         # Remove dist/

# Running
npm run demo          # Build and run CLI monitoring demo-app.js
npm run demo:sandbox  # Run demo-app.js in Vercel Sandbox
npm run demo:legacy   # Run legacy single-file reflexive.js (no build)
```

## Architecture

### Three Operating Modes

**Local Mode** - Spawn and monitor a child process:
```bash
reflexive [options] <script.js> [-- app-args]
```

**Sandbox Mode** - Run in isolated Vercel Sandbox:
```bash
reflexive --sandbox <script.js>
```

**Library Mode** - Embed the agent inside your app:
```typescript
import { makeReflexive } from 'reflexive';
const r = makeReflexive({ port: 3099, title: 'My App' });
r.setState('key', value);
```

### Project Structure

```
src/
├── index.ts              # Library mode entry point, public API exports
├── cli.ts                # CLI entry point
├── types/                # TypeScript type definitions
│   ├── index.ts          # Core types (LogEntry, Capabilities, Config)
│   ├── sandbox.ts        # Sandbox-specific types
│   ├── manager.ts        # Manager interface types
│   └── mcp.ts            # MCP tool types
├── core/                 # Core infrastructure
│   ├── app-state.ts      # Circular log buffer, custom state store
│   ├── config-loader.ts  # Config file discovery and merging
│   ├── dashboard.ts      # HTML dashboard generator
│   ├── chat-stream.ts    # SSE chat streaming via Claude Agent SDK
│   └── http-server.ts    # Minimal HTTP server utilities
├── managers/             # Process and sandbox managers
│   ├── process-manager.ts      # Child process spawning, restart logic
│   ├── remote-debugger.ts      # V8 Inspector protocol client
│   ├── sandbox-manager.ts      # Single Vercel Sandbox wrapper
│   └── multi-sandbox-manager.ts # Multi-tenant sandbox pool
├── mcp/                  # MCP tool definitions
│   ├── tools.ts          # Base tool helpers (createTool, textResult)
│   ├── local-tools.ts    # Tools for local file operations
│   ├── cli-tools.ts      # Tools for CLI mode (process control, logs)
│   ├── sandbox-tools.ts  # Tools for sandbox mode
│   └── hosted-tools.ts   # Tools for hosted multi-tenant mode
├── sandbox/              # Sandbox utilities
│   ├── inject.ts         # Sandbox injection script
│   ├── snapshot.ts       # Filesystem snapshot/restore
│   └── storage.ts        # S3/R2/Memory storage providers
├── api/                  # REST API for hosted mode
│   ├── routes.ts         # REST endpoint definitions
│   └── auth.ts           # API key auth and rate limiting
└── __tests__/            # Test suites (vitest)
    ├── unit/             # Unit tests
    ├── integration/      # Integration tests
    ├── e2e/              # End-to-end tests
    ├── fixtures/         # Test fixtures
    └── mocks/            # Mock implementations
```

### Dashboard Server

Runs on port 3099 by default. Routes vary by mode:

**CLI/Sandbox Mode:**
- `/` or `/dashboard` - Web dashboard UI
- `/chat` - POST, SSE stream for AI chat
- `/state` - GET, JSON process/sandbox state
- `/logs` - GET, JSON logs with filtering
- `/restart`, `/stop`, `/start` - POST, process control

**Hosted Mode API:**
- `/api/health` - GET, health check
- `/api/sandboxes` - POST (create), GET (list)
- `/api/sandboxes/:id` - GET (details), DELETE (destroy)
- `/api/sandboxes/:id/start` - POST, start sandbox
- `/api/sandboxes/:id/stop` - POST, stop sandbox
- `/api/sandboxes/:id/snapshot` - POST, create snapshot
- `/api/snapshots` - GET, list snapshots
- `/api/snapshots/:id/resume` - POST, resume from snapshot

### MCP Tools Pattern

Agent capabilities are exposed as MCP tools with Zod-validated parameters:

**CLI Mode:** `get_process_state`, `get_output_logs`, `restart_process`, `stop_process`, `start_process`, `send_input`, `search_logs`

**Debug Mode (--debug):** `debug_set_breakpoint`, `debug_remove_breakpoint`, `debug_resume`, `debug_pause`, `debug_step_over`, `debug_step_into`, `debug_step_out`, `debug_get_call_stack`, `debug_evaluate`, `debug_get_scope_variables`

**Sandbox Mode:** `get_sandbox_state`, `get_output_logs`, `restart_sandbox`, `get_custom_state`, `search_logs`

**Hosted Mode:** All sandbox tools plus `create_snapshot`, `restore_from_snapshot`, `list_snapshots`, `delete_snapshot`

### CLI Capability Flags

Dangerous operations are gated behind flags:
- `--write` - Allow file modifications
- `--shell` - Allow shell command execution
- `--inject` - Enable deep console/diagnostic injection
- `--eval` - Enable runtime code evaluation (DANGEROUS)
- `--debug` - Enable V8 Inspector debugging
- `--watch` - Hot-reload on file changes
- `--sandbox` - Run in Vercel Sandbox
- `--dangerously-skip-permissions` - Enable ALL capabilities

## Configuration

Configuration can be provided via:
- `reflexive.config.js` / `reflexive.config.mjs`
- `reflexive.config.json`
- `.reflexiverc` / `.reflexiverc.json`

See `reflexive.config.example.js` for all options.

## Dependencies

**Runtime:**
- `@anthropic-ai/claude-agent-sdk` - Claude AI integration
- `zod` - Parameter validation for MCP tools
- `ws` - WebSocket for V8 Inspector protocol
- `ms` - Time string parsing

**Optional (for advanced features):**
- `@vercel/sandbox` - Sandbox mode isolation
- `@aws-sdk/client-s3` - S3 snapshot storage

## Authentication

Requires Claude API access via either:
1. Claude Code CLI authentication (recommended)
2. `ANTHROPIC_API_KEY` environment variable

For hosted mode, also set:
- `REFLEXIVE_API_KEY` - API key for REST endpoints
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` - For S3 snapshots

## Deployment

**Railway:**
```bash
railway up
```
Uses `railway.json` configuration.

**Docker:**
```bash
docker build -t reflexive .
docker run -p 3099:3099 -e ANTHROPIC_API_KEY=sk-xxx reflexive
```

**Manual:**
```bash
npm ci && npm run build
node dist/cli.js --sandbox app.js
```
