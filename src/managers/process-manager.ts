/**
 * ProcessManager - Manages external child processes for CLI mode
 *
 * This class spawns and controls Node.js child processes,
 * capturing their output, handling IPC for injection, and
 * providing V8 debugging capabilities.
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RemoteDebugger, BreakpointInfo, CallFrame } from './remote-debugger.js';
import type { LogEntry, ProcessState, EventHandler } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ProcessManagerOptions {
  entry: string;
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

export interface PersistedBreakpoint extends BreakpointInfo {
  enabled: boolean;
  prompt: string;
  promptEnabled: boolean;
  hitCount: number;
}

export interface TriggeredBreakpointPrompt {
  breakpoint: PersistedBreakpoint;
  callFrames: CallFrame[];
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
  private entry: string;
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

  // V8 Inspector debugging
  private debug: boolean;
  private debugger: RemoteDebugger | null = null;
  private inspectorUrl: string | null = null;
  private debuggerReady = false;

  // Persisted breakpoints survive restarts
  private persistedBreakpoints: PersistedBreakpoint[] = [];

  // Queue of triggered breakpoint prompts for dashboard to consume
  private triggeredBreakpointPrompts: TriggeredBreakpointPrompt[] = [];

  // State from child makeReflexive() instances (parent-child coordination)
  private clientState: Record<string, unknown> = {};

  constructor(options: ProcessManagerOptions) {
    this.options = options;
    this.entry = resolve(options.entry);
    this.cwd = dirname(this.entry);
    this.interactive = options.interactive || false;
    this.inject = options.inject || false;
    this.debug = options.debug || false;
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

    // Store CLI port for environment setup
    if (cliPort) {
      this.options.cliPort = cliPort;
    }

    // Build node args, adding --require for injection if enabled
    const nodeArgs = [...(this.options.nodeArgs || [])];
    if (this.inject) {
      const injectPath = resolve(__dirname, '..', '..', 'src', 'inject.cjs');
      nodeArgs.unshift('--require', injectPath);
    }

    // Add V8 Inspector flag if debugging is enabled
    if (this.debug) {
      // Use --inspect-brk=0 to pause on first line and use random port
      nodeArgs.unshift('--inspect-brk=0');
    }

    const args = [...nodeArgs, this.entry, ...(this.options.appArgs || [])];

    // In interactive mode, pipe stdin so we can send input programmatically
    const stdinMode = this.interactive ? 'pipe' : 'inherit';

    // Add IPC channel if injection is enabled
    const stdio: ('pipe' | 'inherit' | 'ipc')[] = this.inject
      ? [stdinMode, 'pipe', 'pipe', 'ipc']
      : [stdinMode, 'pipe', 'pipe'];

    // Set up environment for injection and CLI coordination
    const env: Record<string, string | undefined> = { ...process.env, FORCE_COLOR: '1' };
    if (this.inject) {
      env.REFLEXIVE_INJECT = 'true';
    }
    if (this.options.eval) {
      env.REFLEXIVE_EVAL = 'true';
    }
    // Enable parent-child coordination: if app uses makeReflexive(), it will connect to CLI instead
    if (this.options.cliPort) {
      env.REFLEXIVE_CLI_MODE = 'true';
      env.REFLEXIVE_CLI_PORT = String(this.options.cliPort);
    }

    // Reset debugger state
    if (this.debugger) {
      this.debugger.disconnect();
      this.debugger = null;
    }
    this.inspectorUrl = null;
    this.debuggerReady = false;

    this.child = spawn(process.execPath, args, {
      cwd: this.cwd,
      env,
      stdio
    });

    this._isRunning = true;
    this.startTime = Date.now();
    this.exitCode = null;
    this.waitingForInput = false;
    this.pendingOutput = '';

    this._log('system', `Started: node ${args.join(' ')}${this.interactive ? ' (interactive mode)' : ''}`);

    this.child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stdout.write(text);
      this._log('stdout', text.trim());

      if (this.interactive) {
        this._handleInteractiveOutput(text, 'stdout');
      }
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stderr.write(text);
      this._log('stderr', text.trim());

      // Parse V8 Inspector URL from stderr when debugging
      if (this.debug && !this.inspectorUrl) {
        const match = text.match(/ws:\/\/[\d.]+:\d+\/[\w-]+/);
        if (match) {
          this.inspectorUrl = match[0];
          this._connectDebugger(this.inspectorUrl);
        }
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
      if (this.debugger) {
        this.debugger.disconnect();
        this.debugger = null;
        this.debuggerReady = false;
        this.inspectorUrl = null;
      }

      // Auto-restart removed - was part of --watch feature which has been removed
    });

    this.child.on('error', (err: Error) => {
      this._log('error', `Process error: ${err.message}`);
    });

    // Handle IPC messages from injected child process
    if (this.inject) {
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
   * Connect to V8 Inspector debugger
   */
  private async _connectDebugger(wsUrl: string): Promise<void> {
    try {
      this.debugger = new RemoteDebugger();

      // Forward debugger events
      this.debugger.on('paused', (data: unknown) => {
        const pauseData = data as { reason: string; hitBreakpoints?: string[]; callFrames: CallFrame[] };
        this._log('debug', `Debugger paused: ${pauseData.reason}${pauseData.hitBreakpoints?.length ? ` at ${pauseData.hitBreakpoints.join(', ')}` : ''}`);

        // Check if any hit breakpoint has a prompt to trigger
        if (pauseData.hitBreakpoints && pauseData.hitBreakpoints.length > 0) {
          for (const bpId of pauseData.hitBreakpoints) {
            const bp = this.persistedBreakpoints.find(b => b.id === bpId);
            if (bp && bp.prompt && bp.promptEnabled) {
              bp.hitCount = (bp.hitCount || 0) + 1;
              // Queue the prompt for the dashboard to consume
              this.triggeredBreakpointPrompts.push({
                breakpoint: { ...bp },
                callFrames: pauseData.callFrames,
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

      this.debugger.on('resumed', () => {
        this._log('debug', 'Debugger resumed');
        this.emit('debuggerResumed', {});
      });

      this.debugger.on('disconnected', () => {
        this._log('debug', 'Debugger disconnected');
        this.debuggerReady = false;
        this.emit('debuggerDisconnected', {});
      });

      await this.debugger.connect(wsUrl);
      await this.debugger.enable();

      this.debuggerReady = true;
      this._log('system', `[debug] V8 Inspector connected: ${wsUrl}`);
      this.emit('debuggerReady', { url: wsUrl });

      // Re-apply persisted breakpoints from previous session
      if (this.persistedBreakpoints && this.persistedBreakpoints.length > 0) {
        this._log('debug', `Restoring ${this.persistedBreakpoints.length} breakpoint(s)`);
        for (const bp of this.persistedBreakpoints) {
          try {
            const result = await this.debugger.setBreakpoint(bp.file, bp.line, bp.condition || undefined);
            // Update the ID since new session gives new IDs
            bp.id = result.breakpointId;
            this._log('debug', `Restored breakpoint: ${bp.file}:${bp.line}`);
          } catch (err) {
            this._log('error', `Failed to restore breakpoint ${bp.file}:${bp.line}: ${(err as Error).message}`);
          }
        }
      }

      // Auto-resume from initial --inspect-brk pause
      // Use a short delay to allow breakpoints to be restored first
      setTimeout(async () => {
        if (this.debugger) {
          try {
            // With --inspect-brk, process is waiting for debugger
            // runIfWaitingForDebugger starts it, but it immediately pauses on first line
            // So we need to also call resume()
            this._log('debug', 'Starting app (runIfWaitingForDebugger)');
            await this.debugger.runIfWaitingForDebugger();

            // Give it a moment to hit the first-line breakpoint
            await new Promise(r => setTimeout(r, 50));

            // Now resume from the first-line breakpoint
            this._log('debug', 'Resuming from first-line breakpoint');
            await this.debugger.resume();
          } catch (err) {
            this._log('debug', `Start error (non-critical): ${(err as Error).message}`);
          }
        }
      }, 200);

    } catch (err) {
      this._log('error', `Failed to connect debugger: ${(err as Error).message}`);
      this.debugger = null;
    }
  }

  // Debugger API methods

  /**
   * Set a breakpoint
   */
  async debugSetBreakpoint(file: string, line: number, condition?: string): Promise<{ breakpointId: string }> {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    // Resolve to absolute path for consistency
    const absFile = resolve(file);
    const result = await this.debugger.setBreakpoint(absFile, line, condition);
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
        locations: result.locations
      });
    }

    return { breakpointId: result.breakpointId };
  }

  /**
   * Remove a breakpoint
   */
  async debugRemoveBreakpoint(breakpointId: string): Promise<void> {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.removeBreakpoint(breakpointId);
    this._log('debug', `Breakpoint removed: ${breakpointId}`);

    // Remove from persisted list
    this.persistedBreakpoints = this.persistedBreakpoints.filter(bp => bp.id !== breakpointId);
  }

  /**
   * List all breakpoints
   */
  debugListBreakpoints(): (BreakpointInfo & { prompt?: string; promptEnabled?: boolean; enabled?: boolean; hitCount?: number })[] {
    if (!this.debugger) {
      return [];
    }
    // Merge debugger breakpoints with persisted data (prompt, etc.)
    const debuggerBps = this.debugger.listBreakpoints();
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
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.resume();
  }

  /**
   * Pause debugger execution
   */
  async debugPause(): Promise<void> {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.pause();
  }

  /**
   * Step over current statement
   */
  async debugStepOver(): Promise<void> {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.stepOver();
  }

  /**
   * Step into function call
   */
  async debugStepInto(): Promise<void> {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.stepInto();
  }

  /**
   * Step out of current function
   */
  async debugStepOut(): Promise<void> {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.stepOut();
  }

  /**
   * Evaluate expression in debugger
   */
  async debugEvaluate(expression: string, callFrameId: string | null = null): Promise<unknown> {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    return await this.debugger.evaluate(expression, callFrameId);
  }

  /**
   * Get current call stack
   */
  debugGetCallStack(): CallFrame[] | null {
    if (!this.debugger) {
      return null;
    }
    return this.debugger.getCallStack();
  }

  /**
   * Get scope variables
   */
  async debugGetScopeVariables(callFrameId: string, scopeType = 'local'): Promise<unknown> {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    return await this.debugger.getScopeVariables(callFrameId, scopeType);
  }

  /**
   * Check if debugger is paused
   */
  isDebuggerPaused(): boolean {
    return this.debugger?.isPaused() || false;
  }

  /**
   * Check if debugger is connected
   */
  isDebuggerConnected(): boolean {
    return this.debugger?.isConnected() || false;
  }

  /**
   * Get debugger state
   */
  getDebuggerState(): {
    connected: boolean;
    paused: boolean;
    inspectorUrl: string | null;
    breakpoints: BreakpointInfo[];
    callStack: CallFrame[] | null;
  } {
    return {
      connected: this.isDebuggerConnected(),
      paused: this.isDebuggerPaused(),
      inspectorUrl: this.inspectorUrl,
      breakpoints: this.debugListBreakpoints(),
      callStack: this.debugGetCallStack()
    };
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
  getState(): ProcessState {
    return {
      isRunning: this._isRunning,
      pid: this.child?.pid || null,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      restartCount: this.restartCount,
      exitCode: this.exitCode,
      entry: this.entry,
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
      inspectorUrl: this.inspectorUrl
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
    if (this.debugger) {
      this.debugger.disconnect();
      this.debugger = null;
    }
    if (this.outputSettleTimeout) {
      clearTimeout(this.outputSettleTimeout);
      this.outputSettleTimeout = null;
    }
  }
}
