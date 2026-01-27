# Developer Guide

Guide for developers who want to understand Reflexive's architecture, contribute code, or extend functionality.

## Table of Contents

- [Architecture](#architecture)
  - [Project Structure](#project-structure)
  - [Module Overview](#module-overview)
  - [Data Flow](#data-flow)
  - [Design Principles](#design-principles)
- [Development Setup](#development-setup)
  - [Prerequisites](#prerequisites)
  - [Cloning and Installation](#cloning-and-installation)
  - [Building from Source](#building-from-source)
  - [Running Tests](#running-tests)
- [Code Organization](#code-organization)
  - [Types](#types)
  - [Core Modules](#core-modules)
  - [Managers](#managers)
  - [MCP Tools](#mcp-tools)
  - [Sandbox Utilities](#sandbox-utilities)
  - [API Layer](#api-layer)
- [Testing](#testing)
  - [Test Structure](#test-structure)
  - [Running Tests](#running-tests-1)
  - [Writing Tests](#writing-tests)
  - [Mock System](#mock-system)
- [Contributing](#contributing)
  - [Code Style](#code-style)
  - [Commit Messages](#commit-messages)
  - [Pull Request Process](#pull-request-process)
  - [Issue Guidelines](#issue-guidelines)
- [Extending Reflexive](#extending-reflexive)
  - [Adding Custom Tools](#adding-custom-tools)
  - [Creating New Managers](#creating-new-managers)
  - [Adding Storage Providers](#adding-storage-providers)

## Architecture

Reflexive is built as a modular TypeScript project with clear separation of concerns.

### Project Structure

```
reflexive/
├── src/
│   ├── index.ts              # Library mode entry point, public API
│   ├── cli.ts                # CLI entry point
│   ├── types/                # TypeScript type definitions
│   │   ├── index.ts          # Core types (LogEntry, Capabilities, Config)
│   │   ├── sandbox.ts        # Sandbox-specific types
│   │   ├── manager.ts        # Manager interface types
│   │   └── mcp.ts            # MCP tool types
│   ├── core/                 # Core infrastructure
│   │   ├── app-state.ts      # Circular log buffer, custom state store
│   │   ├── config-loader.ts  # Config file discovery and merging
│   │   ├── dashboard.ts      # HTML dashboard generator
│   │   ├── chat-stream.ts    # SSE chat streaming via Claude Agent SDK
│   │   └── http-server.ts    # Minimal HTTP server utilities
│   ├── managers/             # Process and sandbox managers
│   │   ├── process-manager.ts      # Child process spawning, restart logic
│   │   ├── remote-debugger.ts      # V8 Inspector protocol client
│   │   ├── sandbox-manager.ts      # Single Vercel Sandbox wrapper
│   │   └── multi-sandbox-manager.ts # Multi-tenant sandbox pool
│   ├── mcp/                  # MCP tool definitions
│   │   ├── tools.ts          # Base tool helpers (createTool, textResult)
│   │   ├── local-tools.ts    # Tools for local file operations
│   │   ├── cli-tools.ts      # Tools for CLI mode (process control, logs)
│   │   ├── sandbox-tools.ts  # Tools for sandbox mode
│   │   └── hosted-tools.ts   # Tools for hosted multi-tenant mode
│   ├── sandbox/              # Sandbox utilities
│   │   ├── inject.ts         # Sandbox injection script
│   │   ├── snapshot.ts       # Filesystem snapshot/restore
│   │   └── storage.ts        # S3/R2/Memory storage providers
│   ├── api/                  # REST API for hosted mode
│   │   ├── routes.ts         # REST endpoint definitions
│   │   └── auth.ts           # API key auth and rate limiting
│   └── __tests__/            # Test suites (vitest)
│       ├── unit/             # Unit tests
│       ├── integration/      # Integration tests
│       ├── e2e/              # End-to-end tests
│       ├── fixtures/         # Test fixtures
│       └── mocks/            # Mock implementations
├── dist/                     # Compiled output (gitignored)
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
└── eslint.config.js
```

### Module Overview

#### Core Modules (`src/core/`)

**app-state.ts**
- Circular log buffer (500 entries by default)
- Custom key-value state storage
- Event emitter for state changes
- Process status tracking

**config-loader.ts**
- Configuration file discovery (reflexive.config.js, .reflexiverc, etc.)
- Config merging and validation
- Environment variable handling
- Default configuration generation

**dashboard.ts**
- Self-contained HTML dashboard generator
- No external dependencies, inline CSS/JS
- Real-time log viewer with ANSI color support
- Chat interface with SSE streaming
- Process control UI

**chat-stream.ts**
- SSE (Server-Sent Events) streaming for AI responses
- Claude Agent SDK integration
- Tool call handling and response formatting
- Error handling and recovery

**http-server.ts**
- Minimal HTTP server utilities
- Request parsing (JSON, URL params)
- Response helpers (JSON, HTML, errors)
- CORS handling

#### Managers (`src/managers/`)

**process-manager.ts**
- Child process lifecycle (spawn, kill, restart)
- stdout/stderr capture and parsing
- File watching with debounced restart
- stdin proxy for interactive apps
- Injection script management
- Integration with RemoteDebugger

**remote-debugger.ts**
- V8 Inspector protocol client over WebSocket
- Breakpoint management (set, remove, list)
- Execution control (pause, resume, step over/into/out)
- Call stack inspection
- Scope variable evaluation
- Script source mapping

**sandbox-manager.ts**
- Single Vercel Sandbox wrapper
- File upload/download
- Command execution
- Log polling from sandbox
- State synchronization
- Injection script deployment

**multi-sandbox-manager.ts**
- Multi-tenant sandbox pool
- Sandbox lifecycle management
- Snapshot creation and restoration
- Storage provider integration
- Per-sandbox state isolation

#### MCP Tools (`src/mcp/`)

**tools.ts**
- Base tool creation helpers
- Result formatting (text, JSON, error)
- Zod schema integration
- Tool combination and filtering

**local-tools.ts**
- File operations (read, write, delete, search)
- Directory listing
- Shell command execution

**cli-tools.ts**
- Process control tools
- Log retrieval and search
- State inspection
- stdin sending

**sandbox-tools.ts**
- Sandbox-specific operations
- File manipulation in sandbox
- Command execution

**hosted-tools.ts**
- Multi-sandbox management
- Snapshot operations
- Cross-sandbox queries

#### Sandbox Utilities (`src/sandbox/`)

**inject.ts**
- Injection script source
- Console interception
- HTTP request/response tracking (diagnostics_channel)
- GC event monitoring
- Event loop latency tracking
- Custom state API (process.reflexive)

**snapshot.ts**
- Filesystem snapshot creation
- Snapshot restoration
- Directory traversal and archiving
- Compression and validation

**storage.ts**
- Storage provider abstraction
- Memory storage (in-process)
- S3 storage (AWS S3, Cloudflare R2)
- Provider factory

#### API Layer (`src/api/`)

**routes.ts**
- REST endpoint definitions
- Request validation
- Response formatting
- Route matching (string and regex)

**auth.ts**
- API key authentication
- Rate limiting (token bucket)
- Public path handling
- Middleware creation

### Data Flow

#### CLI Mode Data Flow

```
┌─────────────┐
│   User      │
│  Terminal   │
└──────┬──────┘
       │ reflexive app.js
       ▼
┌─────────────────────────────────────────┐
│           Reflexive CLI                 │
│  - Parse args                           │
│  - Load config                          │
│  - Create ProcessManager                │
│  - Start HTTP server                    │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────┐      ┌───────────────┐
│ ProcessManager  │◄─────┤   AppState    │
│ - Spawn app.js  │      │ - Logs        │
│ - Capture stdout│      │ - State       │
│ - Watch files   │      │ - Events      │
└────────┬────────┘      └───────────────┘
         │
         ▼
┌─────────────────┐
│   app.js        │
│ (Child Process) │
└─────────────────┘

       ┌──────────────────────────────────┐
       │     HTTP Server                  │
       │  - Dashboard UI                  │
       │  - Chat endpoint (SSE)           │
       │  - Status/logs endpoints         │
       └────────┬─────────────────────────┘
                │
                ▼
       ┌──────────────────┐
       │ Browser Client   │
       │ - Chat UI        │
       │ - Log viewer     │
       │ - Controls       │
       └──────────────────┘
```

#### Sandbox Mode Data Flow

```
┌─────────────┐
│     CLI     │
└──────┬──────┘
       │ reflexive --sandbox app.js
       ▼
┌─────────────────────────────────────┐
│      SandboxManager (Local)         │
│  - Create Vercel Sandbox            │
│  - Upload files                     │
│  - Upload inject script             │
│  - Start process                    │
│  - Poll logs                        │
└──────┬──────────────────────────────┘
       │
       │ WebSocket/HTTP
       ▼
┌─────────────────────────────────────┐
│    Vercel Sandbox (Remote)          │
│  - Isolated filesystem              │
│  - Run app.js                       │
│  - Write logs to /tmp/...           │
└──────┬──────────────────────────────┘
       │
       │ Log polling
       ▼
┌─────────────────┐
│    AppState     │
│  - Store logs   │
│  - Track state  │
└─────────────────┘
```

#### Hosted Mode Data Flow

```
┌─────────────┐
│ API Client  │
└──────┬──────┘
       │ POST /api/sandboxes
       ▼
┌─────────────────────────────────────┐
│    REST API Server                  │
│  - Auth middleware                  │
│  - Rate limiting                    │
│  - Route handling                   │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   MultiSandboxManager               │
│  - Create sandbox                   │
│  - Manage lifecycle                 │
│  - Create snapshots                 │
│  - Restore from snapshots           │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────┬────────────────────┐
│ SandboxManager  │  StorageProvider   │
│ (per sandbox)   │  (S3/R2/Memory)    │
└─────────────────┴────────────────────┘
```

### Design Principles

1. **Modularity**: Each module has a single responsibility
2. **Type Safety**: Strict TypeScript for compile-time guarantees
3. **Testability**: Dependency injection, mockable interfaces
4. **Extensibility**: Plugin system for custom tools and storage
5. **Safety**: Explicit opt-in for dangerous operations
6. **Performance**: Circular buffers, efficient log polling
7. **Developer Experience**: Clear APIs, comprehensive types

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Git
- Claude API access (for testing chat features)

### Cloning and Installation

```bash
# Clone repository
git clone https://github.com/yourusername/reflexive.git
cd reflexive

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test
```

### Building from Source

```bash
# Clean previous build
npm run clean

# Type check (no emit)
npm run typecheck

# Build
npm run build

# Watch mode for development
npm run dev
```

Build output goes to `dist/` directory.

### Running Tests

```bash
# Run all tests once
npm test

# Watch mode for development
npm run test:watch

# With coverage report
npm run test:coverage

# Run specific test file
npx vitest src/__tests__/unit/app-state.test.ts
```

## Code Organization

### Types

All TypeScript types are in `src/types/`:

**index.ts**: Core types used across the codebase
- `LogEntry`, `LogType`
- `AppStatus`, `ProcessState`
- `Capabilities`, `ReflexiveConfig`

**sandbox.ts**: Sandbox-specific types
- `SandboxStatus`, `SandboxInstance`
- `Snapshot`, `SnapshotFile`
- `CommandResult`

**manager.ts**: Manager interface definitions
- `BaseManager`
- `SandboxManagerInterface`
- `MultiSandboxManagerInterface`

**mcp.ts**: MCP tool types
- `McpTool`, `ToolResult`
- `ChatStreamEvent`, `ChatOptions`

### Core Modules

**AppState** manages application state:
```typescript
class AppState {
  private logs: LogEntry[] = [];  // Circular buffer
  private customState: Map<string, unknown> = new Map();

  log(type: LogType, message: string, meta?: unknown): void
  getLogs(count?: number, type?: string): LogEntry[]
  setState(key: string, value: unknown): void
  getState(key?: string): unknown
}
```

**ConfigLoader** handles configuration:
```typescript
export function loadConfig(configPath?: string): ReflexiveConfig
export function findConfigFile(): string | null
export function getDefaultConfig(): ReflexiveConfig
```

### Managers

Managers follow a common interface pattern:

```typescript
interface BaseManager {
  start(entry: string, args?: string[]): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  isRunning(): boolean;
  on(event: string, handler: EventHandler): void;
}
```

**ProcessManager** for local processes:
```typescript
class ProcessManager implements BaseManager {
  private child: ChildProcess | null;
  private watcher: FSWatcher | null;
  private debugger: RemoteDebugger | null;

  async start(): Promise<void>
  async stop(): Promise<void>
  async sendInput(text: string): Promise<void>
  getState(): ProcessState
}
```

### MCP Tools

Tools are created using the `createTool` helper:

```typescript
import { createTool, textResult } from './tools.js';
import { z } from 'zod';

export const readFileTool = createTool(
  'read_file',
  'Read file contents',
  z.object({
    path: z.string().describe('File path to read')
  }),
  async ({ path }) => {
    const content = await fs.readFile(path, 'utf-8');
    return textResult(content);
  }
);
```

Tool result helpers:
```typescript
textResult(text: string): ToolResult
jsonResult(data: unknown): ToolResult
errorResult(message: string): ToolResult
```

### Sandbox Utilities

**Injection script** provides runtime APIs:
```typescript
// In sandbox/inject.ts
process.reflexive = {
  setState(key: string, value: unknown): void,
  emit(event: string, data: unknown): void,
  log(level: string, ...args: unknown[]): void
};
```

**Snapshot** creates filesystem archives:
```typescript
export async function createSnapshot(
  dir: string,
  options?: CreateSnapshotOptions
): Promise<Snapshot>

export async function restoreFromSnapshot(
  snapshot: Snapshot,
  targetDir: string
): Promise<RestoreResult>
```

### API Layer

**Routes** define REST endpoints:
```typescript
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string | RegExp;
  handler: RequestHandler;
}

export function createApiRoutes(config: ApiRoutesConfig): Route[]
```

**Auth** provides middleware:
```typescript
export function createAuthMiddleware(
  config: AuthConfig
): (req, res, pathname) => Promise<boolean>

export function createRateLimiter(
  config: RateLimitConfig
): (req, res) => boolean
```

## Testing

### Test Structure

Tests are organized by type:

```
src/__tests__/
├── unit/              # Unit tests (isolated)
├── integration/       # Integration tests (multiple modules)
├── e2e/              # End-to-end tests (full workflows)
├── fixtures/         # Test data and sample apps
└── mocks/            # Mock implementations
```

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npx vitest src/__tests__/unit/

# Integration tests
npx vitest src/__tests__/integration/

# E2E tests (requires credentials)
npx vitest src/__tests__/e2e/

# Specific file
npx vitest src/__tests__/unit/app-state.test.ts

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Writing Tests

Use Vitest with TypeScript:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppState } from '../../core/app-state.js';

describe('AppState', () => {
  let appState: AppState;

  beforeEach(() => {
    appState = new AppState();
  });

  describe('log()', () => {
    it('adds log entry with timestamp', () => {
      appState.log('info', 'test message');
      const logs = appState.getLogs();

      expect(logs).toHaveLength(1);
      expect(logs[0].type).toBe('info');
      expect(logs[0].message).toBe('test message');
      expect(logs[0].timestamp).toBeDefined();
    });

    it('maintains circular buffer', () => {
      // Add more than maxLogs
      for (let i = 0; i < 600; i++) {
        appState.log('info', `message ${i}`);
      }

      const logs = appState.getLogs();
      expect(logs).toHaveLength(500);
      expect(logs[0].message).toBe('message 100');
    });
  });
});
```

### Mock System

Mocks for testing without external dependencies:

**MockSandbox** (`__tests__/mocks/sandbox-mock.ts`):
```typescript
export class MockSandbox {
  files: Map<string, string> = new Map();
  commands: { cmd: string; args: string[] }[] = [];

  async writeFiles(files: SandboxFile[]): Promise<void>
  async runCommand(options: any): Promise<CommandResult>
  async stop(): Promise<void>
}
```

**MockAnthropicClient** (`__tests__/mocks/anthropic-mock.ts`):
```typescript
export function createMockQuery() {
  return async function* (options: any) {
    yield { type: 'text', content: 'Mock response' };
    yield { type: 'done' };
  };
}
```

Usage in tests:
```typescript
import { vi } from 'vitest';
import { MockSandbox } from '../mocks/sandbox-mock.js';

vi.mock('@vercel/sandbox', () => ({
  Sandbox: MockSandbox
}));
```

## Contributing

### Code Style

- **TypeScript**: Strict mode enabled
- **Formatting**: Prettier with 2-space indents
- **Linting**: ESLint with TypeScript rules
- **Naming**:
  - Classes: PascalCase (`AppState`, `ProcessManager`)
  - Functions: camelCase (`loadConfig`, `createTool`)
  - Constants: UPPER_SNAKE_CASE (`MAX_LOGS`)
  - Types/Interfaces: PascalCase (`LogEntry`, `ReflexiveConfig`)

Run before committing:
```bash
npm run lint
npm run typecheck
npm test
```

### Commit Messages

Follow conventional commits:

```
feat: add sandbox snapshot creation
fix: resolve memory leak in log buffer
docs: update API reference for new tools
test: add integration tests for ProcessManager
refactor: extract config loading to separate module
chore: update dependencies
```

### Pull Request Process

1. **Fork and Branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make Changes**
   - Write code with tests
   - Update documentation
   - Run linter and tests

3. **Commit**
   ```bash
   git add .
   git commit -m "feat: add my feature"
   ```

4. **Push and PR**
   ```bash
   git push origin feature/my-feature
   ```
   - Open PR on GitHub
   - Fill in PR template
   - Link related issues

5. **Review**
   - Address review comments
   - Keep PR updated with main

6. **Merge**
   - Squash and merge
   - Delete branch

### Issue Guidelines

**Bug Reports** should include:
- Reflexive version
- Node.js version
- Operating system
- Minimal reproduction
- Expected vs actual behavior
- Logs/screenshots

**Feature Requests** should include:
- Use case description
- Proposed API/UX
- Alternatives considered
- Willingness to implement

## Extending Reflexive

### Adding Custom Tools

Create a custom tool module:

```typescript
// tools/database-tools.ts
import { createTool, textResult, jsonResult } from 'reflexive/mcp/tools';
import { z } from 'zod';

export const queryDatabaseTool = createTool(
  'query_database',
  'Execute SQL query',
  z.object({
    sql: z.string().describe('SQL query to execute')
  }),
  async ({ sql }) => {
    const results = await db.query(sql);
    return jsonResult(results);
  }
);

export const getDatabaseStatsTool = createTool(
  'get_database_stats',
  'Get database statistics',
  z.object({}),
  async () => {
    const stats = await db.getStats();
    return textResult(`Tables: ${stats.tables}, Size: ${stats.size}`);
  }
);
```

Use in your app:
```typescript
import { makeReflexive } from 'reflexive';
import { queryDatabaseTool, getDatabaseStatsTool } from './tools/database-tools.js';

const r = makeReflexive({
  tools: [queryDatabaseTool, getDatabaseStatsTool]
});
```

### Creating New Managers

Implement the `BaseManager` interface:

```typescript
import { BaseManager } from 'reflexive/types/manager';
import { AppState } from 'reflexive/core/app-state';
import { EventEmitter } from 'events';

export class CustomManager extends EventEmitter implements BaseManager {
  private appState: AppState;
  private running = false;

  constructor(options: CustomManagerOptions) {
    super();
    this.appState = options.appState || new AppState();
  }

  async start(entry: string, args?: string[]): Promise<void> {
    // Implementation
    this.running = true;
    this.emit('start', { entry });
  }

  async stop(): Promise<void> {
    // Implementation
    this.running = false;
    this.emit('stop');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  isRunning(): boolean {
    return this.running;
  }

  getLogs(count?: number): LogEntry[] {
    return this.appState.getLogs(count);
  }

  // ... implement other BaseManager methods
}
```

### Adding Storage Providers

Implement the `StorageProvider` interface:

```typescript
import { StorageProvider, Snapshot } from 'reflexive/sandbox/storage';

export class CustomStorageProvider implements StorageProvider {
  async save(snapshot: Snapshot): Promise<string> {
    // Save snapshot, return ID
    const id = generateId();
    await this.backend.write(id, JSON.stringify(snapshot));
    return id;
  }

  async load(id: string): Promise<Snapshot> {
    // Load snapshot by ID
    const data = await this.backend.read(id);
    return JSON.parse(data);
  }

  async delete(id: string): Promise<void> {
    // Delete snapshot
    await this.backend.delete(id);
  }

  async list(): Promise<Snapshot[]> {
    // List all snapshots
    const ids = await this.backend.listIds();
    return Promise.all(ids.map(id => this.load(id)));
  }
}
```

Register the provider:
```typescript
import { createStorageProvider } from 'reflexive/sandbox/storage';

const storage = createStorageProvider({
  provider: 'custom',
  config: { /* ... */ }
});
```

---

**Next**: See [Deployment Guide](./deployment.md) for production deployment instructions.
