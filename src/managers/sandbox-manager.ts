/**
 * SandboxManager - Manages Vercel Sandbox instances for sandbox mode
 *
 * This class wraps the @vercel/sandbox API to provide:
 * - Sandbox lifecycle (create, start, stop, restart)
 * - File operations (upload, read, write, list)
 * - Command execution
 * - Log polling from /tmp/reflexive-logs.jsonl
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  LogEntry,
  SandboxConfig,
  SandboxFile,
  CommandResult,
  SandboxLogEntry,
  EventHandler,
} from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path where the inject script writes logs inside the sandbox
const SANDBOX_LOG_PATH = '/tmp/reflexive-logs.jsonl';

// Path to inject script relative to this module
const INJECT_SCRIPT_PATH = resolve(__dirname, '..', 'sandbox', 'inject.ts');

export interface SandboxManagerOptions {
  vcpus?: number;
  memory?: number;
  timeout?: string | number;
  runtime?: 'node22' | 'node20';
}

export interface SandboxState {
  isCreated: boolean;
  isRunning: boolean;
  startedAt: number | null;
  entry: string | null;
  entryArgs: string[];
  customState: Record<string, unknown>;
}

/**
 * Interface for sandbox instance (from @vercel/sandbox)
 * This is a simplified interface that matches the parts of the API we use
 * We only use non-detached commands, so the result is always CommandFinished
 */
interface VercelSandbox {
  sandboxId: string;
  writeFiles(files: { path: string; content: Buffer }[], opts?: { signal?: AbortSignal }): Promise<void>;
  readFileToBuffer(file: { path: string; cwd?: string }, opts?: { signal?: AbortSignal }): Promise<Buffer | null>;
  runCommand(cmd: string, args?: string[], opts?: { signal?: AbortSignal }): Promise<CommandFinished>;
  runCommand(params: { cmd: string; args?: string[]; cwd?: string; env?: Record<string, string> }): Promise<CommandFinished>;
  shutdown?(): Promise<void>;
}

/**
 * CommandFinished result from @vercel/sandbox
 * Note: stdout() and stderr() are methods that return promises
 */
interface CommandFinished {
  exitCode: number;
  stdout(opts?: { signal?: AbortSignal }): Promise<string>;
  stderr(opts?: { signal?: AbortSignal }): Promise<string>;
}

/**
 * SandboxManager provides control over a single Vercel Sandbox instance
 */
export class SandboxManager {
  private options: SandboxManagerOptions;
  private sandbox: VercelSandbox | null = null;
  private _isCreated = false;
  private _isRunning = false;
  private startedAt: number | null = null;
  private entry: string | null = null;
  private entryArgs: string[] = [];
  private logs: LogEntry[] = [];
  private maxLogs = 500;
  private customState: Record<string, unknown> = {};
  private eventHandlers = new Map<string, EventHandler[]>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastLogPosition = 0;

  // Track if @vercel/sandbox is available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sandboxModule: { Sandbox: { create: (opts?: any) => Promise<VercelSandbox> } } | null = null;

  constructor(options: SandboxManagerOptions = {}) {
    this.options = {
      vcpus: options.vcpus || 2,
      memory: options.memory || 2048,
      timeout: options.timeout || '30m',
      runtime: options.runtime || 'node22',
    };
  }

  /**
   * Subscribe to an event
   */
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * Unsubscribe from an event
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event to all subscribers
   */
  emit(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach(h => {
      try {
        h(data);
      } catch {
        // Don't let handler errors break the emit loop
      }
    });
  }

  /**
   * Load the @vercel/sandbox module dynamically
   */
  private async loadSandboxModule(): Promise<void> {
    if (this.sandboxModule) return;

    try {
      // Dynamic import to handle optional dependency
      this.sandboxModule = await import('@vercel/sandbox');
    } catch (err) {
      throw new Error(
        '@vercel/sandbox is not installed. Install it with: npm install @vercel/sandbox'
      );
    }
  }

  /**
   * Create a new sandbox instance
   */
  async create(): Promise<void> {
    if (this._isCreated) {
      throw new Error('Sandbox already created. Call destroy() first.');
    }

    await this.loadSandboxModule();

    const createOptions = {
      vcpus: this.options.vcpus,
      memory: this.options.memory,
      timeout: this.options.timeout,
    };

    this.sandbox = await this.sandboxModule!.Sandbox.create(createOptions);
    this._isCreated = true;
    this._log('system', `Sandbox created: ${this.sandbox.sandboxId}`);
    this.emit('created', { sandboxId: this.sandbox.sandboxId });
  }

  /**
   * Start the application in the sandbox
   */
  async start(entryFile: string, args: string[] = []): Promise<void> {
    if (!this._isCreated || !this.sandbox) {
      throw new Error('Sandbox not created. Call create() first.');
    }

    if (this._isRunning) {
      throw new Error('Sandbox is already running. Call stop() first.');
    }

    this.entry = entryFile;
    this.entryArgs = args;

    // Upload the inject script
    await this.uploadInjectScript();

    // Start the app with the inject script preloaded
    const nodeArgs = [
      '--require',
      '/app/sandbox-inject.js',
      entryFile,
      ...args,
    ];

    // Run in background (the command will keep running)
    // Note: We don't await because the app runs continuously
    this.sandbox.runCommand({
      cmd: 'node',
      args: nodeArgs,
    }).then(async result => {
      // App exited
      this._isRunning = false;
      const stdout = await result.stdout();
      const stderr = await result.stderr();
      this._log('system', `App exited with code ${result.exitCode}`);
      this.emit('exit', { exitCode: result.exitCode, stdout, stderr });
    }).catch(err => {
      this._isRunning = false;
      this._log('error', `App error: ${err.message}`);
      this.emit('error', { error: err });
    });

    this._isRunning = true;
    this.startedAt = Date.now();
    this._log('system', `Started: node ${nodeArgs.join(' ')}`);
    this.emit('started', { entry: entryFile, args });

    // Start polling for logs
    this.startLogPolling();
  }

  /**
   * Stop the running application
   */
  async stop(): Promise<void> {
    if (!this._isRunning) return;

    this.stopLogPolling();

    if (this.sandbox && this.sandbox.shutdown) {
      await this.sandbox.shutdown();
    }

    this._isRunning = false;
    this._log('system', 'Sandbox stopped');
    this.emit('stopped', {});
  }

  /**
   * Restart the application
   */
  async restart(): Promise<void> {
    if (!this.entry) {
      throw new Error('No entry file set. Call start() first.');
    }

    this._log('system', 'Restarting...');
    await this.stop();

    // Re-create sandbox for clean state
    await this.destroy();
    await this.create();

    await this.start(this.entry, this.entryArgs);
  }

  /**
   * Destroy the sandbox instance
   */
  async destroy(): Promise<void> {
    this.stopLogPolling();

    if (this.sandbox) {
      if (this.sandbox.shutdown) {
        await this.sandbox.shutdown();
      }
      this.sandbox = null;
    }

    this._isCreated = false;
    this._isRunning = false;
    this.startedAt = null;
    this.lastLogPosition = 0;
    this._log('system', 'Sandbox destroyed');
    this.emit('destroyed', {});
  }

  /**
   * Upload the inject script to the sandbox
   */
  private async uploadInjectScript(): Promise<void> {
    if (!this.sandbox) return;

    // Read the compiled inject script
    // In production this would be the compiled JS from dist/
    // For now we generate a simplified version inline
    const injectScript = this.generateInjectScript();

    await this.sandbox.writeFiles([
      {
        path: '/app/sandbox-inject.js',
        content: Buffer.from(injectScript),
      },
    ]);

    this._log('system', 'Inject script uploaded');
  }

  /**
   * Generate the inject script content (CommonJS version for require())
   */
  private generateInjectScript(): string {
    return `
/**
 * Reflexive Sandbox Inject Script
 * This runs inside the Vercel Sandbox to capture logs and state.
 */

const fs = require('fs');
const LOG_FILE_PATH = '/tmp/reflexive-logs.jsonl';

// Track custom state
const customState = {};

// Store original console methods
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

function writeLogEntry(entry) {
  try {
    const line = JSON.stringify(entry) + '\\n';
    fs.appendFileSync(LOG_FILE_PATH, line);
  } catch (e) {
    // Ignore write errors
  }
}

function log(level, message, meta) {
  writeLogEntry({
    type: 'log',
    data: { level, message, ...meta },
    ts: Date.now(),
  });
}

// Intercept console methods
console.log = (...args) => {
  log('info', args.map(String).join(' '));
  originalConsole.log(...args);
};

console.info = (...args) => {
  log('info', args.map(String).join(' '));
  originalConsole.info(...args);
};

console.warn = (...args) => {
  log('warn', args.map(String).join(' '));
  originalConsole.warn(...args);
};

console.error = (...args) => {
  log('error', args.map(String).join(' '));
  originalConsole.error(...args);
};

console.debug = (...args) => {
  log('debug', args.map(String).join(' '));
  originalConsole.debug(...args);
};

// Capture errors
process.on('uncaughtException', (err) => {
  writeLogEntry({
    type: 'error',
    data: {
      errorType: 'uncaughtException',
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
    ts: Date.now(),
  });
  originalConsole.error('\\n' + err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const err = reason || {};
  writeLogEntry({
    type: 'error',
    data: {
      errorType: 'unhandledRejection',
      name: err.name,
      message: err.message || String(reason),
      stack: err.stack,
    },
    ts: Date.now(),
  });
});

// Create process.reflexive API
process.reflexive = {
  setState(key, value) {
    customState[key] = value;
    writeLogEntry({
      type: 'state',
      data: { key, value },
      ts: Date.now(),
    });
  },

  getState(key) {
    return key ? customState[key] : { ...customState };
  },

  log(level, message, meta) {
    log(level, message, meta);
  },

  emit(event, data) {
    writeLogEntry({
      type: 'event',
      data: { event, payload: data },
      ts: Date.now(),
    });
  },
};

// Clear log file and write ready message
try {
  fs.writeFileSync(LOG_FILE_PATH, '');
} catch (e) {}

writeLogEntry({
  type: 'ready',
  data: {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
  },
  ts: Date.now(),
});

module.exports = process.reflexive;
`;
  }

  /**
   * Start polling for logs from the sandbox
   */
  private startLogPolling(): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(() => {
      this.pollLogs().catch(err => {
        // Polling errors are expected when sandbox is stopping
        if (this._isRunning) {
          this._log('error', `Log poll error: ${err.message}`);
        }
      });
    }, 1000); // Poll every second
  }

  /**
   * Stop polling for logs
   */
  private stopLogPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Poll logs from the sandbox log file
   */
  async pollLogs(): Promise<void> {
    if (!this.sandbox || !this._isRunning) return;

    try {
      // Read the log file
      const result = await this.sandbox.runCommand({
        cmd: 'cat',
        args: [SANDBOX_LOG_PATH],
      });

      if (result.exitCode !== 0) {
        return; // File doesn't exist yet
      }

      const content = await result.stdout();
      const lines = content.split('\n').filter(line => line.trim());

      // Process only new lines
      for (let i = this.lastLogPosition; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]) as SandboxLogEntry;
          this.processLogEntry(entry);
        } catch {
          // Skip malformed log entries
        }
      }

      this.lastLogPosition = lines.length;
    } catch (err) {
      // Ignore polling errors when sandbox is not running
    }
  }

  /**
   * Process a log entry from the sandbox
   */
  private processLogEntry(entry: SandboxLogEntry): void {
    const { type, data, ts } = entry;
    const timestamp = new Date(ts).toISOString();

    switch (type) {
      case 'ready':
        this._log('system', `[inject] Ready - pid: ${data.pid}, node: ${data.nodeVersion}`);
        this.emit('injectionReady', data);
        break;

      case 'log': {
        const level = (data.level as string) || 'info';
        this._log(`inject:${level}`, data.message as string);
        this.emit('log', { level, message: data.message, timestamp });
        break;
      }

      case 'error':
        this._log('inject:error', `[${data.errorType}] ${data.name}: ${data.message}`);
        if (data.stack) {
          this._log('inject:error', data.stack as string);
        }
        this.emit('error', data);
        break;

      case 'state':
        this.customState[data.key as string] = data.value;
        this._log('inject:state', `State: ${data.key} = ${JSON.stringify(data.value)}`);
        this.emit('stateChange', { key: data.key, value: data.value });
        break;

      case 'event':
        this._log('inject:event', `Event: ${data.event} - ${JSON.stringify(data.payload)}`);
        this.emit('customEvent', { event: data.event, data: data.payload });
        break;

      default:
        this._log('inject:unknown', `Unknown log type: ${type}`);
    }
  }

  /**
   * Upload files to the sandbox
   */
  async uploadFiles(files: SandboxFile[]): Promise<void> {
    if (!this.sandbox) {
      throw new Error('Sandbox not created');
    }

    const sandboxFiles = files.map(f => ({
      path: f.path,
      content: Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content),
    }));

    await this.sandbox.writeFiles(sandboxFiles);
    this._log('system', `Uploaded ${files.length} file(s)`);
  }

  /**
   * Read a file from the sandbox
   */
  async readFile(path: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error('Sandbox not created');
    }

    const content = await this.sandbox.readFileToBuffer({ path });
    if (content === null) {
      throw new Error(`File not found: ${path}`);
    }
    return content.toString('utf-8');
  }

  /**
   * Write a file to the sandbox
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (!this.sandbox) {
      throw new Error('Sandbox not created');
    }

    await this.sandbox.writeFiles([
      { path, content: Buffer.from(content) },
    ]);
    this._log('system', `Wrote file: ${path}`);
  }

  /**
   * List files in a directory
   */
  async listFiles(path: string): Promise<string[]> {
    if (!this.sandbox) {
      throw new Error('Sandbox not created');
    }

    const result = await this.sandbox.runCommand({
      cmd: 'ls',
      args: ['-1', path],
    });

    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      throw new Error(`Failed to list files: ${stderr}`);
    }

    const stdout = await result.stdout();
    return stdout.split('\n').filter(f => f.trim());
  }

  /**
   * Run a command in the sandbox
   */
  async runCommand(cmd: string, args: string[] = []): Promise<CommandResult> {
    if (!this.sandbox) {
      throw new Error('Sandbox not created');
    }

    const result = await this.sandbox.runCommand({ cmd, args });
    this._log('system', `Command: ${cmd} ${args.join(' ')} -> exit ${result.exitCode}`);

    const stdout = await result.stdout();
    const stderr = await result.stderr();

    return {
      stdout,
      stderr,
      exitCode: result.exitCode,
    };
  }

  /**
   * Add a log entry
   */
  private _log(type: string, message: string): void {
    const entry: LogEntry = {
      type,
      message,
      timestamp: new Date().toISOString(),
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.emit('log', entry);
  }

  /**
   * Get logs
   */
  getLogs(count = 50, filter?: string): LogEntry[] {
    let filtered = this.logs;
    if (filter) {
      filtered = this.logs.filter(l => l.type === filter);
    }
    return filtered.slice(-count);
  }

  /**
   * Search logs
   */
  searchLogs(query: string): LogEntry[] {
    const lower = query.toLowerCase();
    return this.logs.filter(l => l.message.toLowerCase().includes(lower));
  }

  /**
   * Get custom state
   */
  getCustomState(key?: string): unknown {
    if (key) {
      return this.customState[key];
    }
    return { ...this.customState };
  }

  /**
   * Get sandbox state
   */
  getState(): SandboxState {
    return {
      isCreated: this._isCreated,
      isRunning: this._isRunning,
      startedAt: this.startedAt,
      entry: this.entry,
      entryArgs: this.entryArgs,
      customState: { ...this.customState },
    };
  }

  /**
   * Check if sandbox is created
   */
  isCreated(): boolean {
    return this._isCreated;
  }

  /**
   * Check if sandbox is running
   */
  isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get the underlying sandbox instance (for testing)
   */
  getSandbox(): VercelSandbox | null {
    return this.sandbox;
  }

  /**
   * Set the sandbox instance (for testing with mocks)
   */
  setSandbox(sandbox: VercelSandbox): void {
    this.sandbox = sandbox;
    this._isCreated = true;
  }
}
