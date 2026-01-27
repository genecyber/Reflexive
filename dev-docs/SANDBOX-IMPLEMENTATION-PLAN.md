# Reflexive Sandbox Implementation Plan

> Port Reflexive to TypeScript, add test suite, and extend with sandbox capabilities.

## Executive Summary

This plan covers three major initiatives:

1. **TypeScript Migration** - Port the entire codebase from JavaScript to TypeScript
2. **Test Suite** - Add comprehensive testing infrastructure
3. **Sandbox Modes** - Add local sandbox and hosted sandbox capabilities

The project will support three operating modes:

1. **Local Mode** (existing) - `npx reflexive app.js` - unchanged behavior
2. **Local Sandbox Mode** - Local Reflexive controls app running in Vercel Sandbox
3. **Hosted Mode** - Railway-deployed Reflexive managing multiple sandboxes with full lifecycle control

---

## TypeScript Migration

### Why TypeScript?

- **Type Safety**: Catch errors at compile time, especially important for complex sandbox lifecycle
- **Better IDE Support**: Autocomplete, refactoring, go-to-definition
- **Documentation**: Types serve as inline documentation
- **Maintainability**: Easier onboarding and code review

### Build Configuration

```
reflexive/
  src/
    index.ts              # Main entry point
    types/
      index.ts            # Shared type definitions
      sandbox.ts          # Sandbox-specific types
      mcp.ts              # MCP tool types
  tsconfig.json           # TypeScript config
  tsconfig.build.json     # Build-specific config (excludes tests)
  package.json            # Updated scripts and exports
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": false,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### Package.json Updates

```json
{
  "name": "reflexive",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "bin": {
    "reflexive": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "demo": "npm run build && node dist/cli.js",
    "demo:sandbox": "npm run build && node dist/cli.js --sandbox demo-app.js",
    "prepublishOnly": "npm run build && npm run test"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

---

## Test Suite

### Testing Framework: Vitest

- Fast, native ESM support
- Jest-compatible API
- Built-in TypeScript support
- Good watch mode for development

### Test Structure

```
src/
  __tests__/
    unit/
      app-state.test.ts
      process-manager.test.ts
      sandbox-manager.test.ts
      multi-sandbox-manager.test.ts
      config-loader.test.ts
      mcp-tools.test.ts
    integration/
      local-mode.test.ts
      sandbox-mode.test.ts
      hosted-mode.test.ts
      api-routes.test.ts
    e2e/
      dashboard.test.ts
      chat-flow.test.ts
      snapshot-restore.test.ts
    fixtures/
      demo-app.ts
      test-config.ts
    mocks/
      sandbox-mock.ts
      anthropic-mock.ts
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'src/__tests__/fixtures/',
        'src/__tests__/mocks/'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80
      }
    },
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 30000 // Sandbox tests may be slow
  }
});
```

### Mock Strategy

**Sandbox Mock** (for unit/integration tests without real Vercel):

```typescript
// src/__tests__/mocks/sandbox-mock.ts
export class MockSandbox {
  sandboxId = 'mock-sandbox-123';
  files: Map<string, string> = new Map();
  commands: { cmd: string; args: string[] }[] = [];
  isRunning = false;

  static async create(options: any) {
    return new MockSandbox();
  }

  async writeFiles(files: { path: string; content: Buffer }[]) {
    files.forEach(f => this.files.set(f.path, f.content.toString()));
  }

  async runCommand(options: { cmd: string; args: string[] }) {
    this.commands.push({ cmd: options.cmd, args: options.args });

    // Simulate reading log file
    if (options.cmd === 'cat' && options.args[0] === '/tmp/reflexive-logs.jsonl') {
      return { stdout: this.files.get('/tmp/reflexive-logs.jsonl') || '', exitCode: 0 };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  }

  async stop() {
    this.isRunning = false;
  }
}
```

**Anthropic Mock** (for testing without API calls):

```typescript
// src/__tests__/mocks/anthropic-mock.ts
export function createMockQuery() {
  return async function* mockQuery(options: any) {
    yield { type: 'system', session_id: 'test-session-123' };
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { text: 'Mock response for: ' + options.prompt }
      }
    };
    yield { type: 'done' };
  };
}
```

### Test Examples

**Unit Test**:

```typescript
// src/__tests__/unit/app-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AppState } from '../../app-state';

describe('AppState', () => {
  let state: AppState;

  beforeEach(() => {
    state = new AppState();
  });

  describe('logs', () => {
    it('adds log entries with timestamp', () => {
      state.log('info', 'test message');
      const logs = state.getLogs();

      expect(logs).toHaveLength(1);
      expect(logs[0].type).toBe('info');
      expect(logs[0].message).toBe('test message');
      expect(logs[0].timestamp).toBeDefined();
    });

    it('maintains circular buffer at maxLogs', () => {
      for (let i = 0; i < 600; i++) {
        state.log('info', `message ${i}`);
      }

      const logs = state.getLogs();
      expect(logs).toHaveLength(500);
      expect(logs[0].message).toBe('message 100');
    });

    it('filters logs by type', () => {
      state.log('info', 'info message');
      state.log('error', 'error message');

      const errors = state.getLogs(100, 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].type).toBe('error');
    });
  });

  describe('state', () => {
    it('stores and retrieves custom state', () => {
      state.setState('users', 42);
      expect(state.getState('users')).toBe(42);
    });

    it('emits event on state change', () => {
      const events: any[] = [];
      state.on('stateChange', (e) => events.push(e));

      state.setState('count', 1);

      expect(events).toHaveLength(1);
      expect(events[0].key).toBe('count');
    });
  });
});
```

**Integration Test**:

```typescript
// src/__tests__/integration/sandbox-mode.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SandboxManager } from '../../sandbox-manager';
import { MockSandbox } from '../mocks/sandbox-mock';

vi.mock('@vercel/sandbox', () => ({
  Sandbox: MockSandbox
}));

describe('SandboxManager', () => {
  let manager: SandboxManager;

  beforeEach(async () => {
    manager = new SandboxManager({ vcpus: 2, memory: 2048 });
    await manager.create();
  });

  afterEach(async () => {
    await manager.stop();
  });

  it('creates sandbox with correct configuration', async () => {
    expect(manager.isCreated()).toBe(true);
  });

  it('uploads inject script on start', async () => {
    await manager.start('app.js');

    const sandbox = manager.getSandbox() as MockSandbox;
    expect(sandbox.files.has('/app/sandbox-inject.cjs')).toBe(true);
  });

  it('polls logs from sandbox', async () => {
    await manager.start('app.js');

    // Simulate log being written
    const sandbox = manager.getSandbox() as MockSandbox;
    sandbox.files.set('/tmp/reflexive-logs.jsonl',
      '{"type":"log","data":{"level":"info","message":"test"},"ts":123}\n'
    );

    await manager.pollLogs();

    const logs = manager.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].data.message).toBe('test');
  });
});
```

**E2E Test**:

```typescript
// src/__tests__/e2e/snapshot-restore.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MultiSandboxManager } from '../../multi-sandbox-manager';

// Skip if no VERCEL_TOKEN (CI without credentials)
const describeWithSandbox = process.env.VERCEL_TOKEN
  ? describe
  : describe.skip;

describeWithSandbox('Snapshot/Restore E2E', () => {
  let manager: MultiSandboxManager;

  beforeAll(async () => {
    manager = new MultiSandboxManager({
      storage: { provider: 'memory' }
    });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it('creates snapshot and restores state', async () => {
    // Create and start sandbox
    const { id } = await manager.create('test-1', { vcpus: 2 });
    await manager.uploadFiles(id, [
      { path: '/app/app.js', content: 'console.log("hello")' }
    ]);
    await manager.start(id, '/app/app.js');

    // Set some state
    await manager.runCommand(id, 'node', ['-e',
      'process.reflexive.setState("count", 42)'
    ]);

    // Create snapshot
    const { snapshotId } = await manager.snapshot(id);

    // Stop original
    await manager.stop(id);

    // Resume from snapshot
    const { id: newId } = await manager.resume(snapshotId);
    await manager.start(newId, '/app/app.js');

    // Verify state restored
    const state = manager.getCustomState(newId);
    expect(state.count).toBe(42);
  }, 120000); // Long timeout for real sandbox operations
});
```

---

## Type Definitions

### Core Types

```typescript
// src/types/index.ts

export interface LogEntry {
  type: 'info' | 'warn' | 'error' | 'debug' | 'stdout' | 'stderr' | 'system';
  message: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

export interface AppStatus {
  pid: number;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  customState: Record<string, unknown>;
  startTime: number;
}

export interface ReflexiveConfig {
  mode: 'local' | 'sandbox' | 'hosted';
  port: number;
  sandbox?: SandboxConfig;
  hosted?: HostedConfig;
  capabilities: Capabilities;
  tools?: CustomTool[];
}

export interface Capabilities {
  readFiles: boolean;
  writeFiles: boolean;
  shellAccess: boolean;
  restart: boolean;
  inject: boolean;
  eval: boolean;
  debug: boolean;
}
```

### Sandbox Types

```typescript
// src/types/sandbox.ts

export interface SandboxConfig {
  provider: 'vercel';
  vcpus: number;
  memory: number;
  timeout: string | number;
  runtime: 'node22' | 'node20';
}

export interface SandboxInstance {
  id: string;
  status: 'created' | 'running' | 'stopped' | 'error';
  config: SandboxConfig;
  createdAt: number;
  startedAt?: number;
  stoppedAt?: number;
}

export interface Snapshot {
  id: string;
  sandboxId: string;
  timestamp: number;
  files: SnapshotFile[];
  state: Record<string, unknown>;
  logs: LogEntry[];
}

export interface SnapshotFile {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
}

export interface HostedConfig {
  maxSandboxes: number;
  defaultTimeout: string;
  snapshotStorage: StorageConfig;
}

export interface StorageConfig {
  provider: 's3' | 'r2' | 'memory';
  bucket?: string;
  endpoint?: string;
}
```

### Manager Interface

```typescript
// src/types/manager.ts

export interface BaseManager {
  // Lifecycle
  start(entryFile: string, args?: string[]): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;

  // State
  isRunning(): boolean;
  getStatus(): AppStatus;
  getLogs(count?: number, filter?: string): LogEntry[];
  searchLogs(query: string): LogEntry[];
  getCustomState(key?: string): unknown;

  // Events
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
  emit(event: string, data: unknown): void;
}

export interface SandboxManagerInterface extends BaseManager {
  create(): Promise<void>;
  uploadFiles(files: { path: string; content: string }[]): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(path: string): Promise<string[]>;
  runCommand(cmd: string, args?: string[]): Promise<CommandResult>;
}

export interface MultiSandboxManagerInterface {
  create(id: string, config: SandboxConfig): Promise<SandboxInstance>;
  start(id: string, entryFile: string, args?: string[]): Promise<void>;
  stop(id: string): Promise<void>;
  destroy(id: string): Promise<void>;

  snapshot(id: string): Promise<{ snapshotId: string }>;
  resume(snapshotId: string): Promise<{ id: string }>;
  listSnapshots(): Promise<Snapshot[]>;

  list(): SandboxInstance[];
  get(id: string): SandboxInstance | undefined;
  getLogs(id: string, count?: number): LogEntry[];
  getCustomState(id: string, key?: string): unknown;
}
```

---

## File Structure (Complete)

```
reflexive/
├── src/
│   ├── index.ts                    # Library exports
│   ├── cli.ts                      # CLI entry point
│   ├── types/
│   │   ├── index.ts                # Core types
│   │   ├── sandbox.ts              # Sandbox types
│   │   ├── manager.ts              # Manager interfaces
│   │   └── mcp.ts                  # MCP tool types
│   ├── core/
│   │   ├── app-state.ts            # AppState class
│   │   ├── config-loader.ts        # Config file loading
│   │   ├── dashboard.ts            # Dashboard HTML generator
│   │   ├── chat-stream.ts          # SSE chat streaming
│   │   └── http-server.ts          # HTTP server setup
│   ├── managers/
│   │   ├── base-manager.ts         # Abstract base class
│   │   ├── process-manager.ts      # Local process control
│   │   ├── sandbox-manager.ts      # Single sandbox control
│   │   └── multi-sandbox-manager.ts # Hosted mode
│   ├── sandbox/
│   │   ├── inject.ts               # sandbox-inject.cjs source
│   │   ├── snapshot.ts             # Snapshot/restore logic
│   │   └── storage.ts              # S3/R2/memory storage
│   ├── mcp/
│   │   ├── tools.ts                # Shared MCP tools
│   │   ├── local-tools.ts          # Local mode tools
│   │   ├── sandbox-tools.ts        # Sandbox mode tools
│   │   └── hosted-tools.ts         # Hosted mode tools
│   ├── api/
│   │   ├── routes.ts               # REST API routes
│   │   └── auth.ts                 # API authentication
│   └── __tests__/
│       ├── unit/
│       ├── integration/
│       ├── e2e/
│       ├── fixtures/
│       ├── mocks/
│       └── setup.ts
├── dist/                           # Compiled output (gitignored)
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── eslint.config.js
├── railway.json
├── reflexive.config.example.js
└── CLAUDE.md
```

---

## Implementation Phases (Revised)

### Phase 0: TypeScript Setup (2 Agents Parallel)

| Task | Description | Agent |
|------|-------------|-------|
| 0.1 | Set up TypeScript config, ESLint, build scripts | Agent A |
| 0.2 | Set up Vitest, test structure, mocks | Agent B |

### Phase 1: Core Migration (4 Agents Parallel)

Port existing JS to TypeScript with tests.

| Task | Description | Agent |
|------|-------------|-------|
| 1.1 | Port `AppState` class + unit tests | Agent A |
| 1.2 | Port `ProcessManager` class + unit tests | Agent B |
| 1.3 | Port dashboard HTML generator + tests | Agent C |
| 1.4 | Port MCP tools + tests | Agent D |

### Phase 2: Local Sandbox Mode (4 Agents Parallel)

| Task | Description | Agent |
|------|-------------|-------|
| 2.1 | Create `SandboxManager` + unit tests | Agent A |
| 2.2 | Create `sandbox-inject.ts` + tests | Agent B |
| 2.3 | Create sandbox MCP tools + tests | Agent C |
| 2.4 | CLI updates for `--sandbox` flag + integration tests | Agent D |

### Phase 3: Hosted Mode (4 Agents Parallel)

| Task | Description | Agent |
|------|-------------|-------|
| 3.1 | Create `MultiSandboxManager` + unit tests | Agent A |
| 3.2 | Create snapshot/restore + tests | Agent B |
| 3.3 | Create REST API routes + tests | Agent C |
| 3.4 | Create hosted dashboard + E2E tests | Agent D |

### Phase 4: Deployment & Polish (3 Agents Parallel)

| Task | Description | Agent |
|------|-------------|-------|
| 4.1 | Railway deployment config + docs | Agent A |
| 4.2 | Auth, rate limiting + security tests | Agent B |
| 4.3 | Documentation, examples, CLAUDE.md update | Agent C |

---

## Three Operating Modes

### Mode 1: Local Mode (Unchanged API)

```bash
npx reflexive app.js
npx reflexive --inject --eval app.js
```

- Uses existing `ProcessManager` to spawn local child processes
- Full feature support: injection, eval, V8 debugging, file watching
- No cloud dependencies required

### Mode 2: Local Sandbox Mode

```bash
npx reflexive --sandbox app.js
# Or via config file
npx reflexive --config reflexive.config.js app.js
```

**reflexive.config.js**:
```javascript
export default {
  mode: 'sandbox',
  sandbox: {
    provider: 'vercel',
    vcpus: 2,
    memory: 2048,
    timeout: '30m'
  }
}
```

- Reflexive runs locally, app runs in isolated Vercel Sandbox
- Dashboard served from localhost
- Agent controls sandboxed process lifecycle

### Mode 3: Hosted Mode (New)

```
https://reflexive.railway.app/
```

- Reflexive deployed as a service on Railway
- Multi-user, multi-sandbox management
- Full sandbox lifecycle: **create, snapshot, stop, resume**
- REST API for programmatic control
- Web dashboard for sandbox management

---

## REST API (Hosted Mode)

```typescript
// Sandbox Lifecycle
POST   /api/sandboxes              // Create sandbox
GET    /api/sandboxes              // List all sandboxes
GET    /api/sandboxes/:id          // Get sandbox details
POST   /api/sandboxes/:id/start    // Start sandbox
POST   /api/sandboxes/:id/stop     // Stop sandbox
DELETE /api/sandboxes/:id          // Destroy sandbox

// Snapshot Operations
POST   /api/sandboxes/:id/snapshot // Create snapshot
GET    /api/snapshots              // List snapshots
POST   /api/snapshots/:id/resume   // Resume from snapshot
DELETE /api/snapshots/:id          // Delete snapshot

// Logs and State
GET    /api/sandboxes/:id/logs     // Get logs
GET    /api/sandboxes/:id/state    // Get custom state

// Chat
POST   /api/sandboxes/:id/chat     // SSE chat stream

// Files
GET    /api/sandboxes/:id/files/*  // Read file
PUT    /api/sandboxes/:id/files/*  // Write file
```

---

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "@vercel/sandbox": "^1.0.2",
    "ms": "^2.1.3",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ms": "^2.1.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitest/coverage-v8": "^2.1.0",
    "eslint": "^9.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  },
  "optionalDependencies": {
    "@aws-sdk/client-s3": "^3.0.0"
  }
}
```

---

## Verification Checklist

### TypeScript & Testing
- [ ] `npm run build` compiles without errors
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes with >80% coverage
- [ ] Types are exported correctly

### Local Mode (Regression)
- [ ] `npx reflexive demo-app.js` works unchanged
- [ ] All existing flags work: `--inject`, `--eval`, `--debug`, `--watch`
- [ ] Dashboard loads and chat works

### Local Sandbox Mode
- [ ] `npx reflexive --sandbox demo-app.js` creates sandbox
- [ ] Logs appear in dashboard
- [ ] `process.reflexive.setState` works
- [ ] File read/write works
- [ ] Restart works

### Hosted Mode
- [ ] Deploy to Railway successfully
- [ ] `POST /api/sandboxes` creates sandbox
- [ ] Start/stop lifecycle works
- [ ] Snapshot creates and stores state
- [ ] Resume from snapshot restores state
- [ ] Multiple sandboxes can run concurrently
- [ ] Rate limiting prevents abuse

---

## Agent Orchestration Summary

```
Phase 0 (2 agents parallel): TypeScript Setup
  Agent A: TypeScript config, ESLint, build scripts
  Agent B: Vitest config, test structure, mocks

Phase 1 (4 agents parallel): Core Migration
  Agent A: AppState + tests
  Agent B: ProcessManager + tests
  Agent C: Dashboard + tests
  Agent D: MCP tools + tests

Phase 2 (4 agents parallel): Local Sandbox
  Agent A: SandboxManager + tests
  Agent B: sandbox-inject + tests
  Agent C: Sandbox MCP tools + tests
  Agent D: CLI + integration tests

Phase 3 (4 agents parallel): Hosted Mode
  Agent A: MultiSandboxManager + tests
  Agent B: Snapshot/restore + tests
  Agent C: REST API + tests
  Agent D: Hosted dashboard + E2E tests

Phase 4 (3 agents parallel): Deployment
  Agent A: Railway config
  Agent B: Auth & rate limiting
  Agent C: Documentation
```

**Total: 17 agent tasks across 5 phases**

---

## Security Considerations

- API keys never logged
- Sandbox isolation verified
- Rate limiting on hosted mode
- API authentication required (JWT or API key)
- Snapshot data encrypted at rest
- CORS configuration for hosted dashboard
- Input validation on all API endpoints
- Type-safe parameter validation with Zod
