/**
 * ProcessManager - Manages external child processes for CLI mode
 *
 * This class spawns and controls child processes for multiple languages,
 * capturing their output, handling IPC for injection (Node.js only), and
 * providing debugging capabilities via language-specific adapters.
 *
 * Supported languages:
 * - Node.js (.js, .ts, etc.) - V8 Inspector Protocol
 * - Python (.py) - debugpy via DAP
 * - Go (.go) - Delve via DAP
 * - .NET (.cs, .dll) - netcoredbg via DAP
 * - Rust (.rs) - CodeLLDB via DAP
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import type { DebugAdapter, BreakpointInfo, StackFrame, LanguageRuntime, DebugConnectionOptions } from '../types/debug.js';
import { V8InspectorAdapter } from '../adapters/v8-inspector-adapter.js';
import { runtimeRegistry, findAvailablePort } from '../runtimes/index.js';
import type { LogEntry, ProcessState, EventHandler } from '../types/index.js';

// Legacy re-export for backward compatibility
export type { BreakpointInfo };
export type CallFrame = StackFrame;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ProcessManagerOptions {
  entry?: string;  // Optional - can be set later via setEntry()
  nodeArgs?: string[];
  appArgs?: string[];
  interactive?: boolean;
  inject?: boolean;
  eval?: boolean;
  debug?: boolean;
  cliPort?: number;  // Port of the CLI dashboard for parent-child coordination
  capabilities?: {
    restart?: boolean;
  };
}

export interface PersistedBreakpoint {
  id: string;
  file: string;
  line: number;
  condition: string | null;
  enabled: boolean;
  prompt: string;
  promptEnabled: boolean;
  hitCount: number;
  locations?: unknown[];
}

export interface TriggeredBreakpointPrompt {
  breakpoint: PersistedBreakpoint;
  callFrames: StackFrame[];
  timestamp: number;
}

export interface EvalCallback {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export interface InjectedMessage {
  reflexive: boolean;
  type: string;
  data?: Record<string, unknown>;
  timestamp?: number;
  id?: number;
}

export class ProcessManager {
  private options: ProcessManagerOptions;
  private entry: string | null;
  private cwd: string;
  private child: ChildProcess | null = null;
  private _isRunning = false;
  private restartCount = 0;
  private startTime: number | null = null;
  private logs: LogEntry[] = [];
  private maxLogs = 500;
  private exitCode: number | null = null;

  // Interactive mode state
  private interactive: boolean;
  private waitingForInput = false;
  private lastOutputTime: number | null = null;
  private inputPromptPatterns: RegExp[] = [
    /^You:\s*$/m,
    /^>\s*$/m,
    /\?\s*$/m,
    /:\s*$/m,
    />>>\s*$/m,
    /\$\s*$/m,
    /input:/i,
    /enter.*:/i,
    /prompt>/i
  ];
  private pendingOutput = '';
  private outputSettleTimeout: ReturnType<typeof setTimeout> | null = null;
  private eventHandlers = new Map<string, EventHandler[]>();

  // Injection mode state
  private inject: boolean;
  private injectedState: Record<string, unknown> = {};
  private injectionReady = false;

  // Eval callbacks
  private evalCallbacks = new Map<number, EvalCallback>();
  private evalIdCounter = 0;

  // Multi-language debugging
  private debug: boolean;
  private debugAdapter: DebugAdapter | null = null;
  private debugConnectionInfo: string | null = null;  // URL or host:port
  private debuggerReady = false;
  private currentRuntime: LanguageRuntime | null = null;
  private debugPort: number = 0;

  // Persisted breakpoints survive restarts
  private persistedBreakpoints: PersistedBreakpoint[] = [];

  // Queue of triggered breakpoint prompts for dashboard to consume
  private triggeredBreakpointPrompts: TriggeredBreakpointPrompt[] = [];

  // State from child makeReflexive() instances (parent-child coordination)
  private clientState: Record<string, unknown> = {};

  constructor(options: ProcessManagerOptions) {
    this.options = options;
    this.entry = options.entry ? resolve(options.entry) : null;
    this.cwd = this.entry ? dirname(this.entry) : process.cwd();
    this.interactive = options.interactive || false;
    this.inject = options.inject || false;
    this.debug = options.debug || false;
  }

  /**
   * Set or change the entry file (for dynamic app switching)
   */
  setEntry(entryPath: string): void {
    this.entry = resolve(entryPath);
    this.cwd = dirname(this.entry);
    this.options.entry = this.entry;
  }

  /**
   * Check if an entry file is configured
   */
  hasEntry(): boolean {
    return this.entry !== null;
  }

  /**
   * Update runtime options (used by /reload endpoint)
   */
  updateOptions(updates: {
    interactive?: boolean;
    inject?: boolean;
    eval?: boolean;
    debug?: boolean;
  }): void {
    if (updates.interactive !== undefined) {
      this.interactive = updates.interactive;
      this.options.interactive = updates.interactive;
    }
    if (updates.inject !== undefined) {
      this.inject = updates.inject;
      this.options.inject = updates.inject;
    }
    if (updates.eval !== undefined) {
      this.options.eval = updates.eval;
    }
    if (updates.debug !== undefined) {
      this.debug = updates.debug;
      this.options.debug = updates.debug;
    }
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
   * Start the child process
   * @param cliPort - Optional port of the CLI dashboard for parent-child coordination
   */
  start(cliPort?: number): void {
    if (this._isRunning) return;
    if (!this.entry) {
      this._log('error', 'No entry file configured. Use setEntry() or run_app tool first.');
      return;
    }

    // Store CLI port for environment setup
    if (cliPort) {
      this.options.cliPort = cliPort;
    }

    // Start async to handle port allocation
    this._startAsync(cliPort).catch((err) => {
      this._log('error', `Failed to start process: ${err.message}`);
    });
  }

  /**
   * Async implementation of start()
   */
  private async _startAsync(cliPort?: number): Promise<void> {
    if (!this.entry) return;

    // Detect runtime based on file extension
    const ext = extname(this.entry);
    this.currentRuntime = runtimeRegistry.getByExtension(ext) || null;

    // Determine if this is Node.js (supports injection and IPC)
    const isNodeRuntime = this.currentRuntime?.name === 'node' || !this.currentRuntime;
    const runtimeName = this.currentRuntime?.displayName || 'Node.js';

    // Allocate debug port if debugging is enabled
    if (this.debug && this.currentRuntime) {
      this.debugPort = await findAvailablePort(this.currentRuntime.defaultPort);
    }

    let command: string;
    let args: string[];
    let env: Record<string, string | undefined> = { ...process.env, FORCE_COLOR: '1' };

    if (isNodeRuntime) {
      // Node.js runtime - use existing logic with injection support
      command = process.execPath;
      const nodeArgs = [...(this.options.nodeArgs || [])];

      if (this.inject) {
        const injectPath = resolve(__dirname, '..', '..', 'src', 'inject.cjs');
        nodeArgs.unshift('--require', injectPath);
        env.REFLEXIVE_INJECT = 'true';
      }
      if (this.options.eval) {
        env.REFLEXIVE_EVAL = 'true';
      }
      if (this.debug) {
        nodeArgs.unshift(`--inspect-brk=${this.debugPort}`);
      }
      if (this.options.cliPort) {
        env.REFLEXIVE_CLI_MODE = 'true';
        env.REFLEXIVE_CLI_PORT = String(this.options.cliPort);
      }

      args = [...nodeArgs, this.entry, ...(this.options.appArgs || [])];
    } else if (this.currentRuntime) {
      // Other runtimes - use runtime configuration
      command = this.currentRuntime.command;

      if (this.debug) {
        args = this.currentRuntime.buildArgs(this.debugPort, this.entry, this.options.appArgs);
      } else {
        // Non-debug mode: just run the file directly
        args = [this.entry, ...(this.options.appArgs || [])];
      }

      // Add runtime-specific environment variables
      if (this.currentRuntime.buildEnv) {
        Object.assign(env, this.currentRuntime.buildEnv(this.debugPort));
      }

      // Disable injection for non-Node runtimes
      if (this.inject) {
        this._log('system', `[warn] Injection not supported for ${runtimeName}, disabling`);
        this.inject = false;
      }
    } else {
      // Fallback to Node.js
      command = process.execPath;
      args = [this.entry, ...(this.options.appArgs || [])];
    }

    // In interactive mode, pipe stdin so we can send input programmatically
    const stdinMode = this.interactive ? 'pipe' : 'inherit';

    // Add IPC channel if injection is enabled (Node.js only)
    const stdio: ('pipe' | 'inherit' | 'ipc')[] = this.inject && isNodeRuntime
      ? [stdinMode, 'pipe', 'pipe', 'ipc']
      : [stdinMode, 'pipe', 'pipe'];

    // Reset debugger state
    if (this.debugAdapter) {
      this.debugAdapter.disconnect();
      this.debugAdapter = null;
    }
    this.debugConnectionInfo = null;
    this.debuggerReady = false;

    this.child = spawn(command, args, {
      cwd: this.cwd,
      env,
      stdio
    });

    this._isRunning = true;
    this.startTime = Date.now();
    this.exitCode = null;
    this.waitingForInput = false;
    this.pendingOutput = '';

    const debugInfo = this.debug ? ` [debug:${this.debugPort}]` : '';
    this._log('system', `Started (${runtimeName}): ${command} ${args.join(' ')}${debugInfo}${this.interactive ? ' (interactive)' : ''}`);

    this.child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stdout.write(text);
      this._log('stdout', text.trim());

      // Check for debug ready signal
      if (this.debug && !this.debugConnectionInfo && this.currentRuntime) {
        this._checkDebugReady(text);
      }

      if (this.interactive) {
        this._handleInteractiveOutput(text, 'stdout');
      }
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stderr.write(text);
      this._log('stderr', text.trim());

      // Check for debug ready signal (often on stderr)
      if (this.debug && !this.debugConnectionInfo && this.currentRuntime) {
        this._checkDebugReady(text);
      }

      if (this.interactive) {
        this._handleInteractiveOutput(text, 'stderr');
      }
    });

    this.child.on('exit', (code, signal) => {
      this._isRunning = false;
      this.exitCode = code;
      this._log('system', `Exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);

      // Clean up debugger connection
      if (this.debugAdapter) {
        this.debugAdapter.disconnect();
        this.debugAdapter = null;
        this.debuggerReady = false;
        this.debugConnectionInfo = null;
      }
    });

    this.child.on('error', (err: Error) => {
      this._log('error', `Process error: ${err.message}`);
    });

    // Handle IPC messages from injected child process (Node.js only)
    if (this.inject && isNodeRuntime) {
      this.child.on('message', (msg: unknown) => {
        const message = msg as InjectedMessage;
        if (!message || !message.reflexive) return;
        this._handleInjectedMessage(message);
      });
    }
  }

  /**
   * Stop the child process
   */
  stop(): Promise<void> {
    if (!this._isRunning || !this.child) return Promise.resolve();

    return new Promise((resolve) => {
      const killTimeout = setTimeout(() => {
        if (this._isRunning && this.child) {
          this.child.kill('SIGKILL');
        }
      }, 5000);

      this.child!.once('exit', () => {
        clearTimeout(killTimeout);
        this._isRunning = false;
        resolve();
      });

      this.child!.kill('SIGTERM');
    });
  }

  /**
   * Restart the child process
   */
  async restart(): Promise<void> {
    this._log('system', 'Restarting...');
    await this.stop();
    this.restartCount++;
    this.start();
  }

  /**
   * Run a different app (stop current, switch entry, start new)
   */
  async runApp(entryPath: string, appArgs?: string[]): Promise<void> {
    this._log('system', `Switching to: ${entryPath}`);
    await this.stop();
    this.setEntry(entryPath);
    if (appArgs) {
      this.options.appArgs = appArgs;
    }
    this.restartCount = 0;  // Reset restart count for new app
    this.start();
  }

  /**
   * Add a log entry
   */
  private _log(type: string, message: string): void {
    const entry: LogEntry = {
      type,
      message,
      timestamp: new Date().toISOString()
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.emit('log', entry);
  }

  /**
   * Handle messages from injected child process
   */
  private _handleInjectedMessage(msg: InjectedMessage): void {
    const { type, data, timestamp } = msg;

    switch (type) {
      case 'ready':
        this.injectionReady = true;
        this._log('system', `[inject] Injection ready - pid: ${data?.pid}, node: ${data?.nodeVersion}`);
        this.emit('injectionReady', data);
        break;

      case 'log': {
        const level = (data?.level as string) || 'info';
        this._log(`inject:${level}`, data?.message as string);
        this.emit('injectedLog', { level, message: data?.message, meta: data?.meta, timestamp });
        break;
      }

      case 'error':
        this._log('inject:error', `[${data?.type}] ${data?.name}: ${data?.message}`);
        if (data?.stack) {
          this._log('inject:error', data.stack as string);
        }
        this.emit('injectedError', data);
        break;

      case 'state':
        this.injectedState[data?.key as string] = data?.value;
        this._log('inject:state', `State: ${data?.key} = ${JSON.stringify(data?.value)}`);
        this.emit('injectedState', data);
        break;

      case 'stateResponse':
        this.injectedState = { ...this.injectedState, ...(data?.state as Record<string, unknown>) };
        this.emit('stateResponse', data?.state);
        break;

      case 'event':
        this._log('inject:event', `Event: ${data?.event} - ${JSON.stringify(data?.data)}`);
        this.emit('injectedEvent', data);
        break;

      case 'span':
        if (data?.phase === 'start') {
          this._log('inject:span', `Span start: ${data.name}`);
        } else {
          const status = data?.error ? `error: ${data.error}` : 'ok';
          this._log('inject:span', `Span end: ${data?.name} (${data?.duration}ms) ${status}`);
        }
        this.emit('injectedSpan', data);
        break;

      case 'diagnostic':
        this._log('inject:diagnostic', `[${data?.channel}] ${JSON.stringify(data?.request || data)}`);
        this.emit('injectedDiagnostic', data);
        break;

      case 'perf':
        if (data?.type === 'gc') {
          this._log('inject:perf', `GC: kind=${data.kind}, duration=${(data.duration as number)?.toFixed(2)}ms`);
        } else if (data?.type === 'eventLoop') {
          this._log('inject:perf', `Event Loop: mean=${(data.mean as number)?.toFixed(2)}ms, p99=${(data.p99 as number)?.toFixed(2)}ms`);
        }
        this.emit('injectedPerf', data);
        break;

      case 'evalResponse': {
        const callback = this.evalCallbacks.get(msg.id!);
        if (callback) {
          this.evalCallbacks.delete(msg.id!);
          if (data?.success) {
            callback.resolve(data.result);
          } else {
            callback.reject(new Error(data?.error as string));
          }
        }
        if (data?.success) {
          this._log('inject:eval', `Eval result: ${JSON.stringify(data.result).slice(0, 200)}`);
        } else {
          this._log('inject:eval', `Eval error: ${data?.error}`);
        }
        this.emit('evalResponse', data);
        break;
      }

      case 'globalsResponse':
        this._log('inject:globals', `Globals: ${(data?.globals as string[]).slice(0, 20).join(', ')}...`);
        this.emit('globalsResponse', data);
        break;

      default:
        this._log('inject:unknown', `Unknown message type: ${type}`);
    }
  }

  /**
   * Evaluate code in the child process
   */
  evaluate(code: string, timeout = 10000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.inject || !this.options.eval) {
        reject(new Error('Eval not enabled. Run with --eval flag.'));
        return;
      }
      if (!this.child || !this.injectionReady) {
        reject(new Error('Process not ready for eval.'));
        return;
      }

      const id = ++this.evalIdCounter;
      const timeoutHandle = setTimeout(() => {
        this.evalCallbacks.delete(id);
        reject(new Error('Eval timed out'));
      }, timeout);

      this.evalCallbacks.set(id, {
        resolve: (result) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        }
      });

      try {
        this.child.send({ reflexive: true, type: 'eval', id, code });
      } catch (e) {
        this.evalCallbacks.delete(id);
        clearTimeout(timeoutHandle);
        reject(new Error(`Failed to send eval: ${(e as Error).message}`));
      }
    });
  }

  /**
   * Query injected state from child process
   */
  queryInjectedState(): void {
    if (this.inject && this.child && this.injectionReady) {
      try {
        this.child.send({ reflexive: true, type: 'getState' });
      } catch {
        // Child may have disconnected
      }
    }
  }

  /**
   * Get cached injected state
   */
  getInjectedState(): Record<string, unknown> {
    return { ...this.injectedState };
  }

  /**
   * Check if debug output indicates the debugger is ready
   */
  private _checkDebugReady(output: string): void {
    if (!this.currentRuntime || this.debugConnectionInfo) return;

    const connectionOptions = this.currentRuntime.parseDebugReady(output, this.debugPort);
    if (connectionOptions) {
      this._connectDebugger(connectionOptions);
    }
  }

  /**
   * Connect to the debug adapter (V8 Inspector or DAP)
   */
  private async _connectDebugger(options: DebugConnectionOptions): Promise<void> {
    if (!this.currentRuntime) return;

    try {
      // Create the appropriate adapter for this runtime
      this.debugAdapter = this.currentRuntime.createAdapter();

      // Track whether we're waiting for the initial pause (Node.js --inspect-brk)
      let waitingForInitialPause = this.currentRuntime.protocol === 'v8-inspector';

      // Forward debugger events
      this.debugAdapter.on('paused', async (data: unknown) => {
        const pauseData = data as { reason: string; hitBreakpointIds?: string[]; threadId?: number };
        this._log('debug', `Debugger paused: ${pauseData.reason}${pauseData.hitBreakpointIds?.length ? ` at ${pauseData.hitBreakpointIds.join(', ')}` : ''}`);

        // Auto-resume from initial --inspect-brk pause ("entry" in our normalized events)
        if (waitingForInitialPause && (pauseData.reason === 'entry' || pauseData.reason === 'Break on start')) {
          waitingForInitialPause = false;
          this._log('debug', 'Auto-resuming from initial break on start');
          // Resume asynchronously to not block the event handler
          this.debugAdapter?.resume().catch((err: Error) => {
            this._log('debug', `Auto-resume error (non-critical): ${err.message}`);
          });
          return; // Don't emit this pause to dashboard
        }

        // Check if any hit breakpoint has a prompt to trigger
        if (pauseData.hitBreakpointIds && pauseData.hitBreakpointIds.length > 0) {
          for (const bpId of pauseData.hitBreakpointIds) {
            const bp = this.persistedBreakpoints.find(b => b.id === bpId);
            if (bp && bp.prompt && bp.promptEnabled) {
              bp.hitCount = (bp.hitCount || 0) + 1;

              // Get call stack for the prompt
              const callFrames = await this.debugAdapter?.getCallStack().catch(() => []) || [];

              // Queue the prompt for the dashboard to consume
              this.triggeredBreakpointPrompts.push({
                breakpoint: { ...bp },
                callFrames,
                timestamp: Date.now()
              });
              const filename = bp.file.split('/').pop();
              this._log('breakpoint-prompt', `BREAKPOINT PROMPT TRIGGERED: ${filename}:${bp.line}`);
              this._log('breakpoint-prompt', `   Prompt: "${bp.prompt.slice(0, 100)}${bp.prompt.length > 100 ? '...' : ''}"`);
            }
          }
        }

        this.emit('debuggerPaused', data);
      });

      this.debugAdapter.on('resumed', () => {
        this._log('debug', 'Debugger resumed');
        this.emit('debuggerResumed', {});
      });

      this.debugAdapter.on('disconnected', () => {
        this._log('debug', 'Debugger disconnected');
        this.debuggerReady = false;
        this.emit('debuggerDisconnected', {});
      });

      // Connect to the debugger
      await this.debugAdapter.connect(options);
      await this.debugAdapter.initialize();

      this.debuggerReady = true;
      this.debugConnectionInfo = options.wsUrl || `${options.host || 'localhost'}:${options.port}`;
      this._log('system', `[debug] ${this.currentRuntime.displayName} debugger connected: ${this.debugConnectionInfo}`);
      this.emit('debuggerReady', { url: this.debugConnectionInfo });

      // Re-apply persisted breakpoints from previous session
      if (this.persistedBreakpoints && this.persistedBreakpoints.length > 0) {
        this._log('debug', `Restoring ${this.persistedBreakpoints.length} breakpoint(s)`);
        for (const bp of this.persistedBreakpoints) {
          try {
            const result = await this.debugAdapter.setBreakpoint(bp.file, bp.line, bp.condition || undefined);
            // Update the ID since new session gives new IDs
            bp.id = result.breakpointId;
            this._log('debug', `Restored breakpoint: ${bp.file}:${bp.line}`);
          } catch (err) {
            this._log('error', `Failed to restore breakpoint ${bp.file}:${bp.line}: ${(err as Error).message}`);
          }
        }
      }

      // Start the app (V8: runIfWaitingForDebugger, DAP: configurationDone)
      this._log('debug', 'Launching debuggee');
      await this.debugAdapter.launch();

    } catch (err) {
      this._log('error', `Failed to connect debugger: ${(err as Error).message}`);
      this.debugAdapter = null;
    }
  }

  // Debugger API methods

  /**
   * Set a breakpoint
   */
  async debugSetBreakpoint(file: string, line: number, condition?: string): Promise<{ breakpointId: string }> {
    if (!this.debugAdapter || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    // Resolve to absolute path for consistency
    const absFile = resolve(file);
    const result = await this.debugAdapter.setBreakpoint(absFile, line, condition);
    this._log('debug', `Breakpoint set: ${absFile}:${line}${condition ? ` (${condition})` : ''}`);

    // Persist for restarts (avoid duplicates)
    const existing = this.persistedBreakpoints.find(bp => bp.file === absFile && bp.line === line);
    if (!existing) {
      this.persistedBreakpoints.push({
        file: absFile,
        line,
        condition: condition || null,
        id: result.breakpointId,
        enabled: true,
        prompt: '',
        promptEnabled: false,
        hitCount: 0,
      });
    }

    return { breakpointId: result.breakpointId };
  }

  /**
   * Remove a breakpoint
   */
  async debugRemoveBreakpoint(breakpointId: string): Promise<void> {
    if (!this.debugAdapter || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugAdapter.removeBreakpoint(breakpointId);
    this._log('debug', `Breakpoint removed: ${breakpointId}`);

    // Remove from persisted list
    this.persistedBreakpoints = this.persistedBreakpoints.filter(bp => bp.id !== breakpointId);
  }

  /**
   * List all breakpoints
   */
  debugListBreakpoints(): (BreakpointInfo & { prompt?: string; promptEnabled?: boolean; enabled?: boolean; hitCount?: number })[] {
    if (!this.debugAdapter) {
      return [];
    }
    // Merge debugger breakpoints with persisted data (prompt, etc.)
    const debuggerBps = this.debugAdapter.listBreakpoints();
    return debuggerBps.map(bp => {
      const persisted = this.persistedBreakpoints.find(p => p.id === bp.id);
      return {
        ...bp,
        prompt: persisted?.prompt || '',
        promptEnabled: persisted?.promptEnabled || false,
        enabled: persisted?.enabled !== false,
        hitCount: persisted?.hitCount || 0
      };
    });
  }

  /**
   * Get persisted breakpoints (includes those not yet set in debugger)
   */
  getPersistedBreakpoints(): PersistedBreakpoint[] {
    return [...this.persistedBreakpoints];
  }

  /**
   * Get and clear triggered breakpoint prompts (dashboard consumes these)
   */
  getTriggeredBreakpointPrompts(): TriggeredBreakpointPrompt[] {
    const prompts = [...this.triggeredBreakpointPrompts];
    this.triggeredBreakpointPrompts = [];
    return prompts;
  }

  /**
   * Update breakpoint properties (prompt, enabled states)
   */
  updateBreakpoint(breakpointId: string, updates: { prompt?: string; promptEnabled?: boolean; enabled?: boolean }): PersistedBreakpoint | null {
    const bp = this.persistedBreakpoints.find(b => b.id === breakpointId);
    if (!bp) {
      return null;
    }

    // Apply updates
    if (updates.prompt !== undefined) bp.prompt = updates.prompt;
    if (updates.promptEnabled !== undefined) bp.promptEnabled = updates.promptEnabled;
    if (updates.enabled !== undefined) bp.enabled = updates.enabled;

    return bp;
  }

  /**
   * Resume debugger execution
   */
  async debugResume(): Promise<void> {
    if (!this.debugAdapter || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugAdapter.resume();
  }

  /**
   * Pause debugger execution
   */
  async debugPause(): Promise<void> {
    if (!this.debugAdapter || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugAdapter.pause();
  }

  /**
   * Step over current statement
   */
  async debugStepOver(): Promise<void> {
    if (!this.debugAdapter || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugAdapter.stepOver();
  }

  /**
   * Step into function call
   */
  async debugStepInto(): Promise<void> {
    if (!this.debugAdapter || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugAdapter.stepInto();
  }

  /**
   * Step out of current function
   */
  async debugStepOut(): Promise<void> {
    if (!this.debugAdapter || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugAdapter.stepOut();
  }

  /**
   * Evaluate expression in debugger
   */
  async debugEvaluate(expression: string, callFrameId: string | null = null): Promise<unknown> {
    if (!this.debugAdapter || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    const result = await this.debugAdapter.evaluate(expression, callFrameId || undefined);
    return result;
  }

  /**
   * Get current call stack
   */
  debugGetCallStack(): StackFrame[] | null {
    if (!this.debugAdapter || !this.debugAdapter.isPaused()) {
      return null;
    }
    // Return cached call stack or empty
    // Note: The new adapter is async, so we cache the call stack on pause events
    return null; // Will be populated via events
  }

  /**
   * Get current call stack (async version)
   */
  async debugGetCallStackAsync(): Promise<StackFrame[]> {
    if (!this.debugAdapter || !this.debuggerReady) {
      return [];
    }
    return await this.debugAdapter.getCallStack();
  }

  /**
   * Get scope variables
   */
  async debugGetScopeVariables(callFrameId: string, scopeType = 'local'): Promise<unknown> {
    if (!this.debugAdapter || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    // Get scopes for the frame
    const scopes = await this.debugAdapter.getScopes(callFrameId);
    // Find the requested scope type
    const scope = scopes.find(s => s.type === scopeType) || scopes[0];
    if (!scope) {
      return [];
    }
    // Get variables for that scope
    return await this.debugAdapter.getVariables(scope.variablesReference);
  }

  /**
   * Check if debugger is paused
   */
  isDebuggerPaused(): boolean {
    return this.debugAdapter?.isPaused() || false;
  }

  /**
   * Check if debugger is connected
   */
  isDebuggerConnected(): boolean {
    return this.debugAdapter?.isConnected() || false;
  }

  /**
   * Get debugger state
   */
  getDebuggerState(): {
    connected: boolean;
    paused: boolean;
    inspectorUrl: string | null;
    breakpoints: BreakpointInfo[];
    callStack: StackFrame[] | null;
    runtime: string | null;
  } {
    return {
      connected: this.isDebuggerConnected(),
      paused: this.isDebuggerPaused(),
      inspectorUrl: this.debugConnectionInfo,
      breakpoints: this.debugListBreakpoints(),
      callStack: this.debugGetCallStack(),
      runtime: this.currentRuntime?.name || null
    };
  }

  /**
   * Get the current runtime info
   */
  getCurrentRuntime(): LanguageRuntime | null {
    return this.currentRuntime;
  }

  /**
   * Handle interactive output for detecting input prompts
   */
  private _handleInteractiveOutput(text: string, _source: string): void {
    this.lastOutputTime = Date.now();
    this.pendingOutput += text;

    // Clear any existing settle timeout
    if (this.outputSettleTimeout) {
      clearTimeout(this.outputSettleTimeout);
    }

    // Check for prompt patterns immediately
    const looksLikePrompt = this.inputPromptPatterns.some(pattern =>
      pattern.test(this.pendingOutput.slice(-100))
    );

    // Set a timeout to detect when output has "settled" (CLI is waiting)
    // Use longer timeouts to give CLI apps time to finish streaming
    this.outputSettleTimeout = setTimeout(() => {
      // Output has settled - CLI is likely waiting for input
      const wasWaiting = this.waitingForInput;
      this.waitingForInput = true;

      if (!wasWaiting) {
        // Emit event with the output that led to this prompt
        this.emit('waitingForInput', {
          output: this.pendingOutput,
          looksLikePrompt,
          timestamp: new Date().toISOString()
        });
      }

      // Reset pending output after emitting
      this.pendingOutput = '';
    }, 10000); // 10 seconds - give streaming chat apps time to finish
  }

  /**
   * Send input to the child process
   */
  sendInput(text: string, addNewline = true): boolean {
    if (!this.child || !this.child.stdin) {
      return false;
    }

    this.waitingForInput = false;
    const input = addNewline ? text + '\n' : text;
    this.child.stdin.write(input);
    this._log('stdin', text);
    this.emit('inputSent', { text, timestamp: new Date().toISOString() });
    return true;
  }

  /**
   * Get recent stdout/stderr output
   */
  getRecentOutput(lines = 20): string {
    const recent = this.logs
      .filter(l => l.type === 'stdout' || l.type === 'stderr')
      .slice(-lines);
    return recent.map(l => l.message).join('\n');
  }


  /**
   * Get process state
   */
  getState(): ProcessState & { runtime?: string } {
    return {
      isRunning: this._isRunning,
      pid: this.child?.pid || null,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      restartCount: this.restartCount,
      exitCode: this.exitCode,
      entry: this.entry || '',
      cwd: this.cwd,
      interactive: this.interactive,
      waitingForInput: this.waitingForInput,
      inject: this.inject,
      injectionReady: this.injectionReady,
      injectedState: this.inject ? this.injectedState : undefined,
      clientState: Object.keys(this.clientState).length > 0 ? this.clientState : undefined,
      debug: this.debug,
      debuggerConnected: this.isDebuggerConnected(),
      debuggerPaused: this.isDebuggerPaused(),
      inspectorUrl: this.debugConnectionInfo,
      runtime: this.currentRuntime?.displayName
    };
  }

  /**
   * Set state from child makeReflexive() instances (parent-child coordination)
   */
  setClientState(key: string, value: unknown): void {
    this.clientState[key] = value;
    this._log('system', `[client] setState: ${key} = ${JSON.stringify(value)}`);
  }

  /**
   * Get client state from child makeReflexive() instances
   */
  getClientState(): Record<string, unknown> {
    return { ...this.clientState };
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
   * Send message to child stdin (deprecated, use sendInput)
   */
  send(message: string): void {
    if (this.child && this.child.stdin) {
      this.child.stdin.write(message + '\n');
    }
  }

  /**
   * Check if process is running
   */
  isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get custom state (from injection)
   */
  getCustomState(key?: string): unknown {
    if (key) {
      return this.injectedState[key];
    }
    return { ...this.injectedState };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.debugAdapter) {
      this.debugAdapter.disconnect();
      this.debugAdapter = null;
    }
    if (this.outputSettleTimeout) {
      clearTimeout(this.outputSettleTimeout);
      this.outputSettleTimeout = null;
    }
  }
}
