# V8 Inspector Protocol Research

Comprehensive research for implementing real debugger breakpoints in Reflexive.

## Table of Contents

1. [V8 Inspector Protocol Basics](#1-v8-inspector-protocol-basics)
2. [Setting Breakpoints Programmatically](#2-setting-breakpoints-programmatically)
3. [Node.js Inspector APIs](#3-nodejs-inspector-apis)
4. [Practical Implementation for Reflexive](#4-practical-implementation-for-reflexive)
5. [NPM Packages and Alternatives](#5-npm-packages-and-alternatives)
6. [Security Considerations](#6-security-considerations)
7. [Complete Code Examples](#7-complete-code-examples)

---

## 1. V8 Inspector Protocol Basics

### What is the V8 Inspector?

The V8 Inspector is a debugging protocol built into V8 (and thus Node.js) that allows external tools to:
- Set breakpoints and step through code
- Inspect variables and call stacks
- Profile CPU and memory usage
- Execute arbitrary JavaScript in the runtime context

It uses the **Chrome DevTools Protocol (CDP)** - the same protocol Chrome uses for its DevTools.

### How Chrome DevTools Connects to Node.js

When you start Node.js with the `--inspect` flag:

```bash
node --inspect app.js
# Output: Debugger listening on ws://127.0.0.1:9229/uuid-here
```

Node.js:
1. Opens a WebSocket server on port 9229 (default)
2. Exposes HTTP endpoints for discovery
3. Accepts CDP commands over the WebSocket connection

Chrome DevTools (or any CDP client) can then:
1. Discover targets via `http://localhost:9229/json/list`
2. Connect to the WebSocket URL
3. Send JSON-RPC commands and receive events

### The `--inspect` Flag Variants

| Flag | Behavior |
|------|----------|
| `--inspect` | Enable inspector, continue execution immediately |
| `--inspect-brk` | Enable inspector, pause on first line (wait for debugger) |
| `--inspect=host:port` | Specify custom host/port |
| `--inspect-brk=0` | Use random available port |

### Discovery Endpoints

When inspector is active, these HTTP endpoints are available:

```bash
# List all debuggable targets
curl http://localhost:9229/json/list

# Get version and WebSocket URL
curl http://localhost:9229/json/version

# Protocol schema
curl http://localhost:9229/json/protocol
```

Example response from `/json/list`:
```json
[{
  "description": "node.js instance",
  "devtoolsFrontendUrl": "devtools://devtools/bundled/...",
  "id": "uuid-here",
  "title": "app.js",
  "type": "node",
  "url": "file:///path/to/app.js",
  "webSocketDebuggerUrl": "ws://127.0.0.1:9229/uuid-here"
}]
```

---

## 2. Setting Breakpoints Programmatically

### CDP Debugger Domain

The Chrome DevTools Protocol's `Debugger` domain provides breakpoint functionality.

### Key Methods for Breakpoints

#### `Debugger.enable`
Must be called first to enable debugging capabilities.

```javascript
session.post('Debugger.enable');
```

#### `Debugger.setBreakpointByUrl`
Set breakpoint by file URL (preferred for most cases).

```javascript
session.post('Debugger.setBreakpointByUrl', {
  lineNumber: 10,          // 0-based line number
  url: 'file:///path/to/app.js',  // or use urlRegex
  columnNumber: 0,         // optional, 0-based
  condition: 'x > 5'       // optional conditional expression
});
```

**Advantages:**
- Can set breakpoints BEFORE scripts load
- Survives page reloads
- Uses file paths (more intuitive)

#### `Debugger.setBreakpoint`
Set breakpoint by script ID (for already-loaded scripts).

```javascript
session.post('Debugger.setBreakpoint', {
  location: {
    scriptId: '104',       // from Debugger.scriptParsed event
    lineNumber: 10,
    columnNumber: 0
  },
  condition: 'x > 5'
});
```

**Use when:**
- You already have the scriptId from `Debugger.scriptParsed`
- Targeting a specific instance of a script

#### `Debugger.setBreakpointsActive`
Enable/disable all breakpoints globally.

```javascript
session.post('Debugger.setBreakpointsActive', { active: false });
```

#### `Debugger.removeBreakpoint`
Remove a breakpoint by ID.

```javascript
session.post('Debugger.removeBreakpoint', {
  breakpointId: 'file:///path/to/app.js:10:0'
});
```

### Execution Control

#### `Debugger.pause`
Pause execution immediately.

```javascript
session.post('Debugger.pause');
```

#### `Debugger.resume`
Resume execution after pause.

```javascript
session.post('Debugger.resume');
```

#### `Debugger.stepOver` / `Debugger.stepInto` / `Debugger.stepOut`
Step through code.

```javascript
session.post('Debugger.stepOver');
session.post('Debugger.stepInto');
session.post('Debugger.stepOut');
```

### Key Events

#### `Debugger.paused`
Fired when execution pauses (breakpoint hit, exception, etc.).

```javascript
session.on('Debugger.paused', (message) => {
  const { callFrames, reason, hitBreakpoints } = message.params;
  console.log('Paused:', reason);
  console.log('At breakpoints:', hitBreakpoints);
  console.log('Call stack:', callFrames);
});
```

The `reason` field indicates why we paused:
- `breakpoint` - Hit a breakpoint
- `exception` - Exception thrown
- `step` - Step operation completed
- `debugCommand` - `debugger` statement
- `other` - Other reasons

#### `Debugger.scriptParsed`
Fired when a new script is loaded.

```javascript
session.on('Debugger.scriptParsed', (message) => {
  const { scriptId, url, startLine, endLine } = message.params;
  // Can now use scriptId for Debugger.setBreakpoint
});
```

#### `Debugger.breakpointResolved`
Fired when a breakpoint is resolved to an actual location.

```javascript
session.on('Debugger.breakpointResolved', (message) => {
  const { breakpointId, location } = message.params;
});
```

### Exception Handling

#### `Debugger.setPauseOnExceptions`
Control exception behavior.

```javascript
session.post('Debugger.setPauseOnExceptions', {
  state: 'all'  // 'none', 'uncaught', or 'all'
});
```

---

## 3. Node.js Inspector APIs

Node.js provides the `node:inspector` module for programmatic access.

### Basic Usage

```javascript
import * as inspector from 'node:inspector';
// Or with promises:
import { Session } from 'node:inspector/promises';
```

### Opening the Inspector

#### `inspector.open([port], [host], [wait])`
Programmatically enable the inspector.

```javascript
import * as inspector from 'node:inspector';

// Open on default port (9229)
inspector.open();

// Open on custom port
inspector.open(9230);

// Open and wait for debugger to attach
inspector.open(9229, '127.0.0.1', true);
```

#### `inspector.url()`
Get the WebSocket URL for the inspector.

```javascript
const wsUrl = inspector.url();
// Returns: ws://127.0.0.1:9229/uuid-here
// Or undefined if inspector not active
```

#### `inspector.waitForDebugger()`
Block until a debugger connects.

```javascript
inspector.open();
console.log('Debugger URL:', inspector.url());
inspector.waitForDebugger();  // Blocks here
console.log('Debugger connected!');
```

#### `inspector.close()`
Deactivate the inspector.

```javascript
inspector.close();
```

### Inspector Session

The `Session` class is the primary interface for CDP commands.

```javascript
import { Session } from 'node:inspector/promises';

const session = new Session();
session.connect();  // Connect to current process

// Send CDP commands
await session.post('Debugger.enable');

// Clean up
session.disconnect();
```

### Session Connection Modes

#### `session.connect()`
Connect to the **current process** (same thread).

```javascript
const session = new Session();
session.connect();
```

**Warning:** Setting breakpoints with `session.connect()` will pause the debugger itself since it's running in the same thread.

#### `session.connectToMainThread()`
From a worker thread, connect to the **main thread**.

```javascript
// Inside a Worker
import { Session } from 'node:inspector/promises';
import { isMainThread } from 'node:worker_threads';

if (!isMainThread) {
  const session = new Session();
  session.connectToMainThread();
  // Now can debug main thread from worker
}
```

**Warning:** Can cause deadlocks if the worker suspends itself.

### Callback vs Promise API

Node.js offers both callback and promise-based APIs:

```javascript
// Callback API
import inspector from 'node:inspector';
const session = new inspector.Session();
session.connect();
session.post('Runtime.evaluate', { expression: '2 + 2' }, (err, result) => {
  console.log(result);  // { result: { type: 'number', value: 4 } }
});

// Promise API (recommended)
import { Session } from 'node:inspector/promises';
const session = new Session();
session.connect();
const result = await session.post('Runtime.evaluate', { expression: '2 + 2' });
console.log(result);
```

---

## 4. Practical Implementation for Reflexive

### Architecture Options

#### Option A: Library Mode (Embedded Agent)

When Reflexive runs inside the target app, use the inspector module directly:

```javascript
// reflexive.js - Library mode debugger support
import * as inspector from 'node:inspector';
import { Session } from 'node:inspector/promises';

class ReflexiveDebugger {
  constructor() {
    this.session = null;
    this.breakpoints = new Map();
  }

  async enable() {
    // Open inspector if not already open
    if (!inspector.url()) {
      inspector.open(0);  // Use random port
    }

    this.session = new Session();
    this.session.connect();

    await this.session.post('Debugger.enable');

    // Listen for pause events
    this.session.on('Debugger.paused', (msg) => {
      this.handlePause(msg.params);
    });

    return inspector.url();
  }

  async setBreakpoint(file, line, condition) {
    const result = await this.session.post('Debugger.setBreakpointByUrl', {
      lineNumber: line - 1,  // Convert to 0-based
      url: `file://${file}`,
      condition: condition || ''
    });

    this.breakpoints.set(result.breakpointId, { file, line, condition });
    return result.breakpointId;
  }

  async removeBreakpoint(breakpointId) {
    await this.session.post('Debugger.removeBreakpoint', { breakpointId });
    this.breakpoints.delete(breakpointId);
  }

  handlePause(params) {
    const { callFrames, reason, hitBreakpoints } = params;
    // Emit event or call callback with pause info
    console.log(`Paused: ${reason} at ${hitBreakpoints?.join(', ')}`);
  }

  async resume() {
    await this.session.post('Debugger.resume');
  }

  async stepOver() {
    await this.session.post('Debugger.stepOver');
  }
}
```

**Limitation:** In library mode, the debugger runs in the same thread as the target code. When a breakpoint hits, the entire process pauses - including Reflexive's chat interface.

#### Option B: CLI Mode (External Process)

When Reflexive spawns the target process, connect via WebSocket:

```javascript
// reflexive.js - CLI mode debugger support
import WebSocket from 'ws';

class RemoteDebugger {
  constructor() {
    this.ws = null;
    this.messageId = 0;
    this.pending = new Map();
    this.eventHandlers = new Map();
  }

  async connect(wsUrl) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        resolve();
      });

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data);

        if (msg.id !== undefined) {
          // Response to a command
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);

          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        } else if (msg.method) {
          // Event notification
          const handler = this.eventHandlers.get(msg.method);
          if (handler) {
            handler(msg.params);
          }
        }
      });

      this.ws.on('error', reject);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pending.set(id, { resolve, reject });

      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, handler) {
    this.eventHandlers.set(event, handler);
  }

  async enable() {
    await this.send('Debugger.enable');
    await this.send('Runtime.enable');
  }

  async setBreakpoint(file, line, condition) {
    return await this.send('Debugger.setBreakpointByUrl', {
      lineNumber: line - 1,
      url: `file://${file}`,
      condition: condition || ''
    });
  }
}
```

### Attaching to a Running Process

#### Method 1: Start with `--inspect`

The simplest approach - start the target with inspector enabled:

```javascript
// In ProcessManager class
spawnChild(script, args) {
  const child = spawn('node', [
    '--inspect=0',  // Random port
    script,
    ...args
  ]);

  // Parse inspector URL from stderr
  child.stderr.on('data', (data) => {
    const match = data.toString().match(/ws:\/\/[\d.]+:\d+\/[\w-]+/);
    if (match) {
      this.inspectorUrl = match[0];
      this.emit('inspector-ready', this.inspectorUrl);
    }
  });
}
```

#### Method 2: Enable Inspector on Running Process (Unix)

Send SIGUSR1 to enable inspector on a process started without `--inspect`:

```javascript
import { spawn } from 'child_process';

// Enable inspector on running process (Unix only)
function enableInspector(pid) {
  process.kill(pid, 'SIGUSR1');
  // Process will start listening on default port 9229
}
```

#### Method 3: Enable Inspector on Running Process (Windows)

Use `process._debugProcess(pid)` from another Node.js process:

```javascript
// Windows only - run in a separate process
process._debugProcess(targetPid);
```

#### Method 4: Programmatic Enable (if you control the target)

If the target app uses Reflexive library mode:

```javascript
import * as inspector from 'node:inspector';

// Can be called at any time
export function enableDebugging() {
  if (!inspector.url()) {
    inspector.open(0, '127.0.0.1');
    return inspector.url();
  }
  return inspector.url();
}
```

### Handling the Pause Problem

When a breakpoint hits in library mode, the event loop stops. Solutions:

#### Solution 1: Worker Thread Debugger

Run the debugger logic in a worker thread:

```javascript
// main.js
import { Worker } from 'worker_threads';

const debuggerWorker = new Worker('./debugger-worker.js');

debuggerWorker.on('message', (msg) => {
  if (msg.type === 'paused') {
    // Breakpoint hit - but we can still handle this message
    // because the worker is in a different thread
  }
});

// debugger-worker.js
import { parentPort } from 'worker_threads';
import { Session } from 'node:inspector/promises';

const session = new Session();
session.connectToMainThread();

await session.post('Debugger.enable');

session.on('Debugger.paused', (msg) => {
  parentPort.postMessage({ type: 'paused', data: msg.params });
});
```

#### Solution 2: Separate Debugger Process

Run the debugger UI in a separate process that connects via WebSocket:

```
[Target Process]  <--WebSocket-->  [Reflexive Debugger Process]
   (paused)                           (still running)
```

#### Solution 3: Use `--inspect-brk` + Lazy Connection

Start paused, connect, set breakpoints, then resume:

```javascript
const child = spawn('node', ['--inspect-brk=0', 'app.js']);

// Wait for inspector URL
child.stderr.once('data', async (data) => {
  const url = parseInspectorUrl(data);

  const debugger = new RemoteDebugger();
  await debugger.connect(url);
  await debugger.enable();

  // Set initial breakpoints
  await debugger.setBreakpoint('/path/to/app.js', 15);

  // Now resume from initial pause
  await debugger.send('Debugger.resume');
});
```

---

## 5. NPM Packages and Alternatives

### chrome-remote-interface

The most popular CDP client for Node.js.

```bash
npm install chrome-remote-interface
```

```javascript
import CDP from 'chrome-remote-interface';

// Connect to Node.js inspector
const client = await CDP({ port: 9229 });

const { Debugger, Runtime } = client;

await Debugger.enable();

Debugger.paused((params) => {
  console.log('Paused:', params);
});

await Debugger.setBreakpointByUrl({
  lineNumber: 10,
  url: 'file:///path/to/app.js'
});

await Runtime.runIfWaitingForDebugger();
```

**Pros:**
- Full CDP support
- Well-maintained
- TypeScript definitions available

**Cons:**
- Additional dependency (~50KB)

### ws (WebSocket)

If you want minimal dependencies, use `ws` directly:

```bash
npm install ws
```

Then implement the CDP protocol yourself (see Section 4).

### ndb

Google's enhanced Node.js debugger using Chrome DevTools.

```bash
npm install -g ndb
ndb node app.js
```

**How it works:**
- Bundles Puppeteer (which includes Chromium)
- Uses CDP to communicate with Node.js
- Provides Chrome DevTools UI

**Relevance to Reflexive:**
- Shows that CDP is the right approach
- Demonstrates worker thread debugging
- Shows file editing via DevTools is possible

### Built-in Node.js Debugger

Node.js includes a simple CLI debugger:

```bash
node inspect app.js
```

Commands:
- `cont`, `c` - Continue
- `next`, `n` - Step over
- `step`, `s` - Step into
- `out`, `o` - Step out
- `setBreakpoint('file.js', line)`, `sb()` - Set breakpoint
- `clearBreakpoint()`, `cb()` - Clear breakpoint
- `repl` - Enter REPL

**Limitation:** CLI only, not suitable for programmatic use.

---

## 6. Security Considerations

### The Inspector is Dangerous

The V8 inspector provides **full access** to the Node.js execution environment:

- Execute arbitrary JavaScript
- Read/write any variable
- Access file system (if the app can)
- Make network requests
- Access environment variables and secrets

### Security Best Practices

#### 1. Bind to Localhost Only

```bash
node --inspect=127.0.0.1:9229 app.js  # Good
node --inspect=0.0.0.0:9229 app.js    # DANGEROUS
```

#### 2. Use Random Ports

```bash
node --inspect=0 app.js  # Uses random available port
```

#### 3. Require Authentication (Future)

Node.js is working on inspector authentication, but it's not yet available.

#### 4. Use Firewall Rules

Block external access to inspector ports.

#### 5. Don't Enable in Production

```javascript
if (process.env.NODE_ENV !== 'production') {
  inspector.open();
}
```

### Implications for Reflexive

Reflexive should:
- Only bind inspector to localhost
- Use random ports when possible
- Warn users about security implications
- Consider authentication tokens for WebSocket connections
- Never expose inspector port in production by default

---

## 7. Complete Code Examples

### Example 1: Simple Breakpoint Setting

```javascript
// simple-breakpoint.js
import { Session } from 'node:inspector/promises';
import * as inspector from 'node:inspector';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);

// Open inspector
inspector.open(0);
console.log('Inspector URL:', inspector.url());

// Create session
const session = new Session();
session.connect();

// Enable debugger
await session.post('Debugger.enable');

// Listen for pause events
session.on('Debugger.paused', (message) => {
  console.log('\n=== PAUSED ===');
  console.log('Reason:', message.params.reason);
  console.log('Hit breakpoints:', message.params.hitBreakpoints);

  // Examine the call stack
  for (const frame of message.params.callFrames) {
    console.log(`  at ${frame.functionName || '(anonymous)'} (${frame.url}:${frame.location.lineNumber + 1})`);
  }

  // Resume after inspection
  setTimeout(() => {
    session.post('Debugger.resume');
  }, 1000);
});

// Set a breakpoint on line 50 of this file
const result = await session.post('Debugger.setBreakpointByUrl', {
  lineNumber: 49,  // 0-based, so this is line 50
  url: `file://${__filename}`
});

console.log('Breakpoint set:', result.breakpointId);

// This is line 50 - breakpoint will hit here
console.log('This line has a breakpoint');

console.log('Script completed');
session.disconnect();
```

### Example 2: Remote Debugger Client

```javascript
// remote-debugger.js
import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class RemoteDebugger extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.messageId = 0;
    this.pending = new Map();
    this.scripts = new Map();
  }

  async connect(wsUrl) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', resolve);
      this.ws.on('error', reject);

      this.ws.on('message', (data) => {
        this._handleMessage(JSON.parse(data));
      });

      this.ws.on('close', () => {
        this.emit('disconnected');
      });
    });
  }

  _handleMessage(msg) {
    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (msg.method) {
      this.emit(msg.method, msg.params);
    }
  }

  async send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async enable() {
    // Enable required domains
    await this.send('Debugger.enable');
    await this.send('Runtime.enable');

    // Track loaded scripts
    this.on('Debugger.scriptParsed', (params) => {
      this.scripts.set(params.scriptId, params);
    });
  }

  async setBreakpoint(file, line, condition) {
    return await this.send('Debugger.setBreakpointByUrl', {
      lineNumber: line - 1,  // Convert to 0-based
      url: file.startsWith('file://') ? file : `file://${file}`,
      condition: condition || ''
    });
  }

  async removeBreakpoint(breakpointId) {
    return await this.send('Debugger.removeBreakpoint', { breakpointId });
  }

  async resume() {
    return await this.send('Debugger.resume');
  }

  async stepOver() {
    return await this.send('Debugger.stepOver');
  }

  async stepInto() {
    return await this.send('Debugger.stepInto');
  }

  async stepOut() {
    return await this.send('Debugger.stepOut');
  }

  async pause() {
    return await this.send('Debugger.pause');
  }

  async evaluate(expression, callFrameId) {
    if (callFrameId) {
      return await this.send('Debugger.evaluateOnCallFrame', {
        callFrameId,
        expression
      });
    } else {
      return await this.send('Runtime.evaluate', { expression });
    }
  }

  async getScopes(callFrameId) {
    // Scopes are included in the callFrame from Debugger.paused
    return null;  // Use data from paused event instead
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Usage example
async function main() {
  const debugger_ = new RemoteDebugger();

  // Connect to a Node.js process running with --inspect
  await debugger_.connect('ws://127.0.0.1:9229/uuid-here');
  await debugger_.enable();

  // Handle pause events
  debugger_.on('Debugger.paused', async (params) => {
    console.log('Paused:', params.reason);

    // Get local variables from first scope
    const frame = params.callFrames[0];
    for (const scope of frame.scopeChain) {
      if (scope.type === 'local') {
        const properties = await debugger_.send('Runtime.getProperties', {
          objectId: scope.object.objectId
        });
        console.log('Local variables:', properties.result);
      }
    }

    // Resume after 2 seconds
    setTimeout(() => debugger_.resume(), 2000);
  });

  // Set a breakpoint
  const bp = await debugger_.setBreakpoint('/path/to/app.js', 10);
  console.log('Breakpoint set:', bp.breakpointId);
}
```

### Example 3: Process Launcher with Debug Support

```javascript
// debug-launcher.js
import { spawn } from 'child_process';
import { RemoteDebugger } from './remote-debugger.js';

export class DebugLauncher {
  constructor() {
    this.child = null;
    this.debugger = null;
    this.inspectorUrl = null;
  }

  async launch(script, args = [], options = {}) {
    const {
      pauseOnStart = false,
      port = 0  // Random port
    } = options;

    const inspectFlag = pauseOnStart
      ? `--inspect-brk=${port}`
      : `--inspect=${port}`;

    this.child = spawn('node', [inspectFlag, script, ...args], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Capture inspector URL from stderr
    this.inspectorUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for inspector URL'));
      }, 5000);

      this.child.stderr.on('data', (data) => {
        const output = data.toString();
        const match = output.match(/ws:\/\/[\d.]+:\d+\/[\w-]+/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      });

      this.child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Connect debugger
    this.debugger = new RemoteDebugger();
    await this.debugger.connect(this.inspectorUrl);
    await this.debugger.enable();

    return {
      inspectorUrl: this.inspectorUrl,
      debugger: this.debugger,
      child: this.child
    };
  }

  async stop() {
    if (this.debugger) {
      this.debugger.disconnect();
    }
    if (this.child) {
      this.child.kill();
    }
  }
}

// Usage
async function main() {
  const launcher = new DebugLauncher();

  const { debugger: dbg } = await launcher.launch('./app.js', [], {
    pauseOnStart: true
  });

  // Set breakpoints before any code runs
  await dbg.setBreakpoint('./app.js', 15);
  await dbg.setBreakpoint('./app.js', 20, 'count > 5');

  // Handle pause events
  dbg.on('Debugger.paused', (params) => {
    console.log('Hit breakpoint at line',
      params.callFrames[0].location.lineNumber + 1);
  });

  // Resume from initial pause
  await dbg.resume();
}
```

### Example 4: MCP Tool for Reflexive

```javascript
// breakpoint-tools.js
import { z } from 'zod';

export function createBreakpointTools(debugger_) {
  return {
    set_breakpoint: {
      description: 'Set a debugger breakpoint at a specific file and line',
      inputSchema: z.object({
        file: z.string().describe('Absolute path to the file'),
        line: z.number().describe('Line number (1-based)'),
        condition: z.string().optional().describe('Optional condition expression')
      }),
      handler: async ({ file, line, condition }) => {
        try {
          const result = await debugger_.setBreakpoint(file, line, condition);
          return {
            success: true,
            breakpointId: result.breakpointId,
            locations: result.locations
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
    },

    remove_breakpoint: {
      description: 'Remove a debugger breakpoint',
      inputSchema: z.object({
        breakpointId: z.string().describe('The breakpoint ID to remove')
      }),
      handler: async ({ breakpointId }) => {
        try {
          await debugger_.removeBreakpoint(breakpointId);
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
    },

    list_breakpoints: {
      description: 'List all active breakpoints',
      inputSchema: z.object({}),
      handler: async () => {
        // Note: CDP doesn't have a list breakpoints command
        // We need to track them ourselves
        return {
          breakpoints: Array.from(debugger_.breakpoints.entries())
        };
      }
    },

    debug_resume: {
      description: 'Resume execution after hitting a breakpoint',
      inputSchema: z.object({}),
      handler: async () => {
        try {
          await debugger_.resume();
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
    },

    debug_step_over: {
      description: 'Step over the current line',
      inputSchema: z.object({}),
      handler: async () => {
        try {
          await debugger_.stepOver();
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
    },

    debug_evaluate: {
      description: 'Evaluate an expression in the current debug context',
      inputSchema: z.object({
        expression: z.string().describe('JavaScript expression to evaluate')
      }),
      handler: async ({ expression }) => {
        try {
          const result = await debugger_.evaluate(expression);
          return {
            success: true,
            result: result.result
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
    }
  };
}
```

---

## Summary: Implementation Recommendations for Reflexive

### For CLI Mode (Recommended Approach)

1. **Start target with `--inspect-brk=0`** - Pauses on first line, uses random port
2. **Parse WebSocket URL from stderr** - Extract `ws://...` URL
3. **Connect via WebSocket** - Use `ws` package or `chrome-remote-interface`
4. **Set breakpoints before resuming** - Use `Debugger.setBreakpointByUrl`
5. **Handle pause events** - Capture call stack, scope variables
6. **Expose as MCP tools** - `set_breakpoint`, `remove_breakpoint`, `resume`, `step_over`, etc.

### For Library Mode (Limited)

1. **Use separate worker thread** - Debugger worker connects to main thread
2. **Accept that pause freezes the app** - Including the chat interface
3. **Consider hybrid approach** - Use library mode for observation, CLI mode for debugging

### Key Takeaways

1. **CDP is the right protocol** - Same as Chrome DevTools uses
2. **`Debugger.setBreakpointByUrl` is the key method** - Works before scripts load
3. **Remote debugging is more practical** - Separate processes avoid pause issues
4. **Security is critical** - Never expose inspector to network
5. **No build-in breakpoint listing** - Must track breakpoints manually

---

## References

- [Node.js Inspector Documentation](https://nodejs.org/api/inspector.html)
- [Node.js Debugger Documentation](https://nodejs.org/api/debugger.html)
- [Chrome DevTools Protocol - Debugger Domain](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/)
- [Chrome DevTools Protocol - V8 Version](https://chromedevtools.github.io/devtools-protocol/v8/)
- [chrome-remote-interface GitHub](https://github.com/cyrus-and/chrome-remote-interface)
- [ndb GitHub (GoogleChromeLabs)](https://github.com/GoogleChromeLabs/ndb)
- [Node.js Debugging Guide](https://nodejs.org/en/learn/getting-started/debugging)
