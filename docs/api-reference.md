# API Reference

Complete API documentation for Reflexive library mode, REST API, and TypeScript types.

## Table of Contents

- [Library API](#library-api)
  - [makeReflexive()](#makereflexive)
  - [ReflexiveInstance](#reflexiveinstance)
  - [AppState](#appstate)
  - [ProcessManager](#processmanager)
  - [SandboxManager](#sandboxmanager)
  - [MultiSandboxManager](#multisandboxmanager)
- [REST API](#rest-api)
  - [Authentication](#authentication)
  - [Health Endpoints](#health-endpoints)
  - [Sandbox Endpoints](#sandbox-endpoints)
  - [Snapshot Endpoints](#snapshot-endpoints)
  - [File Endpoints](#file-endpoints)
  - [Chat Endpoint](#chat-endpoint)
- [MCP Tools](#mcp-tools)
  - [File Tools](#file-tools)
  - [Process Tools](#process-tools)
  - [Debug Tools](#debug-tools)
  - [Sandbox Tools](#sandbox-tools)
  - [Custom Tools](#custom-tools)
- [TypeScript Types](#typescript-types)
  - [Core Types](#core-types)
  - [Sandbox Types](#sandbox-types)
  - [Manager Types](#manager-types)
  - [MCP Types](#mcp-types)
- [Events](#events)

## Library API

### makeReflexive()

Create a Reflexive instance embedded in your application.

**Important:** When your app is run via `reflexive app.js` (CLI mode), `makeReflexive()` automatically detects this and connects to the parent CLI instead of starting its own server. This allows seamless integration - your app works both standalone and with the CLI.

#### Signature
```typescript
function makeReflexive(options?: MakeReflexiveOptions): ReflexiveInstance
```

#### Options
```typescript
interface MakeReflexiveOptions {
  port?: number;              // Dashboard port (default: 3099)
  title?: string;             // Dashboard title (default: 'Reflexive')
  systemPrompt?: string;      // Additional system prompt for AI
  tools?: CustomTool[];       // Custom MCP tools
  onReady?: (info: {          // Called when server starts (standalone mode only)
    port: number;
    appState: AppState;
    server: Server;
  }) => void;
}
```

#### Example
```typescript
import { makeReflexive } from 'reflexive';

const r = makeReflexive({
  port: 3099,
  title: 'My App',
  systemPrompt: 'You are monitoring a payment processing system.',
  tools: [
    {
      name: 'get_payment_status',
      description: 'Get status of a payment',
      schema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async ({ id }) => ({
        content: [{ type: 'text', text: `Payment ${id}: completed` }]
      })
    }
  ],
  onReady: ({ port }) => {
    console.log(`Dashboard ready at http://localhost:${port}/reflexive`);
  }
});

// Use the instance
r.setState('payments.processed', 1234);
console.log('Payment system started');
```

#### CLI Integration (Parent-Child Coordination)

When you run your app with the Reflexive CLI:

```bash
reflexive app.js
```

The CLI sets environment variables that `makeReflexive()` detects:
- `REFLEXIVE_CLI_MODE=true`
- `REFLEXIVE_CLI_PORT=<port>`

In this mode, `makeReflexive()` becomes a **client** that connects to the CLI's server:
- `.chat()` calls are proxied to the CLI's `/chat` endpoint
- `.setState()` syncs state to the CLI dashboard
- No duplicate server is started
- Logs flow through stdout (already captured by CLI)

This means your app works identically in both scenarios:

| How you run | What happens |
|-------------|--------------|
| `node app.js` | Standalone mode - starts own server on :3099 |
| `reflexive app.js` | Client mode - connects to CLI's server |

**Example: AI-Powered Endpoint**
```typescript
import { makeReflexive } from 'reflexive';
import http from 'http';

const r = makeReflexive({ title: 'Story API' });

http.createServer(async (req, res) => {
  if (req.url?.startsWith('/story/')) {
    const topic = req.url.slice(7);
    // This .chat() call works whether run standalone OR via CLI
    const story = await r.chat(`Write a short story about: ${topic}`);
    res.end(JSON.stringify({ story }));
  }
}).listen(8080);
```

Run standalone: `node app.js` → Dashboard at :3099
Run with CLI: `reflexive app.js` → Use CLI's dashboard, same `.chat()` behavior

#### Using makeReflexive() with CLI Capability Flags

When using `makeReflexive()` under CLI mode with capability flags like `--eval`, both systems work together:

```bash
reflexive --eval --write --inject app.js
```

**What happens:**
1. **Injection system** (from `--inject`/`--eval`):
   - Loaded via Node's `--require` flag before your app starts
   - Instruments console, HTTP, GC, event loop
   - Provides `evaluate_in_app` tool to the agent (with `--eval`)
   - Communicates with CLI via IPC

2. **Library system** (from `makeReflexive()`):
   - Your app's `makeReflexive()` call detects CLI mode
   - Becomes a client, connects to CLI's HTTP server
   - Provides `.chat()` and `.setState()` programmatic API
   - Agent can use `get_custom_state` to read your setState values

**Key point**: These are orthogonal systems that work independently. The agent gets:
- Full eval capabilities from the injection system
- Chat/state capabilities from library integration
- No conflicts (different communication channels: IPC vs HTTP)

**Example: Maximum AI Power**
```typescript
import { makeReflexive } from 'reflexive';

const r = makeReflexive({ title: 'Advanced App' });

// Expose state
r.setState('requests.count', 0);

let requestCount = 0;

async function handleRequest(req) {
  requestCount++;
  r.setState('requests.count', requestCount);

  // Use AI programmatically in your code
  const suggestion = await r.chat('Should I cache this request?');

  // Agent can also use evaluate_in_app to inspect requestCount directly
}
```

Run with: `reflexive --eval --write app.js`

The agent now has:
- `evaluate_in_app` to inspect variables like `requestCount` directly
- `get_custom_state` to read your `requests.count` state
- `edit_file` to modify source files
- Access to your programmatic `r.chat()` calls in the code

This enables building truly AI-native applications with deep runtime introspection.

### ReflexiveInstance

The object returned by `makeReflexive()`.

#### Properties
```typescript
interface ReflexiveInstance {
  appState: AppState;                      // State manager
  server: Server;                           // HTTP server instance
  log: (type: string, message: string) => void;
  setState: (key: string, value: unknown) => void;
  getState: (key?: string) => unknown;
  chat: (message: string) => Promise<string>;
}
```

#### Methods

##### log()
Add a log entry programmatically.

```typescript
r.log('info', 'User logged in');
r.log('error', 'Payment failed');
r.log('custom', 'Business event occurred');
```

##### setState()
Expose custom state for the AI to query.

```typescript
r.setState('users.count', 42);
r.setState('cache.hitRate', 0.95);
r.setState('db.connections', pool.size);
```

##### getState()
Retrieve stored state.

```typescript
const userCount = r.getState('users.count');        // 42
const allState = r.getState();                      // Entire state object
```

##### chat()
Send a message to the AI and get a response.

```typescript
const answer = await r.chat("What's the current memory usage?");
console.log(answer);
// "Current memory usage is 145.2 MB (RSS). Heap is at 67% capacity."
```

### AppState

Manages logs and custom state.

#### Constructor
```typescript
class AppState {
  constructor(options?: AppStateOptions)
}

interface AppStateOptions {
  maxLogs?: number;    // Max log entries (default: 500)
}
```

#### Methods

##### log()
```typescript
log(type: LogType, message: string, meta?: Record<string, unknown>): void
```

Add a log entry.

```typescript
appState.log('info', 'Server started');
appState.log('error', 'Connection failed', { code: 'ECONNREFUSED' });
```

##### getLogs()
```typescript
getLogs(count?: number, type?: string): LogEntry[]
```

Retrieve log entries.

```typescript
const allLogs = appState.getLogs();           // All logs (up to maxLogs)
const last10 = appState.getLogs(10);          // Last 10 logs
const errors = appState.getLogs(50, 'error'); // Last 50 errors
```

##### searchLogs()
```typescript
searchLogs(query: string): LogEntry[]
```

Search logs by regex pattern.

```typescript
const matches = appState.searchLogs('error|warn');
const userLogs = appState.searchLogs('user.*logged');
```

##### setState() / getState()
```typescript
setState(key: string, value: unknown): void
getState(key?: string): unknown
```

Manage custom state.

```typescript
appState.setState('users.active', 42);
appState.setState('cache.size', 1024);

const active = appState.getState('users.active');  // 42
const all = appState.getState();                    // Entire state
```

##### getStatus()
```typescript
getStatus(): AppStatus
```

Get application status.

```typescript
const status = appState.getStatus();
// {
//   pid: 12345,
//   uptime: 123.45,
//   memory: { rss: 52428800, heapTotal: 20971520, ... },
//   customState: { "users.active": 42 },
//   startTime: 1640000000000
// }
```

##### on() / off() / emit()
```typescript
on(event: string, handler: EventHandler): void
off(event: string, handler: EventHandler): void
emit(event: string, data: unknown): void
```

Event emitter for state changes.

```typescript
appState.on('stateChange', ({ key, value }) => {
  console.log(`${key} changed to ${value}`);
});

appState.setState('count', 1);  // Triggers event
```

### ProcessManager

Manages a child Node.js process (local mode).

#### Constructor
```typescript
class ProcessManager {
  constructor(options: ProcessManagerOptions)
}

interface ProcessManagerOptions {
  entry: string;                // Entry file path
  args?: string[];              // Arguments to entry file
  cwd?: string;                 // Working directory
  nodeArgs?: string[];          // Arguments to Node.js
  watch?: boolean;              // Auto-restart on changes
  interactive?: boolean;        // Proxy stdin/stdout
  inject?: boolean;             // Enable injection
  eval?: boolean;               // Enable eval (implies inject)
  debug?: boolean;              // Enable V8 debugger
  appState?: AppState;          // State manager
}
```

#### Methods

##### start()
```typescript
async start(): Promise<void>
```

Start the process.

```typescript
const pm = new ProcessManager({ entry: 'app.js' });
await pm.start();
```

##### stop()
```typescript
async stop(): Promise<void>
```

Stop the process gracefully.

```typescript
await pm.stop();
```

##### restart()
```typescript
async restart(): Promise<void>
```

Restart the process.

```typescript
await pm.restart();
```

##### sendInput()
```typescript
async sendInput(text: string): Promise<void>
```

Send input to interactive process.

```typescript
await pm.sendInput('hello\n');
```

##### getState()
```typescript
getState(): ProcessState
```

Get current process state.

```typescript
const state = pm.getState();
// {
//   isRunning: true,
//   pid: 12345,
//   uptime: 123.45,
//   restartCount: 0,
//   exitCode: null,
//   entry: 'app.js',
//   cwd: '/path/to/app',
//   interactive: false,
//   inject: false,
//   debug: false,
//   ...
// }
```

### SandboxManager

Manages a single Vercel Sandbox (sandbox mode).

#### Constructor
```typescript
class SandboxManager {
  constructor(options?: SandboxManagerOptions)
}

interface SandboxManagerOptions {
  vcpus?: number;        // 1-4 (default: 2)
  memory?: number;       // MB, 128-8192 (default: 2048)
  timeout?: number;      // ms (default: 30 minutes)
  runtime?: 'node22' | 'node20';  // (default: 'node22')
  appState?: AppState;
}
```

#### Methods

##### create()
```typescript
async create(): Promise<void>
```

Create the sandbox.

```typescript
const sm = new SandboxManager({ vcpus: 2, memory: 2048 });
await sm.create();
```

##### uploadFiles()
```typescript
async uploadFiles(files: SandboxFile[]): Promise<void>
```

Upload files to sandbox.

```typescript
await sm.uploadFiles([
  { path: '/app/server.js', content: 'console.log("hello")' },
  { path: '/app/package.json', content: '{"name":"my-app"}' }
]);
```

##### start()
```typescript
async start(entryFile: string, args?: string[]): Promise<void>
```

Start the sandbox process.

```typescript
await sm.start('/app/server.js', ['--port', '3000']);
```

##### stop()
```typescript
async stop(): Promise<void>
```

Stop the sandbox.

```typescript
await sm.stop();
```

##### readFile()
```typescript
async readFile(path: string): Promise<string>
```

Read file from sandbox.

```typescript
const content = await sm.readFile('/app/config.json');
```

##### writeFile()
```typescript
async writeFile(path: string, content: string): Promise<void>
```

Write file to sandbox.

```typescript
await sm.writeFile('/app/data.txt', 'Hello World');
```

##### runCommand()
```typescript
async runCommand(cmd: string, args?: string[]): Promise<CommandResult>
```

Run command in sandbox.

```typescript
const result = await sm.runCommand('ls', ['-la', '/app']);
console.log(result.stdout);
```

### MultiSandboxManager

Manages multiple sandboxes (hosted mode).

#### Constructor
```typescript
class MultiSandboxManager {
  constructor(config: MultiSandboxManagerConfig)
}

interface MultiSandboxManagerConfig {
  maxSandboxes?: number;        // Max concurrent sandboxes (default: 10)
  defaultTimeout?: string;       // Default timeout (default: '30m')
  snapshotStorage?: StorageConfig;
}
```

#### Methods

##### create()
```typescript
async create(id: string, config?: Partial<SandboxConfig>): Promise<SandboxInstance>
```

Create a new sandbox.

```typescript
const instance = await manager.create('my-app', {
  vcpus: 2,
  memory: 2048,
  timeout: '30m'
});
```

##### start()
```typescript
async start(id: string, entryFile: string, args?: string[]): Promise<void>
```

Start a sandbox.

```typescript
await manager.start('my-app', '/app/server.js');
```

##### stop()
```typescript
async stop(id: string): Promise<void>
```

Stop a sandbox.

```typescript
await manager.stop('my-app');
```

##### destroy()
```typescript
async destroy(id: string): Promise<void>
```

Destroy a sandbox.

```typescript
await manager.destroy('my-app');
```

##### snapshot()
```typescript
async snapshot(id: string, options?: { files?: string[] }): Promise<{ snapshotId: string }>
```

Create a snapshot.

```typescript
const { snapshotId } = await manager.snapshot('my-app');
```

##### resume()
```typescript
async resume(snapshotId: string, options?: { newId?: string }): Promise<{ id: string }>
```

Resume from snapshot.

```typescript
const { id } = await manager.resume(snapshotId, { newId: 'my-app-restored' });
```

##### list()
```typescript
list(): SandboxInstance[]
```

List all sandboxes.

```typescript
const sandboxes = manager.list();
sandboxes.forEach(s => console.log(s.id, s.status));
```

##### get()
```typescript
get(id: string): SandboxInstance | undefined
```

Get sandbox by ID.

```typescript
const sandbox = manager.get('my-app');
if (sandbox) {
  console.log(sandbox.status);
}
```

## REST API

The REST API is available in hosted mode.

### Authentication

All endpoints (except `/api/health`) require authentication.

#### Header
```
Authorization: Bearer YOUR_API_KEY
```

#### Example
```bash
curl -H "Authorization: Bearer sk-xxx" \
  https://your-reflexive.app/api/sandboxes
```

Set the API key via environment variable:
```bash
REFLEXIVE_API_KEY=your-secret-key
```

### Health Endpoints

#### GET /api/health

Check service health.

**Response**:
```json
{
  "status": "ok",
  "sandboxes": 3,
  "running": 2
}
```

**Example**:
```bash
curl https://your-reflexive.app/api/health
```

### Sandbox Endpoints

#### POST /api/sandboxes

Create a new sandbox.

**Request Body**:
```json
{
  "id": "my-app",
  "config": {
    "vcpus": 2,
    "memory": 2048,
    "timeout": "30m",
    "runtime": "node22"
  }
}
```

**Response**: `201 Created`
```json
{
  "id": "my-app",
  "status": "created",
  "config": { "vcpus": 2, "memory": 2048, "timeout": 1800000, "runtime": "node22" },
  "createdAt": 1640000000000
}
```

**Example**:
```bash
curl -X POST https://your-reflexive.app/api/sandboxes \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{"id":"my-app","config":{"vcpus":2}}'
```

#### GET /api/sandboxes

List all sandboxes.

**Response**:
```json
{
  "sandboxes": [
    {
      "id": "my-app",
      "status": "running",
      "createdAt": 1640000000000,
      "startedAt": 1640000010000
    }
  ]
}
```

#### GET /api/sandboxes/:id

Get sandbox details.

**Response**:
```json
{
  "id": "my-app",
  "status": "running",
  "config": { "vcpus": 2, "memory": 2048 },
  "createdAt": 1640000000000,
  "startedAt": 1640000010000
}
```

#### POST /api/sandboxes/:id/start

Start a sandbox.

**Request Body**:
```json
{
  "entryFile": "/app/server.js",
  "args": ["--port", "3000"]
}
```

**Response**:
```json
{
  "status": "started"
}
```

#### POST /api/sandboxes/:id/stop

Stop a sandbox.

**Response**:
```json
{
  "status": "stopped"
}
```

#### DELETE /api/sandboxes/:id

Destroy a sandbox.

**Response**:
```json
{
  "status": "destroyed"
}
```

### Snapshot Endpoints

#### POST /api/sandboxes/:id/snapshot

Create a snapshot.

**Request Body** (optional):
```json
{
  "files": ["/app/data.txt", "/app/state.json"]
}
```

**Response**: `201 Created`
```json
{
  "snapshotId": "snap-abc123",
  "timestamp": 1640000000000,
  "fileCount": 2
}
```

#### GET /api/snapshots

List all snapshots.

**Response**:
```json
{
  "snapshots": [
    {
      "id": "snap-abc123",
      "sandboxId": "my-app",
      "timestamp": 1640000000000,
      "fileCount": 2
    }
  ]
}
```

#### GET /api/snapshots/:id

Get snapshot details.

**Response**:
```json
{
  "id": "snap-abc123",
  "sandboxId": "my-app",
  "timestamp": 1640000000000,
  "files": [
    { "path": "/app/data.txt", "size": 1024 }
  ]
}
```

#### POST /api/snapshots/:id/resume

Resume from snapshot.

**Request Body** (optional):
```json
{
  "newId": "my-app-restored"
}
```

**Response**: `201 Created`
```json
{
  "id": "my-app-restored",
  "status": "created",
  "restoredFrom": "snap-abc123"
}
```

#### DELETE /api/snapshots/:id

Delete a snapshot.

**Response**:
```json
{
  "status": "deleted"
}
```

### File Endpoints

#### GET /api/sandboxes/:id/files/*

Read a file from sandbox.

**Example**: `GET /api/sandboxes/my-app/files/app/config.json`

**Response**:
```json
{
  "path": "/app/config.json",
  "content": "{\"port\":3000}"
}
```

#### PUT /api/sandboxes/:id/files/*

Write a file to sandbox.

**Example**: `PUT /api/sandboxes/my-app/files/app/data.txt`

**Request Body**:
```json
{
  "content": "Hello World"
}
```

**Response**:
```json
{
  "status": "written",
  "path": "/app/data.txt"
}
```

### Chat Endpoint

#### POST /api/sandboxes/:id/chat

Chat with the AI agent (SSE stream).

**Request Body**:
```json
{
  "message": "What is this app doing?"
}
```

**Response**: Server-Sent Events stream

```
event: text
data: {"content":"This application is an Express server..."}

event: tool
data: {"name":"read_file","input":{"path":"server.js"}}

event: text
data: {"content":"running on port 3000."}

event: done
data: {}
```

**Example**:
```bash
curl -X POST https://your-reflexive.app/api/sandboxes/my-app/chat \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{"message":"Show me the logs"}' \
  --no-buffer
```

## MCP Tools

MCP (Model Context Protocol) tools are the capabilities the AI agent can use.

### File Tools

Available in all modes.

#### read_file
Read file contents.

**Parameters**:
- `path` (string, required): File path

**Example**:
```
[read_file: path="server.js"]
```

#### list_directory
List directory contents.

**Parameters**:
- `path` (string, required): Directory path

**Example**:
```
[list_directory: path="./src"]
```

#### search_files
Search for files by glob pattern.

**Parameters**:
- `pattern` (string, required): Glob pattern (e.g., `**/*.js`)

**Example**:
```
[search_files: pattern="**/*.test.js"]
```

#### edit_file
Modify file contents (requires `--write`).

**Parameters**:
- `path` (string, required): File path
- `content` (string, required): New content

#### create_file
Create new file (requires `--write`).

**Parameters**:
- `path` (string, required): File path
- `content` (string, required): File content

#### delete_file
Delete file (requires `--write`).

**Parameters**:
- `path` (string, required): File path

### Process Tools

Available in local and CLI modes.

#### get_process_state
Get current process state.

**Returns**:
```json
{
  "isRunning": true,
  "pid": 12345,
  "uptime": 123.45,
  "memory": { "rss": 52428800 }
}
```

#### get_output_logs
Retrieve process logs.

**Parameters**:
- `count` (number, optional): Number of logs (default: 50)
- `type` (string, optional): Filter by type

#### search_logs
Search logs by pattern.

**Parameters**:
- `query` (string, required): Regex pattern

#### restart_process
Restart the monitored process.

#### stop_process
Stop the monitored process.

#### start_process
Start a stopped process.

#### send_input
Send stdin to interactive process.

**Parameters**:
- `text` (string, required): Input text

### Debug Tools

Available with `--debug` flag.

#### debug_set_breakpoint
Set a breakpoint.

**Parameters**:
- `file` (string, required): File path
- `line` (number, required): Line number

#### debug_remove_breakpoint
Remove a breakpoint.

**Parameters**:
- `file` (string, required): File path
- `line` (number, required): Line number

#### debug_resume
Resume execution from paused state.

#### debug_pause
Pause execution.

#### debug_step_over
Step over function call.

#### debug_step_into
Step into function.

#### debug_step_out
Step out of current function.

#### debug_get_call_stack
Get current call stack when paused.

#### debug_evaluate
Evaluate expression at breakpoint.

**Parameters**:
- `expression` (string, required): JavaScript expression

#### debug_get_scope_variables
Get variables in current scope.

### Sandbox Tools

Available in sandbox and hosted modes.

#### get_sandbox_state
Get sandbox status.

#### restart_sandbox
Restart the sandbox.

#### create_snapshot
Create state snapshot (hosted mode only).

#### restore_from_snapshot
Restore from snapshot (hosted mode only).

**Parameters**:
- `snapshotId` (string, required): Snapshot ID

### Custom Tools

Add custom tools to extend the agent's capabilities.

```typescript
import { makeReflexive } from 'reflexive';
import { z } from 'zod';

const r = makeReflexive({
  tools: [
    {
      name: 'get_user_count',
      description: 'Get number of active users',
      schema: {
        type: 'object',
        properties: {}
      },
      handler: async () => ({
        content: [{
          type: 'text',
          text: `Active users: ${getUserCount()}`
        }]
      })
    },
    {
      name: 'ban_user',
      description: 'Ban a user by ID',
      schema: {
        type: 'object',
        properties: {
          userId: { type: 'string' }
        },
        required: ['userId']
      },
      handler: async ({ userId }) => {
        await banUser(userId);
        return {
          content: [{
            type: 'text',
            text: `User ${userId} banned`
          }]
        };
      }
    }
  ]
});
```

## TypeScript Types

### Core Types

```typescript
export type LogType =
  | 'info'
  | 'warn'
  | 'error'
  | 'debug'
  | 'stdout'
  | 'stderr'
  | 'system'
  | 'stdin'
  | 'breakpoint-prompt';

export interface LogEntry {
  type: LogType | string;
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

export interface ProcessState {
  isRunning: boolean;
  pid: number | null;
  uptime: number;
  restartCount: number;
  exitCode: number | null;
  entry: string;
  cwd: string;
  interactive: boolean;
  inject: boolean;
  debug: boolean;
  debuggerConnected: boolean;
  debuggerPaused: boolean;
  inspectorUrl: string | null;
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
export type SandboxStatus =
  | 'created'
  | 'running'
  | 'stopped'
  | 'error';

export interface SandboxInstance {
  id: string;
  status: SandboxStatus;
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

export interface SandboxFile {
  path: string;
  content: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

### Manager Types

```typescript
export interface BaseManager {
  start(entryFile: string, args?: string[]): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  isRunning(): boolean;
  getStatus(): AppStatus;
  getLogs(count?: number, filter?: string): LogEntry[];
  searchLogs(query: string): LogEntry[];
  getCustomState(key?: string): unknown;
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
  emit(event: string, data: unknown): void;
}

export interface SandboxManagerInterface extends BaseManager {
  create(): Promise<void>;
  uploadFiles(files: SandboxFile[]): Promise<void>;
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
  list(): SandboxInstance[];
  get(id: string): SandboxInstance | undefined;
  getLogs(id: string, count?: number): LogEntry[];
  getCustomState(id: string, key?: string): unknown;
}
```

### MCP Types

```typescript
export interface ToolResult {
  content: ToolResultContent[];
}

export type ToolResultContent = {
  type: 'text';
  text: string;
} | {
  type: 'image';
  data: string;
  mimeType: string;
};

export interface McpTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface CustomTool extends McpTool {}
```

## Events

Managers emit events for state changes.

### AppState Events

```typescript
appState.on('stateChange', ({ key, value }) => {
  console.log(`State changed: ${key} = ${value}`);
});

appState.on('log', (entry: LogEntry) => {
  console.log(`New log: ${entry.message}`);
});
```

### ProcessManager Events

```typescript
processManager.on('start', ({ pid }) => {
  console.log(`Process started: ${pid}`);
});

processManager.on('stop', ({ exitCode }) => {
  console.log(`Process stopped: ${exitCode}`);
});

processManager.on('restart', ({ restartCount }) => {
  console.log(`Restarted ${restartCount} times`);
});

processManager.on('breakpoint', ({ file, line }) => {
  console.log(`Breakpoint hit: ${file}:${line}`);
});
```

### SandboxManager Events

```typescript
sandboxManager.on('created', ({ sandboxId }) => {
  console.log(`Sandbox created: ${sandboxId}`);
});

sandboxManager.on('started', () => {
  console.log('Sandbox started');
});

sandboxManager.on('stopped', () => {
  console.log('Sandbox stopped');
});
```

---

**Next**: See [Examples](./examples.md) for practical usage patterns.
